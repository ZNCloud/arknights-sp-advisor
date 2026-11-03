"""Imitation policy net: one small transformer over the decision-point tokens (imitate/tokens.py), three heads.

  board  [n_base]  logit that each base chess id is on the owner's board at this round's battle start (deploy)
  level  [1]       logit that the owner levels the dispatch center up during this PREP
  buy    [6]       logit that the owner buys shop slot i of the shop shown at this decision point
Heads read the [BOS] state (board / level) and each shop slot's identity token + the [BOS] state (buy).
Two optional structure knobs (model config; both off = the v1 net):
  prior         heads in this list output `table logit + net`: forward() gets the head's lookup-table logit
                (imitate/evaluate.py `logits`) and the net only learns the residual; the residual layer starts at zero,
                so before training the head is exactly the table
  level_direct  the level head also reads its own embeddings of the round token and the owner's dispatch-center level
                token (tokens.POS_ROUND / POS_ME_SL) through a small MLP, so "round x level" is one hop away instead of
                having to survive the transformer
Default size d=128, 2 layers (~0.5M params); ~1 ms per decision on a desktop GPU, the exact number is measured by
train.py (`latency`) and written next to the checkpoint.
"""
import torch
from torch import nn

import tokens


class ImitationNet(nn.Module):
    def __init__(self, n_vocab, n_base, d=128, layers=2, heads=4, ff=2, dropout=0.1, prior=(), level_direct=0):
        super().__init__()
        self.emb = nn.Embedding(n_vocab, d, padding_idx=0)
        self.pos = nn.Parameter(torch.zeros(tokens.SEQ_LEN, d))
        enc = nn.TransformerEncoderLayer(d, heads, ff * d, dropout=dropout, batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(enc, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.board = nn.Linear(d, n_base)
        self.level_direct = level_direct
        if level_direct:
            self.level_tok = nn.Embedding(n_vocab, level_direct)
            self.level = nn.Sequential(nn.Linear(d + 2 * level_direct, d), nn.GELU(), nn.Linear(d, 1))
        else:
            self.level = nn.Linear(d, 1)
        self.prior = tuple(prior)
        for h in self.prior:  # residual starts at 0: the untrained head is the table
            last = getattr(self, h)
            last = last[-1] if isinstance(last, nn.Sequential) else last
            nn.init.zeros_(last.weight)
            nn.init.zeros_(last.bias)
        self.buy = nn.Sequential(nn.Linear(2 * d, d), nn.GELU(), nn.Linear(d, 1))
        self.register_buffer("shop_pos", torch.tensor([tokens.POS_SHOP + tokens.SHOP_W * i for i in range(tokens.N_SHOP)]), persistent=False)

    def forward(self, x, prior=None):
        """prior: {head: table logits} for every head in self.prior ([B, n_base] board, [B] level)"""
        h = self.norm(self.enc(self.emb(x) + self.pos[: x.shape[1]]))
        g = h[:, 0]
        s = h[:, self.shop_pos]                                           # [B, 6, d]
        buy = self.buy(torch.cat([s, g.unsqueeze(1).expand_as(s)], -1)).squeeze(-1)
        lv = torch.cat([g, self.level_tok(x[:, tokens.POS_ROUND]), self.level_tok(x[:, tokens.POS_ME_SL])], -1) if self.level_direct else g
        out = {"board": self.board(g), "level": self.level(lv).squeeze(-1), "buy": buy}
        for k in self.prior:
            out[k] = out[k] + prior[k]
        return out


def build(n_vocab, n_base, cfg):
    return ImitationNet(n_vocab, n_base, d=cfg.get("d", 128), layers=cfg.get("layers", 2), heads=cfg.get("heads", 4),
                        ff=cfg.get("ff", 2), dropout=cfg.get("dropout", 0.1), prior=cfg.get("prior", ()),
                        level_direct=cfg.get("level_direct", 0))
