FROM ghcr.io/astral-sh/uv:0.11.23 AS uv
FROM python:3.12-slim-bookworm AS builder
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
RUN groupadd --system api && useradd --system --gid api --home-dir /app api && mkdir -p /app/data && chown api:api /app/data
COPY --from=builder --chown=api:api /app/.venv /app/.venv
COPY --from=builder --chown=api:api /app/src /app/src
USER api
EXPOSE 9100
CMD ["uvicorn", "job_helper_api.main:app", "--host", "0.0.0.0", "--port", "9100", "--workers", "1", "--no-access-log"]
