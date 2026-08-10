"""Internal endpoints invoked by Cloud Scheduler, not by users.

Auth: the scheduler job attaches an OIDC identity token for the backend's own
service account. We verify the token's signature (Google certs) and that the
email claim matches an allowed invoker. No shared secrets involved.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Header, HTTPException, status

from app.models.billing import SubscriptionDoc
from app.models.common import utc_now
from app.models.followup import Followup
from app.services.app_config import get_config_doc
from app.services.firestore import get_db
from app.services.push import send_push

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

_DEFAULT_INVOKER = "soapnotesai-backend@soapnotesai-dev-f7e79.iam.gserviceaccount.com"


def _verify_scheduler_token(authorization: Optional[str]) -> None:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_token")
    token = authorization.split(" ", 1)[1].strip()

    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token as ga_id_token

    cfg = get_config_doc("scheduler")
    audience = cfg.get("audience") or "https://soapnotesai-backend-z66y5cnt4q-uc.a.run.app"
    try:
        claims = ga_id_token.verify_oauth2_token(token, ga_requests.Request(), audience)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token") from e

    allowed = cfg.get("invoker_email") or _DEFAULT_INVOKER
    if claims.get("email") != allowed or not claims.get("email_verified"):
        logger.warning("scheduler_invoker_rejected email=%s", claims.get("email"))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invoker_not_allowed")


@router.post("/subscriptions/sweep", include_in_schema=False)
def sweep_subscriptions(
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict[str, int]:
    """Daily billing lifecycle sweep:
      1. Flip lapsed active subscriptions + trials to `expired` (accurate state).
      2. Push a renewal reminder to org owners 3 days before, and on, expiry.

    Idempotent: reminders are stamped per period_end so they fire at most once
    per window. Manual-renewal model — this never charges; it just nudges.
    """
    _verify_scheduler_token(authorization)

    db = get_db()
    now = utc_now()
    soon = now + timedelta(days=3)

    expired_count = 0
    reminders_sent = 0

    for org_snap in db.collection("organizations").stream():
        org_id = org_snap.id
        billing_col = db.collection("organizations").document(org_id).collection("billing")

        # Owner push tokens for this org (renewal reminders go to owners).
        owner_tokens: list[tuple[str, str]] = []
        for u_snap in db.collection("users").where("org_id", "==", org_id).stream():
            u = u_snap.to_dict() or {}
            memberships = u.get("memberships") or []
            is_owner = any(
                isinstance(m, dict) and m.get("role") == "owner" for m in memberships
            )
            if is_owner and u.get("push_token"):
                owner_tokens.append((u["push_token"], u.get("push_token_type") or "expo"))

        for sub_snap in billing_col.stream():
            doc_id = sub_snap.id
            if doc_id != "subscription" and not doc_id.startswith("subscription_"):
                continue
            data = sub_snap.to_dict() or {}
            try:
                sub = SubscriptionDoc.model_validate(data)
            except Exception:
                continue

            # ── Trial expiry (org-level doc) ──
            if (
                doc_id == "subscription"
                and sub.status == "trial"
                and sub.trial_ends_at
                and sub.trial_ends_at <= now
            ):
                sub_snap.reference.update({"status": "expired", "updated_at": now.isoformat()})
                expired_count += 1
                continue

            # ── Paid clinic subscription lifecycle ──
            if sub.status == "active" and sub.current_period_end:
                if sub.current_period_end <= now:
                    sub_snap.reference.update(
                        {"status": "expired", "updated_at": now.isoformat()}
                    )
                    expired_count += 1
                    # notify on-expiry (once per period)
                    stamp = f"expired:{sub.current_period_end.date().isoformat()}"
                    if data.get("renewal_reminded_for") != stamp and owner_tokens:
                        for tok, ttype in owner_tokens:
                            if send_push(
                                tok, ttype,
                                "Your plan has expired",
                                "Renew now to keep creating notes for this clinic.",
                                data={"screen": "payments"},
                            ):
                                reminders_sent += 1
                        sub_snap.reference.update({"renewal_reminded_for": stamp})
                elif now < sub.current_period_end <= soon:
                    # renewal reminder, 3-day window, once per period
                    stamp = f"pre:{sub.current_period_end.date().isoformat()}"
                    if data.get("renewal_reminded_for") != stamp and owner_tokens:
                        days = max(1, (sub.current_period_end - now).days)
                        for tok, ttype in owner_tokens:
                            if send_push(
                                tok, ttype,
                                f"Plan renews in {days} day{'s' if days != 1 else ''}",
                                "Renew to avoid interruption to note generation.",
                                data={"screen": "payments"},
                            ):
                                reminders_sent += 1
                        sub_snap.reference.update({"renewal_reminded_for": stamp})

    logger.info("subscription_sweep expired=%d reminders=%d", expired_count, reminders_sent)
    return {"expired": expired_count, "reminders_sent": reminders_sent}


@router.post("/reminders/run", include_in_schema=False)
def run_reminders(
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict[str, int]:
    """Daily sweep: push follow-up reminders for today + tomorrow.

    Standard/Premium orgs only (product matrix). Each follow-up alerts at most
    once per date via the reminded_on stamp.
    """
    _verify_scheduler_token(authorization)

    db = get_db()
    today = utc_now().date()
    targets = {today.isoformat(), (today + timedelta(days=1)).isoformat()}

    orgs_scanned = 0
    pushes_sent = 0
    for org_snap in db.collection("organizations").stream():
        org_id = org_snap.id
        orgs_scanned += 1

        # Per-clinic billing: reminders are a Standard/Premium clinic feature;
        # the org-level trial covers every clinic. Build the eligible set once.
        billing_col = db.collection("organizations").document(org_id).collection("billing")
        now = utc_now()
        org_snap = billing_col.document("subscription").get()
        org_sub = (
            SubscriptionDoc.model_validate(org_snap.to_dict())
            if org_snap.exists else SubscriptionDoc()
        )
        trial_ok = bool(
            org_sub.status == "trial" and org_sub.trial_ends_at and org_sub.trial_ends_at > now
        )
        eligible_clinics: set[str] = set()
        for sub_doc in billing_col.stream():
            if not sub_doc.id.startswith("subscription_"):
                continue
            try:
                csub = SubscriptionDoc.model_validate(sub_doc.to_dict())
            except Exception:
                continue
            if csub.tier in ("standard", "premium") and csub.status == "active" and (
                csub.current_period_end is None or csub.current_period_end > now
            ):
                eligible_clinics.add(sub_doc.id.removeprefix("subscription_"))
        if not trial_ok and not eligible_clinics:
            continue

        # Org members with a registered push token, plus which clinics each
        # belongs to — reminders only go to the clinic that owns the patient.
        members: list[tuple[str, str, set[str]]] = []
        for user_snap in db.collection("users").where("org_id", "==", org_id).stream():
            u = user_snap.to_dict() or {}
            if not u.get("push_token"):
                continue
            if u.get("reminders_enabled") is False:
                continue  # doctor turned reminders off
            clinic_ids = {
                m.get("clinic_id")
                for m in (u.get("memberships") or [])
                if isinstance(m, dict) and m.get("clinic_id")
            }
            members.append((u["push_token"], u.get("push_token_type") or "expo", clinic_ids))
        if not members:
            continue

        # Single-field "in" query only — status filtered in code so no
        # composite index is required.
        due_q = (
            db.collection("organizations").document(org_id)
            .collection("followups")
            .where("due_date", "in", sorted(targets))
        )
        for f_snap in due_q.stream():
            try:
                f = Followup.model_validate(f_snap.to_dict())
            except Exception:
                continue
            if f.status != "scheduled":
                continue
            if not trial_ok and f.clinic_id not in eligible_clinics:
                continue
            stamp = f.due_date if f.due_date == today.isoformat() else f"pre:{f.due_date}"
            if stamp in f.reminded_on:
                continue
            when = "today" if f.due_date == today.isoformat() else "tomorrow"
            title = f"Follow-up {when}: {f.patient_name}"
            body = f.note or "Patient is due for a follow-up consultation."
            recipients = [
                (token, token_type)
                for token, token_type, clinic_ids in members
                if f.clinic_id in clinic_ids
            ]
            sent_any = False
            for token, token_type in recipients:
                if send_push(
                    token, token_type, title, body,
                    data={"followup_id": f_snap.id, "patient_id": f.patient_id,
                          "phone": f.patient_phone or ""},
                ):
                    pushes_sent += 1
                    sent_any = True
            if sent_any:
                f_snap.reference.update({
                    "reminded_on": f.reminded_on + [stamp],
                    "updated_at": utc_now().isoformat(),
                })

    logger.info("reminders_run orgs=%d pushes=%d", orgs_scanned, pushes_sent)
    return {"orgs_scanned": orgs_scanned, "pushes_sent": pushes_sent}
