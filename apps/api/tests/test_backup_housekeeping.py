"""Actual PostgreSQL dump/restore and archive bytes survive reuse and pruning."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

SCRIPT = Path(__file__).resolve().parents[3] / "deploy" / "backup_housekeeping.py"
spec = importlib.util.spec_from_file_location("backup_housekeeping", SCRIPT)
housekeeping = importlib.util.module_from_spec(spec)
spec.loader.exec_module(housekeeping)

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL and matching pg_dump/pg_restore")


@pytest.fixture
def snapshots(tmp_path):
    url = make_url(os.environ["DATABASE_URL"])
    source, target = ["backup_test_" + uuid.uuid4().hex for _ in range(2)]
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as db:
        major = int(db.scalar(text("SHOW server_version_num"))) // 10000
        # Ubuntu runners may have more than one client version. Use the server's
        # tools so a newer dump header does not add unsupported SET statements.
        matching = Path(f"/usr/lib/postgresql/{major}/bin")
        pg_dump = str(matching / "pg_dump") if (matching / "pg_dump").is_file() else shutil.which("pg_dump")
        pg_restore = str(matching / "pg_restore") if (matching / "pg_restore").is_file() else shutil.which("pg_restore")
        assert pg_dump and pg_restore, "PostgreSQL integration must provide real dump/restore tools"
        for name in (source, target):
            db.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(url.set(database=source))
    with engine.begin() as db:
        db.execute(text("CREATE TABLE synthetic_state (id integer primary key, body text not null)"))
        db.execute(text("INSERT INTO synthetic_state VALUES (1, 'Synthetic recovery bytes')"))
    engine.dispose()
    flags = ["-h", url.host, "-p", str(url.port or 5432), "-U", url.username]
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    dump = subprocess.check_output([pg_dump, *flags, "-d", source, "-Fc"], env=env)
    toc = subprocess.check_output([pg_restore, "--list"], input=dump)
    tar_bytes = io.BytesIO()
    with tarfile.open(fileobj=tar_bytes, mode="w:gz") as archive:
        item = tarfile.TarInfo("synthetic.txt")
        body = b"Synthetic attachment bytes"
        item.size = len(body)
        archive.addfile(item, io.BytesIO(body))
    root = tmp_path / "backups"
    root.mkdir()
    def make(stamp, staging=False):
        directory = root / (".chat-reader-backup." + stamp if staging else "chat-reader-" + stamp)
        directory.mkdir()
        for name in housekeeping.COMPONENTS:
            (directory / name).write_bytes(dump if name == "postgres.dump" else tar_bytes.getvalue())
        (directory / "postgres.toc").write_bytes(toc)
        sums = "".join(hashlib.sha256((directory / name).read_bytes()).hexdigest() + "  " + name + "\n" for name in housekeeping.COMPONENTS)
        (directory / "SHA256SUMS").write_text(sums)
        (directory / "MANIFEST").write_text("schema_version=1\ncreated_at=" + stamp + "\ncomponents=postgres,imports,exports,offline,assets\n" + sums)
        return directory
    try:
        yield root, make, [pg_restore, "--list"], (pg_restore, flags, target, env, url)
    finally:
        with admin.connect() as db:
            for name in (source, target):
                db.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


def test_two_logical_snapshots_restore_after_dedup_and_old_removal(snapshots):
    root, make, pg, restore = snapshots
    old = make("20261001T010000Z")
    previous = make("20261002T010000Z")
    staging = make("20261003T010000Z", staging=True)
    before = {name: (staging / name).read_bytes() for name in housekeeping.MEMBERS}
    result = housekeeping.deduplicate(root, staging, pg)
    assert result["reused_components"] == 5
    assert os.path.samefile(staging / "assets.tar.gz", previous / "assets.tar.gz")
    newest = root / "chat-reader-20261003T010000Z"
    staging.rename(newest)
    removed = housekeeping.retain(root, pg, apply=True)
    assert removed["removed"] == 1 and removed["retained"] == 2
    assert not old.exists()
    assert {name: (newest / name).read_bytes() for name in housekeeping.MEMBERS} == before
    assert housekeeping.retain(root, pg, apply=True)["removed"] == 0
    exe, flags, target, env, url = restore
    subprocess.run([exe, *flags, "--exit-on-error", "--no-owner", "-d", target], input=(newest / "postgres.dump").read_bytes(), env=env, check=True, capture_output=True)
    restored = create_engine(url.set(database=target))
    with restored.connect() as db:
        assert db.scalar(text("select body from synthetic_state where id=1")) == "Synthetic recovery bytes"
    restored.dispose()
    with tarfile.open(newest / "assets.tar.gz") as archive:
        assert archive.extractfile("synthetic.txt").read() == b"Synthetic attachment bytes"


def test_corrupt_new_snapshot_does_not_displace_old_recovery_points(snapshots):
    root, make, pg, _ = snapshots
    old = make("20261001T010000Z")
    previous = make("20261002T010000Z")
    broken = make("20261003T010000Z")
    (broken / "assets.tar.gz").write_bytes(b"broken")
    report = housekeeping.retain(root, pg, apply=True)
    assert report["verified"] == 2 and report["removed"] == 0
    assert old.is_dir() and previous.is_dir() and broken.is_dir()


def test_unknown_members_and_active_backup_lock_block_removal(snapshots):
    root, make, pg, _ = snapshots
    old = make("20261001T010000Z")
    make("20261002T010000Z")
    make("20261003T010000Z")
    (old / "unowned.txt").write_bytes(b"preserve")
    assert housekeeping.retain(root, pg, apply=True)["removed"] == 0
    lock = root / ".backup-operation.lock"
    lock.mkdir()
    with pytest.raises(FileExistsError):
        housekeeping.retain(root, pg, apply=True)
    assert lock.is_dir() and (old / "unowned.txt").read_bytes() == b"preserve"


def test_one_valid_backup_never_allows_apply(snapshots):
    root, make, pg, _ = snapshots
    kept = make("20261001T010000Z")
    with pytest.raises(ValueError, match="two_verified"):
        housekeeping.retain(root, pg, apply=True)
    assert kept.is_dir()
    assert not (root / ".backup-operation.lock").exists()
