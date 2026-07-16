from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from psycopg.types.json import Jsonb
from sqlalchemy import insert
from sqlalchemy.orm import Session


def insert_rows(db: Session, model: type, rows: Sequence[dict[str, Any]]) -> None:
    if not rows:
        return

    mapper = model.__mapper__
    mapper_keys = [attribute.key for attribute in mapper.column_attrs]
    known_keys = set(mapper_keys)
    grouped_rows: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        unknown_keys = set(row) - known_keys
        if unknown_keys:
            unknown = ", ".join(sorted(unknown_keys))
            raise KeyError(f"Unknown columns for {model.__name__}: {unknown}")
        keys = tuple(key for key in mapper_keys if key in row)
        grouped_rows[keys].append(row)

    for keys, matching_rows in grouped_rows.items():
        _insert_matching_rows(db, model, mapper, keys, matching_rows)


def _insert_matching_rows(
    db: Session,
    model: type,
    mapper: Any,
    keys: tuple[str, ...],
    rows: Sequence[dict[str, Any]],
) -> None:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        db.execute(insert(model), list(rows))
        return

    columns = [mapper.attrs[key].columns[0] for key in keys]
    table_name = model.__table__.name.replace('"', '""')
    column_sql = ", ".join(f'"{column.name.replace(chr(34), chr(34) * 2)}"' for column in columns)
    sql = f'COPY "{table_name}" ({column_sql}) FROM STDIN'
    driver_connection = db.connection().connection.driver_connection

    with driver_connection.cursor().copy(sql) as copy:
        for row in rows:
            copy.write_row(tuple(_copy_value(row[key]) for key in keys))


def _copy_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return Jsonb(value)
    return value
