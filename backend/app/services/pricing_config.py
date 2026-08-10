"""Runtime pricing, stored in Firestore (app_config/pricing) so prices can
change WITHOUT a redeploy. Code constants in pricing.py are the fallback
defaults; any field present in the Firestore doc overrides them.

Read via get_pricing(); cached 5 min (invalidate by waiting or editing the
doc — the app_config cache TTL handles it).
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.app_config import get_config_doc
from app.services import pricing as _defaults


@dataclass(frozen=True)
class Pricing:
    joining_fee_paise: int
    standard_monthly_paise: int
    premium_monthly_paise: int
    per_note_paise: int
    letterhead_change_fee_paise: int
    min_topup_paise: int
    max_topup_paise: int
    trial_days: int
    subscription_period_days: int
    standard_daily_case_limit: int


def _int(doc: dict, key: str, default: int) -> int:
    v = doc.get(key)
    try:
        return int(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def get_pricing() -> Pricing:
    """Merge Firestore app_config/pricing over the code defaults."""
    doc = get_config_doc("pricing")
    return Pricing(
        joining_fee_paise=_int(doc, "joining_fee_paise", _defaults.JOINING_FEE_PAISE),
        standard_monthly_paise=_int(doc, "standard_monthly_paise", _defaults.STANDARD_MONTHLY_PAISE),
        premium_monthly_paise=_int(doc, "premium_monthly_paise", _defaults.PREMIUM_MONTHLY_PAISE),
        per_note_paise=_int(doc, "per_note_paise", _defaults.PER_NOTE_PAISE),
        letterhead_change_fee_paise=_int(
            doc, "letterhead_change_fee_paise", _defaults.DEFAULT_LETTERHEAD_CHANGE_FEE_PAISE
        ),
        min_topup_paise=_int(doc, "min_topup_paise", _defaults.MIN_TOPUP_PAISE),
        max_topup_paise=_int(doc, "max_topup_paise", _defaults.MAX_TOPUP_PAISE),
        trial_days=_int(doc, "trial_days", _defaults.TRIAL_DAYS),
        subscription_period_days=_int(
            doc, "subscription_period_days", _defaults.SUBSCRIPTION_PERIOD_DAYS
        ),
        standard_daily_case_limit=_int(
            doc, "standard_daily_case_limit", _defaults.STANDARD_DAILY_CASE_LIMIT
        ),
    )
