"""Distillation pipeline driver: teacher data → train → DAgger rounds → fixed-seed eval. Resumable, idle-gated.

  python distill/run.py --config <cfg.json> [--stage auto|datagen|train|eval|status] [--ignore-idle]

auto runs the steps below in order and records each finished step in <work_dir>/state.json; a rerun continues at the
first unfinished step (datagen and train resume inside a step too):
  datagen:0   teacher plays (beta 1) games seed_base … +games_iter0-1                → data/iter0.jsonl
  train:0     train from scratch on data/*.jsonl (train.max_steps)                  → students/iter0.json
  datagen:k   DAgger: student_{k-1} plays with prob 1-beta_k, the teacher labels     → data/iter<k>.jsonl
  train:k     continue from the checkpoint on all data (+train.finetune_steps)       → students/iter<k>.json
  eval        eval/advised.mjs --student <last> on eval.seeds (--mode both = guide-only baseline on the same seeds),
              then eval/report/compare50.py against the eval.reference arms (e.g. the full advisor's result files)
Idle gate (distill/idle.py): before starting (confirm_samples quiet checks) and every recheck_sec while a step runs;
when the machine gets busy the running step is stopped (datagen keeps finished games, train checkpoints) and this
exits 75 with the reasons in <work_dir>/logs/run.log. Only one driver runs per work_dir (lock file).
Exit codes: 0 all done, 75 paused / not started because busy, 1 failed.
"""
import argparse, fcntl, json, os, signal, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import load_config, teacher_of, ROOT  # noqa: E402
import idle as idle_gate  # noqa: E402

PAUSED = 75


class Paused(Exception):
    pass


def steps_of(cfg):
    out = ['datagen:0', 'train:0']
    for k in range(1, cfg['dagger']['iters'] + 1):
        out += [f'datagen:{k}', f'train:{k}']
    return out + ['eval']


def seeds_for(cfg, k):
    g = cfg['datagen']
    a = g['seed_base'] + (0 if k == 0 else g['games_iter0'] + (k - 1) * g['games_per_iter'])
    n = g['games_iter0'] if k == 0 else g['games_per_iter']
    return a, a + n - 1


