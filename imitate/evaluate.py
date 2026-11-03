"""Held-out metrics and the lookup-table baselines the net has to beat (stdlib only).

Every metric is computed on records of held-out games only; baselines are fitted on the training games only.
  board  add@5 / add@10  of the chess the owner newly put on the board this round, the share ranked in the top 5 / 10
                         among the chess not already on the board (same definition as sprlmodel_2355 tiny_bc)
         keep_auc        among the chess already on the board, AUC of score(kept) vs score(taken off)
  level  auc / brier     level up this PREP or not
  buy    auc             per shop slot, bought or not
         top1            of decision points where the owner bought >= 1 slot, the share whose top-scored slot was bought
"""
import collections


def auc(pos, neg):
    """P(score(pos) > score(neg)), ties 1/2. Rank-based, O(n log n)."""
    if not pos or not neg:
        return None
    allv = sorted([(v, 1) for v in pos] + [(v, 0) for v in neg])
    rank_sum, i, n = 0.0, 0, len(allv)
    while i < n:
        j = i
        while j < n and allv[j][0] == allv[i][0]:
            j += 1
        r = (i + j + 1) / 2.0  # 1-based mean rank of the tie group
        rank_sum += r * sum(1 for k in range(i, j) if allv[k][1] == 1)
        i = j
    return (rank_sum - len(pos) * (len(pos) + 1) / 2.0) / (len(pos) * len(neg))


def board_sets(rec, vocab):
    base = lambda units: {vocab.base(u["id"]) for u in units or [] if not u.get("token") and vocab.base(u["id"])}
    return base(rec["board_prev"]), base(rec["labels"]["board_next"])


def card_key(cid, vocab):
    return cid if vocab.is_item(cid) else (vocab.base(cid) or cid)


def owned(rec, vocab, cid):
    """copies of this card's base the owner already holds (board + hand); equipment counts 0"""
    if vocab.is_item(cid):
        return 0
    b = vocab.base(cid)
    held = [u["id"] for u in rec["board_prev"] or [] if not u.get("token")] + list(rec.get("hand") or [])
    return sum(1 for h in held if not vocab.is_item(h) and vocab.base(h) == b)


# ── metrics ──────────────────────────────────────────────────────────────────────────────────────────────────────

def board_metrics(recs, scores, vocab):
    """scores[i]: dict base id -> score for recs[i]"""
    a5 = a10 = n_add = 0
    kept_s, rem_s = [], []
    pairs_auc, pairs_n = 0.0, 0
    for rec, s in zip(recs, scores):
        prev, nxt = board_sets(rec, vocab)
        adds = nxt - prev
        if adds:
            cand = sorted((b for b in vocab.base_ids if b not in prev), key=lambda b: -s[b])
            a5 += len(adds & set(cand[:5])) / len(adds)
            a10 += len(adds & set(cand[:10])) / len(adds)
            n_add += 1
        kept, rem = [s[b] for b in prev & nxt], [s[b] for b in prev - nxt]
        a = auc(kept, rem)
        if a is not None:  # pooled over records the way tiny_bc did (pairs within a record)
            pairs_auc += a * len(kept) * len(rem)
            pairs_n += len(kept) * len(rem)
    return {"add@5": a5 / n_add if n_add else None, "add@10": a10 / n_add if n_add else None, "n_add": n_add,
            "keep_auc": pairs_auc / pairs_n if pairs_n else None, "keep_pairs": pairs_n}


def level_metrics(ys, ps):
    pos = [p for y, p in zip(ys, ps) if y == 1]
    neg = [p for y, p in zip(ys, ps) if y == 0]
    return {"auc": auc(pos, neg), "brier": sum((p - y) ** 2 for y, p in zip(ys, ps)) / len(ys) if ys else None,
            "n": len(ys), "pos": len(pos)}


def buy_metrics(labels, scores):
    """labels / scores: per decision point, one list per shop slot"""
    pos, neg, top1, n_top = [], [], 0, 0
    for y, s in zip(labels, scores):
        pos += [v for v, t in zip(s, y) if t == 1]
        neg += [v for v, t in zip(s, y) if t == 0]
        if any(y):
            n_top += 1
            top1 += y[max(range(len(s)), key=lambda i: s[i])] == 1
    return {"auc": auc(pos, neg), "top1": top1 / n_top if n_top else None, "n_points": len(labels), "n_slots": len(pos) + len(neg)}


# ── lookup-table baselines (fitted on training records only) ─────────────────────────────────────────────────────

class BoardTable:
    """P(add | band) with backoff to P(add); chess already on the board get +1 so keep_auc reflects the prior."""

    def __init__(self, recs, vocab, by_band=True):
        self.vocab, self.by_band = vocab, by_band
        self.glob, self.band = collections.Counter(), collections.defaultdict(collections.Counter)
        for r in recs:
            prev, nxt = board_sets(r, vocab)
            for b in nxt - prev:
                self.glob[b] += 1
                self.band[r.get("band")][b] += 1

    def __call__(self, rec):
        prev, _ = board_sets(rec, self.vocab)
        c = self.band[rec.get("band")] if self.by_band and rec.get("band") and sum(self.band[rec.get("band")].values()) >= 10 else self.glob
        tot = sum(c.values()) or 1
        return {b: c[b] / tot + (1.0 if b in prev else 0.0) for b in self.vocab.base_ids}


class LevelTable:
    """P(level up | round, shop level) -> P(level up | round) -> P(level up), each needing >= 5 samples."""

    def __init__(self, recs):
        self.c = collections.defaultdict(lambda: [0, 0])
        for r in recs:
            y = r["labels"]["level_up"]
            for k in self.keys(r):
                self.c[k][0] += y
                self.c[k][1] += 1

    @staticmethod
    def keys(r):
        return [("rs", r["round"], (r.get("pub") or {}).get("shopLevel")), ("r", r["round"]), ("all",)]

    def __call__(self, rec):
        for k in self.keys(rec):
            n1, n = self.c.get(k, (0, 0))
            if n >= 5:
                return n1 / n
        return 0.0


class BuyTable:
    """P(buy | copies already held (0/1/2+), price) -> P(buy | copies held) -> P(buy)."""

    def __init__(self, recs, vocab):
        self.vocab = vocab
        self.c = collections.defaultdict(lambda: [0, 0])
        for r in recs:
            for s, y in zip(r["shop"], r["labels"]["buys"]):
                for k in self.keys(r, s):
                    self.c[k][0] += y
                    self.c[k][1] += 1

    def keys(self, r, s):
        o = min(2, owned(r, self.vocab, s["id"]))
        return [("op", o, s.get("price"), self.vocab.is_item(s["id"])), ("o", o, self.vocab.is_item(s["id"])), ("all",)]

    def __call__(self, rec):
        out = []
        for s in rec["shop"][:6]:
            for k in self.keys(rec, s):
                n1, n = self.c.get(k, (0, 0))
                if n >= 5:
                    out.append(n1 / n)
                    break
            else:
                out.append(0.0)
        return out
