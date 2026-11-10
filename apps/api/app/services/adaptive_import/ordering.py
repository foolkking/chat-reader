"""Server-owned selection order, independent of filenames and ORM row order."""
from __future__ import annotations

from app.models.import_record import ImportRecord


def remember_source(record: ImportRecord, artifact_id) -> None:
    summary = dict(record.analysis_summary or {})
    order = list(summary.get("source_order") or [])
    key = str(artifact_id)
    if key not in order:
        order.append(key)
    summary["source_order"] = order
    record.analysis_summary = summary


class ImportOrder:
    def __init__(self, record: ImportRecord):
        artifacts = list(record.artifacts)
        originals = [item for item in artifacts if item.source_type != "adaptive_archive_document"]
        original_ids = {str(item.id) for item in originals}
        saved = (record.analysis_summary or {}).get("source_order")
        selected = [key for key in saved if isinstance(key, str) and key in original_ids] if isinstance(saved, list) else []
        selected = list(dict.fromkeys(selected))
        self.basis = "selection" if original_ids and original_ids == set(selected) else "legacy"
        # Old sessions have no selection receipt. Stabilize their current
        # source order without claiming to recover the user's original intent.
        for item in sorted(originals, key=lambda item: (
            str(getattr(item, "created_at", "") or ""), item.filename.casefold(), str(item.id),
        )):
            if str(item.id) not in selected:
                selected.append(str(item.id))
        ranks = {key: index for index, key in enumerate(selected)}
        self.keys = {}
        for item in artifacts:
            summary = item.parsed_summary or {}
            parent = str(summary.get("archive_artifact_id")) if item.source_type == "adaptive_archive_document" else str(item.id)
            member_order = summary.get("source_member_order", 0)
            member_order = member_order if isinstance(member_order, int) and member_order >= 0 else 0
            self.keys[str(item.id)] = (
                ranks.get(parent, len(ranks)),
                member_order if item.source_type == "adaptive_archive_document" else -1,
                item.filename.casefold() if parent not in ranks or "source_member_order" not in summary else "",
                str(item.id),
            )

    def artifact(self, item):
        return self.keys[str(item.id)]

    def group(self, group):
        return min((self.keys[key] for key in map(str, group.artifact_ids) if key in self.keys),
                   default=(len(self.keys), 0, group.display_name.casefold(), str(group.id)))


def ordered_artifacts(record: ImportRecord):
    return sorted(record.artifacts, key=ImportOrder(record).artifact)


def ordered_groups(record: ImportRecord, groups=None):
    return sorted(record.input_groups if groups is None else groups, key=ImportOrder(record).group)


def ordered_families(record: ImportRecord):
    order = ImportOrder(record)
    return sorted(record.structure_families, key=lambda family: min(
        (order.group(group) for group in family.groups),
        default=(len(order.keys), 0, family.display_name.casefold(), str(family.id)),
    ))
