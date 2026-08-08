#!/usr/bin/env bash
# Bump the backend version in both pyproject.toml AND app/version.py.
# Single source of truth = app/version.py; this script keeps them in sync.
#
# Usage:  ./bump-version.sh patch     # 0.2.0 -> 0.2.1
#         ./bump-version.sh minor     # 0.2.0 -> 0.3.0
#         ./bump-version.sh major     # 0.2.0 -> 1.0.0
#         ./bump-version.sh 0.5.2     # explicit version
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || cd ../.. && pwd)"
VERSION_PY="${REPO_ROOT}/backend/app/version.py"
PYPROJECT="${REPO_ROOT}/backend/pyproject.toml"

current=$(grep -E '^__version__\s*=' "${VERSION_PY}" | sed -E 's/.*"([^"]+)".*/\1/')
echo "current: ${current}"

bump="${1:?Usage: $0 patch|minor|major|<x.y.z>}"

if [[ "${bump}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  next="${bump}"
else
  IFS='.' read -r major minor patch <<<"${current}"
  case "${bump}" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) echo "Bad bump: ${bump}" >&2; exit 1 ;;
  esac
  next="${major}.${minor}.${patch}"
fi
echo "next:    ${next}"

# Update app/version.py
sed -i.bak -E "s/^__version__\\s*=\\s*\"[^\"]+\"/__version__ = \"${next}\"/" "${VERSION_PY}"
rm -f "${VERSION_PY}.bak"

# Update pyproject.toml (only the [project].version line — leave deps alone)
python3 - <<PY
import re, pathlib
p = pathlib.Path("${PYPROJECT}")
t = p.read_text()
# Only the first version= in the [project] section.
t = re.sub(r'(\[project\][^[]*?version\s*=\s*")[^"]+(")',
           lambda m: m.group(1) + "${next}" + m.group(2),
           t, count=1, flags=re.S)
p.write_text(t)
PY

echo "✓ bumped ${current} -> ${next}"
echo "Now: git add backend/app/version.py backend/pyproject.toml && git commit -m 'release: v${next}'"
echo "Then: ./05-deploy.sh"
