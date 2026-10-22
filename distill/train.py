"""Distillation / behaviour-cloning trainer for the student (distill/model.py) on distill/datagen.mjs rows.

  python distill/train.py --config distill/configs/smoke.json [--data f1.jsonl f2.jsonl ...] [--steps N] [--fresh]
                          [--export <student.json>] [--respect-idle]

Losses per row (rows of early rounds weighted by early_round_weight — their teacher labels are the noisiest):
  util   MSE of q to the teacher's utility on every labelled legal action (soft labels, not just the winner)
  kl     KL(teacher softmax(u/tau) || student softmax(q/tau)) over the labelled legal actions
  pick   cross-entropy of the teacher's actual choice over the legal actions (auxiliary; -1 = outside the vocabulary)
  line   cross-entropy of the team-aware advisor's line over the available lines
  value  MSE of the value head to the game's final utility
Checkpoints <work_dir>/ckpt/last.pt (model, optimiser, step, data cursor, norm, config) every ckpt_every_sec and on
SIGTERM/SIGINT; a rerun resumes from it (--fresh starts over). Validation rows = game seed % val_mod == 0.
--respect-idle: re-check the idle gate (distill/idle.py) every idle.recheck_sec; when busy, checkpoint and exit 75.
Exit codes: 0 done, 75 paused (resume later).
"""
import argparse, glob, hashlib, json, math, os, signal, sys, time
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import load_config  # noqa: E402
from model import build  # noqa: E402
import idle as idle_gate  # noqa: E402

PAUSED = 75


def load_rows(files, cache_dir):
    """JSONL rows → arrays, cached per file (keyed by size + mtime)."""
    parts, meta = [], None
    for f in files:
        with open(f + '.meta.json') as fm:
            m = json.load(fm)
        if meta and (m['vocab'] != meta['vocab'] or m['featureNames'] != meta['featureNames'] or m['lines'] != meta['lines']):
            raise SystemExit(f'{f}: vocabulary / feature layout / lines differ from {files[0]} — regenerate the data')
        meta = meta or m
        st = os.stat(f)
        key = hashlib.sha1(f'{os.path.abspath(f)}:{st.st_size}:{st.st_mtime_ns}'.encode()).hexdigest()[:16]
        cp = os.path.join(cache_dir, f'{key}.npz')
        if not os.path.exists(cp):
            V, L, D = len(m['vocab']), len(m['lines']), len(m['featureNames'])
            rows = [json.loads(l) for l in open(f) if l.strip()]
            n = len(rows)
            X = np.zeros((n, D), np.float32); U = np.full((n, V), np.nan, np.float32); legal = np.zeros((n, V), bool)
            line_ok = np.zeros((n, L), bool); ints = np.zeros((n, 4), np.int64); z = np.zeros(n, np.float32)
            for i, r in enumerate(rows):
                if len(r['x']) != D:
                    raise SystemExit(f'{f}: row {i} has {len(r["x"])} features, layout says {D}')
                X[i] = r['x']; legal[i, r['legal']] = True; line_ok[i, r['lineAvail']] = True; z[i] = r['z']
                for k, v in r['u'].items():
                    U[i, int(k)] = v
                ints[i] = (r['seed'], r['round'], r['pick'], r['line'])
            os.makedirs(cache_dir, exist_ok=True)
            np.savez(cp + '.tmp.npz', X=X, U=U, legal=legal, line_ok=line_ok, ints=ints, z=z)
            os.replace(cp + '.tmp.npz', cp)
        d = np.load(cp)
        parts.append({k: d[k] for k in d.files})
    if not parts:
        raise SystemExit('no data files')
    return {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}, meta


def pick_device(want):
    if want != 'auto':
        return torch.device(want)
    if not torch.cuda.is_available():
        return torch.device('cpu')
    free = [torch.cuda.mem_get_info(i)[0] for i in range(torch.cuda.device_count())]
    return torch.device(f'cuda:{int(np.argmax(free))}')


