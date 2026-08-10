import logging
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.firebase import init_firebase
from app.config import Settings, get_settings
from app.interfaces.audio_to_soap import AudioToSoap
from app.providers.fake_audio_to_soap import FakeAudioToSoap
from app.routers import accounts as accounts_router
from app.routers import audio as audio_router
from app.routers import auth_otp as auth_otp_router
from app.routers import billing as billing_router
from app.routers import cases as cases_router
from app.routers import clinics as clinics_router
from app.routers import documents as documents_router
from app.routers import export as export_router
from app.routers import verification as verification_router
from app.routers import followups as followups_router
from app.routers import internal as internal_router
from app.routers import invites as invites_router
from app.routers import patients as patients_router
from app.routers import recordings as recordings_router
from app.routers import soap as soap_router
from app.version import API_PREFIX, __version__, get_build_info

logger = logging.getLogger("soapnotesai")


@lru_cache(maxsize=1)
def get_audio_to_soap() -> AudioToSoap:
    """Construct the active AudioToSoap provider per Settings.

    Cached so the (potentially expensive) Vertex AI init runs once per process.
    Tests override via FastAPI's `app.dependency_overrides[get_audio_to_soap]`.
    """
    settings = get_settings()
    if settings.audio_to_soap_provider == "fake":
        logger.info("AudioToSoap provider: fake (canned response)")
        return FakeAudioToSoap()

    # Import lazily so the fake-provider path doesn't require vertexai installed.
    from app.providers.vertex_gemini import VertexGeminiAudioToSoap

    logger.info(
        "AudioToSoap provider: vertex_gemini model=%s location=%s",
        settings.vertex_model,
        settings.vertex_location,
    )
    return VertexGeminiAudioToSoap(
        project=settings.vertex_project_id,
        location=settings.vertex_location,
        model=settings.vertex_model,
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    init_firebase(settings)
    bi = get_build_info()
    logger.info(
        "SoapNotesAi backend started env=%s app=%s api=%s sha=%s built=%s",
        settings.app_env, bi.app_version, bi.api_version, bi.git_sha, bi.build_time,
    )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="SoapNotesAi",
        version=__version__,
        description="Voice-driven SOAP-notes API.",
        lifespan=lifespan,
        # Pin the OpenAPI to the API version too.
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Liveness probe — unauthenticated, lightweight, returns build metadata.
    # NOTE: mounted at /health (not /healthz). Google's Cloud Run frontend
    # silently swallows /healthz, /readyz, and other K8s-style paths in some
    # configurations, so we use the simpler /health and also expose at /v1/health.
    def _health() -> dict[str, str]:
        bi = get_build_info()
        return {
            "status": "ok",
            "app_version": bi.app_version,
            "api_version": bi.api_version,
            "git_sha": bi.git_sha,
            "build_time": bi.build_time,
            "image_tag": bi.image_tag,
        }

    app.add_api_route("/health", _health, tags=["meta"], methods=["GET"])
    app.add_api_route(f"{API_PREFIX}/health", _health, tags=["meta"], methods=["GET"])

    # All mobile-facing routes hang off /v1 so we can add /v2 alongside
    # without breaking already-shipped APKs.
    app.include_router(audio_router.router, prefix=API_PREFIX)
    app.include_router(soap_router.router, prefix=API_PREFIX)
    app.include_router(accounts_router.router, prefix=API_PREFIX)
    app.include_router(invites_router.router, prefix=API_PREFIX)
    app.include_router(patients_router.router, prefix=API_PREFIX)
    app.include_router(recordings_router.router, prefix=API_PREFIX)
    app.include_router(billing_router.router, prefix=API_PREFIX)
    app.include_router(followups_router.router, prefix=API_PREFIX)
    app.include_router(internal_router.router, prefix=API_PREFIX)
    app.include_router(auth_otp_router.router, prefix=API_PREFIX)
    app.include_router(export_router.router, prefix=API_PREFIX)
    app.include_router(verification_router.router, prefix=API_PREFIX)
    app.include_router(clinics_router.router, prefix=API_PREFIX)
    app.include_router(cases_router.router, prefix=API_PREFIX)
    app.include_router(documents_router.router, prefix=API_PREFIX)

    return app


app = create_app()
