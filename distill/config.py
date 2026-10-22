"""Run config (JSON) for distill/run.py, train.py, idle.py. Relative paths resolve against the repo root, so the same
file works wherever the checkout sits (the documented layout: engine/ and guides/ next to the checkout)."""
import json, os, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATHS = ['work_dir', 'node_cwd', 'guide', 'value_model', 'team_profile']
DEFAULTS = {
    'work_dir': '../data/distill', 'node_cwd': '..', 'guide': '../guides/g06_final.json', 'value_model': 'models',
    'team_profile': 'models/team-profile.json', 'node': 'node', 'workers': 16, 'concurrent': 8,
    'datagen': {'teacher': 'model', 'seed_base': 100001, 'games_iter0': 2000, 'games_per_iter': 500, 'steps': 2, 'K': 8, 'N': 6, 'N2': 6, 'chunk': 32},
    'dagger': {'iters': 3, 'beta0': 0.5, 'beta_decay': 0.5},
    'train': {'arch': 'mlp', 'hidden': [512, 256], 'd': 128, 'layers': 2, 'heads': 4, 'dropout': 0.0, 'batch': 512, 'lr': 1e-3,
              'weight_decay': 1e-4, 'max_steps': 20000, 'finetune_steps': 5000, 'max_minutes': 60, 'tau': 0.05, 'w_util': 1.0,
              'w_kl': 1.0, 'w_pick': 0.2, 'w_line': 0.2, 'w_value': 0.1, 'early_round_max': 6, 'early_round_weight': 0.5,
              'val_mod': 10, 'eval_every': 500, 'ckpt_every_sec': 120, 'device': 'auto', 'seed': 0},
    'eval': {'seeds': '5001-5150', 'steps': 2, 'margin': 0.05, 'lineup': False, 'reference': {}},
    'idle': {},
}


def merge(a, b):
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def resolve(p):
    return p if p is None or os.path.isabs(p) else os.path.normpath(os.path.join(ROOT, p))


def load_config(path):
    """a config may `"extends": "<other config>"` (relative to itself): local paths on top of a checked-in config."""
    with open(path) as f:
        own = json.load(f)
    base = DEFAULTS
    if own.get('extends'):
        base = merge(DEFAULTS, json.load(open(os.path.join(os.path.dirname(os.path.abspath(path)), own.pop('extends')))))
    cfg = merge(base, own)
    for k in PATHS:
        cfg[k] = resolve(cfg[k])
    cfg['eval']['reference'] = {k: [resolve(p) for p in v] for k, v in cfg['eval']['reference'].items()}
    cfg['config_path'] = os.path.abspath(path)
    return cfg


def teacher_of(cfg, k):
    """datagen.teacher: one teacher, or a list per DAgger iteration (the last entry repeats)."""
    t = cfg['datagen']['teacher']
    return t if isinstance(t, str) else t[min(k, len(t) - 1)]
