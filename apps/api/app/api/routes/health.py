from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.assets.scanner import configured_scanner_name

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    stage: str


class AttachmentCapabilities(BaseModel):
    upload_enabled: bool
    scanner_provider: str
    scanner_enabled: bool
    allow_unscanned_attachments: bool
    unscanned_status: str
    basic_preview_enabled: bool
    complex_preview_enabled: bool
    max_file_size_bytes: int
    viewer: bool
    range: bool
    imageDerivatives: bool
    textSearch: bool
    batchDownload: bool


class CapabilitiesResponse(BaseModel):
    attachments: AttachmentCapabilities


def health_payload() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="chat-reader-api",
        stage="stage-00-foundation",
    )


@router.get("/health", response_model=HealthResponse)
def root_health() -> HealthResponse:
    return health_payload()


@router.get("/api/health", response_model=HealthResponse)
def api_health() -> HealthResponse:
    return health_payload()


@router.get("/api/capabilities", response_model=CapabilitiesResponse)
def capabilities() -> CapabilitiesResponse:
    settings = get_settings()
    scanner_provider = configured_scanner_name()
    return CapabilitiesResponse(
        attachments=AttachmentCapabilities(
            upload_enabled=settings.attachment_upload_enabled,
            scanner_provider=scanner_provider,
            scanner_enabled=scanner_provider != "disabled",
            allow_unscanned_attachments=(
                settings.allow_unscanned_attachments if scanner_provider == "disabled" else False
            ),
            unscanned_status="scanner_disabled" if scanner_provider == "disabled" else "pending",
            basic_preview_enabled=True,
            complex_preview_enabled=bool(
                settings.complex_attachment_preview_enabled and settings.attachment_preview_origin
            ),
            max_file_size_bytes=settings.bundle_max_object_bytes,
            viewer=True,
            range=True,
            imageDerivatives=True,
            textSearch=True,
            batchDownload=True,
        )
    )
