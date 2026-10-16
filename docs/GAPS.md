# Coverage gaps (research pass, 2026-10)

Three research passes audited assessments 1–5. Topics below were missing or shallow and were used to seed assessments 6–10.

## Backend / distributed / security-in-code
OAuth refresh-token rotation races · IDOR (object-level authz) · SSRF via fetch-by-URL (redirect to metadata IP, DNS rebinding) · CSRF & SameSite (same-site ≠ same-origin) · ReDoS · consensus & split brain · CRDT vs LWW in active-active · watermarks & late events · AES-GCM nonce reuse · goroutine leaks · Node stream backpressure · JSON numbers > 2^53 · prompt injection in tool-using agents · agent tool-call loops · Redis Cluster CROSSSLOT/MOVED · GraphQL aliases/complexity · Elasticsearch oversharding · HLL/Bloom error budgets · multipart uploads never completed · supply-chain drift.

## Infra / DevOps / SRE
Terraform state/plan replaces (moved blocks, prevent_destroy) · IAM evaluation (explicit deny, SCP, boundaries) · SG vs stateless NACL · k8s eviction (ephemeral storage) vs OOMKill vs throttling · HPA on requests · PDB blocking drains · pending pods (zonal PVC, anti-affinity) · CoreDNS ndots:5 · image-pull limits per NAT IP · inode exhaustion · mutable tags vs digests · secret rotation without dual validity · spot interruption & scale-in · cross-AZ/NAT cost · telemetry cost · DR quota blockers · restore time (RTO) · chaos experiments masked by retries · canary statistical power · postmortem action items.

## Frontend / UX
Core Web Vitals root causes · hydration mismatch · personalised HTML at the edge · out-of-order search responses · optimistic rollback clobbering · IME composition & autofill · focus management · live regions · contrast & reduced motion · offline sync conflicts · app version skew · stale service worker / ChunkLoadError · CSP breaking tags · SameSite in iframes · i18n plurals/expansion/RTL · timezone display · loading/empty/error states · confirm vs undo · A/B pitfalls (peeking, novelty, Simpson) · analytics schema drift.
