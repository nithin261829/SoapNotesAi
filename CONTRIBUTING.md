# Contributing and commit rules

This repository is public. Anything committed, even if deleted in a later commit, stays in git history and can be copied by anyone. Follow these rules for every commit.

## One-time setup on each machine

```bash
brew install gitleaks
./scripts/install-hooks.sh
```

This turns on a pre-commit hook that scans your staged changes and blocks the commit if it finds a secret or a forbidden file.

## Never commit

| Never commit | Use instead |
|---|---|
| `.env` files (`backend/.env`, `mobile/.env`) | `.env.example` with placeholder values only |
| Service-account key files (`*firebase-adminsdk*.json`, `*service-account*.json`, `*.pem`, `*.p12`) | Application Default Credentials locally (`gcloud auth application-default login`); the Cloud Run service account in production |
| API keys, tokens, passwords, Razorpay keys, webhook secrets in code | Environment variables, read through `backend/app/config.py` |
| Real patient data: names, phone numbers, recordings, transcripts, PDFs | Made-up test data (`example.com` emails, invented names) |
| Personal emails or phone numbers | Placeholders such as `you@example.com` |
| Local tool settings (`.claude/`, `.mcp.json`, `.xcode.env.local`, editor folders) | Keep them local; they are in `.gitignore` |

## Before every commit

1. Run `git status` and read the list of files. Nothing from the table above should be there.
2. Run `git diff --staged` and look for keys or real data.
3. Commit. The hook runs gitleaks automatically. If it blocks the commit, remove the secret; do not bypass the hook with `--no-verify`.

## Adding a new setting or secret

1. Read it from an environment variable in code.
2. Add the variable name with a placeholder value to the matching `.env.example`.
3. Put the real value only in your local `.env` (ignored by git) or in Cloud Run's environment / Secret Manager.

## If a secret is committed by mistake

Act fast; assume it is already copied.

1. **Revoke it first.** Google Cloud Console → *IAM & Admin → Service Accounts → Keys* (delete the key), or *APIs & Services → Credentials* (regenerate or restrict the API key). For Razorpay, regenerate the key in the Razorpay dashboard.
2. **Remove it from history** with [`git filter-repo`](https://github.com/newren/git-filter-repo) on a fresh clone, then force-push.
3. Rerun `gitleaks git .` until it reports no leaks.

Deleting the file in a new commit is **not** enough. The old commit still contains it.

## Commit style

- One logical change per commit, message in the imperative: `Add follow-up reminders`, `Fix PDF header on continuation sheets`.
- Run the backend tests (`cd backend && uv run pytest`) before pushing.
- The GitHub **Secret scan** check runs on every push and pull request. Keep it green.
