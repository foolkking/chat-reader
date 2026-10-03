from __future__ import annotations

from .safety import load_protocol_json
from typing import Any


def load_index_json(text: str) -> dict[str, Any]:
    obj = load_protocol_json(text)
    if not isinstance(obj, dict):
        raise ValueError("index.json must contain a JSON object")
    return obj


def index_catalog(index: dict[str, Any]) -> dict[str, Any]:
    chapters = []
    segment_to_chapter: dict[str, str] = {}
    for ch in index.get("chapters", []) if isinstance(index.get("chapters"), list) else []:
        if not isinstance(ch, dict):
            continue
        seg_ids = ch.get("segment_ids") if isinstance(ch.get("segment_ids"), list) else []
        for sid in seg_ids:
            if isinstance(sid, str):
                segment_to_chapter[sid] = str(ch.get("id"))
        chapters.append({
            "id": ch.get("id"), "seq_start": ch.get("seq_start"), "seq_end": ch.get("seq_end"),
            "title": ch.get("title"), "about": ch.get("about"), "segment_ids": seg_ids,
        })
    segments = []
    for seg in index.get("segments", []) if isinstance(index.get("segments"), list) else []:
        if not isinstance(seg, dict):
            continue
        segments.append({
            "id": seg.get("id"),
            "chapter_id": segment_to_chapter.get(str(seg.get("id"))),
            "seq_start": seg.get("seq_start"), "seq_end": seg.get("seq_end"),
            "message_count": seg.get("message_count"), "kind": seg.get("kind"),
            "title": seg.get("title"), "about": seg.get("about"),
            "topics": seg.get("topics") if isinstance(seg.get("topics"), list) else [],
            "key_ref_count": len(seg.get("key_refs") or []),
            "attachment_ref_count": len(seg.get("attachment_refs") or []),
        })
    return {
        "schema": "chat-reader-index-catalog",
        "version": "1.0.0",
        "conversation_id": index.get("conversation_id"),
        "continuation_revision": index.get("continuation_revision"),
        "coverage": index.get("coverage"),
        "chapters": chapters,
        "segments": segments,
    }