def losses(out, b, t):
    q, legal, U = out['q'], b['legal'], b['U']
    lab = legal & ~torch.isnan(U)
    Uz = torch.nan_to_num(U)
    w = b['w']
    nl = lab.sum(1).clamp(min=1)
    util = (((q - Uz) ** 2) * lab).sum(1) / nl
    neg = torch.finfo(q.dtype).min / 4
    multi = lab.sum(1) >= 2
    pt = F.softmax(torch.where(lab, Uz / t['tau'], neg), 1)
    lps = F.log_softmax(torch.where(lab, q / t['tau'], neg), 1)
    kl = (pt * (torch.log(pt.clamp(min=1e-12)) - lps) * lab).sum(1) * multi
    pick_ok = b['pick'] >= 0
    pick = F.cross_entropy(torch.where(legal, q / t['tau'], neg), b['pick'].clamp(min=0), reduction='none') * pick_ok
    # a line label outside this game's available lines (the advisor "observed" a seat on a banned bond) is not trained on
    line_ok = (b['line'] >= 0) & b['line_ok'].gather(1, b['line'].clamp(min=0)[:, None]).squeeze(1)
    line = F.cross_entropy(torch.where(b['line_ok'], out['line'], neg), b['line'].clamp(min=0), reduction='none') * line_ok
    value = (out['value'] - b['z']) ** 2
    parts = {'util': util, 'kl': kl, 'pick': pick, 'line': line, 'value': value}
    total = sum(t[f'w_{k}'] * (v * w).sum() / w.sum() for k, v in parts.items())
    stats = {k: float((v * w).sum() / w.sum()) for k, v in parts.items()}
    # agreement: student's best legal action == teacher's best labelled action (rows with ≥ 2 labels)
    sb = torch.where(lab, q, neg).argmax(1); tb = torch.where(lab, Uz, neg).argmax(1)
    stats['top1'] = float(((sb == tb) * multi).sum() / multi.sum().clamp(min=1))
    stats['lineAcc'] = float(((torch.where(b['line_ok'], out['line'], neg).argmax(1) == b['line']) * line_ok).sum() / line_ok.sum().clamp(min=1))
    return total, stats


CLIP = 10.0


def normalize(x, mean, std):
    """standardise, then clip: a feature that barely moved in training must not explode on an unseen position
    (distill/student.mjs applies the same clip)."""
    return ((x - mean) / std).clamp(-CLIP, CLIP)


def batch_of(D, idx, mean, std, dev, t):
    rnd = D['ints'][idx, 1]
    w = np.where(rnd <= t['early_round_max'], t['early_round_weight'], 1.0).astype(np.float32)
    g = lambda a: torch.from_numpy(np.ascontiguousarray(a)).to(dev)
    return {'x': normalize(g(D['X'][idx]), mean, std), 'U': g(D['U'][idx]), 'legal': g(D['legal'][idx]), 'line_ok': g(D['line_ok'][idx]),
            'pick': g(D['ints'][idx, 2]), 'line': g(D['ints'][idx, 3]), 'z': g(D['z'][idx]), 'w': g(w)}


@torch.no_grad()
def evaluate(model, D, idx, mean, std, dev, t):
    model.eval()
    acc, n = {}, 0
    for s in range(0, len(idx), 4096):
        j = idx[s:s + 4096]
        b = batch_of(D, j, mean, std, dev, t)
        _, st = losses(model(b['x']), b, t)
        for k, v in st.items():
            acc[k] = acc.get(k, 0) + v * len(j)
        n += len(j)
    model.train()
    return {k: v / max(1, n) for k, v in acc.items()}


def save(path, **state):
    torch.save(state, path + '.tmp')
    os.replace(path + '.tmp', path)


