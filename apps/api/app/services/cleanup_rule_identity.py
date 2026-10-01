"""Frozen v1 literal-rule identity, also used by the historical migration."""
import hashlib
import json

MATCH_FIELDS = ("matcher_version", "match_value", "matcher_mode", "normalization_profile", "max_edit_distance", "boundary_mode", "case_sensitive", "role_filter")


def configuration_digest_v1(config: dict, *, scope: str = "MESSAGE") -> str:
    # Matcher modes define their own normalization. Preserve literal text and
    # case/role/boundary differences instead of guessing equivalent behavior.
    content = {key: config[key] for key in MATCH_FIELDS}
    return hashlib.sha256(json.dumps({"identity_version": 1, "scope": scope, **content}, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def literal_configuration(match_value: str, *, case_sensitive=True, role_filter=None, matcher_mode="EXACT", boundary_mode="ANYWHERE") -> dict:
    return {"matcher_version": "noise-v4", "match_value": match_value.strip(), "case_sensitive": case_sensitive,
        "role_filter": role_filter, "matcher_mode": matcher_mode, "boundary_mode": boundary_mode,
        "normalization_profile": "NFKC_CASEFOLD_WHITESPACE" if matcher_mode in {"NORMALIZED", "APPROXIMATE"} else "NONE",
        "max_edit_distance": 1 if matcher_mode == "APPROXIMATE" else None}
