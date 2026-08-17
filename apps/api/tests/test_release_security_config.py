from alembic.config import Config
from pydantic import ValidationError
import pytest

from app.core.alembic_config import escape_alembic_config_value
from app.core.config import Settings


@pytest.mark.parametrize("app_env", ["development", "test"])
def test_development_and_test_allow_local_attachment_cursor_secret(
    app_env: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ATTACHMENT_CURSOR_SECRET", raising=False)
    settings = Settings(_env_file=None, APP_ENV=app_env)
    assert settings.attachment_cursor_secret == "chat-reader-local-cursor-v1"


@pytest.mark.parametrize(
    "secret",
    [None, "", "chat-reader-local-cursor-v1", "change-me", "replace-with-a-production-secret"],
)
def test_production_rejects_missing_default_or_placeholder_attachment_cursor_secret(
    secret: str | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ATTACHMENT_CURSOR_SECRET", raising=False)
    values: dict[str, str] = {"APP_ENV": "production"}
    if secret is not None:
        values["ATTACHMENT_CURSOR_SECRET"] = secret

    with pytest.raises(ValidationError, match="ATTACHMENT_CURSOR_SECRET"):
        Settings(_env_file=None, **values)


@pytest.mark.parametrize("secret", ["custom", "synthetic-release-test-secret"])
def test_production_accepts_non_default_attachment_cursor_secret(secret: str) -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        ATTACHMENT_CURSOR_SECRET=secret,
        AUTH_ENABLED=True,
        AUTH_SESSION_SECRET="test-only-auth-session-secret-012345678901234567890",
        AUTH_COOKIE_SECURE=True,
        AUTH_INACTIVITY_TIMEOUT_SECONDS=172800,
    )
    assert settings.attachment_cursor_secret == secret


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg://user:simple@db/chat_reader",
        "postgresql+psycopg://user:p%word@db/chat_reader",
        "postgresql+psycopg://user:p%25word@db/chat_reader",
        "postgresql+psycopg://user:p%3Dword@db/chat_reader",
        "postgresql+psycopg://user:p%40word@db/chat_reader",
        "postgresql+psycopg://user:p%25%3D%40word@db/chat_reader",
    ],
)
def test_alembic_config_preserves_percent_encoded_database_url(database_url: str) -> None:
    config = Config()
    config.set_main_option("sqlalchemy.url", escape_alembic_config_value(database_url))
    assert config.get_main_option("sqlalchemy.url") == database_url
