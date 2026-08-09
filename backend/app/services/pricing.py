"""Single source of truth for all billing prices, limits, and clock rules.

Every module that charges, gates, or displays money imports from HERE —
routers/billing.py, services/billing_service.py, routers/clinics.py. A price
edited in one place can no longer drift from what another code path charges.
All amounts are integer paise.
"""
from __future__ import annotations

from datetime import timedelta, timezone

JOINING_FEE_PAISE = 500 * 100          # ₹500, includes the 7-day trial
STANDARD_MONTHLY_PAISE = 499 * 100     # ₹499 / month / clinic
PREMIUM_MONTHLY_PAISE = 799 * 100      # ₹799 / month / clinic
PER_NOTE_PAISE = 5 * 100               # ₹5 / note (pay-per-note from wallet)
DEFAULT_LETTERHEAD_CHANGE_FEE_PAISE = 49 * 100  # ₹49 per change after the first

TRIAL_DAYS = 7
SUBSCRIPTION_PERIOD_DAYS = 30
STANDARD_DAILY_CASE_LIMIT = 30

MIN_TOPUP_PAISE = 50 * 100             # ₹50
MAX_TOPUP_PAISE = 50_000 * 100         # ₹50,000

# The product serves Indian clinics: quota "days" run midnight-to-midnight IST,
# not UTC (a clinic must not stay capped until 05:30 in the morning).
IST = timezone(timedelta(hours=5, minutes=30))
