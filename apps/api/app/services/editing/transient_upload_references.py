import re
from dataclasses import dataclass


_FENCE_RE = re.compile(r"^ {0,3}(?P<marker>`{3,}|~{3,})(?P<rest>.*)$")
_TRANSIENT_DESTINATION_RE = re.compile(
    r"\]\(\s*cr-upload://(?P<token>[^\s)<>'\"]+)"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class TransientUploadReference:
    line_number: int


def find_transient_upload_references(source: str) -> list[TransientUploadReference]:
    references: list[TransientUploadReference] = []
    fence_character = ""
    fence_length = 0

    for line_number, line in enumerate(source.splitlines(), 1):
        fence = _FENCE_RE.match(line)
        if fence_character:
            if fence:
                marker = fence.group("marker")
                if (
                    marker[0] == fence_character
                    and len(marker) >= fence_length
                    and not fence.group("rest").strip()
                ):
                    fence_character = ""
                    fence_length = 0
            continue
        if fence:
            marker = fence.group("marker")
            fence_character = marker[0]
            fence_length = len(marker)
            continue
        if line.startswith("    ") or line.startswith("\t"):
            continue

        visible = _mask_inline_code(line)
        if _TRANSIENT_DESTINATION_RE.search(visible):
            references.append(TransientUploadReference(line_number=line_number))

    return references


def _mask_inline_code(line: str) -> str:
    masked = list(line)
    cursor = 0
    while cursor < len(line):
        if line[cursor] != "`":
            cursor += 1
            continue
        run_length = 1
        while cursor + run_length < len(line) and line[cursor + run_length] == "`":
            run_length += 1
        delimiter = "`" * run_length
        closing = line.find(delimiter, cursor + run_length)
        if closing < 0:
            cursor += run_length
            continue
        for index in range(cursor, closing + run_length):
            masked[index] = " "
        cursor = closing + run_length
    return "".join(masked)
