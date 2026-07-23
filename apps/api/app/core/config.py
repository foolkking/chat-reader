from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
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
    public_web_base_url: str = Field(default="http://localhost:3000", alias="PUBLIC_WEB_BASE_URL")
    import_commit_inline: bool = Field(default=False, alias="IMPORT_COMMIT_INLINE")
    import_worker_poll_seconds: float = Field(default=1.0, alias="IMPORT_WORKER_POLL_SECONDS")
    import_stale_after_seconds: int = Field(default=300, alias="IMPORT_STALE_AFTER_SECONDS")

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
