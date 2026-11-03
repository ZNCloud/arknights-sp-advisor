"""One decision point (a seat's PREP state) -> fixed-length token sequence. Stdlib only.

This is the single state encoding shared by every source (.spdemo, overlay records, later the official-client
recogniser): each source fills the same decision-point record (imitate/records.py), this module turns it into tokens.
Origin: sprlmodel_2355 sptok.py (vocab v1); v2 here pads missing teammates, encodes equipment in shop / hand as IT_*
and exposes the slot layout so the model can read per-slot outputs (shop slot i, board slot j).

Layout (fixed order, fixed widths, SEQ_LEN = 179):
  [BOS] <G> R_r MODE_x BOSS_x BAND_x TLP_b FAC_x*3                                   10
  <ME> LP_b SL_n BC_n (BOND_x CNT_n LAY_b)*6                                         22
  (<MATE> SEAT_n LP_b SL_n BC_n (BOND_x CNT_n LAY_b)*2)*3                            33
  <BOARD> (CH_base G_0/1 CELL_r_c DIR_x IT_x IT_x)*12                                73
  <SHOP>  (CH_base|IT_item PRICE_n FRZ_0/1)*6                                         19
  <HAND>  (CH_base|IT_item G_0/1)*9                                                   19
  <ECO>   F_n [EOS]                                                                    3
A field the source did not record gets that field's NA token (never guessed); a source without shop / hand / funds
(.spdemo) gets EMPTY slots and F_NA.
"""
import json
import os

FACTIONS = ["DOT", "ELEMENT", "FLY", "INVISIBLE", "REFLECTION", "SPECIAL", "TIMES"]
LAY_EDGES = [0, 2, 5, 10, 20, 40, 80, 160, 320]
N_BOARD, N_SHOP, N_HAND, N_MATE = 12, 6, 9, 3
BOARD_W, SHOP_W, HAND_W = 6, 3, 2
# token index of the first token of each block (fixed because every block has a fixed width)
POS_BOARD = 10 + 22 + 33 + 1
POS_SHOP = POS_BOARD + N_BOARD * BOARD_W + 1
POS_HAND = POS_SHOP + N_SHOP * SHOP_W + 1
SEQ_LEN = POS_HAND + N_HAND * HAND_W + 3
POS_ROUND, POS_ME_SL = 2, 12  # R_r in the global block, the owner's SL_n (dispatch-center level) in the <ME> block
N_SPECIAL = 13  # [PAD] .. EMPTY: structure tokens, never masked by augmentation


def lay_bucket(v):
    for i, e in enumerate(LAY_EDGES):
        if v <= e:
            return f"LAY_{i}"
    return f"LAY_{len(LAY_EDGES)}"


