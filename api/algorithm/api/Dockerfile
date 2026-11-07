FROM python:3.12.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --locked --no-dev
ENV PATH="/app/.venv/bin:$PATH"
CMD ["sh", "-c", "exec uvicorn algorithm_api.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log"]
