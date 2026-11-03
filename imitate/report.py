#!/usr/bin/env python3
"""eval.json (imitate/train.py) of one or more configs -> a markdown table + a trimmed JSON for docs/imitate/.

The trimmed JSON keeps what the numbers need (data counts + sha256, config, per fold x seed metrics, loss curves) and
drops machine paths. usage:
  python3 imitate/report.py --run default=<run>/eval.json --run early-metric=<run2>/eval.json [--final <final>/eval.json] \
      --md docs/imitate/eval.md --json docs/imitate/eval.json
"""
import argparse
import json

ROWS = [("board", "add@5", "阵容：新上的干员落在前 5"), ("board", "add@10", "阵容：新上的干员落在前 10"),
        ("board", "keep_auc", "阵容：留谁 AUC"), ("level", "auc", "升级 AUC"), ("level", "brier", "升级 Brier（越小越好）"),
        ("buy", "auc", "买牌：每格 AUC"), ("buy", "top1", "买牌：分最高那格真买了")]


def cell(v):
    return "-" if v is None else f"{v[0]:.3f} ± {v[1]:.3f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="append", required=True, help="name=path/eval.json (cv merged)")
    ap.add_argument("--final", default=None)
    ap.add_argument("--md", required=True)
    ap.add_argument("--json", required=True)
    a = ap.parse_args()
    runs = {}
    for spec in a.run:
        name, path = spec.split("=", 1)
        runs[name] = json.load(open(path, encoding="utf-8"))
    first = next(iter(runs.values()))
    data = {k: v for k, v in first["data"].items() if k != "file"}
    if any({k: v for k, v in r["data"].items() if k != "file"} != data for r in runs.values()):
        raise SystemExit("runs were trained on different decisions.jsonl")
    cols = [(f"网络（{n}）", r["cv"]["summary"]["model"]) for n, r in runs.items()]
    cols += [("查表：全局", first["cv"]["summary"]["table_global"]), ("查表：按策略", first["cv"]["summary"]["table_band"])]
    lines = [f"数据：{data['n_games']} 局（.spdemo {data['by_source']['spdemo']}、overlay {data['by_source']['overlay']}），"
             f"{data['n_records']} 个决策点，decisions.jsonl sha256 `{data['sha256'][:16]}`。"
             f"按局 {len({d['fold'] for d in first['cv']['detail']})} 折；网络每折 {first['config']['seeds']} 个种子；均值 ± 标准差（折 × 种子）。", "",
             "| 指标 | " + " | ".join(c for c, _ in cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for h, k, label in ROWS:
        lines.append(f"| {label} | " + " | ".join(cell(s[h].get(k)) for _, s in cols) + " |")
    out = {"data": data, "runs": {n: {"config": r["config"], "device": r["device"], "torch": r["torch"],
                                      "summary": r["cv"]["summary"], "loss_curve": r["cv"]["loss_curve"],
                                      "detail": r["cv"]["detail"]} for n, r in runs.items()}}
    if a.final:
        fin = json.load(open(a.final, encoding="utf-8"))
        out["final"] = {"config": fin["config"], **fin["final"], "loss_curve": fin["final_loss_curve"]}
        lines += ["", f"全量模型：{fin['final']['params']} 参数，{fin['final']['epochs_run']} 轮；单个局面推理 "
                      f"{fin['final']['latency_ms_batch1_cpu']} ms（{fin['device']}，torch {fin['torch']}）。"]
    open(a.md, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    json.dump(out, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
