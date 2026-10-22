"""Idle gate: is this machine free enough for distillation work right now? Every "no" names its reason.

Checks (thresholds in the run config's "idle" block, see distill/configs/*.json):
  gpu        other processes' GPU memory (nvidia-smi compute apps, our own process tree excluded) and utilisation
  cpu        1-min load average per core, minus the load our own running jobs account for (own_load)
  memory     MemAvailable from /proc/meminfo
  processes  command lines of other processes matching busy_patterns (renders, docker tests, other evals ...)
  docker     running containers whose name matches busy_containers
  hours      optional allowed_hours windows (local time), e.g. ["00-09", "20-24"]
Used by distill/run.py (before starting and periodically while running) and distill/train.py (--respect-idle).
CLI (exit 0 = idle, 1 = busy; one JSON line appended to <work_dir>/logs/idle.log):
  python distill/idle.py --config distill/configs/full.json
"""
import argparse, datetime, json, os, re, shutil, subprocess, time

DEFAULTS = {
    'gpu_util_max': 20,             # % on a GPU that also hosts another process
    'gpu_other_mem_mib_max': 2048,  # other processes' memory on a GPU
    'cpu_load_per_core_max': 0.5,   # (load1 - own_load) / cores
    'mem_available_gb_min': 32,
    'busy_patterns': ['blender', 'ffmpeg', 'eval/advised\\.mjs', 'eval/teamplay', 'advisor/datagen\\.mjs', 'docker run', 'render'],
    'busy_containers': ['test', 'smoke', 'render', 'qa'],
    'allowed_hours': [],
    'confirm_samples': 3, 'confirm_interval_sec': 20, 'recheck_sec': 60,
}


def own_tree(root=None):
    """pids of this process plus `root` (run.py passes its own pid) and every descendant of root: our own jobs never
    count as "someone else is busy"."""
    root = root or os.getpid()
    kids = {}
    for d in os.listdir('/proc'):
        if not d.isdigit():
            continue
        try:
            with open(f'/proc/{d}/stat') as f:
                ppid = int(f.read().rsplit(')', 1)[1].split()[1])
            kids.setdefault(ppid, []).append(int(d))
        except (OSError, IndexError, ValueError):
            pass
    out, todo = {root, os.getpid()}, [root]
    while todo:
        for c in kids.get(todo.pop(), []):
            if c not in out:
                out.add(c); todo.append(c)
    return out


