SHELL := /bin/bash
UV ?= uv
.DEFAULT_GOAL := help

.PHONY: help install secrets up down logs lint fmt test test-unit test-integration migrate downgrade revision openapi bundle demo mail replay run worker

help: ## List the targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

install: ## Create .venv with runtime and dev dependencies from uv.lock
	$(UV) sync --frozen

secrets: ## Create ./.secrets for docker compose (never overwrites)
	./scripts/init-local-secrets.sh

up: secrets ## Build and start the local stack (postgres, redis, migrate, api, worker, beat)
	docker compose up --build

down: ## Stop the local stack (add ARGS=-v to delete its volumes)
	docker compose down $(ARGS)

logs: ## Follow the api and worker logs
	docker compose logs -f api worker

lint: ## ruff, black --check, mypy --strict
	$(UV) run ruff check .
	$(UV) run black --check .
	$(UV) run mypy

fmt: ## Fix imports and format
	$(UV) run ruff check --fix .
	$(UV) run black .

test: ## All tests with coverage (integration needs Docker or LEP_TEST_* services)
	$(UV) run pytest --cov --cov-report=term-missing

test-unit: ## Unit tests only (no Docker, no services)
	$(UV) run pytest tests/unit

test-integration: ## Integration tests only
	$(UV) run pytest tests/integration

migrate: ## alembic upgrade head (LEP_DB_* plus LEP_DB_MIGRATOR_USER/PASSWORD)
	$(UV) run alembic upgrade head

downgrade: ## alembic downgrade one step
	$(UV) run alembic downgrade -1

revision: ## New empty migration: make revision m="add review_log"
	@test -n "$(m)" || (echo 'usage: make revision m="what it does"' && exit 2)
	$(UV) run alembic revision -m "$(m)"

replay: ## Rebuild a learner's memory state from the review log: make replay LEARNER=<uuid> [WRITE=1]
	$(UV) run python -m scripts.replay $(LEARNER) $(if $(WRITE),--write,)

openapi: ## Regenerate openapi.json
	$(UV) run python -m scripts.export_openapi openapi.json

demo: ## Create the demo learner (dev only, idempotent; password: LEP_DEMO_PASSWORD or .secrets)
	$(UV) run python -m scripts.seed_demo

mail: ## Print the newest letter the local stack wrote (password-reset links)
	docker compose exec api sh -c 'f=$$(ls -t /srv/mail/*.eml 2>/dev/null | head -1); [ -n "$$f" ] && cat "$$f" || echo "no letters yet"'

bundle: ## Write the content bundle for the CDN (files named by hash): make bundle [DIR=var/bundle]
	$(UV) run python -m scripts.export_bundle $(or $(DIR),var/bundle)

run: ## Run the API with reload (LEP_* must be set, see .env.example)
	$(UV) run uvicorn app.main:create_app --factory --reload --no-access-log

worker: ## Run a Celery worker with beat embedded (development only)
	$(UV) run celery --quiet -A app.workers.main:celery_app worker --beat --loglevel=INFO
