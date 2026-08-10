from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All settings are optional with safe empty defaults so the backend boots
    without any Google Cloud setup. Features guard on truthiness at the use site
    and fail with a clear 503 if the corresponding service is required but
    unconfigured.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Firebase / GCP — left blank in local-files-only mode until you opt in.
    firebase_project_id: str = Field("", alias="FIREBASE_PROJECT_ID")
    google_application_credentials: str = Field("", alias="GOOGLE_APPLICATION_CREDENTIALS")
    firebase_storage_bucket: str = Field("", alias="FIREBASE_STORAGE_BUCKET")  # unused in local mode

    # Vertex AI (needed for the audio → SOAP step).
    vertex_project_id: str = Field("", alias="VERTEX_PROJECT_ID")
    vertex_location: str = Field("us-central1", alias="VERTEX_LOCATION")
    vertex_model: str = Field("gemini-2.5-flash", alias="VERTEX_MODEL")

    # Audio upload + processing limits.
    max_upload_bytes: int = Field(100 * 1024 * 1024, alias="MAX_UPLOAD_BYTES")
    # Gemini 2.5 reliably handles ~9.5 minutes of audio per call. 9 min keeps
    # margin while covering typical clinical dictations.
    max_audio_duration_ms: int = Field(5 * 60 * 1000, alias="MAX_AUDIO_DURATION_MS")

    # Which AudioToSoap provider to use.
    #   - "vertex_gemini" (default): real Gemini call, billed
    #   - "fake": canned response, no network, zero cost — good for UI iteration
    audio_to_soap_provider: Literal["vertex_gemini", "fake"] = Field(
        "vertex_gemini", alias="AUDIO_TO_SOAP_PROVIDER"
    )

    # Razorpay payment gateway. Endpoints 503 with `payments_not_configured`
    # until key id + secret are set. The key secret and webhook secret must
    # never be shipped to clients — only key_id is public.
    razorpay_key_id: str = Field("", alias="RAZORPAY_KEY_ID")
    razorpay_key_secret: str = Field("", alias="RAZORPAY_KEY_SECRET")
    razorpay_webhook_secret: str = Field("", alias="RAZORPAY_WEBHOOK_SECRET")

    # App.
    app_env: Literal["development", "production", "test"] = Field("development", alias="APP_ENV")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    cors_allow_origins: str = Field(
        "http://localhost:8081,http://localhost:19006",
        alias="CORS_ALLOW_ORIGINS",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
