#!/usr/bin/env python3
"""Inference: decision-point record(s) in -> the imitation net's suggestions out (one JSON line per record).

This is the interface a live consumer (overlay, official-client recogniser) talks to: it fills the record schema of
imitate/records.py from whatever it can read (unknown fields -> None) and gets back
  add       top-k chess not on the board yet, by P(on the board at this round's battle)       (deploy / buy target)
  keep      every board unit with P(still on the board at the battle)                         (low = sell / bench it)
  level_up  P(the owner levels up this PREP)
  buy       per shop slot P(the owner buys it); [] when the record has no shop
The net only imitates the owner; it is a candidate generator, the engine check (advisor/lineup.mjs) stays the judge.

usage: python3 imitate/predict.py --ckpt <run>/final.pt --engine-data ../engine/data [--k 5] < records.jsonl
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate  # noqa: E402
import model as M  # noqa: E402
import tokens  # noqa: E402
import torch  # noqa: E402


class Policy:
    def __init__(self, ckpt, engine_data, device="cpu"):
        ck = torch.load(ckpt, map_location=device)
        chess, *_ = tokens.load_tables(engine_data)
        self.vocab = tokens.Vocab(ck["itos"], chess)  # the checkpoint's own token ids, not today's tables
        if self.vocab.base_ids != ck["base_ids"]:
            raise SystemExit("checkpoint base_ids do not match its itos")
        self.net = M.build(len(ck["itos"]), len(ck["base_ids"]), ck["config"]["model"]).to(device).eval()
        self.heads, self.device = ck["heads"], device
        st = ck.get("prior_tables") or {}  # heads in config model.prior read the tables fitted on the training games
        if sorted(st) != sorted(ck["config"]["model"].get("prior", [])):
            raise SystemExit("checkpoint prior tables do not match its config model.prior")
        load = {"board": lambda x: evaluate.BoardTable.from_state(x, self.vocab), "level": evaluate.LevelTable.from_state}
        self.tables = {h: load[h](x) for h, x in st.items()}
        self.names = {c["baseId"]: c.get("name") for c in chess.values()}

    @torch.no_grad()
    def __call__(self, rec, k=5):
        x = torch.tensor([self.vocab.ids(rec)], device=self.device)
        pr = {h: torch.tensor([t.logits(rec)], device=self.device) for h, t in self.tables.items()}
        p = {}
        for h, state in self.heads.items():
            self.net.load_state_dict(state)
            p[h] = torch.sigmoid(self.net(x, pr)[h][0]).cpu().tolist()
        board = dict(zip(self.vocab.base_ids, p["board"]))
        units = tokens.board_slots(rec.get("board_prev"))
        on = {self.vocab.base(u["id"]) for u in units if not u.get("token")}
        add = sorted((b for b in self.vocab.base_ids if b not in on), key=lambda b: -board[b])[:k]
        shop = (rec.get("shop") or [])[: tokens.N_SHOP]
        return {
            "round": rec.get("round"),
            "add": [{"base": b, "name": self.names.get(b), "p": round(board[b], 4)} for b in add],
            "keep": [{"slot": j, "id": u["id"], "p": round(board.get(self.vocab.base(u["id"]), 0.0), 4)}
                     for j, u in enumerate(units) if not u.get("token")],
            "level_up": round(p["level"], 4),
            "buy": [{"slot": i, "id": s["id"], "p": round(p["buy"][i], 4)} for i, s in enumerate(shop)],
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--engine-data", required=True)
    ap.add_argument("--k", type=int, default=5)
    a = ap.parse_args()
    pol = Policy(a.ckpt, a.engine_data)
    for line in sys.stdin:
        if line.strip():
            print(json.dumps(pol(json.loads(line), a.k), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
