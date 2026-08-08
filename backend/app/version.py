"""Build / version metadata.

Populated from:
  - `__version__` (the truth — bumped manually + reflected in pyproject.toml)
  - env vars set by the Docker build (BUILD_GIT_SHA, BUILD_TIMESTAMP)

`/healthz` returns this so the deployed build is identifiable without shelling
into the pod.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

__version__ = "0.2.0"
"""Bump on every release. Follow semver."""

_API_VERSION = "v1"
"""URL prefix for all stable mobile-facing routes. Never break a shipped /v1/
contract — add /v2/ alongside instead."""


@dataclass(frozen=True)
class BuildInfo:
    app_version: str
    api_version: str
    git_sha: str          # short SHA or "unknown"
    build_time: str       # ISO-8601 or "unknown"
    image_tag: str        # docker tag or "local"


def get_build_info() -> BuildInfo:
    return BuildInfo(
        app_version=__version__,
        api_version=_API_VERSION,
        git_sha=os.environ.get("BUILD_GIT_SHA", "unknown")[:12],
        build_time=os.environ.get("BUILD_TIMESTAMP", "unknown"),
        image_tag=os.environ.get("IMAGE_TAG", "local"),
    )


API_PREFIX = f"/{_API_VERSION}"
