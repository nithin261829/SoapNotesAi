# Multi-stage build for the SoapNotesAi FastAPI backend.
# - System layer carries pango / cairo / harfbuzz / glib for WeasyPrint.
# - App layer installs Python deps via uv, copies source, runs uvicorn.
#
# Build context: repo root.  Build:
#   docker build -f deploy/docker/Dockerfile -t soapnotesai-backend backend/
# (Yes, build context is `backend/` — the COPY paths below are relative to it.)

# ─── System base ──────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS base

# WeasyPrint native deps + locales for clean PDF text rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    fonts-dejavu-core \
    fontconfig \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# uv = fast Python package manager (matches local dev).
COPY --from=ghcr.io/astral-sh/uv:0.5.10 /uv /usr/local/bin/uv

# ─── Deps layer ───────────────────────────────────────────────────
FROM base AS deps

WORKDIR /app
# Copy only the lock + pyproject so this layer caches across code edits.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# ─── App layer ────────────────────────────────────────────────────
FROM base AS app

# Non-root user for the runtime container.
RUN useradd --create-home --shell /bin/bash app
WORKDIR /app

# Copy installed deps from the deps stage.
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# WeasyPrint looks up libpango via the dynamic linker. On Debian the libs
# are in /usr/lib/x86_64-linux-gnu, which is already on the default path,
# but set DYLD/LD as a belt-and-braces guard.
ENV LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu

# Force gRPC to use the native resolver (Vertex AI calls fail with the
# default c-ares resolver on hosts where IPv6 is broken).
ENV GRPC_DNS_RESOLVER=native

# Source.
COPY app ./app
COPY pyproject.toml ./

# Build-time metadata embedded as env vars. Surfaced by /healthz.
ARG BUILD_GIT_SHA=unknown
ARG BUILD_TIMESTAMP=unknown
ARG IMAGE_TAG=local
ENV BUILD_GIT_SHA=${BUILD_GIT_SHA}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV IMAGE_TAG=${IMAGE_TAG}

# OCI image labels — show up in `gcloud artifacts docker images describe`
# and in Artifact Registry's UI.
LABEL org.opencontainers.image.title="soapnotesai-backend" \
      org.opencontainers.image.vendor="SoapNotesAi" \
      org.opencontainers.image.revision="${BUILD_GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIMESTAMP}" \
      org.opencontainers.image.version="${IMAGE_TAG}"

# Drop privileges.
RUN chown -R app:app /app
USER app

# Cloud Run / GKE both inject PORT; default to 8080 for K8s.
ENV PORT=8080
EXPOSE 8080

# Production server: one uvicorn worker per pod (let K8s HPA scale by adding
# pods instead of inflating worker counts inside one pod — keeps memory
# predictable and per-request latency consistent).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