class Driver:
    def __init__(self, cfg, ignore_idle):
        self.cfg, self.ignore_idle, self.wd = cfg, ignore_idle, cfg['work_dir']
        for d in ('data', 'students', 'logs', 'eval', 'ckpt'):
            os.makedirs(os.path.join(self.wd, d), exist_ok=True)
        self.state_path = os.path.join(self.wd, 'state.json')
        self.state = json.load(open(self.state_path)) if os.path.exists(self.state_path) else {'done': [], 'history': []}
        self.idle_log = idle_gate.logger(os.path.join(self.wd, 'logs', 'idle.log'))

    def log(self, **rec):
        rec = {'time': time.strftime('%F %T'), **rec}
        print(json.dumps(rec, ensure_ascii=False), flush=True)
        with open(os.path.join(self.wd, 'logs', 'run.log'), 'a') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')

    def save(self):
        with open(self.state_path + '.tmp', 'w') as f:
            json.dump(self.state, f, indent=1)
        os.replace(self.state_path + '.tmp', self.state_path)

    def run_child(self, name, argv, cwd, own_load):
        """run one step's process group; stop it (SIGTERM) and raise Paused when the idle gate says busy."""
        self.log(event='step-start', step=name, argv=[os.path.relpath(x, cwd) if os.path.isabs(x) else x for x in argv])
        with open(os.path.join(self.wd, 'logs', f'{name.replace(":", "-")}.log'), 'a') as out:
            p = subprocess.Popen(argv, cwd=cwd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
            last = time.time()
            while p.poll() is None:
                time.sleep(2)
                if self.ignore_idle or time.time() - last < self.cfg['idle'].get('recheck_sec', idle_gate.DEFAULTS['recheck_sec']):
                    continue
                last = time.time()
                r = idle_gate.check(self.cfg['idle'], own_load=own_load, root=os.getpid())
                self.idle_log(r, source='run.py', step=name)
                if not r['idle']:
                    os.killpg(p.pid, signal.SIGTERM)
                    try:
                        p.wait(timeout=120)
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid, signal.SIGKILL); p.wait()
                    raise Paused(f'{name} stopped: ' + '; '.join(r['reasons']))
        if p.returncode == PAUSED:
            raise Paused(f'{name} paused itself (see logs/{name.replace(":", "-")}.log)')
        if p.returncode != 0:
            raise RuntimeError(f'{name} failed with exit code {p.returncode} (see logs/{name.replace(":", "-")}.log)')

    def datagen(self, k):
        c, g = self.cfg, self.cfg['datagen']
        a, b = seeds_for(c, k)
        argv = [c['node'], os.path.join(ROOT, 'distill', 'datagen.mjs'), '--seeds', f'{a}-{b}', '--out', os.path.join(self.wd, 'data', f'iter{k}.jsonl'),
                '--teacher', teacher_of(c, k), '--iter', str(k), '--steps', str(g['steps']), '--workers', str(c['workers']), '--concurrent', str(c['concurrent']),
                '--guide', c['guide'], '--team', c['team_profile']]
        argv += ['--model', c['value_model']] if teacher_of(c, k) == 'model' else ['--K', str(g['K']), '--N', str(g['N']), '--N2', str(g['N2'])]
        if k > 0:
            beta = c['dagger']['beta0'] * c['dagger']['beta_decay'] ** (k - 1)
            argv += ['--student', os.path.join(self.wd, 'students', f'iter{k - 1}.json'), '--beta', f'{beta:.4f}']
        self.run_child(f'datagen:{k}', argv, c['node_cwd'], own_load=c['workers'] + 1)

    def train(self, k):
        c, t = self.cfg, self.cfg['train']
        ck = os.path.join(self.wd, 'ckpt', 'last.pt')
        steps = t['max_steps'] if k == 0 else self._ck_step(ck) + t['finetune_steps']
        argv = [sys.executable, os.path.join(ROOT, 'distill', 'train.py'), '--config', c['config_path'], '--steps', str(steps),
                '--export', os.path.join(self.wd, 'students', f'iter{k}.json')]
        if k == 0 and not os.path.exists(ck):
            argv.append('--fresh')
        self.run_child(f'train:{k}', argv, ROOT, own_load=1)

    def _ck_step(self, ck):
        # the train step a fine-tune round starts from is fixed when the round starts (state.json), so a resumed
        # round does not keep moving its own finish line
        key = f'train_start:{len(self.state["done"])}'
        if key not in self.state:
            import torch
            self.state[key] = torch.load(ck, map_location='cpu', weights_only=False)['step'] if os.path.exists(ck) else 0
            self.save()
        return self.state[key]

    def eval(self):
        c, e = self.cfg, self.cfg['eval']
        last = max(k for k in range(c['dagger']['iters'] + 1) if os.path.exists(os.path.join(self.wd, 'students', f'iter{k}.json')))
        student, out = os.path.join(self.wd, 'students', f'iter{last}.json'), os.path.join(self.wd, 'eval', f'student-iter{last}.json')
        argv = [c['node'], os.path.join(ROOT, 'eval', 'advised.mjs'), '--seeds', e['seeds'], '--mode', 'both', '--guide', c['guide'], '--student', student,
                '--steps', str(e['steps']), '--margin', str(e['margin']), '--out', out] + (['--lineup', '1', '--workers', str(c['workers'])] if e['lineup'] else [])
        self.run_child('eval', argv, c['node_cwd'], own_load=c['workers'] + 1 if e['lineup'] else 1)
        arms = [f'guide={out}:baseline', f'student={out}:advised'] + [f'{k}={",".join(v)}:advised' for k, v in e['reference'].items()]
        rep = subprocess.run([sys.executable, os.path.join(ROOT, 'eval', 'report', 'compare50.py'), '--common', *arms], capture_output=True, text=True, check=True).stdout
        with open(os.path.join(self.wd, 'eval', f'compare-iter{last}.md'), 'w') as f:
            f.write(rep)
        self.log(event='eval-report', student=os.path.basename(student), report=rep)

    def run(self, only=None):
        todo = [s for s in steps_of(self.cfg) if s not in self.state['done']] if not only else only
        if not todo:
            self.log(event='nothing-to-do', done=self.state['done']); return 0
        if not self.ignore_idle:
            r = idle_gate.confirm(self.cfg['idle'], lambda x: self.idle_log(x, source='run.py', step='start'))
            if not r['idle']:
                self.log(event='not-started', why=r['reasons']); return PAUSED
        for s in todo:
            kind, _, k = s.partition(':')
            t0 = time.time()
            try:
                getattr(self, kind)(*( [int(k)] if k else []))
            except Paused as p:
                self.log(event='paused', step=s, why=str(p)); return PAUSED
            if s in steps_of(self.cfg) and s not in self.state['done']:
                self.state['done'].append(s)
            self.state['history'].append({'step': s, 'sec': round(time.time() - t0, 1), 'at': time.strftime('%F %T')}); self.save()
            self.log(event='step-done', step=s, sec=round(time.time() - t0, 1))
        return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', required=True)
    ap.add_argument('--stage', default='auto', help='auto | status | one step such as datagen:0, train:1, eval')
    ap.add_argument('--ignore-idle', action='store_true', help='skip the idle gate (manual / smoke runs)')
    a = ap.parse_args()
    cfg = load_config(a.config)
    d = Driver(cfg, a.ignore_idle)
    if a.stage == 'status':
        print(json.dumps({'done': d.state['done'], 'todo': [s for s in steps_of(cfg) if s not in d.state['done']], 'history': d.state['history'][-5:]}, indent=1))
        return 0
    lock = open(os.path.join(d.wd, 'run.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        d.log(event='not-started', why=['another run.py holds the lock for this work_dir']); return PAUSED
    try:
        return d.run(None if a.stage == 'auto' else [a.stage])
    except Exception as e:
        d.log(event='failed', error=str(e)); return 1


if __name__ == '__main__':
    raise SystemExit(main())
