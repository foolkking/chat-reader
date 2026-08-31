from functools import lru_cache
from typing import ClassVar

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    _DEVELOPMENT_ATTACHMENT_CURSOR_SECRET: ClassVar[str] = "chat-reader-local-cursor-v1"
    _PRODUCTION_SECRET_PLACEHOLDERS: ClassVar[set[str]] = {
        "change-me",
        "changeme",
        "placeholder",
        "replace-me",
        "replace-with-a-production-secret",
    }

    app_name: str = Field(default="chat-reader", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://chat_reader:chat_reader@localhost:5432/chat_reader",
        alias="DATABASE_URL",
    )
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:3001"],
        alias="CORS_ORIGINS",
    )
    max_import_file_size_mb: int = Field(default=50, alias="MAX_IMPORT_FILE_SIZE_MB")
    max_adaptive_import_total_mb: int = Field(default=512, alias="MAX_ADAPTIVE_IMPORT_TOTAL_MB")
    import_storage_dir: str = Field(
        default="storage/imports",
        alias="IMPORT_STORAGE_DIR",
    )
    export_storage_dir: str = Field(
        default="storage/exports",
        alias="EXPORT_STORAGE_DIR",
    )
    offline_storage_dir: str = Field(
        default="storage/offline",
        alias="OFFLINE_STORAGE_DIR",
    )
    asset_storage_dir: str = Field(default="storage/assets", alias="ASSET_STORAGE_DIR")
    asset_storage_backend: str = Field(default="local", alias="ASSET_STORAGE_BACKEND")
    asset_s3_bucket: str | None = Field(default=None, alias="ASSET_S3_BUCKET")
    asset_s3_endpoint_url: str | None = Field(default=None, alias="ASSET_S3_ENDPOINT_URL")
    asset_s3_region: str | None = Field(default=None, alias="ASSET_S3_REGION")
    asset_s3_prefix: str = Field(default="attachments", alias="ASSET_S3_PREFIX")
    attachment_scanner: str = Field(default="disabled", alias="ATTACHMENT_SCANNER")
    allow_unscanned_attachments: bool = Field(default=True, alias="ALLOW_UNSCANNED_ATTACHMENTS")
    asset_scan_required: bool = Field(default=False, alias="ASSET_SCAN_REQUIRED")
    clamav_host: str = Field(default="127.0.0.1", alias="CLAMAV_HOST")
    clamav_port: int = Field(default=3310, alias="CLAMAV_PORT")
    clamav_timeout_seconds: float = Field(default=30.0, alias="CLAMAV_TIMEOUT_SECONDS")
    remote_scanner_url: str | None = Field(default=None, alias="REMOTE_SCANNER_URL")
    remote_scanner_token: str | None = Field(default=None, alias="REMOTE_SCANNER_TOKEN")
    remote_scanner_timeout_seconds: float = Field(default=60.0, alias="REMOTE_SCANNER_TIMEOUT_SECONDS")
    attachment_upload_enabled: bool = Field(default=True, alias="ATTACHMENT_UPLOAD_ENABLED")
    attachment_upload_ttl_hours: int = Field(default=24, alias="ATTACHMENT_UPLOAD_TTL_HOURS")
    complex_attachment_preview_enabled: bool = Field(default=False, alias="COMPLEX_ATTACHMENT_PREVIEW_ENABLED")
    attachment_preview_origin: str | None = Field(default=None, alias="ATTACHMENT_PREVIEW_ORIGIN")
    attachment_cursor_secret: str = Field(default=_DEVELOPMENT_ATTACHMENT_CURSOR_SECRET, alias="ATTACHMENT_CURSOR_SECRET")
    bundle_max_compressed_bytes: int = Field(default=512 * 1024 * 1024, alias="BUNDLE_MAX_COMPRESSED_BYTES")
    bundle_max_expanded_bytes: int = Field(default=2 * 1024 * 1024 * 1024, alias="BUNDLE_MAX_EXPANDED_BYTES")
    bundle_max_object_bytes: int = Field(default=256 * 1024 * 1024, alias="BUNDLE_MAX_OBJECT_BYTES")
    bundle_max_entries: int = Field(default=5_000, alias="BUNDLE_MAX_ENTRIES")
    bundle_max_objects: int = Field(default=2_000, alias="BUNDLE_MAX_OBJECTS")
    bundle_max_compression_ratio: int = Field(default=100, alias="BUNDLE_MAX_COMPRESSION_RATIO")
    bundle_max_path_depth: int = Field(default=4, alias="BUNDLE_MAX_PATH_DEPTH")
    public_web_base_url: str = Field(default="http://localhost:3000", alias="PUBLIC_WEB_BASE_URL")
    import_commit_inline: bool = Field(default=False, alias="IMPORT_COMMIT_INLINE")
    import_worker_poll_seconds: float = Field(default=1.0, alias="IMPORT_WORKER_POLL_SECONDS")
    import_stale_after_seconds: int = Field(default=300, alias="IMPORT_STALE_AFTER_SECONDS")
    task_terminal_result_retention_seconds: int = Field(
        default=600,
        alias="TASK_TERMINAL_RESULT_RETENTION_SECONDS",
        ge=60,
        le=24 * 60 * 60,
    )
    worker_heartbeat_interval_seconds: float = Field(default=30.0, alias="WORKER_HEARTBEAT_INTERVAL_SECONDS", ge=1)
    worker_heartbeat_stale_after_seconds: int = Field(default=120, alias="WORKER_HEARTBEAT_STALE_AFTER_SECONDS", ge=3)
    import_draft_ttl_hours: int = Field(default=24, alias="IMPORT_DRAFT_TTL_HOURS")
    enable_internal_diagnostics: bool = Field(default=False, alias="ENABLE_INTERNAL_DIAGNOSTICS")
    auth_enabled: bool = Field(default=False, alias="AUTH_ENABLED")
    auth_session_secret: SecretStr | None = Field(default=None, alias="AUTH_SESSION_SECRET")
    auth_cookie_secure: bool = Field(default=False, alias="AUTH_COOKIE_SECURE")
    auth_activity_touch_interval_seconds: int = Field(
        default=600, alias="AUTH_ACTIVITY_TOUCH_INTERVAL_SECONDS", ge=300, le=900
    )
    auth_inactivity_timeout_seconds: int = Field(
        default=48 * 60 * 60, alias="AUTH_INACTIVITY_TIMEOUT_SECONDS", ge=60
    )
    artifact_cleanup_grace_hours: int = Field(default=24, alias="ARTIFACT_CLEANUP_GRACE_HOURS", ge=1)
    canjson_max_line_bytes: int = Field(default=32 * 1024 * 1024, alias="CANJSON_MAX_LINE_BYTES")
    canjson_max_messages: int = Field(default=100_000, alias="CANJSON_MAX_MESSAGES")
    canjson_max_json_depth: int = Field(default=64, alias="CANJSON_MAX_JSON_DEPTH")
    canjson_max_compression_ratio: int = Field(default=200, alias="CANJSON_MAX_COMPRESSION_RATIO")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        enable_decoding=False,
        extra="ignore",
        populate_by_name=True,
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def reject_unsafe_production_security_configuration(self) -> "Settings":
        if self.worker_heartbeat_stale_after_seconds < self.worker_heartbeat_interval_seconds * 3:
            raise ValueError(
                "WORKER_HEARTBEAT_STALE_AFTER_SECONDS must allow at least three heartbeat intervals."
            )
        if self.app_env.strip().casefold() not in {"production", "prod"}:
            return self

        secret = self.attachment_cursor_secret.strip()
        if (
            not secret
            or secret == self._DEVELOPMENT_ATTACHMENT_CURSOR_SECRET
            or secret.casefold() in self._PRODUCTION_SECRET_PLACEHOLDERS
        ):
            raise ValueError(
                "Refusing to start in production with a missing, default, or placeholder attachment cursor secret. "
                "Configure ATTACHMENT_CURSOR_SECRET with a production-specific value."
            )
        if not self.auth_enabled:
            raise ValueError("Refusing to start in production with AUTH_ENABLED disabled.")
        auth_secret = self.auth_session_secret.get_secret_value().strip() if self.auth_session_secret else ""
        if len(auth_secret) < 32 or auth_secret.casefold() in self._PRODUCTION_SECRET_PLACEHOLDERS:
            raise ValueError(
                "Refusing to start in production with a missing, short, or placeholder AUTH_SESSION_SECRET."
            )
        if not self.auth_cookie_secure:
            raise ValueError("Refusing to start in production without a Secure authentication cookie.")
        if self.auth_inactivity_timeout_seconds != 48 * 60 * 60:
            raise ValueError("Production AUTH_INACTIVITY_TIMEOUT_SECONDS must be exactly 48 hours.")
        return self

    def auth_secret_value(self) -> str:
        return self.auth_session_secret.get_secret_value() if self.auth_session_secret else ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
