"""Write immutable release provenance during image build, not at runtime."""

import json
import re
import sys
from pathlib import Path


def main() -> None:
    revision = sys.argv[1] if len(sys.argv) > 1 else ""
    if revision and not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise SystemExit("Build revision must be a complete lowercase Git commit hash.")
    destination = Path(__file__).parents[1] / "app" / "build_metadata.json"
    destination.write_text(json.dumps({"revision": revision or None}), encoding="utf-8")


if __name__ == "__main__":
    main()
