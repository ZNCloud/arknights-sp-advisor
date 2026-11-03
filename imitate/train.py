#!/usr/bin/env python3
"""Train + evaluate the imitation net on decisions.jsonl (imitate/dataset.py).

  cv     game-grouped K-fold (folds from the record's `fold`, fixed by game id) x model seeds; the lookup tables
         (imitate/evaluate.py) are fitted on the same training folds. Optional --train-games k = learning curve
         (each fold keeps only its first k training games in sha1(game id + "/lc") order).
  final  one net on every game (seed 0) -> <out>/final.pt (weights + itos + config) and its latency.
Writes <out>/eval.json (every fold x seed and the means) and prints the summary table.
Heads listed in model.prior (imitate/model.py) add the lookup-table logit of evaluate.py, fitted on the same training
records as the baseline tables (prior_tables); the test records only ever see tables fitted without them.
--only-fold f [--only-seed s] runs the cv of one fold (one seed) and writes <out>/cv_fold<f>[_s<s>].json instead;
--stage merge then pools every cv_fold*.json in <out> into eval.json (same numbers as one cv run: folds and seeds are
independent) and refuses if a (fold, seed) is missing / duplicated or the parts saw another decisions.jsonl.

usage: python3 imitate/train.py --data ../data/imitate/decisions.jsonl --engine-data ../engine/data \
           --config imitate/configs/default.json --out ../data/imitate/run1 [--stage cv,final] [--train-games k]
"""
import argparse
import glob
import hashlib
import json
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate  # noqa: E402
import model as M  # noqa: E402
import tokens  # noqa: E402
import torch  # noqa: E402
from torch import nn  # noqa: E402


def tensors(recs, vocab):
    bidx = {b: i for i, b in enumerate(vocab.base_ids)}
    n = len(recs)
    X = torch.tensor([vocab.ids(r) for r in recs], dtype=torch.long)
    Yb, Mb = torch.zeros(n, len(vocab.base_ids)), torch.zeros(n)
    Yl, Ml = torch.zeros(n), torch.zeros(n)
    Ys, Ms = torch.zeros(n, tokens.N_SHOP), torch.zeros(n, tokens.N_SHOP)
    for i, r in enumerate(recs):
        L = r["labels"]
        if L["board_next"] is not None:
            Mb[i] = 1
            for b in evaluate.board_sets(r, vocab)[1]:
                Yb[i, bidx[b]] = 1
        if L["level_up"] is not None:
            Ml[i], Yl[i] = 1, L["level_up"]
        if L["buys"] is not None:
            for j, y in enumerate(L["buys"][: tokens.N_SHOP]):
                Ms[i, j], Ys[i, j] = 1, y
    return X, (Yb, Mb), (Yl, Ml), (Ys, Ms)


def masked_bce(logit, y, m):
    if m.sum() == 0:
        return logit.sum() * 0
    loss = nn.functional.binary_cross_entropy_with_logits(logit, y, reduction="none")
    if loss.dim() == 2 and m.dim() == 1:
        loss = loss.mean(1)
    return (loss * m).sum() / m.sum()


def head_losses(net, x, yb, mb, yl, ml, ysh, msh, pr):
    return output_losses(net(x, pr), yb, mb, yl, ml, ysh, msh)


def output_losses(o, yb, mb, yl, ml, ysh, msh):
    return {"board": masked_bce(o["board"], yb, mb), "level": masked_bce(o["level"], yl, ml), "buy": masked_bce(o["buy"], ysh, msh)}


HEADS = ("board", "level", "buy")


def fit_tables(recs, vocab):
    """the two tables that are also head priors, fitted on recs (only records carrying that head's label)"""
    return {"board": evaluate.BoardTable([r for r in recs if r["labels"]["board_next"] is not None], vocab, by_band=True),
            "level": evaluate.LevelTable([r for r in recs if r["labels"]["level_up"] is not None])}


def table_logits(tables, heads, recs, idx, out):
    for h in heads:
        for i in idx:
            out[h][i] = torch.tensor(tables[h].logits(recs[i]))


