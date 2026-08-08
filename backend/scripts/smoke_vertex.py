"""Tiny smoke test: confirms Vertex AI Gemini is reachable from the backend.

Costs ~$0.0001. Run from the backend dir:
    uv run python scripts/smoke_vertex.py
"""
from __future__ import annotations

import sys

import vertexai
from vertexai.generative_models import GenerativeModel

from app.config import get_settings


def main() -> int:
    settings = get_settings()
    if not settings.vertex_project_id:
        print("VERTEX_PROJECT_ID not set in backend/.env", file=sys.stderr)
        return 2
    print(
        f"project={settings.vertex_project_id} location={settings.vertex_location} model={settings.vertex_model}"
    )
    vertexai.init(project=settings.vertex_project_id, location=settings.vertex_location)
    model = GenerativeModel(settings.vertex_model)
    response = model.generate_content("Say 'pong' and nothing else.")
    print(f"reply: {response.text.strip()!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