def export_student(model, meta, mean, std, path, info, D, val_idx):
    """MLP → the JSON distill/student.mjs runs; carries 3 check rows so the JS side verifies its own forward pass."""
    lin = [m for m in model.trunk if isinstance(m, torch.nn.Linear)]
    r = lambda a: [float(f'{x:.7g}') for x in a]
    layer = lambda L: {'W': [r(row) for row in L.weight.detach().cpu().numpy()], 'b': r(L.bias.detach().cpu().numpy())}
    check_idx = val_idx[:3] if len(val_idx) >= 3 else np.arange(min(3, len(D['X'])))
    with torch.no_grad():
        xs = torch.from_numpy(D['X'][check_idx]).to(mean.device)
        out = model.eval()(normalize(xs, mean, std)); model.train()
    doc = {'format': 'sp-distill-student/1', 'arch': 'mlp', 'featureVersion': info['featureVersion'], 'vocab': meta['vocab'], 'lines': meta['lines'],
           'norm': {'mean': r(mean.cpu().numpy()), 'std': r(std.cpu().numpy()), 'clip': CLIP}, 'trunk': [layer(L) for L in lin],
           'heads': {k: layer(getattr(model.heads, k)) for k in ('q', 'line', 'value')},
           'check': {'x': [r(x) for x in D['X'][check_idx]], 'q': [r(q) for q in out['q'].cpu().numpy()]}, 'meta': info}
    with open(path + '.tmp', 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', required=True)
    ap.add_argument('--data', nargs='*', help='datagen JSONL files (default: every <work_dir>/data/*.jsonl)')
    ap.add_argument('--steps', type=int, help='train until this global step (default train.max_steps)')
    ap.add_argument('--fresh', action='store_true', help='ignore an existing checkpoint')
    ap.add_argument('--export', help='write the JS student JSON here (MLP only)')
    ap.add_argument('--respect-idle', action='store_true')
    a = ap.parse_args()
    cfg = load_config(a.config); t = cfg['train']; wd = cfg['work_dir']
    os.makedirs(os.path.join(wd, 'ckpt'), exist_ok=True)
    log_path = os.path.join(wd, 'logs', 'train.log'); os.makedirs(os.path.dirname(log_path), exist_ok=True)
    def log(**rec):
        rec = {'time': time.strftime('%F %T'), **rec}
        print(json.dumps(rec, ensure_ascii=False), flush=True)
        with open(log_path, 'a') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    files = a.data or sorted(f for f in glob.glob(os.path.join(wd, 'data', '*.jsonl')) if not f.endswith('.games.jsonl'))
    D, meta = load_rows(files, os.path.join(wd, 'cache'))
    seeds = D['ints'][:, 0]
    val_idx = np.where(seeds % t['val_mod'] == 0)[0]; tr_idx = np.where(seeds % t['val_mod'] != 0)[0]
    if len(tr_idx) == 0:
        raise SystemExit('no training rows (every game seed is in the validation split)')
    torch.manual_seed(t['seed']); rng = np.random.default_rng(t['seed'])
    dev = pick_device(t['device'])
    ck_path = os.path.join(wd, 'ckpt', 'last.pt')
    ck = torch.load(ck_path, map_location='cpu', weights_only=False) if os.path.exists(ck_path) and not a.fresh else None
    names, V, L = meta['featureNames'], len(meta['vocab']), len(meta['lines'])
    arch_kw = {k: t[k] for k in ('hidden', 'd', 'layers', 'heads', 'dropout')}
    if ck and (ck['arch'] != t['arch'] or ck['arch_kw'] != arch_kw or ck['names'] != names):
        raise SystemExit(f'{ck_path}: architecture / feature layout changed since the checkpoint — use --fresh')
    model = build(t['arch'], names, V, L, **arch_kw).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=t['lr'], weight_decay=t['weight_decay'])
    if ck:
        model.load_state_dict(ck['model']); opt.load_state_dict(ck['opt'])
        mean, std = ck['mean'].to(dev), ck['std'].to(dev)   # the student keeps its normalisation across DAgger rounds
        step, best = ck['step'], ck.get('best')
    else:
        X = D['X'][tr_idx]
        # scale floor: 5% of the feature's largest training magnitude (and ≥ 0.01), so near-constant features stay tame
        scale = np.maximum(X.std(0), np.maximum(1e-2, 0.05 * np.abs(X).max(0)))
        mean = torch.tensor(X.mean(0), device=dev); std = torch.tensor(scale, device=dev)
        step, best = 0, None
    target = a.steps or t['max_steps']
    n_params = sum(p.numel() for p in model.parameters())
    log(event='start', device=str(dev), arch=t['arch'], params=n_params, rows=len(D['X']), train=len(tr_idx), val=len(val_idx),
        files=len(files), resumed_step=step, target=target)
    stop = {'why': None}
    def on_signal(sig, _):
        stop['why'] = f'signal {sig}'
    signal.signal(signal.SIGTERM, on_signal); signal.signal(signal.SIGINT, on_signal)
    def checkpoint():
        save(ck_path, model=model.state_dict(), opt=opt.state_dict(), step=step, best=best, mean=mean.cpu(), std=std.cpu(),
             arch=t['arch'], arch_kw=arch_kw, names=names, vocab=meta['vocab'], lines=meta['lines'], config=cfg)
    t0 = last_ck = last_idle = time.time()
    while step < target and not stop['why']:
        perm = rng.permutation(tr_idx)
        for s in range(0, len(perm), t['batch']):
            b = batch_of(D, perm[s:s + t['batch']], mean, std, dev, t)
            loss, st = losses(model(b['x']), b, t)
            opt.zero_grad(set_to_none=True); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0); opt.step(); step += 1
            if step % t['eval_every'] == 0 or step == target:
                v = evaluate(model, D, val_idx, mean, std, dev, t) if len(val_idx) else {}
                score = v.get('util', 0) + v.get('kl', 0)
                if len(val_idx) and (best is None or score < best['score']):
                    best = {'score': score, 'step': step, 'val': v}
                    save(os.path.join(wd, 'ckpt', 'best.pt'), model=model.state_dict(), step=step, mean=mean.cpu(), std=std.cpu(),
                         arch=t['arch'], arch_kw=arch_kw, names=names, vocab=meta['vocab'], lines=meta['lines'])
                log(event='eval', step=step, train={k: round(x, 4) for k, x in st.items()}, val={k: round(x, 4) for k, x in v.items()},
                    elapsed=round(time.time() - t0, 1))
            now = time.time()
            if now - last_ck > t['ckpt_every_sec']:
                checkpoint(); last_ck = now
            if a.respect_idle and now - last_idle > cfg['idle'].get('recheck_sec', idle_gate.DEFAULTS['recheck_sec']):
                last_idle = now
                r = idle_gate.check(cfg['idle'])
                if not r['idle']:
                    stop['why'] = 'busy: ' + '; '.join(r['reasons'])
            if (now - t0) / 60 > t['max_minutes']:
                stop['why'] = stop['why'] or f'max_minutes {t["max_minutes"]} reached'
            if step >= target or stop['why']:
                break
    checkpoint()
    paused = bool(stop['why']) and step < target and not stop['why'].startswith('max_minutes')
    log(event='paused' if paused else 'done', step=step, why=stop['why'], best=best, elapsed=round(time.time() - t0, 1))
    if a.export:
        if t['arch'] != 'mlp':
            log(event='export-skipped', why=f'arch {t["arch"]} has no JS forward pass yet (distill/student.mjs runs mlp only)')
        else:
            src = os.path.join(wd, 'ckpt', 'best.pt')
            if os.path.exists(src):
                model.load_state_dict(torch.load(src, map_location='cpu', weights_only=False)['model'])
            info = {'featureVersion': meta['featureVersion'], 'step': step, 'bestStep': best and best['step'], 'val': best and best['val'], 'rows': int(len(D['X'])),
                    'params': n_params, 'files': [os.path.basename(f) for f in files], 'trainedAt': time.strftime('%F %T')}
            export_student(model, meta, mean, std, a.export, info, D, val_idx)
            log(event='exported', path=a.export)
    raise SystemExit(PAUSED if paused else 0)


if __name__ == '__main__':
    main()
