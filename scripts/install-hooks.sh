#!/usr/bin/env bash
# Points git at the repo's .githooks folder so the secret-scanning
# pre-commit hook runs on every commit. Run once per clone.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/*
git config core.hooksPath .githooks
command -v gitleaks >/dev/null 2>&1 || echo "Note: install gitleaks too: brew install gitleaks"
echo "Pre-commit secret scan enabled."
