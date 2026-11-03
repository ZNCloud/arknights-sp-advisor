"""Sources -> decision-point records (one schema for every source). Stdlib only.

A record is one of the owner's decisions during a PREP phase:
  game, source, date, round, mode, boss, band, factions, teamLp, outcome
  pub      {lp, shopLevel, boardCount, bonds{bondId: [count, layers]}}         the owner's public state
  mates    [{seat, lp, shopLevel, boardCount, bonds, isBot}]                     teammates' public state
  board_prev [unit]   the board the decision starts from (unit = {id,row,col,dir,items,golden,token})
  shop / hand / funds the private state (overlay only; None when the source does not record it)
  labels   {board_next: [unit] | None, level_up: 0/1 | None, buys: [0/1 per shop slot] | None}
A label is None when the source cannot tell; the trainer masks it. Nothing is inferred beyond what the frames say.

Readers:
  spdemo_records(path)   a client .spdemo replay (gzip JSON). One record per round: board_prev = own board at the
                         previous battle start, board_next = own board at this round's battle start, level_up from the
                         shopLevel in m.public. No shop / hand / funds (the server does not broadcast them).
  overlay_records(path)  an overlay record file (matches/*.jsonl, one snapshot per line). One record per "shop epoch":
                         a run of snapshots whose shop only loses cards (buys); a refresh or a new round starts the next
                         epoch. buys[i] = the opening shop's slot i is gone by the epoch's last snapshot. The round's
                         first epoch also carries board_next (the board at COMBAT) and level_up.
"""
import collections
import datetime
import gzip
import json


def _iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _bonds_public(p):
    b = p.get("bonds") or []
    if isinstance(b, dict):
        b = [dict(bondId=k, **v) for k, v in b.items()]
    return {x["bondId"]: [x.get("count", 0) or 0, x.get("layers", 0) or 0] for x in b
            if (x.get("count") or 0) > 0 or (x.get("layers") or 0) > 0}


def _bonds_strings(lst):
    """overlay form "bondId:count/layers" -> {bondId: [count, layers]}"""
    out = {}
    for s in lst or []:
        if isinstance(s, str) and ":" in s and "/" in s:
            k, v = s.split(":", 1)
            c, l = v.split("/", 1)
            if int(c) > 0 or int(l) > 0:
                out[k] = [int(c), int(l)]
    return out


# ── .spdemo ──────────────────────────────────────────────────────────────────────────────────────────────────────

def _spdemo_unit(u, chess):
    cid = u.get("chessId") or u.get("id") or u.get("tokenId")
    if u.get("kind") == "token":
        return {"id": cid, "row": u.get("row"), "col": u.get("col"), "dir": u.get("dir"), "items": [], "golden": False, "token": True}
    golden = bool(chess[cid].get("isGolden")) if cid in chess else str(cid).endswith("_b")
    return {"id": cid, "row": u.get("row"), "col": u.get("col"), "dir": u.get("dir"), "items": list(u.get("items") or []),
            "golden": golden, "token": False}


def load_spdemo(path):
    raw = open(path, "rb").read()
    return json.loads(gzip.decompress(raw))


def spdemo_records(path, chess):
    d = load_spdemo(path)
    me = d["me"]["playerId"]
    fr = d["frames"]
    res = d.get("result") or {}
    pubs = [x["data"] for x in fr if x["type"] == "m.public"]
    prep_first, team_lp, last_tlp = {}, {}, None
    for p in pubs:
        if p.get("teamLp") is not None:
            last_tlp = p["teamLp"]
        if p.get("phase") == "PREP" and isinstance(p.get("round"), int) and p["round"] not in prep_first:
            prep_first[p["round"]] = p
            team_lp[p["round"]] = last_tlp  # last team LP broadcast before this PREP (PREP broadcasts often omit it)
    board = {}
    for x in fr:
        if x["type"] != "b.start":
            continue
        s = x["data"]["spec"]
        for pl in s["players"]:
            if pl["playerId"] == me and (s["round"] not in board or s["kind"] == "normal"):
                board[s["round"]] = [_spdemo_unit(u, chess) for u in pl["units"]]
    myres = next((p for p in res.get("players", []) if p.get("playerId") == me), {})
    first = pubs[0] if pubs else {}
    base = {"game": d["id"], "source": "spdemo", "date": _iso(d["startedAt"]), "mode": res.get("modeId"),
            "boss": res.get("bossId"), "band": myres.get("bandId"), "factions": first.get("factions"),
            "outcome": {"victory": res.get("victory"), "hiddenCleared": res.get("hiddenCleared"), "roundsPassed": res.get("roundsPassed")}}
    out = []
    for r in sorted(board):
        pf = prep_first.get(r)
        mine = next((p for p in (pf or {}).get("players", []) if p["playerId"] == me), None)
        if mine is None:
            continue
        nxt = next((p for p in (prep_first.get(r + 1) or {}).get("players", []) if p["playerId"] == me), None)
        lv0, lv1 = mine.get("shopLevel"), (nxt or {}).get("shopLevel")
        rec = dict(base)
        rec.update({
            "round": r, "teamLp": team_lp.get(r),
            "pub": {"lp": mine.get("lp"), "shopLevel": lv0, "boardCount": mine.get("boardCount"), "bonds": _bonds_public(mine)},
            "mates": [{"seat": p.get("seat"), "lp": p.get("lp"), "shopLevel": p.get("shopLevel"), "boardCount": p.get("boardCount"),
                       "bonds": _bonds_public(p), "isBot": bool(p.get("isBot"))} for p in pf["players"] if p["playerId"] != me],
            "board_prev": board.get(r - 1, []), "shop": None, "hand": None, "funds": None,
            "labels": {"board_next": board[r],
                       "level_up": (1 if lv1 > lv0 else 0) if (lv0 is not None and lv1 is not None) else None,
                       "buys": None},
        })
        out.append(rec)
    return d["id"], out


