"""Build a synthetic v5 archive for the fresh-instance browser gate only."""
import os
import shutil
import sys
import tempfile
from pathlib import Path

if os.environ.get("APP_ENV") != "test" or os.environ.get("E2E_SETTINGS_MAILBOX") != "1":
    raise RuntimeError("Synthetic archive generation requires explicit test opt-in")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.database import Base  # noqa: E402
from test_system_archive_configuration import configuration_source  # noqa: E402


def main():
    destination = Path(os.environ["E2E_SYSTEM_ARCHIVE_SOURCE"]).resolve()
    if destination.suffix != ".cr" or destination.exists():
        raise RuntimeError("Select a new .cr path for the synthetic archive")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="chat-reader-synthetic-archive-") as directory:
        root = Path(directory)
        os.environ["EXPORT_STORAGE_DIR"] = str(root / "exports")
        os.environ["ASSET_STORAGE_DIR"] = str(root / "assets")
        get_settings.cache_clear()
        engine = create_engine("sqlite://")
        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                path, _ = configuration_source(db)
                shutil.copyfile(path, destination)
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()
