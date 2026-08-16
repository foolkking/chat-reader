from __future__ import annotations

import mimetypes
import socket
import struct
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import httpx

from app.core.config import get_settings


_MAGIC_DETECTION_LOCK = Lock()


class AssetScanError(RuntimeError):
    pass


@dataclass(frozen=True)
class ScanResult:
    status: str
    provider: str
    allowed_by_policy: bool
    detail: str | None = None


class AttachmentScanner(ABC):
    provider: str

    @abstractmethod
    def scan(self, path: Path) -> ScanResult:
        raise NotImplementedError


class DisabledScanner(AttachmentScanner):
    provider = "disabled"

    def scan(self, path: Path) -> ScanResult:
        del path
        allowed = get_settings().allow_unscanned_attachments
        return ScanResult(
            status="scanner_disabled",
            provider=self.provider,
            allowed_by_policy=allowed,
            detail="scan_skipped_by_deployment_policy",
        )


class ClamAVScanner(AttachmentScanner):
    provider = "clamav"

    def scan(self, path: Path) -> ScanResult:
        settings = get_settings()
        try:
            with socket.create_connection(
                (settings.clamav_host, settings.clamav_port),
                timeout=settings.clamav_timeout_seconds,
            ) as connection:
                connection.sendall(b"zINSTREAM\0")
                with path.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        connection.sendall(struct.pack("!I", len(chunk)))
                        connection.sendall(chunk)
                connection.sendall(struct.pack("!I", 0))
                response = bytearray()
                while len(response) < 8192:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    response.extend(chunk)
                    if b"\0" in chunk:
                        break
        except OSError as exc:
            raise AssetScanError("Attachment scanner is unavailable.") from exc
        result = bytes(response).rstrip(b"\0\r\n").decode("utf-8", errors="replace")
        if result.endswith(" OK"):
            return ScanResult(status="clean", provider=self.provider, allowed_by_policy=True)
        if result.endswith(" FOUND"):
            return ScanResult(status="infected", provider=self.provider, allowed_by_policy=False)
        raise AssetScanError("Attachment scanner returned an invalid response.")


class RemoteScanner(AttachmentScanner):
    provider = "remote"

    def scan(self, path: Path) -> ScanResult:
        settings = get_settings()
        if not settings.remote_scanner_url:
            raise AssetScanError("Remote scanner URL is not configured.")
        headers = {}
        if settings.remote_scanner_token:
            headers["Authorization"] = f"Bearer {settings.remote_scanner_token}"
        try:
            with path.open("rb") as source:
                response = httpx.post(
                    settings.remote_scanner_url,
                    files={"file": ("attachment.bin", source, "application/octet-stream")},
                    headers=headers,
                    timeout=settings.remote_scanner_timeout_seconds,
                )
            response.raise_for_status()
            payload = response.json()
        except (OSError, httpx.HTTPError, ValueError) as exc:
            raise AssetScanError("Remote attachment scanner is unavailable.") from exc
        status = str(payload.get("status") or "").casefold()
        if status not in {"clean", "infected"}:
            raise AssetScanError("Remote attachment scanner returned an invalid response.")
        return ScanResult(
            status=status,
            provider=self.provider,
            allowed_by_policy=status == "clean",
            detail=str(payload.get("detail")) if payload.get("detail") else None,
        )


def configured_scanner_name() -> str:
    settings = get_settings()
    configured = settings.attachment_scanner.strip().casefold()
    if configured == "auto":
        return "clamav" if settings.asset_scan_required else "disabled"
    if configured not in {"disabled", "clamav", "remote"}:
        raise AssetScanError(f"Unsupported attachment scanner provider: {configured}")
    return configured


def get_attachment_scanner() -> AttachmentScanner:
    provider = configured_scanner_name()
    if provider == "disabled":
        return DisabledScanner()
    if provider == "remote":
        return RemoteScanner()
    return ClamAVScanner()


def scan_attachment(path: Path) -> ScanResult:
    return get_attachment_scanner().scan(path)


def scan_status_allows_use(status: str) -> bool:
    if status == "clean":
        return True
    return status in {"unscanned", "scanner_disabled", "scan_skipped_by_deployment_policy"} and (
        get_settings().allow_unscanned_attachments
    )


def allowed_scan_statuses() -> tuple[str, ...]:
    if get_settings().allow_unscanned_attachments:
        return ("clean", "unscanned", "scanner_disabled", "scan_skipped_by_deployment_policy")
    return ("clean",)


def scan_with_clamav(path: Path) -> str:
    """Compatibility wrapper for older import paths.

    Disabled scanning intentionally returns ``scanner_disabled`` rather than
    claiming that an unscanned object is clean.
    """

    return scan_attachment(path).status


def detect_mime_type(path: Path, filename: str | None = None) -> tuple[str, str | None]:
    # python-magic initializes and reuses process-global state. Serialize the
    # optional import and first use so concurrent uploads cannot observe a
    # partially initialized module when libmagic is unavailable.
    with _MAGIC_DETECTION_LOCK:
        try:
            import magic  # type: ignore[import-not-found]

            detected = str(magic.from_file(str(path), mime=True) or "application/octet-stream")
        except (ImportError, OSError):
            detected = (
                _signature_mime(path)
                or mimetypes.guess_type(filename or path.name)[0]
                or "application/octet-stream"
            )
    extension = mimetypes.guess_extension(detected, strict=False)
    return detected.lower(), extension.lower() if extension else None


def _signature_mime(path: Path) -> str | None:
    with path.open("rb") as source:
        header = source.read(16)
    signatures = (
        (b"%PDF-", "application/pdf"),
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"PK\x03\x04", "application/zip"),
        (b"OggS", "audio/ogg"),
    )
    return next((mime for signature, mime in signatures if header.startswith(signature)), None)