# ── overlay records ──────────────────────────────────────────────────────────────────────────────────────────────

PREP_PHASES = ("ROUND_START", "PREP")


def split_overlay_games(rows):
    """Same rule as advisor/team.mjs splitMatches: a new match starts at INFO_CHECK / round 0."""
    games, cur = [], []
    for r in rows:
        if (r.get("phase") == "INFO_CHECK" or (r.get("round") == 0 and r.get("phase") != "RESULT")) and cur:
            games.append(cur)
            cur = []
        cur.append(r)
    games.append(cur)
    return [g for g in games if len(g) > 2]


def _overlay_unit(b):
    at = b.get("at") or [None, None]
    cid = b.get("id")
    items = [i.get("id") if isinstance(i, dict) else i for i in b.get("items") or []]  # overlay writes {uid, id}
    return {"id": cid, "row": at[0], "col": at[1], "dir": b.get("dir"), "items": [i for i in items if i],
            "golden": bool(b.get("golden")), "token": str(cid).startswith("token_")}


def _shop(row):
    return [{"id": s["id"], "price": s.get("price"), "frozen": bool(s.get("frozen"))} for s in row.get("shop") or []]


def _sub_multiset(a, b):
    ca, cb = collections.Counter(a), collections.Counter(b)
    return all(cb[k] >= v for k, v in ca.items())


def _buys(opening, last):
    """opening shop slots -> 1 if the card is gone by `last` (duplicates: earlier slots are taken first)."""
    left = collections.Counter(s["id"] for s in last)
    out = []
    for s in opening:
        if left[s["id"]] > 0:
            left[s["id"]] -= 1
            out.append(0)
        else:
            out.append(1)
    return out


def overlay_records(path):
    return overlay_records_from_rows([json.loads(l) for l in open(path, encoding="utf-8") if l.strip()])


def overlay_records_from_rows(rows):
    out = []
    for gi, g in enumerate(split_overlay_games(rows)):
        gid = "ov-" + g[0]["at"].replace(":", "").replace("-", "")[:15]
        res = next((r["result"] for r in reversed(g) if r.get("result")), None) or {}
        self_seat = next((r["self"]["seat"] for r in g if (r.get("self") or {}).get("seat") is not None), None)
        base = {"game": gid, "source": "overlay", "date": g[0]["at"][:19] + "Z", "mode": g[0].get("mode"),
                "boss": res.get("bossId"), "band": None, "factions": None,
                "outcome": {"victory": res.get("victory"), "hiddenCleared": res.get("hiddenCleared"), "roundsPassed": res.get("roundsPassed")}}
        by_round = collections.OrderedDict()
        for r in g:
            if isinstance(r.get("round"), int) and r["round"] >= 1:
                by_round.setdefault(r["round"], []).append(r)
        for rnd, rs in by_round.items():
            preps = [r for r in rs if r.get("phase") in PREP_PHASES]
            if not preps:
                continue
            combat = next((r for r in rs if r.get("phase") == "COMBAT"), None)
            # epochs: consecutive snapshots whose shop is a sub-multiset of the epoch's opening shop
            epochs, cur = [], None
            for r in preps + ([combat] if combat else []):
                ids = [s["id"] for s in _shop(r)]
                if cur is not None and _sub_multiset(ids, [s["id"] for s in _shop(cur[0])]):
                    cur.append(r)
                else:
                    if cur:
                        epochs.append(cur)
                    cur = [r]
            if cur:
                epochs.append(cur)
            end = combat or preps[-1]
            for ei, ep in enumerate(epochs):
                o = ep[0]
                if o.get("phase") == "COMBAT":
                    continue
                opening = _shop(o)
                rec = dict(base)
                rec.update({
                    "round": rnd, "epoch": ei, "teamLp": o.get("teamLp"),
                    "pub": {"lp": o.get("lp"), "shopLevel": o.get("level"),
                            "boardCount": sum(1 for b in o.get("board") or [] if not str(b.get("id")).startswith("token_")),
                            "bonds": _bonds_strings(o.get("bonds"))},
                    "mates": [{"seat": m.get("seat"), "lp": m.get("lp"), "shopLevel": m.get("level"),
                               "boardCount": m.get("board") if isinstance(m.get("board"), int) else None,
                               "bonds": _bonds_strings(m.get("bonds")), "isBot": bool(m.get("isBot"))}
                              for m in o.get("mates") or [] if m.get("seat") != self_seat],
                    "board_prev": [_overlay_unit(b) for b in o.get("board") or []],
                    "shop": opening, "hand": list(o.get("hand") or []), "funds": o.get("funds"),
                    "labels": {
                        "board_next": [_overlay_unit(b) for b in end.get("board") or []] if ei == 0 and combat else None,
                        "level_up": (1 if (end.get("level") or 0) > (o.get("level") or 0) else 0) if ei == 0 and combat else None,
                        "buys": _buys(opening, _shop(ep[-1])) if len(ep) >= 2 and opening else None,
                    },
                })
                out.append(rec)
    return out
