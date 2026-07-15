from collections.abc import Sequence
from typing import Any

from psycopg.types.json import Jsonb
from sqlalchemy import insert
from sqlalchemy.orm import Session


def insert_rows(db: Session, model: type, rows: Sequence[dict[str, Any]]) -> None:
    if not rows:
        return
    if db.bind is None or db.bind.dialect.name != "postgresql":
        db.execute(insert(model), list(rows))
        return

    mapper = model.__mapper__
    keys = list(rows[0].keys())
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
