#!/usr/bin/env bash
# Run node 22 in docker from <root> (containing sp-advisor/), with the engine checkout mounted read-only at <root>/engine.
# ENGINE=/path/to/Stronghold-Protocol ./sp-advisor/advisor/run-node.example.sh sp-advisor/advisor/cli.mjs advise --state ...
set -euo pipefail
docker run --name "spadvisor_node_$$" --user "$(id -u):$(id -g)" --memory 16g --cpus "${SP_CPUS:-24}" -e HOME=/tmp --rm \
  -v "$PWD:/work" -v "${ENGINE:?set ENGINE}:/work/engine:ro" -w /work node:22 node "$@"
