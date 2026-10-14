FROM python:3.12-slim

# tzdata: the API resolves each browser's IANA time zone (zoneinfo), and TZ sets the seed's "today".
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.8 /uv /bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app

ENV DATABASE_URL=sqlite:////data/leadflow.db \
    SEED_DEMO_DATA=true
VOLUME /data
EXPOSE 8000

# Seed the demo leads on first start only, then serve.
CMD ["sh", "-c", "if [ \"$SEED_DEMO_DATA\" = true ]; then python -m app.seed --if-empty; fi && exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000"]
