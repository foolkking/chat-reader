from collections import defaultdict
from dataclasses import replace
import uuid

from app.services.adaptive_import.archive_sources import (
    archive_catalog, archive_enrichment_for_artifact, archive_reference_matches,
)
from app.services.adaptive_import.stream_markdown import decode_message
from app.services.canonical.block_builder import iter_basic_render_blocks
from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool


def enrich_stream(record, source, draft, conversation_index):
    member = str((source.parsed_summary or {}).get("archive_member_id") or source.id)
    attachments = archive_enrichment_for_artifact(record, source)
    owned = {str(item["id"]) for item in attachments}
    catalog = archive_catalog(record, uuid.UUID(source.parsed_summary["archive_artifact_id"]))
    warnings = [*draft.warnings, *[str(item["message"]) for item in catalog.get("issues", [])
                if item.get("severity") == "warning" and item.get("message")]]

    def records():
        for index, raw in enumerate(draft.stream_records):
            message = decode_message(raw["message"])
            identity = message.source_message_id or f"archive:{member}:message:{index + 1}"
            version = message.source_current_version_id or f"{identity}:version:1"
            message = replace(message, source_message_id=identity, source_current_version_id=version)
            references = []
            per_block = defaultdict(int)
            for block_index, block in enumerate(iter_basic_render_blocks(message.display_text)):
                if block.block_type == "code":
                    continue
                asset_id = str(block.data.get("attachmentId") or "")
                if asset_id in owned:
                    matches = [(asset_id, block.block_type == "image")]
                else:
                    matches = (
                        (match.group("target").removeprefix("cr-asset://"),
                         match.group("prefix").startswith("![") or match.group("prefix").lower().startswith("src"))
                        for match in archive_reference_matches(str(block.data.get("text") or block.data.get("title") or ""))
                        if match.group("target").startswith("cr-asset://")
                    )
                for asset_id, image in matches:
                    if asset_id not in owned:
                        continue
                    occurrence = per_block[(block_index, asset_id)]
                    per_block[(block_index, asset_id)] += 1
                    references.append({
                        "record_type": "attachment_ref", "attachment_id": asset_id, "message_id": identity,
                        "message_version_id": version,
                        "occurrence_key": f"{member}:{index}:{block_index}:{asset_id}:{occurrence}",
                        "placement": "inline", "relation_type": "inline" if image else "file",
                        "display_order": len(references), "block_index": block_index,
                        "display_mode": "inline" if image else "card",
                    })
            yield {"message": message, "attachments": references, "source_refs": [
                *raw.get("source_refs", []),
                {"message_id": identity, "source_message_id": identity, "source_index": index,
                 "source_type": "adaptive_archive", "source_profile": "conversation-zip-markdown-v1",
                 "source_metadata": {"archive_member_id": member, "conversation_index": conversation_index}},
            ]}
    spool = RecordSpool.write(draft.stream_records.path.parent, records(), prefix="enriched")
    return replace(draft, source_type="adaptive_archive", source_profile="conversation-zip-markdown-v1",
                   warnings=warnings, attachments=attachments, source_refs=[],
                   stream_records=spool, messages=MappedSequence(spool, lambda raw: decode_message(raw["message"])))
