#!/usr/bin/env bash
# B4 一键补训（游戏更新后）。在 <root>（含 sp-advisor/、engine/）下运行；RUN 为跑 node 的包装（docker），PY 为跑 python 的包装。
# 用法: PATCH=<patch.json 或空> FAVOR=<改动干员 baseId,逗号分隔> GAMES=1200 SEEDS=2001-2020 sp-advisor/tools/retrain.sh <候选模型目录>
# 步骤: 造数据(多打改动干员) → 训练 → 打版本戳 → 验收三条 → 通过才换上 sp-advisor/models（旧模型备份到 <候选>.prev）。
set -euo pipefail
CAND=${1:?candidate model dir}; GAMES=${GAMES:-1200}; SEEDS=${SEEDS:-2001-2020}; FEAT=${FEAT:-x}
RUN=${RUN:-./run-node.sh}; MODELS=${MODELS:-sp-advisor/models}; PY=${PY:?set PY to a python runner with lightgbm}
node_() { if [ -n "${PATCH:-}" ]; then $RUN sp-advisor/eval/with-patch.mjs "$PATCH" "$@"; else $RUN "$@"; fi; }
mkdir -p "$CAND" data results
tag=$(basename "$CAND")
node_ sp-advisor/advisor/datagen.mjs --games "$GAMES" --seed 70000 --workers ${WORKERS:-20} --table 1 ${FAVOR:+--favor $FAVOR} --out data/$tag-train.jsonl
node_ sp-advisor/advisor/datagen.mjs --games 300 --seed 79000 --workers ${WORKERS:-20} --table 1 --out data/$tag-holdout.jsonl
$PY sp-advisor/advisor/train.py data/$tag-train.jsonl --feat "$FEAT" --out "$CAND"
node_ sp-advisor/advisor/stamp.mjs --model "$CAND" data/$tag-train.jsonl
node_ sp-advisor/eval/advised.mjs --seeds "$SEEDS" --mode advised --model "$MODELS" --allowStale 1 --K 60 --N 0 --steps 3 --workers ${WORKERS:-20} --out results/$tag-play-old.json
node_ sp-advisor/eval/advised.mjs --seeds "$SEEDS" --mode advised --model "$CAND" --K 60 --N 0 --steps 3 --workers ${WORKERS:-20} --out results/$tag-play-new.json
node_ sp-advisor/advisor/accept.mjs --old "$MODELS" --new "$CAND" --holdout data/$tag-holdout.jsonl --play-old results/$tag-play-old.json \
  --play-new results/$tag-play-new.json ${FAVOR:+--favor $FAVOR} --dir "${DIR:-up}" --out results/$tag-accept.json
if python3 -c "import json,sys;sys.exit(0 if json.load(open('results/$tag-accept.json'))['pass'] else 1)"; then
  rm -rf "$CAND.prev"; cp -r "$MODELS" "$CAND.prev"; cp "$CAND"/*.json "$MODELS"/; echo "ACCEPTED: $CAND → $MODELS (旧模型在 $CAND.prev)"
else echo "REJECTED: 验收未过，保留旧模型；详见 results/$tag-accept.json"; exit 2; fi