def prior_tables(recs, fit_idx, vocab, cfg):
    """Prior logits {head: tensor over every record} for the heads in model.prior, plus the fitted tables' state.
    Records outside fit_idx get the tables fitted on all of fit_idx. Records inside fit_idx get the same tables when
    train.prior_oof is 0 (in-sample), else out-of-fold ones: fit_idx is split by game (sha1(game + "/prior") % k) and
    each part reads tables fitted on the other parts, so during training the prior is as good as it will be at test."""
    heads = cfg["model"].get("prior", [])
    if not heads:
        return {}, None
    pr = {"board": torch.zeros(len(recs), len(vocab.base_ids)), "level": torch.zeros(len(recs))}
    pr = {h: pr[h] for h in heads}
    tables = fit_tables([recs[i] for i in fit_idx], vocab)
    inside = set(fit_idx)
    table_logits(tables, heads, recs, [i for i in range(len(recs)) if i not in inside], pr)
    k = cfg["train"].get("prior_oof", 0)
    if not k:
        table_logits(tables, heads, recs, fit_idx, pr)
    else:
        part = lambda i: int(hashlib.sha1((recs[i]["game"] + "/prior").encode()).hexdigest(), 16) % k
        for q in range(k):
            table_logits(fit_tables([recs[i] for i in fit_idx if part(i) != q], vocab), heads, recs,
                         [i for i in fit_idx if part(i) == q], pr)
    return pr, {h: tables[h].state() for h in heads}


def inner_split(recs, idx, k):
    """Split training records by game: games with sha1(game + "/val") % k == 0 become the early-stopping set
    (at least one game). The test fold is never looked at."""
    games = sorted({recs[i]["game"] for i in idx})
    val = {g for g in games if int(hashlib.sha1((g + "/val").encode()).hexdigest(), 16) % k == 0} or {games[0]}
    return [i for i in idx if recs[i]["game"] not in val], [i for i in idx if recs[i]["game"] in val]


