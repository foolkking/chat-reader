from __future__ import annotations

import argparse
from pathlib import Path
import sys

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from app.core.database import engine


def repository_heads(api_root: Path) -> tuple[str, ...]:
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    return tuple(ScriptDirectory.from_config(config).get_heads())


def database_heads() -> tuple[str, ...]:
    with engine.connect() as connection:
        return tuple(MigrationContext.configure(connection).get_current_heads())


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the repository has one Alembic head.")
    parser.add_argument(
        "--require-current",
        action="store_true",
        help="also require the configured database to be exactly at the repository head",
    )
    args = parser.parse_args()
    heads = repository_heads(API_ROOT)
    if len(heads) != 1:
        print(f"Expected exactly one repository migration head; found {len(heads)}: {', '.join(heads) or 'none'}")
        return 1
    repository_head = heads[0]
    if args.require_current:
        current = database_heads()
        if current != heads:
            print(
                "Database migration state does not match the repository head: "
                f"repository={repository_head}, current={', '.join(current) or 'none'}"
            )
            return 1
        print(f"{repository_head} (head/current)")
        return 0
    print(f"{repository_head} (head)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
