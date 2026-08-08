"""Pydantic models matching the Firestore collection layout.

Read `docs/architecture.md` and `docs/soap-notes-app-claude-code-prompt.md`
for the full data model. Every clinical field is OPTIONAL by default — the
LLM must never invent values, and absence is rendered as "not documented".
"""
