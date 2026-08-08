# K8s archive (not used)

These manifests + scripts were written when we briefly used GKE Autopilot. We
pivoted to **Cloud Run** because:

- Single stateless FastAPI service — K8s is overkill for our footprint.
- Cloud Run scales to zero (free at idle); GKE baseline was ~$50/mo.
- Cloud Run gives us free HTTPS at `*.run.app`; GKE required a domain + DNS + cert wrangling.
- Far fewer failure surfaces — pod scheduling, ingress, cert provisioning, HPA all evaporate.

The cluster + static IP have been deleted; the GSA `soapnotesai-backend@` still
exists and is reused by Cloud Run as its runtime identity.

**Bring this back when:**

- We have 3+ services that need to talk to each other privately
- We need custom networking (mTLS, service mesh)
- We outgrow Cloud Run's per-region request limits (~1000 req/sec sustained)

Until then: leave it frozen.
