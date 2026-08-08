# Deploy — Cloud Run

Deploys the SoapNotesAi FastAPI backend to **Google Cloud Run**:

- Free public HTTPS URL (`https://soapnotesai-backend-<hash>-uc.a.run.app`)
- Scale to zero when idle (you pay $0 with no traffic)
- Per-revision rollback in one command
- Runs as a dedicated service account with Firestore / GCS / Vertex AI access via runtime identity (**no JSON keys**)

> Why not Kubernetes? See `k8s-archive/README.md`. Short version: K8s is overkill for a single stateless service at the testing stage; Cloud Run gives us scale-to-zero, free TLS, simpler ops, and the same Cloud Logging. We can revisit K8s when we have multiple services or unusual networking needs.

---

## One-time setup (run in order)

```bash
cd deploy/scripts
chmod +x *.sh

./01-create-artifact-registry.sh    # ~30 sec — Docker registry
./02-setup-service-account.sh       # ~30 sec — runtime IAM
```

---

## Every release

```bash
cd deploy/scripts
./deploy.sh
```

That command:

1. Reads `__version__` from `backend/app/version.py`
2. Builds image tagged `<app-version>-<utc-stamp>-<git-sha>` (also `:latest`)
3. Pushes to Artifact Registry
4. Deploys a new Cloud Run revision tagged `vX-Y-Z-…` for traceability
5. Routes 100% of traffic to the new revision
6. Prints the public URL

Skip the rebuild (config-only change):

```bash
SKIP_BUILD=1 ./deploy.sh
```

Bump the app version first if it's a "real" release:

```bash
./bump-version.sh patch     # 0.2.0 -> 0.2.1
./bump-version.sh minor     # 0.2.0 -> 0.3.0
./deploy.sh
```

---

## Operations

| Need to… | Command |
|---|---|
| See service URL + recent revisions + traffic split + health | `./status.sh` |
| Tail logs live | `./logs.sh` |
| Snapshot of the last 100 log lines | `./logs.sh --no-follow` |
| Filter logs by text | `./logs.sh ERROR` |
| Roll back to previous revision | `./rollback.sh` |
| Roll back to a specific revision | `./rollback.sh soapnotesai-backend-0029-abc` |
| Inspect via web UI | https://console.cloud.google.com/run?project=soapnotesai-dev-f7e79 |

---

## Versioning & traceability

| Aspect | Where it's set | Where it surfaces |
|---|---|---|
| App version | `backend/app/version.py` `__version__` (truth) + `pyproject.toml` (in sync) | `/healthz` JSON, deploy logs, image tag prefix |
| API version | `backend/app/version.py` `_API_VERSION` | All mobile routes hang off `/v1/...` |
| Image version | Auto from the build script | Image tag, OCI labels, `/healthz` JSON |
| Build traceability | Auto from `git rev-parse` | `/healthz.git_sha`, OCI label, startup log |

Bump rule: `./bump-version.sh patch|minor|major|<x.y.z>` — it edits **both** `version.py` and `pyproject.toml` atomically.

---

## Costs (rough)

| Component | Idle | At ~10 concurrent doctors |
|---|---|---|
| Cloud Run requests + CPU | **$0** | ~$1–5/mo |
| Artifact Registry | ~$0.10/mo | ~$0.10/mo |
| Logs | $0 (free tier) | $0 |
| Vertex AI per recording | n/a | ~$0.0005–0.005 each |
| **Total infra** | **~$0** | **~$5–10/mo** |

Plus Firebase Firestore + Storage at their free tiers (more than enough for testing).

---

## Mobile config

After `./deploy.sh` succeeds, copy the URL it prints into `mobile/.env`:

```
EXPO_PUBLIC_API_BASE_URL=https://soapnotesai-backend-<hash>-uc.a.run.app
```

Then rebuild the mobile bundle so the new URL is baked in:

```bash
cd mobile
pkill -f "expo start"
CI=1 npx expo start --tunnel --clear
```

---

## Where data lives (unchanged from local dev)

| Data | Where |
|---|---|
| Firebase Auth users | Firebase Auth |
| `users/{uid}` profiles | Firestore |
| `organizations/{oid}/clinics/{cid}/patients/...` | Firestore |
| Audio files | Cloud Storage |
| PDFs | **NOT stored** — re-rendered on demand |

---

## File layout

```
deploy/
├── README.md
├── docker/
│   └── Dockerfile              # multi-stage, pango deps, build-arg metadata
├── scripts/
│   ├── env.sh                  # shared constants
│   ├── 01-create-artifact-registry.sh   # one-time
│   ├── 02-setup-service-account.sh      # one-time
│   ├── 03-build-and-push.sh             # called by deploy.sh
│   ├── bump-version.sh                  # patch|minor|major|<x.y.z>
│   ├── deploy.sh               # ⭐ the one you'll run for every release
│   ├── status.sh
│   ├── logs.sh
│   └── rollback.sh
└── k8s-archive/                # frozen K8s manifests + scripts (not used)
```
