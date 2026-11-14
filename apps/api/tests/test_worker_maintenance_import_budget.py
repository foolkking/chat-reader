"""The unchanged cooperative maintenance budget also covers selected imports."""
import builtins
from contextlib import nullcontext

import pytest

from app.services.worker_maintenance import run_worker_maintenance

MODULES = (
    "app.services.export_retention",
    "app.services.sharing.share_service",
    "app.services.assets.upload_service",
    "app.services.assets.lifecycle",
)


def test_stopped_pass_does_not_import_cleanup_handlers(monkeypatch, tmp_path):
    original = builtins.__import__

    def imported(name, *args, **kwargs):
        assert name not in MODULES, "Stopped maintenance still imported cleanup handlers."
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", imported)
    run_worker_maintenance(None, tmp_path, should_continue=lambda: False)


@pytest.mark.parametrize("boundary", ["budget", "stopped"])
def test_slow_or_stopped_import_cannot_start_an_item_or_import_later_families(
    boundary, monkeypatch, tmp_path,
):
    from app.services import export_retention

    clock = [0.0]
    allowed = [True]
    imports = []
    calls = []
    original = builtins.__import__
    monkeypatch.setattr(export_retention, "reclaim_exports", lambda *a, **kw: calls.append(True))

    def imported(name, *args, **kwargs):
        if name in MODULES:
            imports.append(name)
            if boundary == "budget":
                clock[0] += 2.0
            else:
                allowed[0] = False
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", imported)
    run_worker_maintenance(
        None, tmp_path, should_continue=lambda: allowed[0], monotonic=lambda: clock[0],
    )
    assert imports == [MODULES[0]]
    assert calls == []


def test_cleanup_import_failure_is_isolated_and_private(monkeypatch, tmp_path, caplog):
    from app.services.sharing import share_service
    from app.services.assets import lifecycle, upload_service

    calls = []
    original = builtins.__import__
    monkeypatch.setattr(
        share_service, "reclaim_expired_frozen_snapshots", lambda *a, **kw: calls.append("share"),
    )
    monkeypatch.setattr(upload_service, "cleanup_finished_uploads", lambda *a, **kw: calls.append("upload"))
    monkeypatch.setattr(lifecycle, "cleanup_deleted_assets", lambda *a, **kw: calls.append("assets"))

    def imported(name, *args, **kwargs):
        if name == MODULES[0]:
            raise ImportError("synthetic private/source/path")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", imported)
    run_worker_maintenance(lambda: nullcontext(None), tmp_path, should_continue=lambda: True)
    assert calls == ["share", "upload", "assets"]
    assert "worker_maintenance_failed" in caplog.text
    assert '"category":"export"' in caplog.text
    assert "private/source/path" not in caplog.text


@pytest.mark.parametrize("lane", range(4))
def test_all_four_first_lanes_get_the_same_budget_without_importing_later_lanes(
    lane, monkeypatch, tmp_path,
):
    from app.services import export_retention
    from app.services.sharing import share_service
    from app.services.assets import lifecycle, upload_service

    clock = [0.0]
    calls = []
    imports = []
    original = builtins.__import__

    def operation(*args, **kwargs):
        assert kwargs["limit"] == 20 and kwargs["should_continue"]()
        calls.append(True)
        clock[0] += 2
        assert not kwargs["should_continue"]()

    monkeypatch.setattr(export_retention, "reclaim_exports", operation)
    monkeypatch.setattr(share_service, "reclaim_expired_frozen_snapshots", operation)
    monkeypatch.setattr(upload_service, "cleanup_finished_uploads", operation)
    monkeypatch.setattr(lifecycle, "cleanup_deleted_assets", operation)

    def imported(name, *args, **kwargs):
        if name in MODULES:
            imports.append(name)
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", imported)
    run_worker_maintenance(
        lambda: nullcontext(None), tmp_path, should_continue=lambda: True,
        monotonic=lambda: clock[0], start_lane=lane,
    )
    assert imports == [MODULES[lane]]
    assert calls == [True]
