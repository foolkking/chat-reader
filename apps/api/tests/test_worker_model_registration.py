"""Closed worker graphs, with unchanged complete API/Alembic registration."""
import ast
import importlib
import json
from pathlib import Path
import textwrap

import pytest

from test_worker_optional_dependency_imports import _fresh


_FACTS = """
    import app.models as models
    from app.core.database import Base
    from sqlalchemy.orm import configure_mappers
    configure_mappers()
    for table in Base.metadata.tables.values():
        for foreign in table.foreign_keys:
            assert foreign.column.table.name in Base.metadata.tables
    for mapper in Base.registry.mappers:
        for relation in mapper.relationships:
            assert relation.mapper.registry is Base.registry
    def facts():
        return {
            "tables": sorted(Base.metadata.tables),
            "modules": sorted({mapper.class_.__module__.removeprefix("app.models.")
                               for mapper in Base.registry.mappers}),
            "mappers": len(list(Base.registry.mappers)),
        }
"""
_FACTS = textwrap.indent(textwrap.dedent(_FACTS), "        ")


def _declared_tables(modules=None):
    root = Path(__file__).resolve().parents[1] / "app/models"
    result = set()
    for path in root.glob("*.py"):
        if modules is not None and path.stem not in modules:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "__tablename__" for target in node.targets
            ):
                result.add(ast.literal_eval(node.value))
    return sorted(result)


@pytest.mark.parametrize("role", ["none", "uvicorn.__main__", "alembic.__main__", "unrecognized.worker"])
def test_default_and_nonworker_registration_keep_every_declared_table(role, tmp_path):
    result = _fresh(tmp_path, """
        from importlib.machinery import ModuleSpec
        sys.modules["__main__"].__spec__ = None if sys.argv[3] == "none" else ModuleSpec(sys.argv[3], None)
    """ + _FACTS + """
        print(json.dumps(facts()))
    """, role)
    assert result["tables"] == _declared_tables()
    assert {"extension_devices", "extension_sources", "extension_pairings", "conversation_append_items"} <= set(result["tables"])
    assert result["mappers"] == len(result["tables"]) == 96
    assert len(result["modules"]) == 42


@pytest.mark.parametrize(("role", "profile", "count"), [
    ("app.workers.import_worker", "SUPERVISOR_MODULES", 36),
    ("app.workers.execution_child", "EXECUTION_MODULES", 45),
])
def test_eager_worker_profile_is_a_complete_fk_and_relationship_closure(role, profile, count, tmp_path):
    result = _fresh(tmp_path, """
        from importlib.machinery import ModuleSpec
        sys.modules["__main__"].__spec__ = ModuleSpec(sys.argv[3], None)
    """ + _FACTS + """
        from app.models import _loading
        selected = getattr(_loading, sys.argv[4])
        assert set(facts()["modules"]) == set(selected)
        assert not any(name in sys.modules for name in ("app.services.auth", "PIL", "magic"))
        try:
            models.this_is_not_a_model
        except AttributeError:
            pass
        else:
            raise AssertionError("An unknown export was admitted")
        print(json.dumps(facts()))
    """, role, profile)
    from app.models import _loading
    assert result["tables"] == _declared_tables(getattr(_loading, profile))
    assert result["mappers"] == count


def test_maintenance_and_complete_upgrade_preserve_class_identity_and_all_tables(tmp_path):
    result = _fresh(tmp_path, """
        from importlib.machinery import ModuleSpec
        sys.modules["__main__"].__spec__ = ModuleSpec("app.workers.execution_child", None)
    """ + _FACTS + """
        original = models.ImportRecord
        models._register_maintenance_models()
        configure_mappers()
        for table in Base.metadata.tables.values():
            for foreign in table.foreign_keys:
                assert foreign.column.table.name in Base.metadata.tables
        maintenance_count = len(Base.metadata.tables)
        models._register_all_models()
        models._register_all_models()
        configure_mappers()
        assert models.ImportRecord is original
        print(json.dumps({"maintenance": maintenance_count, **facts()}))
    """)
    assert result["maintenance"] == 55
    assert result["tables"] == _declared_tables()
    assert result["mappers"] == 96


@pytest.mark.parametrize("name", ["ContextBinding", "EmailVerificationGrant", "ContentCleanupRulePublication"])
def test_explicit_legacy_package_export_upgrades_worker_to_complete_registration(name, tmp_path):
    result = _fresh(tmp_path, """
        from importlib.machinery import ModuleSpec
        sys.modules["__main__"].__spec__ = ModuleSpec("app.workers.import_worker", None)
        import app.models as models
        from app.models._loading import MODULE_EXPORTS
        name = sys.argv[3]
        value = getattr(models, name)
        provider = next(module for module, symbols in MODULE_EXPORTS.items() if name in symbols)
        assert value is getattr(importlib.import_module("app.models." + provider), name)
        from app.core.database import Base
        print(json.dumps({"tables": sorted(Base.metadata.tables)}))
    """, name)
    assert result["tables"] == _declared_tables()


def test_complete_exports_keep_the_original_ninety_genuine_class_objects():
    import app.models as models
    from app.models._loading import MODULE_EXPORTS, PUBLIC_NAMES
    extension_exports = {"ExtensionDevice", "ExtensionSource", "ExtensionPairing", "AppendItem"}
    assert extension_exports <= PUBLIC_NAMES
    assert len(PUBLIC_NAMES - extension_exports) == 90
    assert len(models.__all__) == 75
    assert set(models.__all__) <= PUBLIC_NAMES
    for module, symbols in MODULE_EXPORTS.items():
        provider = importlib.import_module("app.models." + module)
        for name in symbols:
            assert getattr(models, name) is getattr(provider, name)


def test_passive_maintenance_does_not_initialize_password_verification(tmp_path):
    result = _fresh(tmp_path, """
        blocked += ("app.services.auth",)
        from app.services.sharing.share_service import reclaim_expired_frozen_snapshots
        assert callable(reclaim_expired_frozen_snapshots)
        assert "argon2" not in sys.modules
        print(json.dumps({"password_work_started": False}))
    """)
    assert result == {"password_work_started": False}


@pytest.mark.parametrize(("module", "name", "provider"), [
    ("app.services.background_jobs", "ContentCleanupScan", "app.models.content_cleanup"),
    ("app.services.background_jobs", "effective_limits", "app.services.feature_policies"),
    ("app.services.exporting.archive_task_status", "SystemBackupRecord", "app.models.administration"),
    ("app.services.sharing.share_service", "hash_password", "app.services.auth"),
    ("app.services.sharing.share_service", "verify_password", "app.services.auth"),
])
def test_selected_service_reexports_are_the_original_objects(module, name, provider):
    assert getattr(importlib.import_module(module), name) is getattr(importlib.import_module(provider), name)
