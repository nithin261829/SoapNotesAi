# Backend

FastAPI service. See top-level `README.md` for the full project context.

## Run

```bash
cp .env.example .env   # fill in
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/healthz>
OpenAPI: <http://localhost:8000/docs>

## Test

```bash
uv run pytest
uv run ruff check .
uv run mypy app
```
