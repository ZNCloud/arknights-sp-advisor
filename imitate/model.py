"""Imitation policy net: one small transformer over the decision-point tokens (imitate/tokens.py), three heads.

  board  [n_base]  logit that each base chess id is on the owner's board at this round's battle start (deploy)
  level  [1]       logit that the owner levels the dispatch center up during this PREP
  buy    [6]       logit that the owner buys shop slot i of the shop shown at this decision point
Heads read the [BOS] state (board / level) and each shop slot's identity token + the [BOS] state (buy).
Default size d=128, 2 layers (~0.5M params); ~1 ms per decision on a desktop GPU, the exact number is measured by
train.py (`latency`) and written next to the checkpoint.
"""
import torch
from torch import nn

import tokens


class ImitationNet(nn.Module):
    def __init__(self, n_vocab, n_base, d=128, layers=2, heads=4, ff=2, dropout=0.1):
        super().__init__()
        self.emb = nn.Embedding(n_vocab, d, padding_idx=0)
        self.pos = nn.Parameter(torch.zeros(tokens.SEQ_LEN, d))
        enc = nn.TransformerEncoderLayer(d, heads, ff * d, dropout=dropout, batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(enc, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.board = nn.Linear(d, n_base)
        self.level = nn.Linear(d, 1)
        self.buy = nn.Sequential(nn.Linear(2 * d, d), nn.GELU(), nn.Linear(d, 1))
        self.register_buffer("shop_pos", torch.tensor([tokens.POS_SHOP + tokens.SHOP_W * i for i in range(tokens.N_SHOP)]), persistent=False)

    def forward(self, x):
        h = self.norm(self.enc(self.emb(x) + self.pos[: x.shape[1]]))
        g = h[:, 0]
        s = h[:, self.shop_pos]                                           # [B, 6, d]
        buy = self.buy(torch.cat([s, g.unsqueeze(1).expand_as(s)], -1)).squeeze(-1)
        return {"board": self.board(g), "level": self.level(g).squeeze(-1), "buy": buy}


def build(n_vocab, n_base, cfg):
    return ImitationNet(n_vocab, n_base, d=cfg.get("d", 128), layers=cfg.get("layers", 2), heads=cfg.get("heads", 4),
                        ff=cfg.get("ff", 2), dropout=cfg.get("dropout", 0.1))