def fit(X, ys, pr, recs, idx, vocab, cfg, seed, dev, heldout=None):
    """Train on records idx; each head keeps the weights of its best epoch on an inner game split of idx
    (inner_split), judged by train.selection: "metric" = the head's held-out ranking metric (board add@5, level AUC,
    buy AUC; evaluate.py), "loss" = its BCE, "last" = no selection (every head = the last epoch, max_epochs, no
    early stop). Training stops when no head improved for `patience` epochs.
    pr: prior logits per head (prior_tables). train.residual_l2 (a number, or {head: number}) adds that weight x
    mean(residual logit^2) per prior head: shrinks the net's correction towards the table.
    Returns (states, info, curve): states[head] = that head's weights (predict() reads each head from its own snapshot); curve[e] = per-head mean loss on the training part (augmentation on), the
    inner validation part and, if `heldout` is given, those records (diagnostic only, nothing is selected on it)."""
    torch.manual_seed(seed)
    random.seed(seed)
    net = M.build(len(vocab.itos), len(vocab.base_ids), cfg["model"]).to(dev)
    tc = cfg["train"]
    opt = torch.optim.AdamW(net.parameters(), lr=tc["lr"], weight_decay=tc["weight_decay"])
    (Yb, Mb), (Yl, Ml), (Ys, Ms) = ys
    tr, va = inner_split(recs, idx, tc["inner_val_mod"])
    if tc["selection"] == "last":  # nothing is selected: train on all of idx (the "val" curve is then in-sample)
        tr = list(idx)
    pack = lambda ii: [a[ii].to(dev) for a in (X, Yb, Mb, Yl, Ml, Ys, Ms)] + [{h: v[ii].to(dev) for h, v in pr.items()}]
    x, yb, mb, yl, ml, ysh, msh, ptr = pack(tr)
    vv, hv = pack(va), (pack(heldout) if heldout else None)
    w = tc["loss_weights"]
    l2 = tc.get("residual_l2") or 0
    l2 = {h: (l2.get(h, 0) if isinstance(l2, dict) else l2) for h in pr}
    best = {h: (-float("inf"), 0, None) for h in HEADS}
    steps, curve = 0, []
    for ep in range(tc["max_epochs"]):
        net.train()
        acc, nb = {h: 0.0 for h in HEADS}, 0
        perm = torch.randperm(len(tr), device=dev)
        for j in range(0, len(tr), tc["batch"]):
            b = perm[j:j + tc["batch"]]
            xb = x[b].clone()
            drop = (torch.rand(xb.shape, device=dev) < tc["token_dropout"]) & (xb >= tokens.N_SPECIAL)
            xb[drop] = vocab.stoi["[MASK]"]
            pb = {h: v[b] for h, v in ptr.items()}
            o = net(xb, pb)
            hl = output_losses(o, yb[b], mb[b], yl[b], ml[b], ysh[b], msh[b])
            loss = sum(w[k] * v for k, v in hl.items())
            for h in pb:
                if l2[h]:
                    loss = loss + l2[h] * ((o[h] - pb[h]) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            steps += 1
            nb += 1
            for k, v in hl.items():
                acc[k] += v.item()
        net.eval()
        with torch.no_grad():
            vl = {k: v.item() for k, v in head_losses(net, *vv).items()}
            crit = {k: -v for k, v in vl.items()}
            if tc["selection"] == "metric":
                p = {h: torch.sigmoid(v).cpu() for h, v in net(vv[0], vv[-1]).items()}
                pos = {i: k for k, i in enumerate(va)}
                m = score_all(recs, va, vocab, lambda i: dict(zip(vocab.base_ids, p["board"][pos[i]].tolist())),
                              lambda i: float(p["level"][pos[i]]), lambda i: p["buy"][pos[i]].tolist())
                crit = {h: (m[h][key] if m[h][key] is not None else -vl[h]) for h, key in (("board", "add@5"), ("level", "auc"), ("buy", "auc"))}
            point = {"epoch": ep + 1, "train": {k: round(v / nb, 5) for k, v in acc.items()}, "val": {k: round(v, 5) for k, v in vl.items()},
                     "val_crit": {k: round(v, 5) for k, v in crit.items()}}
            if hv:
                point["heldout"] = {k: round(v.item(), 5) for k, v in head_losses(net, *hv).items()}
        curve.append(point)
        for h in HEADS:
            if tc["selection"] == "last" or crit[h] > best[h][0]:
                best[h] = (crit[h], ep + 1, {k: v.detach().clone() for k, v in net.state_dict().items()})
        if tc["selection"] != "last" and all(ep + 1 - best[h][1] >= tc["patience"] for h in HEADS):
            break
    info = {"steps": steps, "epochs_run": len(curve), "best_epoch": {h: best[h][1] for h in HEADS},
            "n_fit_games": len({recs[i]["game"] for i in tr}), "n_val_games": len({recs[i]["game"] for i in va})}
    return {h: best[h][2] for h in HEADS}, info, curve


@torch.no_grad()
def predict(states, net, X, pr, idx, dev):
    """each head from its own snapshot"""
    out = {}
    for h in HEADS:
        net.load_state_dict(states[h])
        net.eval()
        out[h] = torch.sigmoid(net(X[idx].to(dev), {k: v[idx].to(dev) for k, v in pr.items()})[h]).cpu()
    return out


def score_all(recs, te, vocab, board_fn, level_fn, buy_fn):
    """Apply three scorers (record index -> score) to the test records; return the three metric dicts."""
    tb = [i for i in te if recs[i]["labels"]["board_next"] is not None]
    tl = [i for i in te if recs[i]["labels"]["level_up"] is not None]
    ts = [i for i in te if recs[i]["labels"]["buys"] is not None]
    return {
        "board": evaluate.board_metrics([recs[i] for i in tb], [board_fn(i) for i in tb], vocab),
        "level": evaluate.level_metrics([recs[i]["labels"]["level_up"] for i in tl], [level_fn(i) for i in tl]),
        "buy": evaluate.buy_metrics([recs[i]["labels"]["buys"][: tokens.N_SHOP] for i in ts], [buy_fn(i)[: len(recs[i]["labels"]["buys"][: tokens.N_SHOP])] for i in ts]),
    }


def mean_sd(vals):
    v = [x for x in vals if x is not None]
    if not v:
        return None
    mu = sum(v) / len(v)
    return [round(mu, 4), round(math.sqrt(sum((x - mu) ** 2 for x in v) / max(1, len(v) - 1)), 4)]


def summarize(runs):
    out = {}
    for arm, lst in runs.items():
        if not lst:
            continue
        out[arm] = {h: {k: mean_sd([r[h][k] for r in lst]) for k in lst[0][h] if not k.startswith("n")} for h in lst[0]}
    return out


def mean_curve(curves):
    """mean over folds x seeds, per epoch and head"""
    out = []
    for e in range(max(len(c) for c in curves)):
        live = [c for c in curves if len(c) > e]  # runs stop at different epochs
        pt = {"epoch": e + 1, "n_runs": len(live)}
        for part in ("train", "val", "heldout"):
            pt[part] = {k: round(sum(c[e][part][k] for c in live) / len(live), 5) for k in HEADS}
        out.append(pt)
    return out


def latency(net, X, pr, dev, n=200):
    x1, p1 = X[:1].to(dev), {h: v[:1].to(dev) for h, v in pr.items()}
    with torch.no_grad():
        for _ in range(10):
            net(x1, p1)
        if dev == "cuda":
            torch.cuda.synchronize()
        t = time.time()
        for _ in range(n):
            net(x1, p1)
        if dev == "cuda":
            torch.cuda.synchronize()
    return round((time.time() - t) / n * 1000, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--engine-data", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stage", default="cv,final")
    ap.add_argument("--train-games", type=int, default=0)
    ap.add_argument("--only-fold", type=int, default=None)
    ap.add_argument("--only-seed", type=int, default=None, help="with --only-fold: one model seed (index); tables only with seed 0")
    ap.add_argument("--device", default="auto")
    a = ap.parse_args()
    cfg = json.load(open(a.config, encoding="utf-8"))
    dev = ("cuda" if torch.cuda.is_available() else "cpu") if a.device == "auto" else a.device
    if cfg.get("cpu_threads"):
        torch.set_num_threads(cfg["cpu_threads"])
    if dev == "cuda" and cfg.get("vram_frac"):
        torch.cuda.set_per_process_memory_fraction(cfg["vram_frac"])
    vocab = tokens.vocab_from_engine(a.engine_data)
    raw = open(a.data, "rb").read()
    recs = [json.loads(l) for l in raw.decode("utf-8").splitlines() if l.strip()]
    X, *ys = tensors(recs, vocab)
    games = sorted({r["game"] for r in recs})
    folds = sorted({r["fold"] for r in recs})
    os.makedirs(a.out, exist_ok=True)
    report = {"data": {"file": os.path.abspath(a.data), "sha256": hashlib.sha256(raw).hexdigest(), "n_records": len(recs),
                       "n_games": len(games), "by_source": {s: len({r["game"] for r in recs if r["source"] == s}) for s in ("spdemo", "overlay")}},
              "config": cfg, "device": dev, "torch": torch.__version__, "vocab": len(vocab.itos), "seq_len": tokens.SEQ_LEN,
              "train_games": a.train_games}
    if dev == "cuda":
        report["gpu"] = torch.cuda.get_device_name(0)
    net = M.build(len(vocab.itos), len(vocab.base_ids), cfg["model"]).to(dev)  # shell the snapshots are loaded into
    t0 = time.time()
    if "cv" in a.stage:
        runs = {"model": [], "table_global": [], "table_band": []}  # tables appear once per fold (seed 0 run)
        detail, curves = [], []
        for f in ([a.only_fold] if a.only_fold is not None else folds):
            tr = [i for i, r in enumerate(recs) if r["fold"] != f]
            if a.train_games:
                # first k training games in a fixed hash order (sources mixed: sorting by id would put every
                # .spdemo game before every overlay game)
                pool = sorted({recs[i]["game"] for i in tr}, key=lambda g: hashlib.sha1((g + "/lc").encode()).hexdigest())
                keep = set(pool[: a.train_games])
                tr = [i for i in tr if recs[i]["game"] in keep]
            te = [i for i, r in enumerate(recs) if r["fold"] == f]
            trr = [recs[i] for i in tr]
            lt = evaluate.LevelTable([r for r in trr if r["labels"]["level_up"] is not None])
            bt = evaluate.BuyTable([r for r in trr if r["labels"]["buys"] is not None], vocab)
            for arm, by_band in (() if a.only_seed not in (None, 0) else (("table_global", False), ("table_band", True))):
                brd = evaluate.BoardTable([r for r in trr if r["labels"]["board_next"] is not None], vocab, by_band)
                m = score_all(recs, te, vocab, lambda i: brd(recs[i]), lambda i: lt(recs[i]), lambda i: bt(recs[i]))
                runs[arm].append(m)
                detail.append({"fold": f, "arm": arm, **m})
            pr, _ = prior_tables(recs, tr, vocab, cfg)
            for s in ([a.only_seed] if a.only_seed is not None else range(cfg["seeds"])):
                states, info, curve = fit(X, ys, pr, recs, tr, vocab, cfg, 1000 + s, dev, heldout=te)
                curves.append(curve)
                p = predict(states, net, X, pr, te, dev)
                pos = {i: k for k, i in enumerate(te)}
                m = score_all(recs, te, vocab,
                              lambda i: dict(zip(vocab.base_ids, p["board"][pos[i]].tolist())),
                              lambda i: float(p["level"][pos[i]]),
                              lambda i: p["buy"][pos[i]].tolist())
                runs["model"].append(m)
                detail.append({"fold": f, "arm": "model", "seed": 1000 + s, **info, "n_train_games": len({recs[i]["game"] for i in tr}), **m})
            print(f"fold {f} done  t={time.time() - t0:.0f}s", flush=True)
        if a.only_fold is not None:
            json.dump({"fold": a.only_fold, "runs": runs, "curves": curves, "detail": detail, "data": report["data"]},
                      open(os.path.join(a.out, f"cv_fold{a.only_fold}" + ("" if a.only_seed is None else f"_s{a.only_seed}") + ".json"),
                           "w", encoding="utf-8"), ensure_ascii=False)
            print(json.dumps({"fold": a.only_fold, "wall_s": round(time.time() - t0, 1), "summary": summarize(runs)}, ensure_ascii=False))
            return
        report["cv"] = {"summary": summarize(runs), "loss_curve": mean_curve(curves), "detail": detail}
    if "merge" in a.stage:
        parts = [json.load(open(f, encoding="utf-8")) for f in sorted(glob.glob(os.path.join(a.out, "cv_fold*.json")))]
        got = sorted({(d["fold"], d.get("seed")) for p in parts for d in p["detail"] if d["arm"] == "model"})
        want = sorted({(f, 1000 + s) for f in folds for s in range(cfg["seeds"])})
        if got != want:
            raise SystemExit(f"cv parts incomplete or duplicated: have {got}, need {want}")
        if any(p["data"]["sha256"] != report["data"]["sha256"] for p in parts):
            raise SystemExit("cv_fold*.json were trained on a different decisions.jsonl; rerun the folds")
        runs = {k: [m for p in parts for m in p["runs"].get(k, [])] for k in ("model", "table_global", "table_band")}
        report["cv"] = {"summary": summarize(runs), "loss_curve": mean_curve([c for p in parts for c in p["curves"]]),
                        "detail": [d for p in parts for d in p["detail"]]}
    if "final" in a.stage:
        pr, prior_state = prior_tables(recs, list(range(len(recs))), vocab, cfg)
        states, info, curve = fit(X, ys, pr, recs, list(range(len(recs))), vocab, cfg, 0, dev)
        report["final_loss_curve"] = curve
        nparams = sum(p.numel() for p in net.parameters())
        net.load_state_dict(states["board"])  # any head's weights: only used for the latency probe below
        torch.save({"heads": states, "itos": vocab.itos, "base_ids": vocab.base_ids, "config": cfg, "prior_tables": prior_state,
                    "data_sha256": report["data"]["sha256"], "n_games": len(games)}, os.path.join(a.out, "final.pt"))
        report["final"] = {"params": nparams, **info, "latency_ms_batch1": latency(net, X, pr, dev),
                           "latency_ms_batch1_cpu": latency(net.cpu(), X, pr, "cpu", 50)}
    report["wall_s"] = round(time.time() - t0, 1)
    if dev == "cuda":
        report["max_vram_MB"] = round(torch.cuda.max_memory_allocated() / 2 ** 20, 1)
    json.dump(report, open(os.path.join(a.out, "eval.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    brief = {k: v for k, v in report.items() if k not in ("config", "cv", "final_loss_curve")}
    if "cv" in report:
        brief["cv"] = report["cv"]["summary"]
        brief["loss_curve_every_10"] = [p for p in report["cv"]["loss_curve"] if p["epoch"] % 10 == 0 or p["epoch"] == 1]
    print(json.dumps(brief, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
