.PHONY: dev-web dev-api test-api typecheck-web lint-web check migrate revision docker-up docker-down

dev-web:
	pnpm --filter web dev

dev-api:
	cd apps/api && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test-api:
	cd apps/api && pytest

migrate:
	cd apps/api && alembic upgrade head

revision:
	cd apps/api && alembic revision --autogenerate -m "$(m)"

typecheck-web:
	pnpm --filter web typecheck

lint-web:
	pnpm --filter web lint

check: typecheck-web test-api

docker-up:
	docker compose up --build

docker-down:
	docker compose down
