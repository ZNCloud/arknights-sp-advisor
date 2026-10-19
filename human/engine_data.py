"""Load engine data from a configurable location."""

import json
import os
from pathlib import Path


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "engine" / "data"
DATA_DIR = Path(os.environ.get("SP_ENGINE_DATA") or DEFAULT_DATA_DIR).expanduser()


def load_json(name):
    """Load one JSON file and explain how to configure a missing data checkout."""
    path = DATA_DIR / name
    try:
        with path.open(encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError as exc:
        raise SystemExit(
            f"Engine data file not found: {path}. "
            "Set SP_ENGINE_DATA to the engine/data directory."
        ) from exc
