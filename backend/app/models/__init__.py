"""Pydantic models matching the Firestore collection layout.

See `docs/architecture.md` for the data model. Every clinical field is OPTIONAL by default — the
LLM must never invent values, and absence is rendered as "not documented".
"""
