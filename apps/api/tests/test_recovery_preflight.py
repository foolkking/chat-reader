from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).parents[3] / "deploy" / "recovery_preflight.py"
SPEC = importlib.util.spec_from_file_location("recovery_preflight", MODULE_PATH)
assert SPEC and SPEC.loader
RECOVERY_PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECOVERY_PREFLIGHT)


def plan() -> dict:
    return {
        "production": {
            "project": "chat-reader",
            "network": "chat-reader_backend",
            "database_name": "chat_reader",
            "database_volume": "chat-reader_postgres-data",
            "web_port": 3000,
            "volumes": {
                "postgres": "chat-reader_postgres-data",
                "imports": "chat-reader_import-storage",
                "exports": "chat-reader_export-storage",
                "offline": "chat-reader_offline-storage",
                "assets": "chat-reader_asset-storage",
            },
            "storage_roots": [
                "/var/lib/docker/volumes/chat-reader_import-storage/_data",
                "/var/lib/docker/volumes/chat-reader_export-storage/_data",
                "/var/lib/docker/volumes/chat-reader_offline-storage/_data",
                "/var/lib/docker/volumes/chat-reader_asset-storage/_data",
            ],
        },
        "recovery": {
            "purpose": "release-m-recovery",
            "project": "chat-reader-release-m-recovery-a",
            "network": "chat-reader-release-m-recovery-a_backend",
            "database_name": "chat_reader_recovery_a",
            "database_volume": "chat-reader-release-m-recovery-a_postgres-data",
            "web_bind": "127.0.0.1",
            "web_port": 39001,
            "backup_root": "/opt/chat-reader/backups/release-m-example",
            "volumes": {
                "postgres": "chat-reader-release-m-recovery-a_postgres-data",
                "imports": "chat-reader-release-m-recovery-a_import-storage",
                "exports": "chat-reader-release-m-recovery-a_export-storage",
                "offline": "chat-reader-release-m-recovery-a_offline-storage",
                "assets": "chat-reader-release-m-recovery-a_asset-storage",
            },
            "storage_roots": [
                "/var/lib/docker/volumes/chat-reader-release-m-recovery-a_import-storage/_data",
                "/var/lib/docker/volumes/chat-reader-release-m-recovery-a_export-storage/_data",
                "/var/lib/docker/volumes/chat-reader-release-m-recovery-a_offline-storage/_data",
                "/var/lib/docker/volumes/chat-reader-release-m-recovery-a_asset-storage/_data",
            ],
        },
    }


def test_accepts_fully_isolated_loopback_recovery_plan() -> None:
    assert RECOVERY_PREFLIGHT.validate_plan(plan()) == {
        "status": "PASS",
        "db_isolated": True,
        "filesystem_isolated": True,
        "ports_isolated": True,
        "stack_isolated": True,
        "production_volume_reuse_count": 0,
    }


@pytest.mark.parametrize(
    ("field", "production_field"),
    [
        ("project", "project"),
        ("network", "network"),
        ("database_name", "database_name"),
        ("database_volume", "database_volume"),
        ("web_port", "web_port"),
    ],
)
def test_refuses_production_target_identity_reuse(field: str, production_field: str) -> None:
    candidate = plan()
    candidate["recovery"][field] = candidate["production"][production_field]
    with pytest.raises(RECOVERY_PREFLIGHT.UnsafeRecoveryPlan):
        RECOVERY_PREFLIGHT.validate_plan(candidate)


def test_refuses_any_production_volume_reuse() -> None:
    candidate = plan()
    candidate["recovery"]["volumes"]["assets"] = candidate["production"]["volumes"]["assets"]
    with pytest.raises(RECOVERY_PREFLIGHT.UnsafeRecoveryPlan, match="production Docker volume"):
        RECOVERY_PREFLIGHT.validate_plan(candidate)


def test_refuses_production_storage_root_reuse() -> None:
    candidate = plan()
    candidate["recovery"]["storage_roots"][0] = candidate["production"]["storage_roots"][0]
    with pytest.raises(RECOVERY_PREFLIGHT.UnsafeRecoveryPlan, match="production storage root"):
        RECOVERY_PREFLIGHT.validate_plan(candidate)


def test_refuses_non_loopback_web_exposure() -> None:
    candidate = plan()
    candidate["recovery"]["web_bind"] = "0.0.0.0"
    with pytest.raises(RECOVERY_PREFLIGHT.UnsafeRecoveryPlan, match="loopback"):
        RECOVERY_PREFLIGHT.validate_plan(candidate)
