"""Push notification sending.

Two transports, chosen per stored token type:
  - "expo": token from expo-notifications getExpoPushTokenAsync() —
    sent via Expo's push API, which relays through FCM (Android) / APNs (iOS).
  - "fcm": raw FCM device token — sent directly with firebase-admin
    (already initialized for auth), no third-party relay.

Tokens live on users/{uid} as push_token + push_token_type, registered via
POST /accounts/push-token.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_push(token: str, token_type: str, title: str, body: str, data: dict | None = None) -> bool:
    try:
        if token_type == "fcm":
            return _send_fcm(token, title, body, data)
        return _send_expo(token, title, body, data)
    except Exception:
        logger.exception("push_send_failed type=%s", token_type)
        return False


def _send_expo(token: str, title: str, body: str, data: dict | None) -> bool:
    import requests

    resp = requests.post(
        _EXPO_PUSH_URL,
        json={"to": token, "title": title, "body": body, "data": data or {}, "sound": "default"},
        timeout=10,
    )
    ok = resp.status_code == 200 and '"error"' not in resp.text[:200]
    if not ok:
        logger.warning("expo_push_error status=%s body=%s", resp.status_code, resp.text[:200])
    return ok


def _send_fcm(token: str, title: str, body: str, data: dict | None) -> bool:
    from firebase_admin import messaging

    msg = messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in (data or {}).items()},
    )
    messaging.send(msg)
    return True
