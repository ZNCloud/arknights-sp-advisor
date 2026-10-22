#!/usr/bin/env bash
# Cron / systemd-timer entry: start or resume the distillation pipeline (distill/run.py --stage auto) only when the
# machine is idle — run.py checks the idle gate, logs why it did not start or why it paused, and resumes next time.
# Everything runs in one memory-capped, low-priority scope (no swap).
#   distill/idle-run.sh <config.json> [python]        e.g. … distill/configs/full.json /path/to/venv/bin/python
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cfg="${1:?usage: idle-run.sh <config.json> [python]}"
py="${2:-python3}"
# cron has no user-session environment; systemd-run --user needs the runtime dir
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
set +e
systemd-run --user --scope -q -p MemoryMax="${DISTILL_MEMORY_MAX:-10G}" -p MemorySwapMax=0 -p CPUWeight=20 \
  nice -n 10 "$py" "$here/run.py" --config "$cfg" --stage auto
rc=$?
set -e
# 75 = not started / paused because the machine is busy: a normal outcome for a timer, not a failure
[ "$rc" -eq 75 ] && exit 0
exit "$rc"