def gpu_state(mine):
    if not shutil.which('nvidia-smi'):
        return None, ['nvidia-smi not found: GPU not checked']
    q = lambda *a: subprocess.run(['nvidia-smi', *a, '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=20).stdout.strip().splitlines()
    gpus = {}
    for line in q('--query-gpu=index,uuid,utilization.gpu,memory.used'):
        i, uuid, util, mem = [x.strip() for x in line.split(',')]
        gpus[uuid] = {'index': int(i), 'util': float(util), 'mem': float(mem), 'other_mem': 0.0, 'other_pids': 0}
    for line in q('--query-compute-apps=gpu_uuid,pid,used_memory'):
        parts = [x.strip() for x in line.split(',')]
        if len(parts) < 3 or parts[0] not in gpus:
            continue
        if int(parts[1]) not in mine:
            g = gpus[parts[0]]; g['other_mem'] += float(parts[2] or 0); g['other_pids'] += 1
    return sorted(gpus.values(), key=lambda g: g['index']), []


def busy_processes(patterns, mine):
    rx = re.compile('|'.join(f'(?:{p})' for p in patterns)) if patterns else None
    hits = []
    if not rx:
        return hits
    for d in os.listdir('/proc'):
        if not d.isdigit() or int(d) in mine:
            continue
        try:
            with open(f'/proc/{d}/cmdline', 'rb') as f:
                cmd = f.read().replace(b'\0', b' ').decode(errors='replace').strip()
        except OSError:
            continue
        m = rx.search(cmd) if cmd else None
        if m and 'distill/idle.py' not in cmd:
            hits.append({'pid': int(d), 'match': m.group(0)})   # the matched pattern only: command lines may hold secrets
    return hits


def in_hours(windows, now):
    if not windows:
        return True
    h = now.hour + now.minute / 60
    for w in windows:
        a, b = (float(x) for x in w.split('-'))
        if a <= h < b:
            return True
    return False


def check(cfg=None, own_load=0.0, root=None):
    c = {**DEFAULTS, **(cfg or {})}
    mine, reasons, notes = own_tree(root), [], []
    gpus, n = gpu_state(mine)
    notes += n
    for g in gpus or []:
        if g['other_mem'] > c['gpu_other_mem_mib_max']:
            reasons.append(f"GPU{g['index']}: other processes use {g['other_mem']:.0f} MiB (> {c['gpu_other_mem_mib_max']})")
        elif g['other_pids'] and g['util'] > c['gpu_util_max']:
            reasons.append(f"GPU{g['index']}: {g['util']:.0f}% busy with {g['other_pids']} other process(es)")
    cores = os.cpu_count() or 1
    load1 = os.getloadavg()[0]
    per_core = max(0.0, load1 - own_load) / cores
    if per_core > c['cpu_load_per_core_max']:
        reasons.append(f'CPU: load {load1:.1f} (own {own_load:.0f}) on {cores} cores = {per_core:.2f}/core (> {c["cpu_load_per_core_max"]})')
    mem = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':'); mem[k] = int(v.split()[0])
    avail = mem.get('MemAvailable', 0) / 2**20
    if avail < c['mem_available_gb_min']:
        reasons.append(f'memory: {avail:.0f} GB available (< {c["mem_available_gb_min"]})')
    procs = busy_processes(c['busy_patterns'], mine)
    if procs:
        reasons.append('heavy jobs running: ' + ', '.join(sorted({p['match'] for p in procs})) + f' ({len(procs)} process(es))')
    containers = []
    if c['busy_containers'] and shutil.which('docker'):
        try:
            names = subprocess.run(['docker', 'ps', '--format', '{{.Names}}'], capture_output=True, text=True, timeout=20).stdout.split()
            rx = re.compile('|'.join(c['busy_containers']))
            containers = [x for x in names if rx.search(x)]
        except (OSError, subprocess.SubprocessError) as e:
            notes.append(f'docker not checked: {e}')
    if containers:
        reasons.append(f'docker: {len(containers)} matching container(s) running ({", ".join(containers[:3])})')
    now = datetime.datetime.now()
    if not in_hours(c['allowed_hours'], now):
        reasons.append(f'outside allowed hours {c["allowed_hours"]} (now {now:%H:%M})')
    return {'time': now.isoformat(timespec='seconds'), 'idle': not reasons, 'reasons': reasons, 'notes': notes,
            'metrics': {'load1': load1, 'own_load': own_load, 'cores': cores, 'mem_available_gb': round(avail, 1),
                        'gpus': [{k: g[k] for k in ('index', 'util', 'mem', 'other_mem', 'other_pids')} for g in gpus or []]}}


def confirm(cfg=None, log=None, own_load=0.0, root=None):
    """idle on `confirm_samples` checks `confirm_interval_sec` apart (a single quiet second is not an idle machine)."""
    c = {**DEFAULTS, **(cfg or {})}
    for i in range(c['confirm_samples']):
        r = check(c, own_load, root)
        if log:
            log(r)
        if not r['idle']:
            return r
        if i + 1 < c['confirm_samples']:
            time.sleep(c['confirm_interval_sec'])
    return r


def logger(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    def log(rec, **extra):
        with open(path, 'a') as f:
            f.write(json.dumps({**rec, **extra}, ensure_ascii=False) + '\n')
    return log


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', required=True)
    ap.add_argument('--confirm', action='store_true', help='sample confirm_samples times before saying idle')
    a = ap.parse_args()
    from config import load_config
    cfg = load_config(a.config)
    log = logger(os.path.join(cfg['work_dir'], 'logs', 'idle.log'))
    r = confirm(cfg['idle'], lambda x: None) if a.confirm else check(cfg['idle'])
    log(r, source='idle.py')
    print(json.dumps(r, ensure_ascii=False))
    raise SystemExit(0 if r['idle'] else 1)
