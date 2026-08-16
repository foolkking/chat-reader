#!/usr/bin/env python3
"""Refuse a restore plan unless every mutable target is isolated.

The plan intentionally contains identities only. Credentials never belong in it.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
from pathlib import Path
from typing import Any


REQUIRED_VOLUMES = {"postgres", "imports", "exports", "offline", "assets"}


class UnsafeRecoveryPlan(ValueError):
    pass


def _required(mapping: dict[str, Any], key: str) -> Any:
    value = mapping.get(key)
    if value in (None, "", [], {}):
        raise UnsafeRecoveryPlan(f"missing required identity: {key}")
    return value


def _is_loopback(value: str) -> bool:
    if value.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def validate_plan(plan: dict[str, Any]) -> dict[str, Any]:
    production = _required(plan, "production")
    recovery = _required(plan, "recovery")
    if not isinstance(production, dict) or not isinstance(recovery, dict):
        raise UnsafeRecoveryPlan("production and recovery identities must be objects")
    if _required(recovery, "purpose") != "release-m-recovery":
        raise UnsafeRecoveryPlan("recovery purpose marker is absent")

    comparisons = ("project", "network", "database_name", "database_volume")
    for key in comparisons:
        if _required(recovery, key) == _required(production, key):
            raise UnsafeRecoveryPlan(f"recovery reuses production {key}")

    recovery_port = int(_required(recovery, "web_port"))
    production_port = int(_required(production, "web_port"))
    if recovery_port == production_port:
        raise UnsafeRecoveryPlan("recovery reuses the production web port")
    if not _is_loopback(str(_required(recovery, "web_bind"))):
        raise UnsafeRecoveryPlan("recovery Web must bind to loopback")

    production_volumes = _required(production, "volumes")
    recovery_volumes = _required(recovery, "volumes")
    if set(production_volumes) != REQUIRED_VOLUMES:
        raise UnsafeRecoveryPlan("production volume identity set is incomplete")
    if set(recovery_volumes) != REQUIRED_VOLUMES:
        raise UnsafeRecoveryPlan("recovery volume identity set is incomplete")
    if len(set(recovery_volumes.values())) != len(REQUIRED_VOLUMES):
        raise UnsafeRecoveryPlan("recovery volume identities are not unique")
    overlap = set(production_volumes.values()) & set(recovery_volumes.values())
    if overlap:
        raise UnsafeRecoveryPlan("recovery reuses a production Docker volume")

    production_roots = {str(Path(value).resolve()) for value in _required(production, "storage_roots")}
    recovery_roots = {str(Path(value).resolve()) for value in _required(recovery, "storage_roots")}
    if production_roots & recovery_roots:
        raise UnsafeRecoveryPlan("recovery reuses a production storage root")
    backup_root = Path(_required(recovery, "backup_root")).resolve()
    if any(backup_root == Path(root) or backup_root.is_relative_to(Path(root)) for root in production_roots):
        raise UnsafeRecoveryPlan("backup workspace is inside production business storage")

    return {
        "status": "PASS",
        "db_isolated": True,
        "filesystem_isolated": True,
        "ports_isolated": True,
        "stack_isolated": True,
        "production_volume_reuse_count": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("plan", type=Path)
    args = parser.parse_args()
    try:
        result = validate_plan(json.loads(args.plan.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, UnsafeRecoveryPlan, TypeError, ValueError) as exc:
        print(json.dumps({"status": "REFUSED", "reason": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
