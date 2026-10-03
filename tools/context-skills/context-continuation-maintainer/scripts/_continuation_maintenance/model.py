from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from _context_package.safety import load_protocol_json

VALID_EFFECTS = {
    "NO_CHANGE", "ADD", "REFINE", "SUPERSEDE", "COMPLETE", "REOPEN", "INVALIDATE", "RETIRE"
}
VALID_TRUST = {"verified", "provisional"}
VALID_MODES = {"ONE_SHOT", "STAGED_BUILD", "FINALIZE", "REPAIR"}
VALID_GC_STATUS = {"performed", "audited_no_change", "not_required_pure_locator_repair"}
NAMESPACES = (
    "EV", "G", "REQ", "CON", "NG", "CONV", "DEC", "TC", "WS", "MIL", "OPEN", "DEF", "VD", "BLK", "NEXT",
    "ASM", "UNK", "CF", "RET", "AD", "E", "CH", "SEG",
)
STABLE_ID_RE = re.compile(r"^(?P<ns>" + "|".join(NAMESPACES) + r")-(?P<num>\d+)$")
NEW_ID_RE = re.compile(r"^NEW-(?P<ns>" + "|".join(NAMESPACES) + r")-(?P<num>\d+)$")
LOCAL_CANDIDATE_ID_RE = re.compile(r"^(?P<ns>[A-Z][A-Z0-9]*)-CAND-(?P<num>\d+)$")


class MaintenanceError(Exception):
    def __init__(self, message: str, code: str = "maintenance_error"):
        super().__init__(message)
        self.code = code


def load_json(path: str | os.PathLike[str]) -> dict[str, Any]:
    p = Path(path)
    try:
        with p.open('rb') as source:
            raw = source.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError('writer JSON exceeds the 16 MiB input limit')
        obj = load_protocol_json(raw.decode('utf-8'))
    except Exception as e:
        raise MaintenanceError(f"cannot read JSON {p}: {e}", "json_unreadable") from e
    if not isinstance(obj, dict):
        raise MaintenanceError(f"JSON root must be an object: {p}", "json_root_invalid")
    return obj


def json_bytes(obj: Any) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=False) + "\n").encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: str | os.PathLike[str]) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def atomic_write_bytes(path: str | os.PathLike[str], data: bytes, *, refuse_existing: bool = False) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if refuse_existing and p.exists():
        raise MaintenanceError(f"output already exists: {p}", "output_exists")
    fd, tmp = tempfile.mkstemp(prefix=p.name + ".tmp-", dir=str(p.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if refuse_existing:
            try:
                os.link(tmp, p)
            except FileExistsError as exc:
                raise MaintenanceError('output appeared before publication', 'output_exists') from exc
            os.unlink(tmp)
        else:
            os.replace(tmp, p)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: str | os.PathLike[str], obj: Any, *, refuse_existing: bool = False) -> None:
    atomic_write_bytes(path, json_bytes(obj), refuse_existing=refuse_existing)


def require_dict(obj: Any, name: str) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise MaintenanceError(f"{name} must be an object", "schema_invalid")
    return obj


def require_list(obj: Any, name: str) -> list[Any]:
    if not isinstance(obj, list):
        raise MaintenanceError(f"{name} must be an array", "schema_invalid")
    return obj


def require_int(obj: Any, name: str) -> int:
    if not isinstance(obj, int) or isinstance(obj, bool):
        raise MaintenanceError(f"{name} must be an integer", "schema_invalid")
    return obj


def require_str(obj: Any, name: str) -> str:
    if not isinstance(obj, str) or not obj:
        raise MaintenanceError(f"{name} must be a non-empty string", "schema_invalid")
    return obj


def normalize_sha256(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.lower()
    return v.split(":", 1)[1] if v.startswith("sha256:") else v


def sequence_set_for_range(ordered_sequences: list[int], start: int, end: int) -> list[int]:
    return [s for s in ordered_sequences if start <= s <= end]


def stable_id_namespace(value: str) -> str | None:
    m = STABLE_ID_RE.match(value)
    return m.group("ns") if m else None
