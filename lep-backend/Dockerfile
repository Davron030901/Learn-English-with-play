# One image for every process: the API (default command), the Celery worker and beat,
# and the migration job. Compose and Kubernetes choose the command.

# ---- build: install the locked dependencies into a virtualenv -------------------------
FROM python:3.12-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ---- runtime: no compiler, no uv, code not writable by the process -------------------
FROM python:3.12-slim-bookworm AS runtime
RUN groupadd --system --gid 10001 lep \
 && useradd --system --uid 10001 --gid lep --no-create-home --shell /usr/sbin/nologin lep
COPY --from=build /opt/venv /opt/venv
WORKDIR /srv/lep
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
# operations scripts: make replay, the demo seed (httpx comes with the anthropic SDK)
COPY scripts ./scripts
# the local stack's mail outbox (LEP_MAIL_BACKEND=file): a named volume mounted here takes
# this directory's owner, so the unprivileged process can write to it
RUN mkdir -p /srv/mail && chown lep:lep /srv/mail && chmod 0700 /srv/mail
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/srv/lep \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
USER lep
EXPOSE 8000
STOPSIGNAL SIGTERM
# --timeout-graceful-shutdown must stay below the orchestrator's grace period
# (compose stop_grace_period: 30s) so in-flight requests finish before a SIGKILL.
CMD ["uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--no-access-log", \
     "--timeout-graceful-shutdown", "25", "--timeout-keep-alive", "5"]
