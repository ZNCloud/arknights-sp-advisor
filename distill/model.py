"""Student networks for distillation (distill/train.py).

Input: the student feature vector (distill/features.mjs, FEATURE_VERSION), standardised with train-set mean/std.
Outputs (shared by both archs):
  q     [V]  predicted teacher utility of each vocabulary action (distill/vocab.mjs); the policy is argmax over legal q
  line  [L]  logits over the core lines (which line the team-aware advisor steers this seat to)
  value [1]  predicted final utility of the game for this seat (auxiliary)
Archs:
  mlp          2–3 dense layers (default 512-256, ~0.8M params) — the one with a JS forward pass (distill/student.mjs)
  transformer  optional: each board / hand / shop unit slot is a token (its attribute block), plus one token for all
               other features; 2 encoder layers, d=128. Python-only for now (eval via JS refuses it loudly).
"""
import re
import torch
from torch import nn

UNIT_RE = re.compile(r'^(board|hand|shop)(\d+)\.')


def unit_layout(names):
    """[(kind, slot, start, width)] for the unit slots in feature order + the indices of every other feature."""
    blocks, cur = [], None
    for i, n in enumerate(names):
        m = UNIT_RE.match(n)
        key = (m.group(1), int(m.group(2))) if m else None
        if key and cur and cur[0] == key and cur[2] == i:
            cur[2] += 1
        else:
            if cur:
                blocks.append(cur)
            cur = [key, i, i + 1] if key else None
    if cur:
        blocks.append(cur)
    units = [(k[0], k[1], a, b - a) for k, a, b in blocks]
    widths = {w for *_, w in units}
    if len(widths) != 1:
        raise ValueError(f'unit blocks of unequal width {sorted(widths)}')
    in_unit = set(i for _, _, a, w in units for i in range(a, a + w))
    return units, [i for i in range(len(names)) if i not in in_unit]


class Heads(nn.Module):
    def __init__(self, d, n_actions, n_lines):
        super().__init__()
        self.q, self.line, self.value = nn.Linear(d, n_actions), nn.Linear(d, n_lines), nn.Linear(d, 1)

    def forward(self, h):
        return {'q': self.q(h), 'line': self.line(h), 'value': self.value(h).squeeze(-1)}


class MLP(nn.Module):
    def __init__(self, d_in, n_actions, n_lines, hidden=(512, 256), dropout=0.0):
        super().__init__()
        layers, d = [], d_in
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()] + ([nn.Dropout(dropout)] if dropout else [])
            d = h
        self.trunk, self.heads = nn.Sequential(*layers), Heads(d, n_actions, n_lines)

    def forward(self, x):
        return self.heads(self.trunk(x))


class UnitTransformer(nn.Module):
    """Set-style encoder: unit slots as tokens (with a learned slot embedding), a global token for the rest."""

    def __init__(self, names, n_actions, n_lines, d=128, layers=2, heads=4, dropout=0.0):
        super().__init__()
        units, rest = unit_layout(names)
        self.register_buffer('unit_idx', torch.tensor([[a + j for j in range(w)] for _, _, a, w in units]), persistent=False)
        self.register_buffer('rest_idx', torch.tensor(rest), persistent=False)
        width = units[0][3]
        self.unit_in, self.rest_in = nn.Linear(width, d), nn.Linear(len(rest), d)
        self.slot = nn.Parameter(torch.zeros(len(units) + 1, d))
        enc = nn.TransformerEncoderLayer(d, heads, 2 * d, dropout, batch_first=True)
        self.enc = nn.TransformerEncoder(enc, layers)
        self.heads = Heads(2 * d, n_actions, n_lines)

    def forward(self, x):
        u = self.unit_in(x[:, self.unit_idx])                      # [B, U, d]
        g = self.rest_in(x[:, self.rest_idx]).unsqueeze(1)         # [B, 1, d]
        t = self.enc(torch.cat([g, u], 1) + self.slot)
        return self.heads(torch.cat([t[:, 0], t[:, 1:].mean(1)], -1))


def build(arch, names, n_actions, n_lines, **kw):
    if arch == 'mlp':
        return MLP(len(names), n_actions, n_lines, hidden=tuple(kw.get('hidden', (512, 256))), dropout=kw.get('dropout', 0.0))
    if arch == 'transformer':
        return UnitTransformer(names, n_actions, n_lines, d=kw.get('d', 128), layers=kw.get('layers', 2), heads=kw.get('heads', 4), dropout=kw.get('dropout', 0.0))
    raise ValueError(f'unknown arch {arch}')
