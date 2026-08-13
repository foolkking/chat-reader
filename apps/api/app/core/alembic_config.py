def escape_alembic_config_value(value: str) -> str:
    """Escape ConfigParser interpolation tokens without changing URL semantics."""

    return value.replace("%", "%%")
