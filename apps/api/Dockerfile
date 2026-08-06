FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
COPY scripts ./scripts
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

RUN apt-get update \
    && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip && pip install .

RUN addgroup --system chatreader \
    && adduser --system --ingroup chatreader chatreader \
    && mkdir -p /data/imports /data/exports /data/offline /data/assets \
    && chown -R chatreader:chatreader /app /data

USER chatreader

EXPOSE 8000

ENV WEB_CONCURRENCY=1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
