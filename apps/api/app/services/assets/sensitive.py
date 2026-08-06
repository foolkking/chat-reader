import re
from pathlib import Path

from app.models.attachment import Attachment


_SENSITIVE_FILENAMES = re.compile(
    r"(^|[._-])(\.env|credentials?|secrets?|id_rsa|id_ed25519)([._-]|$)|\.(pem|key|p12|pfx)$",
    re.IGNORECASE,
)
_SENSITIVE_CONTENT = re.compile(
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"\bAKIA[0-9A-Z]{16}\b|"
    rb"(?i:\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{20,})"
)


def is_sensitive_attachment(attachment: Attachment, path: Path) -> bool:
    if _SENSITIVE_FILENAMES.search(Path(attachment.original_filename).name):
        return True
    try:
        with path.open("rb") as source:
            return _SENSITIVE_CONTENT.search(source.read(256 * 1024)) is not None
    except OSError:
        return True
