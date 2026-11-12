from dataclasses import dataclass


@dataclass(frozen=True)
class TransientUploadReference:
    line_number: int


def find_transient_upload_references(source: str) -> list[TransientUploadReference]:
    from app.services.editing.markdown_attachment_references import attachment_references
    return [TransientUploadReference(ref.line_number) for ref in attachment_references(source, "cr-upload")]
