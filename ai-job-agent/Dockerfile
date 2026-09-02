FROM ghcr.io/astral-sh/uv:0.11.23 AS uv

FROM python:3.12-slim-bookworm AS builder

COPY --from=uv /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN groupadd --system agent && useradd --system --gid agent --home-dir /app agent
COPY --from=builder --chown=agent:agent /app/.venv /app/.venv
COPY --from=builder --chown=agent:agent /app/src /app/src

USER agent
EXPOSE 9101

CMD ["uvicorn", "job_helper_agent.main:app", "--host", "0.0.0.0", "--port", "9101"]
