"""Cloud Storage helper around firebase_admin's default bucket.

All clinical artifacts live under
`organizations/{orgId}/clinics/{clinicId}/patients/{patientId}/recordings/{recordingId}/...`
so storage.rules can enforce tenancy.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def storage_path_for_audio(
    *, org_id: str, clinic_id: str, patient_id: str, recording_id: str, extension: str = "m4a"
) -> str:
    """Returns the relative path inside the default bucket — NOT a gs:// URI."""
    return (
        f"organizations/{org_id}/clinics/{clinic_id}/patients/{patient_id}/"
        f"recordings/{recording_id}/audio.{extension}"
    )


def upload_audio(
    *,
    org_id: str,
    clinic_id: str,
    patient_id: str,
    recording_id: str,
    audio_bytes: bytes,
    content_type: str,
    extension: str = "m4a",
) -> str:
    """Upload audio bytes to the default bucket. Returns the gs:// URI."""
    from firebase_admin import storage

    bucket = storage.bucket()
    path = storage_path_for_audio(
        org_id=org_id,
        clinic_id=clinic_id,
        patient_id=patient_id,
        recording_id=recording_id,
        extension=extension,
    )
    blob = bucket.blob(path)
    blob.upload_from_string(audio_bytes, content_type=content_type)
    gs_uri = f"gs://{bucket.name}/{path}"
    logger.info(
        "audio_uploaded recording=%s bytes=%d path=%s",
        recording_id,
        len(audio_bytes),
        path,
    )
    return gs_uri


def signed_audio_url(gs_uri: str, expires_minutes: int = 60) -> Optional[str]:
    """Generate a short-lived signed URL for playback. Used by future
    mobile audio-playback work."""
    from datetime import timedelta

    from firebase_admin import storage

    if not gs_uri.startswith("gs://"):
        return None
    _, _, rest = gs_uri.partition("gs://")
    bucket_name, _, path = rest.partition("/")
    bucket = storage.bucket(bucket_name)
    blob = bucket.blob(path)
    try:
        return blob.generate_signed_url(expiration=timedelta(minutes=expires_minutes))
    except Exception:
        # No local private key (Cloud Run runs on a keyless service account):
        # sign via the IAM signBlob API instead. Requires the runtime SA to
        # hold roles/iam.serviceAccountTokenCreator on itself (granted).
        try:
            import google.auth
            from google.auth.transport import requests as ga_requests

            credentials, _ = google.auth.default()
            credentials.refresh(ga_requests.Request())
            return blob.generate_signed_url(
                expiration=timedelta(minutes=expires_minutes),
                version="v4",
                service_account_email=credentials.service_account_email,
                access_token=credentials.token,
            )
        except Exception:
            logger.exception("signed_url_failed")
            return None
