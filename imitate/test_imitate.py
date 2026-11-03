"""python3 -m unittest imitate/test_imitate.py   (stdlib; the model test runs only when torch is installed)

Uses a three-chess fake table, so no engine checkout is needed.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dataset  # noqa: E402
import evaluate  # noqa: E402
import records  # noqa: E402
import tokens  # noqa: E402

CHESS = {
    "chess_char_1_01_a": {"baseId": "chess_char_1_01_a", "isGolden": False},
    "chess_char_1_01_b": {"baseId": "chess_char_1_01_a", "isGolden": True},
    "chess_char_2_02_a": {"baseId": "chess_char_2_02_a", "isGolden": False},
    "chess_char_3_03_a": {"baseId": "chess_char_3_03_a", "isGolden": False},
}
V = tokens.Vocab(tokens.build_itos(CHESS, ["chess_item_1_01_e_a"], ["preciShip", "yanShip"], ["band_pith"]), CHESS)


def rec(**kw):
    r = {"round": 5, "mode": "mode_multi_abyss", "boss": "boss_2", "band": "band_pith", "factions": ["FLY"], "teamLp": 33,
         "pub": {"lp": 20, "shopLevel": 3, "boardCount": 2, "bonds": {"preciShip": [2, 7]}}, "mates": [],
         "board_prev": [{"id": "chess_char_2_02_a", "row": 10, "col": 4, "dir": "RIGHT", "items": [], "golden": False},
                        {"id": "chess_char_1_01_b", "row": 9, "col": 5, "dir": "UP", "items": ["chess_item_1_01_e_a"], "golden": True}],
         "shop": [{"id": "chess_char_3_03_a", "price": 3, "frozen": False}, {"id": "chess_item_1_01_e_a", "price": 1, "frozen": True}],
         "hand": ["chess_char_1_01_a"], "funds": 7,
         "labels": {"board_next": None, "level_up": None, "buys": None}}
    r.update(kw)
    return r


class Tokens(unittest.TestCase):
    def test_fixed_length_and_slots(self):
        t = V.encode(rec())
        self.assertEqual(len(t), tokens.SEQ_LEN)
        self.assertEqual(t[tokens.POS_BOARD - 1], "<BOARD>")
        self.assertEqual(t[tokens.POS_SHOP - 1], "<SHOP>")
        self.assertEqual(t[tokens.POS_HAND - 1], "<HAND>")
        self.assertEqual(t[tokens.POS_SHOP], "CH_chess_char_3_03_a")
        self.assertEqual(t[tokens.POS_SHOP + tokens.SHOP_W], "IT_chess_item_1_01_e_a")
        # board slots in (row, col) order: the golden unit at row 9 comes first, base id + G_1
        self.assertEqual(t[tokens.POS_BOARD:tokens.POS_BOARD + 2], ["CH_chess_char_1_01_a", "G_1"])
        self.assertNotIn("[UNK]", t)

    def test_missing_fields_are_na_not_guessed(self):
        t = V.encode(rec(shop=None, hand=None, funds=None, teamLp=None, mates=None, band=None))
        self.assertEqual(len(t), tokens.SEQ_LEN)
        self.assertIn("F_NA", t)
        self.assertIn("TLP_NA", t)
        self.assertIn("BAND_NA", t)
        self.assertEqual(t.count("SEAT_NA"), tokens.N_MATE)


class Records(unittest.TestCase):
    def test_buys_duplicates_take_earlier_slots(self):
        opening = [{"id": "a"}, {"id": "b"}, {"id": "a"}]
        self.assertEqual(records._buys(opening, [{"id": "a"}]), [0, 1, 1])

    def test_overlay_epochs_split_on_refresh(self):
        def row(phase, shop, funds, level=3, board=()):
            return {"at": "2026-10-21T12:00:00.000Z", "phase": phase, "round": 4, "mode": "mode_multi_abyss", "funds": funds,
                    "lp": 20, "level": level, "bonds": ["preciShip:2/7"], "hand": [],
                    "board": [{"id": b, "golden": False, "items": [], "at": [10, i]} for i, b in enumerate(board)],
                    "shop": [{"id": s, "price": 3, "frozen": False} for s in shop]}
        rows = [{"at": "2026-10-21T11:59:00.000Z", "phase": "INFO_CHECK", "round": 0},
                row("PREP", ["x", "y", "z"], 9), row("PREP", ["x", "z"], 6),        # epoch 0: bought y
                row("PREP", ["p", "q", "r"], 4), row("PREP", ["p", "q", "r"], 4),  # refresh -> epoch 1: bought none
                row("COMBAT", ["p", "q", "r"], 4, level=3, board=["chess_char_2_02_a"])]
        rs = records.overlay_records_from_rows(rows)
        self.assertEqual([r["labels"]["buys"] for r in rs], [[0, 1, 0], [0, 0, 0]])
        self.assertEqual(rs[0]["labels"]["level_up"], 0)
        self.assertEqual([u["id"] for u in rs[0]["labels"]["board_next"]], ["chess_char_2_02_a"])
        self.assertIsNone(rs[1]["labels"]["board_next"])  # only the round's first epoch carries the round labels


class Folds(unittest.TestCase):
    def test_fold_depends_only_on_game_id(self):
        self.assertEqual(dataset.fold_of("1793622004609-jr4c42", 5), dataset.fold_of("1793622004609-jr4c42", 5))
        self.assertEqual(len({dataset.fold_of(f"g{i}", 5) for i in range(50)}), 5)


class Metrics(unittest.TestCase):
    def test_auc(self):
        self.assertEqual(evaluate.auc([3, 4], [1, 2]), 1.0)
        self.assertEqual(evaluate.auc([1], [1]), 0.5)
        self.assertEqual(evaluate.auc([1, 3], [2]), 0.5)
        self.assertIsNone(evaluate.auc([], [1]))


try:
    import torch

    import model as M

    class Model(unittest.TestCase):
        def test_forward_shapes(self):
            net = M.build(len(V.itos), len(V.base_ids), {"d": 16, "layers": 1, "heads": 2})
            o = net(torch.tensor([V.ids(rec()), V.ids(rec(shop=None))]))
            self.assertEqual(tuple(o["board"].shape), (2, len(V.base_ids)))
            self.assertEqual(tuple(o["level"].shape), (2,))
            self.assertEqual(tuple(o["buy"].shape), (2, tokens.N_SHOP))
except ImportError:
    pass

if __name__ == "__main__":
    unittest.main()
