#!/usr/bin/env python3
"""Gather every owner game in the repo -> decisions.jsonl + manifest.json (stdlib only).

Sources (re-scanned on every run, so new uploads are picked up by just re-running):
  demos/raw/*.spdemo, matches/*.spdemo   client replays (the same game can sit in both: deduped by the replay's game id)
  matches/*.jsonl                        overlay records
Folds: fold = sha1(game id) mod K. Adding games never moves an existing game to another fold, so numbers before and
after a data drop stay comparable game for game.

usage: python3 imitate/dataset.py --repo . --engine-data ../engine/data --out ../data/imitate/decisions.jsonl [--folds 5]
"""
import argparse
import collections
import glob
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import records  # noqa: E402
import tokens  # noqa: E402


def fold_of(game, k):
    return int(hashlib.sha1(game.encode("utf-8")).hexdigest(), 16) % k


def collect(repo, chess):
    recs, games, seen = [], {}, {}
    spdemos = sorted(glob.glob(os.path.join(repo, "demos", "raw", "*.spdemo")) + glob.glob(os.path.join(repo, "matches", "*.spdemo")))
    for f in spdemos:
        gid, rs = records.spdemo_records(f, chess)
        if gid in seen:
            continue
        seen[gid] = os.path.relpath(f, repo)
        recs += rs
        games[gid] = {"source": "spdemo", "file": seen[gid]}
    for f in sorted(glob.glob(os.path.join(repo, "matches", "*.jsonl"))):
        rs = records.overlay_records(f)
        for r in rs:
            games.setdefault(r["game"], {"source": "overlay", "file": os.path.relpath(f, repo)})
        recs += rs
    return recs, games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--engine-data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--folds", type=int, default=5)
    a = ap.parse_args()
    chess, *_ = tokens.load_tables(a.engine_data)
    recs, games = collect(a.repo, chess)
    unknown = collections.Counter()
    for r in recs:
        r["fold"] = fold_of(r["game"], a.folds)
        for u in (r["board_prev"] or []) + ((r["labels"]["board_next"]) or []):
            if not u.get("token") and u["id"] not in chess:
                unknown[u["id"]] += 1
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fo:
        for r in recs:
            fo.write(json.dumps(r, ensure_ascii=False) + "\n")
    per_game = collections.defaultdict(lambda: collections.Counter())
    for r in recs:
        c = per_game[r["game"]]
        c["records"] += 1
        for k, v in r["labels"].items():
            c[k] += v is not None
    man = {
        "n_records": len(recs), "n_games": len(games), "folds": a.folds,
        "by_source": dict(collections.Counter(g["source"] for g in games.values())),
        "labels": {k: sum(1 for r in recs if r["labels"][k] is not None) for k in ("board_next", "level_up", "buys")},
        "buy_slots": sum(len(r["labels"]["buys"]) for r in recs if r["labels"]["buys"]),
        "buy_positive": sum(sum(r["labels"]["buys"]) for r in recs if r["labels"]["buys"]),
        "unknown_chess_ids": dict(unknown),
        "games": {g: dict(v, fold=fold_of(g, a.folds), **per_game[g]) for g, v in sorted(games.items())},
    }
    json.dump(man, open(os.path.splitext(a.out)[0] + ".manifest.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in man.items() if k != "games"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