def num(prefix, v, lo, hi, step=1):
    if v is None:
        return prefix + "_NA"
    v = max(lo, min(hi, int(v) // step * step))
    return f"{prefix}_{v}"


def build_itos(chess, items, bonds, bands):
    """Token list from the engine's data tables. Sorted, so the same tables always give the same ids."""
    base = sorted({c["baseId"] for c in chess.values()})
    toks = ["[PAD]", "[BOS]", "[EOS]", "[UNK]", "[MASK]", "<G>", "<ME>", "<MATE>", "<BOARD>", "<SHOP>", "<HAND>", "<ECO>", "EMPTY"]
    assert len(toks) == N_SPECIAL
    toks += [f"R_{i}" for i in range(17)] + ["MODE_mode_multi_abyss", "MODE_mode_multi_hard", "MODE_NA"]
    toks += [f"BOSS_boss_{i}" for i in range(1, 12)] + ["BOSS_NA"]
    toks += ["BAND_" + b for b in sorted(bands)] + ["BAND_NA"]
    toks += [f"TLP_{i}" for i in range(0, 101, 10)] + ["TLP_NA"]
    toks += ["FAC_" + f for f in FACTIONS + ["NA"]]
    toks += [f"LP_{i}" for i in range(0, 41, 2)] + ["LP_NA"]
    toks += [f"SL_{i}" for i in range(0, 11)] + ["SL_NA"] + [f"BC_{i}" for i in range(0, 16)] + ["BC_NA"]
    toks += ["BOND_" + b for b in sorted(bonds)] + ["BOND_NA"] + [f"CNT_{i}" for i in range(0, 13)]
    toks += [f"LAY_{i}" for i in range(len(LAY_EDGES) + 1)] + [f"SEAT_{i}" for i in range(4)] + ["SEAT_NA"]
    toks += ["CH_" + b for b in base] + ["CH_TOKEN"] + ["G_0", "G_1"]
    toks += [f"CELL_{r}_{c}" for r in range(0, 19) for c in range(0, 21)] + ["CELL_NA"]
    toks += ["DIR_" + d for d in ["UP", "DOWN", "LEFT", "RIGHT", "NA"]]
    toks += ["IT_" + i for i in sorted(items)] + ["IT_NONE"]
    toks += [f"PRICE_{i}" for i in range(0, 11)] + ["PRICE_NA", "FRZ_0", "FRZ_1"] + [f"F_{i}" for i in range(0, 61)] + ["F_NA"]
    return toks


class Vocab:
    """itos is the contract: a trained checkpoint stores its own itos and is reloaded with it (data-table drift only
    turns unseen ids into [UNK], it never shifts ids)."""

    def __init__(self, itos, chess):
        self.itos = list(itos)
        self.stoi = {t: i for i, t in enumerate(self.itos)}
        self.chess = chess
        self.base_ids = sorted(t[3:] for t in self.itos if t.startswith("CH_") and t != "CH_TOKEN")

    def id(self, t):
        return self.stoi.get(t, self.stoi["[UNK]"])

    def base(self, cid):
        c = self.chess.get(cid)
        return c["baseId"] if c else None

    def is_item(self, cid):
        return isinstance(cid, str) and cid.startswith("chess_item_")

    def card(self, cid):
        """shop / hand entry -> its identity token (chess by base id, equipment by item id)."""
        if self.is_item(cid):
            return "IT_" + cid
        b = self.base(cid)
        return "CH_" + b if b else "[UNK]"

    def encode(self, rec):
        t = ["[BOS]", "<G>", f"R_{min(16, rec['round'])}", "MODE_" + (rec.get("mode") or "NA"),
             "BOSS_" + (rec.get("boss") or "NA"), "BAND_" + (rec.get("band") or "NA"), num("TLP", rec.get("teamLp"), 0, 100, 10)]
        fac = (rec.get("factions") or [])[:3]
        t += ["FAC_" + f for f in fac] + ["FAC_NA"] * (3 - len(fac))
        p = rec.get("pub") or {}
        t += ["<ME>", num("LP", p.get("lp"), 0, 40, 2), num("SL", p.get("shopLevel"), 0, 10), num("BC", p.get("boardCount"), 0, 15)]
        t += self._bonds(p.get("bonds") or {}, 6)
        mates = sorted(rec.get("mates") or [], key=lambda m: m.get("seat") if m.get("seat") is not None else 9)[:N_MATE]
        for m in mates:
            seat = m.get("seat")
            t += ["<MATE>", f"SEAT_{seat}" if seat is not None else "SEAT_NA", num("LP", m.get("lp"), 0, 40, 2),
                  num("SL", m.get("shopLevel"), 0, 10), num("BC", m.get("boardCount"), 0, 15)]
            t += self._bonds(m.get("bonds") or {}, 2)
        for _ in range(N_MATE - len(mates)):
            t += ["<MATE>", "SEAT_NA", "LP_NA", "SL_NA", "BC_NA"] + ["BOND_NA", "CNT_0", "LAY_0"] * 2
        assert len(t) == POS_BOARD - 1
        t += ["<BOARD>"]
        for u in board_slots(rec.get("board_prev")):
            if u.get("token"):
                t += ["CH_TOKEN", "G_0"]
            else:
                b = self.base(u["id"])
                t += ["CH_" + b if b else "[UNK]", "G_1" if u.get("golden") else "G_0"]
            t += [f"CELL_{u['row']}_{u['col']}" if u.get("row") is not None else "CELL_NA", "DIR_" + (u.get("dir") or "NA")]
            its = (u.get("items") or [])[:2]
            t += ["IT_" + i for i in its] + ["IT_NONE"] * (2 - len(its))
        t += ["EMPTY"] * (POS_SHOP - 1 - len(t))
        t += ["<SHOP>"]
        shop = (rec.get("shop") or [])[:N_SHOP]
        for s in shop:
            t += [self.card(s["id"]), num("PRICE", s.get("price"), 0, 10), "FRZ_1" if s.get("frozen") else "FRZ_0"]
        t += ["EMPTY"] * (SHOP_W * (N_SHOP - len(shop)))
        t += ["<HAND>"]
        hand = (rec.get("hand") or [])[:N_HAND]
        for h in hand:
            t += [self.card(h), "G_1" if (self.chess.get(h) or {}).get("isGolden") else "G_0"]
        t += ["EMPTY"] * (HAND_W * (N_HAND - len(hand)))
        t += ["<ECO>", num("F", rec.get("funds"), 0, 60), "[EOS]"]
        assert len(t) == SEQ_LEN, len(t)
        return t

    def ids(self, rec):
        return [self.id(x) for x in self.encode(rec)]

    def _bonds(self, bonds, k):
        top = sorted(bonds.items(), key=lambda kv: (-kv[1][1], -kv[1][0], kv[0]))[:k]
        out = []
        for b, (cnt, lay) in top:
            out += ["BOND_" + b, f"CNT_{min(12, cnt)}", lay_bucket(lay)]
        return out + ["BOND_NA", "CNT_0", "LAY_0"] * (k - len(top))


def board_slots(units):
    """The board units in slot order (row, col), at most N_BOARD. The model's board slot j is this list's j-th unit."""
    return sorted(units or [], key=lambda u: (u.get("row") if u.get("row") is not None else 99,
                                              u.get("col") if u.get("col") is not None else 99, u.get("id") or ""))[:N_BOARD]


def load_tables(data_dir):
    j = lambda n: json.load(open(os.path.join(data_dir, f"{n}.json"), encoding="utf-8"))
    keys = lambda d: list(d.keys()) if isinstance(d, dict) else [x.get("id") or x.get("bondId") or x.get("bandId") or x.get("itemId") for x in d]
    return j("chess"), keys(j("items")), keys(j("bonds")), keys(j("bands"))


def vocab_from_engine(data_dir):
    chess, items, bonds, bands = load_tables(data_dir)
    return Vocab(build_itos(chess, items, bonds, bands), chess)
