import type { Assessment } from '../types';
import { bump, shape, step, timeAxis, window_ } from '../series';
import leakedKey from '../labs/a15-leaked-key';

/* ───────────── chart data ───────────── */

// Alert volume by rule over 14 days (alerts/day)
const days = ['Oct 01', 'Oct 02', 'Oct 03', 'Oct 04', 'Oct 05', 'Oct 06', 'Oct 07', 'Oct 08', 'Oct 09', 'Oct 10', 'Oct 11', 'Oct 12', 'Oct 13', 'Oct 14'];
const geoAlerts = shape(14, { base: 610, noise: 0.08, seed: 3 });
const failedLoginAlerts = shape(14, { base: 380, noise: 0.1, seed: 5 });
const s3PublicAlerts = shape(14, { base: 140, noise: 0.15, seed: 7 });
const iamChangeAlerts = shape(14, { base: 70, noise: 0.2, seed: 9 });

// Login traffic during enumeration (per minute)
const lx = timeAxis('02:00', 60, 1);
const resetRequests = shape(60, { base: 12, noise: 0.3, seed: 11 }, step(14, 2100), step(47, 14));
const resetIps = shape(60, { base: 10, noise: 0.25, seed: 13 }, step(14, 1900), step(47, 11));
const loginFails = shape(60, { base: 30, noise: 0.25, seed: 17 });

// Takeover timeline histogram (events per 10 min)
const tx = timeAxis('08:00', 18, 10);
const txCounts = shape(18, { base: 3, noise: 0.4, seed: 21 }, window_(9, 10, 26), window_(10, 13, 9), window_(13, 14, 61), bump(14, 18, 0));
const txErrors = shape(18, { base: 0, noise: 0, seed: 1 }, window_(9, 10, 2));

const a15: Assessment = {
	id: 'security',
	number: 15,
	title: 'Security engineering',
	tagline: 'Authorization design, secrets and crypto, supply chain, and running a security incident without making it worse.',
	description:
		'Defensive security for senior engineers. Every scenario is a design review, a code review, a detection problem or an incident response decision, and most have a tempting answer that would make things worse: deleting the evidence, trusting the token\'s own header, or "fixing" a CI leak by rotating one secret. Numbers are worked where the decision depends on them (hash cost, key rotation, nonce budgets, alert precision).',
	minutes: 195,
	difficulty: 'advanced',
	track: 'core',
	topics: ['authorization', 'OAuth / OIDC', 'crypto & KMS', 'supply chain', 'CI security', 'incident response', 'threat modeling'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · AuthN / AuthZ', minutes: 35 },
				{ label: '2 · Secrets & crypto', minutes: 35 },
				{ label: '3 · Supply chain & CI', minutes: 30 },
				{ label: '4 · Detect & respond', minutes: 45 },
				{ label: '5 · Threat modeling', minutes: 25 },
				{ label: '6 · Lab', minutes: 15 },
				{ label: 'Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: 'Review method',
					items: [
						'Name the asset and who must **not** reach it.',
						'Find the trust boundary the code or design crosses.',
						'Ask who chooses: the verifier, or the attacker-controlled input?',
						'Rank findings by exploitability × impact, not by how clever they are.'
					]
				},
				{
					title: 'Incident method',
					items: [
						'Contain without destroying evidence or the business.',
						'Assume persistence: look for the second foothold.',
						'Scope with logs before you scope with opinions.',
						'Communicate facts, unknowns and next update time.'
					]
				},
				{
					title: 'What graders reward',
					items: [
						'The defense placed at the layer that cannot be forgotten (data layer, verifier, admission).',
						'Trade-offs stated: latency, availability, operational cost.',
						'Numbers when a parameter is being chosen.',
						'Saying what you would **not** do and why.'
					]
				}
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'Scope',
			text: 'This set is defensive: reviewing, detecting, containing and designing. Offensive detail is limited to what a reviewer needs to recognize a weakness.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · AuthN/Z',
			eyebrow: 'Part 1 · 35 minutes',
			title: 'Authentication and authorization design',
			meta: 'roles · relationships · tokens · OAuth · service identity',
			minutes: 35,
			questions: [
				{
					id: 'a1-new-enemy',
					title: 'Removed from the folder, still reads the new doc',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'A document product uses a [[rebac|relationship-based]] authorization service with tuples like `doc:X#parent@folder:Y` and `folder:Y#viewer@user:Z`. Checks are served from regional read replicas for latency. A customer reports:'
						},
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Priya Natarajan',
								role: 'Head of People, customer account',
								subject: 'Contractor saw a document after we removed him',
								time: 'Tue 16:20',
								body: `We removed a contractor from our "Restructuring" folder at 14:02. At 14:03 our HR lead uploaded the layoff list into that folder. The audit log shows the contractor opened the layoff list at 14:03:20.

Your support team said "permissions can take a minute to propagate". That is not acceptable for us. How did this happen, and how do we know it won't again?`
							}
						},
						{ type: 'p', text: 'Explain the mechanism precisely and propose a fix that does not route every check to the primary.' }
					],
					hints: ['The removal and the upload are two writes. Which snapshot did the check read each of them from?'],
					answer: [
						{
							type: 'p',
							text: 'This is the [[new-enemy-problem|new-enemy problem]]. The removal (write W1, 14:02) and the upload (write W2, 14:03) were both committed. The check at 14:03:20 read the **document and its parent folder** from fresh storage (the doc existed, so it saw W2) but evaluated **permissions** on a replica that had not yet applied W1. Content was newer than the ACL snapshot used to protect it. "Propagation delay" is the symptom; the bug is mixing snapshots.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Consistency tokens on content writes',
									body: 'When the HR lead uploads into the folder, the app asks the authz service for a [[consistency-token|consistency token]] (zookie) representing the ACL state now (already including W1) and stores it on the document row. Every later check for that document passes the token; the service evaluates at a snapshot at least that new, falling back to a fresher replica or the leader only when the local one is behind.',
									confirm: 'Replay the incident in staging with an artificially lagged replica: the check must block until the replica passes the token or be routed elsewhere.'
								},
								{
									title: 'Make revocations bump a version that checks must observe',
									body: 'A cheaper approximation: removals increment a per-folder ACL version; content written after records it; checks reject if the replica\'s version is older. Same idea, coarser.'
								},
								{
									title: 'Not the fix: shorter cache TTLs or "check on the primary for sensitive folders"',
									body: 'Lower TTLs shrink the window but never close it, and routing by sensitivity relies on someone tagging folders correctly in advance.'
								}
							]
						},
						{
							type: 'p',
							text: '**Also:** treat this as a confidentiality incident for the customer (layoff list exposure), not a support ticket; give them the exact access log entries, and confirm whether other folders saw removals followed by uploads within the replica lag window.'
						}
					]
				},
				{
					id: 'a2-tenant-admin',
					title: '"Only admins can add members"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'Review this endpoint in a [[multi-tenancy|multi-tenant]] project-management API. `user.roles` comes from the session.' },
						{
							type: 'code',
							lang: 'python',
							code: `@router.post("/projects/{project_id}/members")
def add_member(project_id: int, body: AddMember, user = Depends(current_user)):
    if "admin" not in user.roles:            # roles: ["admin", "member", ...]
        raise HTTPException(403)
    project = db.get(Project, project_id)
    new_member = db.get(User, body.user_id)
    project.members.append(new_member)
    db.commit()
    return {"ok": True}`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Role is not scoped to a tenant',
									body: '`"admin" in user.roles` asks "is this person an admin *somewhere*?" Any customer\'s admin can add members to any project in any organization by changing `project_id`. This is [[idor|IDOR]] wearing an RBAC costume: [[rbac|roles]] must be evaluated against the organization that owns the object (`has_role(user, "admin", org=project.org_id)`).'
								},
								{
									title: 'The added user is not checked either',
									body: '`body.user_id` can be a user from another tenant, which grants that outsider membership (and so read access) to this project. Require `new_member.org_id == project.org_id` or an explicit cross-org invite flow.'
								},
								{
									title: 'Enforcement lives only in this handler',
									body: 'Every other endpoint must remember the same check. Push tenant scoping down: [[row-level-security|row-level security]] keyed on the session\'s org, or a repository layer whose `get(Project, id)` refuses objects outside the caller\'s tenant.'
								}
							]
						},
						{
							type: 'code',
							lang: 'python',
							code: `project = projects.get_for(user, project_id)          # raises 404 outside caller's org
authz.require(user, "manage_members", project)        # role scoped to project.org_id
new_member = users.get_in_org(project.org_id, body.user_id)`
						},
						{ type: 'p', text: 'Return 404 rather than 403 for objects in other tenants so the endpoint does not confirm which ids exist.' }
					]
				},
				{
					id: 'a3-jwt-review',
					title: 'Review the token middleware',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'A service accepts [[jwt|JWTs]] from the company IdP (RS256). An older internal tool signs HS256 tokens with a shared secret. Rank what you would flag.' },
						{
							type: 'code',
							lang: 'typescript',
							code: `import jwt from "jsonwebtoken";
const PUBLIC_KEY = fs.readFileSync("keys/idp-rs256.pub");

export function authenticate(req: Request) {
  const token = req.headers.authorization?.replace("Bearer ", "") ?? "";
  const { header } = jwt.decode(token, { complete: true })!;
  const key = header.alg === "RS256"
    ? PUBLIC_KEY
    : process.env.LEGACY_HS_SECRET ?? PUBLIC_KEY;   // fallback for local dev
  const claims = jwt.verify(token, key) as Claims;  // checks signature + exp
  return { userId: claims.sub, scopes: claims.scope?.split(" ") ?? [] };
}`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The token chooses its own verification ([[jwt-alg-confusion|algorithm confusion]])',
									body: 'The header\'s `alg` selects the key. In any environment where `LEGACY_HS_SECRET` is unset, an HS256 token is verified with the **public** key as the HMAC secret. The public key is public, so anyone can mint tokens with any `sub` and scopes. The "local dev" fallback is the vulnerability, and environment drift ships it to prod.',
									confirm: 'Deploy check: is `LEGACY_HS_SECRET` set in every environment? Add a unit test that a token signed HS256 with the public key is rejected.'
								},
								{
									title: 'No `algorithms` pinned in `verify`',
									body: 'Pass `{ algorithms: ["RS256"] }` for IdP tokens. Separate the legacy path entirely: different header (`X-Internal-Token`), different verifier, `algorithms: ["HS256"]`, its own secret, and plan its removal.'
								},
								{
									title: 'No issuer or audience check',
									body: 'Any RS256 token from the same IdP, minted for a different application (or the staging tenant if keys are shared), is accepted. Verify `iss` and `aud`.'
								},
								{
									title: 'No revocation story',
									body: 'Signature + `exp` only: a disabled user keeps access until expiry. Fine if access tokens live minutes; not if they live hours (see the next question).'
								}
							]
						},
						{
							type: 'p',
							text: '**Rule of thumb:** the verifier decides algorithm, key and audience from its own configuration (keyed by `kid` from a trusted JWKS); the token only provides claims to be checked.'
						}
					]
				},
				{
					id: 'a4-revocation',
					title: 'Disabled employee, still in for 11 hours',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'An employee was terminated at 09:00 and their [[sso|SSO]] account disabled. Logs show API calls with their token until 20:04. Access tokens are JWTs valid for 12 h; there are 4 million API requests per minute at peak across 30 services. Propose a design that bounds this to under 1 minute without a database round trip per request.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Self-contained tokens are not consulted with anyone, so disabling the account changes nothing until `exp`. You need either shorter tokens or a cheap per-request revocation signal. See [[token-revocation]].'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Per-user session version checked at the gateway',
									body: 'Add an `sv` claim. The gateway keeps `user → current sv` in a local cache fed by a pub/sub stream (or Redis with a 5 s local cache). Disabling a user bumps `sv`; tokens with an older `sv` fail. Cost: one in-memory lookup per request, freshness bounded by the cache and stream lag (seconds).',
									confirm: 'Measure end-to-end: disable a test user, time until the gateway rejects.'
								},
								{
									title: 'Short access tokens + revocable refresh tokens',
									body: 'Access tokens of 5–10 minutes with [[refresh-token-rotation|rotating refresh tokens]] checked against the session store. Simple, but the bound is the access-token TTL, not 1 minute, and refresh traffic grows (4 M req/min does not change; refreshes are per session, typically small).'
								},
								{
									title: 'A `jti` denylist',
									body: 'Works but needs the token ids of every live session for the user (you rarely have them) and must be held until each token\'s `exp`. Per-user versions revoke all sessions in one write.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'Do not stop at the gateway: services that accept tokens directly (internal calls, websockets that authenticated once at connect time) must also see revocations. Long-lived websocket sessions are the usual leftover.'
						}
					]
				},
				{
					id: 'a5-oauth-redirect',
					title: 'The preview-environment redirect rule',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'An in-house OAuth server validates `redirect_uri` with the function below. The SPA client is public (no client secret) and does not use [[pkce|PKCE]]. Registered URIs for the web client: `https://app.example.com/callback` and `https://*.preview.example.com/callback` (for preview deployments).'
						},
						{
							type: 'code',
							lang: 'python',
							code: `from fnmatch import fnmatch

def redirect_allowed(client, redirect_uri: str) -> bool:
    for allowed in client.redirect_uris:
        if "*" in allowed:
            if fnmatch(redirect_uri, allowed):
                return True
        elif redirect_uri.startswith(allowed):
            return True
    return False`
						},
						{ type: 'p', text: 'List the weaknesses, explain impact, and give the fixed design.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '`fnmatch`\'s `*` matches dots and slashes',
									body: '`https://attacker.net/x?.preview.example.com/callback` matches `https://*.preview.example.com/callback`. The authorization code (or token) is delivered to a host the attacker controls.'
								},
								{
									title: 'Prefix match on exact URIs',
									body: '`https://app.example.com/callback.attacker.net/...` is not a concern (path), but `https://app.example.com/callback/../logout?next=...` style paths and query-string appends can reach an open redirect on the real host, which then forwards the code. [[redirect-uri-validation|Redirect URIs]] must be compared by exact string equality.'
								},
								{
									title: 'Public client without PKCE',
									body: 'A leaked authorization code can be redeemed by anyone. With PKCE the code is useless without the verifier held in the legitimate browser tab.'
								},
								{
									title: 'Preview wildcards',
									body: 'Every preview deployment (often built from any branch, sometimes from fork PRs) becomes a valid login destination for production identities. Use a separate client registration for previews against a non-production IdP tenant.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fixed design:** exact-match registered URIs only; PKCE required for all clients; [[oauth-state-nonce|`state`]] bound to the user\'s session and single-use; `nonce` checked in the ID token; previews use their own client in a staging tenant, registered automatically per deployment if needed.'
						}
					]
				},
				{
					id: 'a6-confused-deputy',
					title: 'mTLS everywhere, invoices still leak',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'All internal traffic uses [[mtls|mTLS]] with per-service identities. `invoice-service` only accepts calls from `api-gateway` and `pdf-renderer`. A pentest report says any logged-in customer can download any other customer\'s invoice PDF via `GET /reports/render?invoice=8812`. The security team says "impossible, invoice-service authenticates every caller".'
						},
						{
							type: 'code',
							lang: 'go',
							code: `// pdf-renderer
func render(w http.ResponseWriter, r *http.Request) {
    user := auth.UserFrom(r)                 // validated at the gateway
    id := r.URL.Query().Get("invoice")
    inv, err := invoiceClient.Get(r.Context(), id)   // mTLS as pdf-renderer
    if err != nil { http.Error(w, "not found", 404); return }
    _ = user                                 // used for the watermark below
    writePDF(w, inv, user.Email)
}`
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Both sides are right. mTLS proves **which service** is calling, and `pdf-renderer` is allowed. The problem is a [[confused-deputy|confused deputy]]: `pdf-renderer` uses its own authority to fetch whatever invoice the user names, and `invoice-service` has no idea which end user the request is for. Service authentication is not user authorization.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Propagate the end-user context and authorize at the data owner',
									body: 'Forward the user\'s token (or exchange it for a down-scoped internal token naming user and tenant) and have `invoice-service` check `invoice.tenant_id == caller.tenant_id`. The service that owns the data enforces access to it.'
								},
								{
									title: 'Interim: check ownership in pdf-renderer',
									body: 'Fetch with the user\'s tenant as a required filter (`GetForTenant(id, user.TenantID)`). Necessary today, but every future caller must remember it, so not the long-term fix.'
								},
								{
									title: 'Narrow service permissions',
									body: '`pdf-renderer` does not need "read any invoice". With user context it needs "read invoices on behalf of the user in this request".'
								}
							]
						}
					]
				},
				{
					id: 'a7-break-glass',
					title: 'Design break-glass access',
					tag: 'design',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Today, emergency production access is a shared admin password in the team vault "in case SSO is down". Design a replacement that works when the identity provider is down, is auditable, and cannot quietly become everyday access.'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Separate identities per person**, held outside the normal IdP: e.g. hardware-key-protected local accounts or cloud root credentials split with [[mfa-step-up|MFA]] devices held by two people in different locations.',
								'**Two-person rule**: using [[break-glass]] requires a second person to release the credential or approve the session.',
								'**Loud by design**: any use pages security and leadership, opens an incident automatically, and is reviewed within 24 h. Sessions are recorded.',
								'**Time-boxed**: credentials or sessions expire in hours; the account is re-sealed (password rotated, keys re-registered) after every use.',
								'**Tested**: a quarterly drill proves it works with the IdP actually blocked; an untested break-glass path fails on the day you need it.',
								'**Least privilege still applies**: a break-glass role for "restore service" differs from one for "read customer data". Most emergencies need the first.'
							]
						},
						{ type: 'p', text: 'What disappears: the shared password, which gives no attribution and is used quietly "just this once".' }
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Crypto',
			eyebrow: 'Part 2 · 35 minutes',
			title: 'Secrets and cryptography in practice',
			meta: 'KMS · password hashing · nonces · signatures · randomness · pinning',
			minutes: 35,
			questions: [
				{
					id: 'c1-kms-rotation',
					title: 'Rotate the key: how long, how much?',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'A document store uses [[envelope-encryption|envelope encryption]]: each of 2.4 billion objects has its own data key, wrapped by one [[kms|KMS]] key. Compliance requires rotating the KMS key yearly, and the team plans "re-wrap every data key". The KMS account limit is 10,000 requests/s, shared with the application, which uses ~6,000 requests/s at peak for decrypts. KMS costs $0.03 per 10,000 requests.'
						},
						{
							type: 'list',
							items: [
								'How long does the re-wrap take at the full limit? At the realistic spare capacity?',
								'What does it cost?',
								'Does rotating the KMS key protect data if one data key leaked last month?',
								'What would you change in the design?'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['', 'Calculation', 'Result'],
							rows: [
								['Full limit', '2.4 × 10⁹ ÷ 10,000/s', '240,000 s ≈ **66.7 h**'],
								['Spare capacity (4,000/s off-peak and peak blended, optimistic)', '2.4 × 10⁹ ÷ 4,000/s', '600,000 s ≈ **6.9 days**'],
								['Cost', '2.4 × 10⁹ ÷ 10⁴ × $0.03', '**$7,200** per rotation']
							]
						},
						{
							type: 'p',
							text: 'And at full limit the application\'s own decrypts would be throttled, so "66.7 hours" really means an outage. Also note that many managed KMSs support automatic rotation where old key versions stay available for unwrapping and new wraps use the new version, which satisfies most "rotate yearly" requirements with **no** re-wrap at all. Check what the control actually demands before scheduling a week of KMS saturation.'
						},
						{
							type: 'p',
							text: '**Leaked data key:** KEK rotation does nothing for it. The attacker has the plaintext DEK; re-wrapping it under a new KEK still leaves the same DEK protecting the data. The affected objects must be re-encrypted under new DEKs.'
						},
						{
							type: 'p',
							text: '**Design change:** a key hierarchy, e.g. one DEK per tenant per day (40,000 tenants × 365 days ≈ 14.6 M DEKs/year). A full re-wrap is 14.6 × 10⁶ ÷ 4,000 ≈ 3,650 s ≈ 1 h, costs ≈ $44, and per-tenant crypto-shredding becomes a handful of deletes. Cap encryptions per DEK for [[nonce-budget|GCM nonce limits]] when one DEK covers many objects.'
						}
					]
				},
				{
					id: 'c2-bcrypt-capacity',
					title: 'Raise the bcrypt cost before the audit',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'An auditor asks to raise [[bcrypt]] cost from 10 to 13. Benchmarks on your login pods: cost 10 = 70 ms of CPU per hash. Login peak is 400/s (Monday 09:00). The login service runs 32 pods × 2 vCPU (64 cores) and is ~45% CPU at peak today. Last quarter you absorbed a [[credential-stuffing]] wave of 6,000 attempts/s for 20 minutes.'
						},
						{ type: 'p', text: 'What happens at cost 13 on a normal Monday and during a stuffing wave? What do you tell the auditor?' }
					],
					answer: [
						{
							type: 'p',
							text: 'Each +1 doubles work: cost 13 = 70 ms × 2³ = **560 ms** per hash. See [[password-hashing]].'
						},
						{
							type: 'table',
							head: ['Scenario', 'Core-seconds needed per second', 'Cores available', 'Outcome'],
							numeric: [1, 2],
							rows: [
								['Today, cost 10, 400/s', '400 × 0.07 = 28', '64', '28/64 ≈ 44%: matches the ~45% you see'],
								['Cost 13, 400/s', '400 × 0.56 = 224', '64', 'needs 3.5× the fleet; logins queue and time out'],
								['Cost 13, stuffing 6,000/s', '6,000 × 0.56 = 3,360', '64', '52× capacity: complete login outage, a DoS for free'],
								['Cost 10, stuffing 6,000/s', '6,000 × 0.07 = 420', '64', '6.6× capacity: you only survived last quarter if bots were filtered before hashing']
							]
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Agree on the goal, not the number',
									body: 'The auditor wants offline cracking to be expensive. Move to [[argon2|Argon2id]] with memory cost (e.g. 64 MiB, ~100 ms), which costs GPUs far more than CPUs, and re-hash on next successful login.'
								},
								{
									title: 'Put rate limiting and bot filtering before the hash',
									body: '[[rate-limiting|Rate limits]] per account and per network, plus bot challenges at the edge, so the expensive function only runs for plausible humans. Without this, any cost increase raises your DoS exposure.'
								},
								{
									title: 'Capacity plan the chosen cost',
									body: 'If moving to cost 12 (280 ms): 400 × 0.28 = 112 cores at peak, 1.75× today\'s 64: a budget decision, not a config change.'
								}
							]
						}
					]
				},
				{
					id: 'c3-gcm-budget',
					title: 'One key, fifty thousand messages a second',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'A telemetry pipeline encrypts each event with AES-256-GCM using one data key loaded at startup and a random 96-bit nonce per event. Pods run for weeks. The fleet encrypts 50,000 events/s with that same key. A reviewer writes "random nonces are fine, 96 bits is huge". Are they right?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'No. The danger is a nonce **collision** under the same key, and with random nonces the birthday bound arrives long before 2⁹⁶. NIST guidance caps random-nonce GCM at 2³² invocations per key to keep the collision probability negligible (~2⁻³²). See [[nonce-budget]] and [[nonce-reuse]].'
						},
						{
							type: 'table',
							head: ['Quantity', 'Value'],
							rows: [
								['Budget per key', '2³² = 4,294,967,296 encryptions'],
								['Rate', '50,000/s'],
								['Time to exhaust', '4,294,967,296 ÷ 50,000 ≈ 85,899 s ≈ **23.9 h**'],
								['Pods run for', 'weeks → a month of traffic is ~30× the budget']
							]
						},
						{
							type: 'p',
							text: 'A single collision with GCM leaks the XOR of two plaintexts and, worse, lets an attacker recover the authentication key and forge messages under that key.'
						},
						{
							type: 'list',
							items: [
								'Rotate the data key well inside the budget (e.g. every hour, or every 2²⁸ messages, whichever first), via [[envelope-encryption|envelope encryption]] so rotation is cheap.',
								'Or use a counter-based nonce per key with a unique per-pod key (no shared counter needed).',
								'Or use a misuse-resistant mode (AES-GCM-SIV) where a nonce repeat only reveals equality of identical messages.'
							]
						}
					]
				},
				{
					id: 'c4-webhook-verify',
					title: 'The payment webhook handler',
					tag: 'core',
					minutes: 6,
					prompt: [
						{ type: 'p', text: 'Review this handler. Rank the problems.' },
						{
							type: 'code',
							lang: 'python',
							code: `@app.post("/webhooks/payments")
def payments_webhook():
    evt = request.get_json()
    order = Order.get(evt["data"]["order_id"])
    order.mark_paid(amount=evt["data"]["amount"])      # commits
    expected = hmac.new(SECRET, json.dumps(evt).encode(), "sha256").hexdigest()
    if request.headers.get("X-Signature") != expected:
        abort(401)
    return "", 204`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Side effect before verification',
									body: '`mark_paid` commits before the signature is checked. Anyone who can POST to the endpoint marks orders paid; the 401 is cosmetic. Verify first, act second, always.'
								},
								{
									title: 'Verifying re-serialized JSON, not the raw body',
									body: '`json.dumps(evt)` produces different bytes (key order, whitespace, unicode escapes) than the sender signed, so legitimate webhooks fail randomly, and the signature never covers the exact bytes you parsed. Use `request.get_data()` as received. See [[webhook-signature]].'
								},
								{
									title: 'No replay protection',
									body: 'A captured valid webhook can be re-sent forever ([[replay-attack]]). Include and check a signed timestamp (reject if older than ~5 min) and record event ids for dedupe ([[idempotency-key|idempotent]] processing).'
								},
								{
									title: 'Non-constant-time comparison',
									body: '`!=` leaks timing ([[timing-safe-compare]]). Use `hmac.compare_digest`. Lower practical risk over the internet than the others, but free to fix.'
								}
							]
						},
						{
							type: 'code',
							lang: 'python',
							code: `raw = request.get_data()
ts, sig = parse_sig_header(request.headers["X-Signature"])   # "t=...,v1=..."
if abs(time.time() - ts) > 300: abort(401)
expected = hmac.new(SECRET, f"{ts}.".encode() + raw, "sha256").hexdigest()
if not hmac.compare_digest(sig, expected): abort(401)
evt = json.loads(raw)
if seen_event(evt["id"]): return "", 204
process(evt)`
						}
					]
				},
				{
					id: 'c5-reset-token',
					title: 'Password reset tokens',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `import random, time, string

def create_reset_token(user_id):
    random.seed(int(time.time()))
    token = "".join(random.choice(string.ascii_letters) for _ in range(12))
    db.execute("INSERT INTO resets(user_id, token) VALUES (%s, %s)", (user_id, token))
    send_email(user_id, f"https://app.example.com/reset?token={token}")`
						},
						{ type: 'p', text: '12 letters from 52 symbols is about 68 bits. Is this token strong? What else is wrong?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Effective entropy is the seed, not the length',
									body: 'The generator is re-seeded with the current Unix second, so the token is a deterministic function of the time. Anyone who triggers a reset for a victim knows the time to within a few seconds and can compute the handful of possible tokens. Effective strength: a few bits. Use a [[csprng|CSPRNG]]: `secrets.token_urlsafe(32)` (256 bits).'
								},
								{
									title: 'Stored in plaintext',
									body: 'Anyone with database read access (a backup, a replica, an analytics export) can reset any account. Store a hash (SHA-256 is fine for a 256-bit random token) and compare hashes.'
								},
								{
									title: 'No expiry, no single use',
									body: 'Tokens should expire (15–60 min), be invalidated after use and when the password changes, and older tokens should be invalidated when a new one is issued.'
								},
								{
									title: 'Token in a URL',
									body: 'Acceptable for reset links, but make the landing page not load third-party scripts and set `Referrer-Policy: no-referrer` so the token is not leaked in the Referer header.'
								}
							]
						}
					]
				},
				{
					id: 'c6-pinning',
					title: 'The certificate expires in nine days',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Ivo',
								role: 'Mobile lead',
								time: 'Thu 10:12',
								body: `Heads up: our API cert renews automatically in 9 days (90-day certs). The iOS and Android apps pin the leaf certificate's SHA-256 since v6.0. Version stats: 62% on the current release, 38% on releases older than two months and will not update in 9 days. Can we just not renew?`
							}
						},
						{ type: 'p', text: 'What happens on renewal, what are the options in the next 9 days, and what should the long-term policy be?' }
					],
					answer: [
						{
							type: 'p',
							text: 'A renewed leaf has a new certificate (and usually a new key), so every app version pinning the old leaf hash refuses the API: **38% of users lose the app** the moment the new cert is served. Not renewing means the old cert expires and **everyone** breaks. See [[certificate-pinning]].'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Renew with the same key pair, if the pin is on the public key',
									body: 'If the app pins the SPKI (public key) rather than the whole certificate, reissuing a certificate for the existing key keeps old apps working. Check exactly what v6.0 hashes. If it is the full certificate, this does not help.'
								},
								{
									title: 'Serve old apps from a separate endpoint',
									body: 'Keep the old certificate on a legacy hostname or via SNI routing for old app versions while it is still valid, and force-upgrade those versions with a server-driven "update required" screen before it expires.'
								},
								{
									title: 'Ship a release that pins a set: current key, a pre-generated backup key, and the issuing CA\'s key',
									body: 'Old versions still break eventually; you are buying time and fixing it for the future.'
								}
							]
						},
						{
							type: 'p',
							text: '**Policy:** pin public keys (never leaves), always include at least one offline backup key, add a remote kill switch for pinning, and question whether pinning is needed at all; for most apps, standard TLS validation plus Certificate Transparency monitoring is enough.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Supply chain',
			eyebrow: 'Part 3 · 30 minutes',
			title: 'Supply chain and CI',
			meta: 'registries · lockfiles · fork PRs · OIDC trust · signing',
			minutes: 30,
			questions: [
				{
					id: 's1-dep-confusion',
					title: 'Version 99.0.0 of our internal library',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{ type: 'p', text: 'A nightly CI job that regenerates lockfiles printed this. The job has deploy credentials for staging and read access to an artifact bucket.' },
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'ci / nightly-deps #4412',
								lines: [
									{ ts: '02:00:04', msg: '$ rm -f package-lock.json && npm install' },
									{ ts: '02:00:11', msg: 'npm http fetch GET 200 https://npm.internal.acme/acme-utils 41ms' },
									{ ts: '02:00:11', msg: 'npm http fetch GET 200 https://registry.npmjs.org/acme-utils 212ms (via internal proxy upstream)' },
									{ ts: '02:00:12', msg: 'added acme-utils@99.0.0' },
									{ ts: '02:00:12', level: 'INFO', msg: '> acme-utils@99.0.0 postinstall' },
									{ ts: '02:00:12', level: 'INFO', msg: '> node scripts/telemetry.js' },
									{ ts: '02:00:13', msg: 'npm http fetch POST 200 https://t.example-cdn.net/i 88ms' },
									{ ts: '02:00:31', msg: 'added 1,204 packages in 27s' },
									{ ts: '02:00:32', msg: '$ npm test  → 1,912 passed' }
								]
							}
						},
						{ type: 'p', text: 'Internal `acme-utils` is at 2.3.1 and the dependency range is `^2.3.0`. Someone in the channel says "the range should have blocked 99.0.0, so this is just a weird log". What happened, and what do you do in the next hour?' }
					],
					answer: [
						{
							type: 'p',
							text: 'It is not a weird log: `acme-utils@99.0.0` was installed from the **public** registry and its `postinstall` ran and made an outbound POST. This is [[dependency-confusion|dependency confusion]], and the range did not save you because something resolved outside `^2.3.0`: check for a `"*"` or `"latest"` spec in a workspace package, an override, or an alias in another package\'s dependencies. The proxy offers "newest version from either source", and the job deleted the lockfile, so nothing pinned the internal tarball. [[npm-lifecycle-scripts|Install scripts]] then ran with CI\'s environment.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Treat it as an incident now',
									body: 'Assume every secret in the job\'s environment is exposed: rotate the staging deploy credentials and any token the runner could read, revoke the runner\'s cloud session, and preserve the job logs and the package tarball ([[forensic-preservation|evidence]]). Check staging and the artifact bucket audit logs from 02:00 onward. Look for persistence (new keys, modified artifacts).',
									confirm: 'Find every job and developer machine that resolved `acme-utils@99.0.0` (proxy logs give you the list).'
								},
								{
									title: 'Block at the proxy',
									body: 'Never fetch internal package names from upstream: deny-list the namespace at the proxy, and report the package to the registry.'
								},
								{
									title: 'Fix resolution permanently',
									body: 'Move internal packages to a scope (`@acme/utils`) mapped to the internal registry in `.npmrc`; keep [[lockfile-integrity|lockfiles]] and use `npm ci` everywhere; regenerate lockfiles in a sandbox with no secrets and review the diff before merge; claim placeholder names publicly.'
								}
							]
						}
					]
				},
				{
					id: 's2-lockfile-pr',
					title: '"Bump lodash" from a first-time contributor',
					tag: 'core',
					minutes: 6,
					prompt: [
						{ type: 'p', text: 'The PR title is "chore: bump lodash to 4.17.22 (security fix)". CI is green. The only change is in the lockfile:' },
						{
							type: 'code',
							lang: 'text',
							code: `   "node_modules/lodash": {
-    "version": "4.17.21",
-    "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
-    "integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=="
+    "version": "4.17.22",
+    "resolved": "https://registry.npmjs-cdn.org/lodash/-/lodash-4.17.22.tgz",
+    "integrity": "sha512-Qm9Yy0r7Xh1sJb2n6wq3Zg0e3cX1vR8mT4pLk2aB5dN7fH6jK9sW1uE3iO0pQ7rT2yU4vX6zA8cB0dE2fG4hJ=="
   },`
						},
						{ type: 'p', text: 'What do you flag, and what control would have caught it without a human noticing?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '`resolved` points at a different host',
									body: '`registry.npmjs-cdn.org` is not the npm registry; it is a [[lookalike-domain|look-alike]]. `npm ci` will faithfully download from that URL and verify against the integrity hash **the attacker also supplied**, so integrity checks pass. [[lockfile-integrity|Lockfile integrity]] only protects you if the lockfile is trusted.'
								},
								{
									title: 'The claimed version may not exist upstream',
									body: 'Verify 4.17.22 exists on the real registry and its published integrity matches. Security-fix pretexts are a common social-engineering wrapper.'
								},
								{
									title: 'Lockfile-only diffs from new contributors',
									body: 'Reviewers skip lockfile diffs. Treat lockfile changes as code changes, and prefer dependency bumps made by your own bot.'
								}
							]
						},
						{
							type: 'p',
							text: '**Automated control:** a CI check (e.g. lockfile-lint) that fails if any `resolved` host is outside an allowlist, plus re-resolving the declared version from the trusted registry and comparing integrity hashes. Also block egress from CI to unknown registries.'
						}
					]
				},
				{
					id: 's3-prt',
					title: 'The workflow that labels PRs',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'code',
							lang: 'yaml',
							code: `name: pr-preview
on:
  pull_request_target:
    types: [opened, synchronize]
permissions:
  contents: write
  pull-requests: write
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm ci && npm run build
      - run: ./scripts/deploy-preview.sh
        env:
          PREVIEW_DEPLOY_TOKEN: \${{ secrets.PREVIEW_DEPLOY_TOKEN }}
          NPM_TOKEN: \${{ secrets.NPM_PUBLISH_TOKEN }}`
						},
						{ type: 'p', text: 'The repo is public. The team chose `pull_request_target` "so that fork PRs get previews too". What is the risk, and how do you keep previews for forks safely?' }
					],
					answer: [
						{
							type: 'p',
							text: '[[pull-request-target|`pull_request_target`]] runs in the base repository\'s context: it gets repository secrets and a write-scoped token. The workflow then checks out **the fork\'s code** and runs `npm ci && npm run build`, so any fork author can put code in `package.json` scripts or the build that runs with `PREVIEW_DEPLOY_TOKEN`, `NPM_PUBLISH_TOKEN` (publish your package!) and a token that can push to the repo.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Immediate',
									body: 'Disable the workflow; rotate `NPM_PUBLISH_TOKEN` and `PREVIEW_DEPLOY_TOKEN`; audit npm publish history, repo pushes and tags since the workflow was added; check past runs triggered by forks.'
								},
								{
									title: 'Split privilege from untrusted code',
									body: 'Build fork PRs under `pull_request` (no secrets, read-only token). Upload the built static artifact. A separate `workflow_run` job with deploy rights downloads the **artifact** (treated as data, never executed) and deploys it to an isolated preview domain.'
								},
								{
									title: 'Least privilege everywhere',
									body: 'The publish token never belongs in a preview job. Use [[ci-oidc-federation|OIDC]] scoped to the release workflow and a protected environment with required reviewers.'
								}
							]
						}
					]
				},
				{
					id: 's4-oidc-trust',
					title: 'Keyless deploys, wide-open trust policy',
					tag: 'core',
					minutes: 6,
					prompt: [
						{ type: 'p', text: 'The team removed static AWS keys from CI and uses GitHub OIDC. The production deploy role trusts:' },
						{
							type: 'code',
							lang: 'json',
							code: `{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::4417...:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringLike": { "token.actions.githubusercontent.com:sub": "repo:acme/*" }
  }
}`
						},
						{ type: 'p', text: 'The role has `AdministratorAccess` "because deploys touch many services". What can go wrong and what would you change?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '`repo:acme/*` trusts every repository in the org, on every branch and event',
									body: 'Any of 400 repos, any branch, any PR workflow (including a newly created repo by any member, or a compromised low-value repo) can assume production admin. [[ci-oidc-federation|OIDC federation]] moved the secret into the trust policy\'s conditions.'
								},
								{
									title: 'No audience condition',
									body: 'Add `token.actions.githubusercontent.com:aud = sts.amazonaws.com` so tokens minted for other audiences cannot be used.'
								},
								{
									title: 'Administrator permissions',
									body: 'Deploy roles need deploy permissions: update specific services, push to specific registries, pass specific execution roles. [[least-privilege|Least privilege]], and a [[permission-boundary]] to cap what the role can grant.'
								}
							]
						},
						{
							type: 'code',
							lang: 'json',
							code: `"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:acme/payments-api:environment:production"
  }
}`
						},
						{ type: 'p', text: 'Binding to a GitHub **environment** lets you require reviewers and restrict which branches can deploy, so the trust is "the protected release process of one repo".' }
					]
				},
				{
					id: 's5-signing',
					title: 'We sign images, so we are safe',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'Admission control in the cluster verifies [[artifact-signing|image signatures]] with this policy:' },
						{
							type: 'code',
							lang: 'yaml',
							code: `verifyImages:
  - imageReferences: ["registry.acme.io/*"]
    attestors:
      - keyless:
          issuer: https://token.actions.githubusercontent.com
          subjectRegExp: ".*"
    mutateDigest: false
    verifyDigest: false`
						},
						{ type: 'p', text: 'Deployments reference `registry.acme.io/payments:release`. What does this policy actually guarantee?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Any GitHub Actions workflow anywhere can produce an acceptable signature',
									body: '`subjectRegExp: ".*"` with the public GitHub issuer accepts signatures from **any** repository on GitHub, including an attacker\'s. Pin the subject to your release workflow: `https://github.com/acme/payments/.github/workflows/release.yml@refs/tags/v*`.'
								},
								{
									title: 'Tags, not digests',
									body: 'With `verifyDigest: false` and a [[mutable-image-tag|mutable tag]], the signature checked and the image run can differ (a re-pushed `release` tag). Resolve and pin to the [[image-digest|digest]] (`mutateDigest: true`, `verifyDigest: true`).'
								},
								{
									title: 'Signature ≠ provenance',
									body: 'A signature says who signed. [[slsa|SLSA]] provenance attestations say what source commit and builder produced the image; verify those too, then an attacker needs to compromise your release workflow itself, not just obtain any signing identity.'
								}
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Respond',
			eyebrow: 'Part 4 · 45 minutes',
			title: 'Detection and response',
			meta: 'timelines · containment · blast radius · logging · alert quality · comms',
			minutes: 45,
			questions: [
				{
					id: 'r1-timeline',
					title: 'Reconstruct the account takeover',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{ type: 'p', text: 'A customer admin says their CRM data was exported by "someone who is not us". Logs for their account on the incident day:' },
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								title: 'audit-* · account 30117',
								query: 'account_id:30117 AND event.category:(iam OR auth OR data)',
								histogram: { x: tx, counts: txCounts, errors: txErrors },
								lines: [
									{ ts: '09:31:02', level: 'INFO', source: 'support-console', msg: 'agent=k.ross changed email for user u-88 (admin) ', fields: { ticket: 'ZD-55102', old: 'm.lee@customer.com', new: 'm.lee.customer@outlook.com', reason: 'lost access to mailbox' } },
									{ ts: '09:31:40', level: 'INFO', source: 'auth', msg: 'password_reset_requested user=u-88', fields: { delivered_to: 'm.lee.customer@outlook.com' } },
									{ ts: '09:33:15', level: 'INFO', source: 'auth', msg: 'password_reset_completed user=u-88', fields: { ip: '102.89.x.x', asn: 'AS37148 (new)' } },
									{ ts: '09:33:51', level: 'WARN', source: 'auth', msg: 'mfa_challenge_failed user=u-88', fields: { method: 'totp' } },
									{ ts: '09:34:20', level: 'INFO', source: 'support-console', msg: 'agent=k.ross reset MFA for user u-88', fields: { ticket: 'ZD-55102' } },
									{ ts: '09:36:02', level: 'INFO', source: 'auth', msg: 'login_success user=u-88', fields: { ip: '102.89.x.x', mfa: 'enrolled_new_device' } },
									{ ts: '09:41:47', level: 'INFO', source: 'api', msg: 'api_token_created user=u-88 name="backup-sync"', fields: { scopes: 'contacts:read,deals:read' } },
									{ ts: '10:12:08', level: 'INFO', source: 'export', msg: 'bulk_export contacts rows=18402', fields: { ip: '45.61.x.x', auth: 'api_token backup-sync' } },
									{ ts: '10:13:30', level: 'INFO', source: 'export', msg: 'bulk_export deals rows=6210', fields: { ip: '45.61.x.x', auth: 'api_token backup-sync' } }
								]
							}
						},
						{ type: 'p', text: 'What was the initial access, what must be contained now, and what else would you check?' }
					],
					answer: [
						{
							type: 'p',
							text: '**Initial access was the support desk, not the product.** A caller convinced agent k.ross to change the admin\'s email to an attacker-controlled address (09:31), received the reset link, then got the same agent to reset MFA (09:34) after a failed challenge. Every step was a legitimate feature used as designed: an [[abuse-case|abuse case]] of account recovery.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Contain the persistence, not just the login',
									body: 'Revoke the `backup-sync` API token (the attacker used it from a **different** IP at 10:12; resetting the password alone leaves it working), revoke all sessions for u-88, restore the original email, re-enroll MFA with the real admin over a verified channel. See [[incident-containment]].'
								},
								{
									title: 'Scope',
									body: 'Search for other `api_token_created`, OAuth app grants, new users, webhook endpoints or mail-forwarding rules on this account since 09:31. Search **other accounts** for support-console email changes followed within minutes by resets from new ASNs: the caller may have repeated the playbook.'
								},
								{
									title: 'Notify',
									body: '18,402 contact records left: a [[personal-data-breach|personal-data breach]] for the customer (controller) and likely for you as processor. Start the legal notification clock now; preserve logs.'
								},
								{
									title: 'Fix the process',
									body: 'Support may not change email and reset MFA on the same ticket; admin email changes require verification through the old address or a second admin; MFA reset forces a cooling-off period and notifies all admins; support actions on admin accounts need a second agent\'s approval.'
								}
							]
						}
					]
				},
				{
					id: 'r2-compromised-vm',
					title: 'GuardDuty says the batch host is mining crypto',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'An alert says an EC2 instance in the analytics VPC is talking to a known mining pool. The instance has an instance role that can read the data lake. An engineer proposes "terminate it, the autoscaling group will replace it". Rank your containment steps.'
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Isolate, do not terminate',
									body: 'Swap its security groups to a quarantine group (no egress, inbound only from the forensics host) and detach it from the ASG and load balancer (so the ASG does not replace and keep running the same vulnerable image). Terminating destroys memory, process state and disk: the answer to "how did they get in, and what did they take?". See [[forensic-preservation]].'
								},
								{
									title: 'Capture evidence',
									body: 'Snapshot EBS volumes, capture memory if tooling exists, export the instance\'s [[cloudtrail|CloudTrail]] and [[vpc-flow-logs|VPC Flow Logs]] history.'
								},
								{
									title: 'Revoke the role\'s live credentials',
									body: 'Isolation does not stop credentials already exfiltrated from the [[instance-metadata|metadata service]]. Add a deny policy on the role for tokens issued before now (`aws:TokenIssueTime`), then check the data-lake access logs for that role from unexpected IPs. Mining is often the noisy part; data access is the quiet part.'
								},
								{
									title: 'Find the entry point before rebuilding',
									body: 'Same image + same exposure = reinfection in hours. Patch, then rebuild from a known-good image.'
								}
							]
						}
					]
				},
				{
					id: 'r3-blast-radius',
					title: 'How far can this role reach?',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{ type: 'p', text: 'Credentials for role `ci-runner` were exposed. Using the IAM data below, list every role an attacker can end up with, and the path.' },
						{
							type: 'table',
							head: ['Role', 'Can assume / pass', 'Notable permissions'],
							rows: [
								['ci-runner', 'sts:AssumeRole → deploy-staging', 'ecr:Push (all repos)'],
								['deploy-staging', 'iam:PassRole → lambda-exec-*', 'lambda:CreateFunction, lambda:InvokeFunction'],
								['lambda-exec-reports', '—', 's3:GetObject on reports-prod'],
								['lambda-exec-ops', 'sts:AssumeRole → ops-admin', 'logs:*'],
								['ops-admin', '—', 'AdministratorAccess (prod)'],
								['deploy-prod', 'trusts: release pipeline only', 'ecs:UpdateService (prod)']
							]
						},
						{ type: 'p', text: 'Also: production ECS services pull images from the same ECR repositories as staging, by tag.' }
					],
					answer: [
						{
							type: 'p',
							text: 'Do the transitive closure, including permissions that let you **run code as** another role. See [[blast-radius]] and [[iam-evaluation]].'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'ci-runner → deploy-staging → (PassRole + CreateFunction) → lambda-exec-ops → ops-admin',
									body: '`iam:PassRole` on `lambda-exec-*` plus `lambda:CreateFunction` lets the attacker create a function that runs as `lambda-exec-ops`, which can assume `ops-admin`. **Production admin in three hops.** PassRole wildcards are the classic privilege-escalation edge.'
								},
								{
									title: 'ci-runner → … → lambda-exec-reports',
									body: 'Same trick: production report data readable.'
								},
								{
									title: 'ci-runner → ecr:Push → production',
									body: 'No role assumption needed: push a malicious image under a tag production uses, and prod ECS runs it with **its** task roles on the next deploy or restart. `deploy-prod`\'s trust restriction does not matter if the attacker controls what it deploys. Fix with [[image-digest|digest]]-pinned deploys, separate prod repositories, and signature verification.'
								}
							]
						},
						{
							type: 'p',
							text: '**Contain:** revoke `ci-runner` sessions; audit CloudTrail for `CreateFunction`, `AssumeRole` into ops-admin, and ECR pushes since exposure. **Fix:** PassRole to exact role ARNs, no role that both passes roles and creates compute unless intended, [[scp|SCP]] guardrails, and periodic automated privilege-escalation path analysis.'
						}
					]
				},
				{
					id: 'r4-log-review',
					title: 'The request logger',
					tag: 'core',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'This middleware ships logs to a third-party log SaaS. What would you change before an auditor or an attacker reads those logs?' },
						{
							type: 'code',
							lang: 'typescript',
							code: `app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      method: req.method,
      url: req.originalUrl,              // e.g. /reset?token=..., /export?api_key=...
      headers: req.headers,              // includes authorization, cookie
      body: req.body,                    // login: { email, password }
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
});`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Credentials in logs',
									body: 'Authorization headers, cookies, passwords in bodies and tokens in query strings are all credentials. A log SaaS breach or an over-permissioned analyst becomes an account takeover. Allowlist headers to log; never log bodies by default; redact known secret query parameters (`token`, `api_key`, `code`).'
								},
								{
									title: 'Missing the fields investigations need',
									body: 'No user id, tenant id, session id, source IP, user agent or request id. [[security-logging|Security logs]] answer "who did what to which object, from where".'
								},
								{
									title: 'PII minimization',
									body: 'Emails and payloads are [[pii|personal data]] sent to a processor; keep only what is needed, set retention, and classify the log stream accordingly.'
								},
								{
									title: 'Remediate history',
									body: 'Changing the code does not clean existing logs: purge or restrict historical indexes and rotate any credential types that appeared (session secrets, API keys).'
								}
							]
						}
					]
				},
				{
					id: 'r5-alert-fatigue',
					title: '1,200 alerts a day',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'SOC · alert volume by rule',
								range: 'Oct 01 – Oct 14',
								panels: [
									{
										kind: 'bars',
										title: 'Alerts per day by rule',
										span: 4,
										x: days,
										stacked: true,
										series: [
											{ name: 'login from new country', points: geoAlerts },
											{ name: '> 10 failed logins', points: failedLoginAlerts },
											{ name: 'S3 bucket policy changed', points: s3PublicAlerts },
											{ name: 'IAM user/key created', points: iamChangeAlerts }
										]
									},
									{ kind: 'stat', title: 'Alerts / day', value: '1,200', span: 1 },
									{ kind: 'stat', title: 'Confirmed incidents (90 d)', value: '432', delta: '0.4% of alerts', tone: 'warn', span: 1 },
									{
										kind: 'table',
										title: 'Precision by rule (last 90 days)',
										span: 6,
										head: ['Rule', 'Alerts/day', 'True positives (90 d)', 'Median time to triage'],
										numeric: [1, 2],
										rows: [
											['login from new country', '610', '9', '3 h 40 m'],
											['> 10 failed logins', '380', '2', '5 h 10 m'],
											['S3 bucket policy changed', '140', '61', '2 h 05 m'],
											['IAM user/key created', '70', '360', '1 h 30 m']
										]
									}
								]
							}
						},
						{ type: 'p', text: 'The team has 3 analysts. Leadership asks to "add more rules for better coverage". What does the data say, and what would you do?' }
					],
					answer: [
						{
							type: 'p',
							text: 'Overall precision: 432 true positives ÷ (1,200 × 90 = 108,000 alerts) = **0.4%**, i.e. ~4.8 real incidents per day buried in 1,195 false ones. With 3 analysts that is ~400 alerts each per day: [[alarm-fatigue|alert fatigue]] guarantees the real ones wait hours. Adding rules lowers [[positive-predictive-value|precision]] further.'
						},
						{
							type: 'table',
							head: ['Rule', 'Alerts in 90 d', 'True positives', 'Precision'],
							numeric: [1, 2, 3],
							rows: [
								['new country', '54,900', '9', '0.016%'],
								['failed logins', '34,200', '2', '0.006%'],
								['S3 policy changed', '12,600', '61', '0.48%'],
								['IAM user/key created', '6,300', '360', '**5.7%**']
							]
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Demote the two noisy rules to signals, not pages',
									body: '"New country" and "failed logins" become inputs to a risk score (new country **and** MFA reset **and** token creation within 1 h = alert). Combining weak signals raises precision dramatically.'
								},
								{
									title: 'Route the high-precision rule to the front of the queue',
									body: 'The rule with 5.7% precision (and the most incidents) currently waits 1.5 h. Sort by expected value, not arrival time.'
								},
								{
									title: 'Auto-close with context',
									body: 'S3 policy changes made by the deploy pipeline role with a matching change ticket can be enriched and auto-closed; human review only for out-of-band changes.'
								}
							]
						},
						{ type: 'p', text: 'Coverage is "the incidents you catch in time", not "the number of rules". Report it that way to leadership.' }
					]
				},
				{
					id: 'r6-ciso',
					title: '"Are we affected?"',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Dana Whitfield',
								role: 'CISO',
								subject: 'xmlkit CVE: are we affected?',
								time: 'Fri 07:48',
								body: `The board chair forwarded a news article about the critical xmlkit vulnerability (CVE-2026-31337, CVSS 9.8, versions < 2.9.14, remote code execution when parsing untrusted XML with external entities enabled).

I need a yes/no for the 10:00 exec call and what we are doing about it.`
							}
						},
						{ type: 'p', text: 'Your [[sbom|SBOM]] query across deployed images returns:' },
						{
							type: 'table',
							head: ['Service', 'xmlkit version', 'How it is used', 'Exposure'],
							rows: [
								['invoice-import', '2.9.10 (transitive via sheetlib)', 'Parses XML invoices **uploaded by customers**', 'Internet-facing upload'],
								['report-builder', '2.9.12', 'Parses its own bundled XML templates at startup', 'Internal only'],
								['dev-cli', '2.9.8', 'Developer tool, not deployed', 'Laptops / CI'],
								['billing-api', '2.9.15', '—', '—']
							]
						},
						{ type: 'p', text: 'Write the triage and the reply.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'invoice-import: affected, treat as urgent',
									body: 'Vulnerable version, attacker-controlled input, internet reachable. Check whether external entities are enabled in its parser config (they often are by default in older versions). Patch/rebuild today; until then disable XML uploads or enable the parser hardening flag; review logs for suspicious uploads since disclosure. See [[vulnerability-reachability]].'
								},
								{
									title: 'report-builder: vulnerable version, not currently reachable',
									body: 'Only parses bundled templates. Patch in the normal cycle this week, and record **why** it is not reachable (evidence, not opinion).'
								},
								{
									title: 'dev-cli: patch, low priority',
									body: 'Could matter if a developer opens a malicious XML file; update the tool and notify developers.'
								},
								{ title: 'billing-api: not affected', body: 'Version ≥ 2.9.14.' }
							]
						},
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'You',
								role: 'Security engineering',
								subject: 'Re: xmlkit CVE: are we affected?',
								body: `Short answer: yes, one internet-facing service is affected; we are mitigating now.

- invoice-import uses a vulnerable xmlkit version to parse customer-uploaded invoices. XML uploads are disabled as of 08:30 while we deploy the patched build (ETA 11:00). We are reviewing upload logs since the disclosure date for signs of exploitation; nothing found so far, next update 12:00.
- Two other components have the vulnerable version but do not process untrusted XML; they will be patched this week.
- Everything else either does not use xmlkit or already runs a fixed version.

Customer impact so far: invoice XML uploads paused for roughly 3 hours; CSV upload still works.`
							}
						}
					]
				},
				{
					id: 'r7-phish',
					title: 'A customer forwards a suspicious invoice email',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Tomasz Wiśniewski',
								role: 'Customer, accounts payable',
								subject: 'Is this invoice from you??',
								time: 'Mon 11:05',
								body: `We received an email from billing@acme-invoices.co saying our bank details changed and asking us to pay invoice INV-20817 to a new IBAN. It has your logo and the invoice number looks right. Is this real? We pay invoices on Wednesdays.`
							}
						},
						{ type: 'p', text: 'Your real billing domain is `acme.com`, which publishes SPF, DKIM and `DMARC p=reject`. What do you check, what do you do, and what do you reply?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'It is a look-alike domain; your DMARC cannot stop it',
									body: '[[email-authentication|SPF, DKIM and DMARC]] protect `acme.com` from being forged. `acme-invoices.co` is a different domain the attacker controls and can authenticate perfectly. See [[lookalike-domain]].'
								},
								{
									title: 'The real invoice number is the alarming part',
									body: 'A correct invoice number suggests the attacker saw real correspondence: a compromised mailbox at the customer, at you, or at a shared vendor. Check whether INV-20817 data could have leaked from your side (support tickets, an exposed invoice link, an employee mailbox).'
								},
								{
									title: 'Act',
									body: 'Request takedown from the registrar and hosting provider; add the domain to brand monitoring; warn other customers who receive invoices that week if your side leaked; never change bank details by email and say so on invoices.'
								}
							]
						},
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'You',
								role: 'Acme Support',
								subject: 'Re: Is this invoice from you??',
								body: `Thank you for checking with us. That email is not from Acme, and our bank details have not changed. Please do not pay to the new IBAN.

Our invoices only come from addresses ending in @acme.com. If you ever receive a request to change payment details, please confirm by phone using the number in your contract, not one from the email.

We are investigating how the sender knew your invoice number and will let you know what we find. If any payment has already been sent, contact your bank immediately to request a recall.`
							}
						}
					]
				},
				{
					id: 'r8-notify',
					title: 'Legal asks: when does the clock start?',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'In the account-takeover incident above, engineering confirmed at 14:00 Monday that 18,402 customer contact records were exported. The investigation will take days. Legal asks what to send to the regulator and when, given that "we don\'t know everything yet". (Assume GDPR applies.)'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Clock:** GDPR gives the controller 72 hours from becoming **aware** of a [[personal-data-breach|personal-data breach]], and confirmation at 14:00 Monday is awareness. If you are the processor, you must notify the controller (your customer) **without undue delay**, which in practice means today.',
								'**Incomplete is allowed:** the initial notification can be phased. State what is known (nature, categories and approximate number of records and people, likely consequences, measures taken), what is not yet known, and when you will update.',
								'**Engineering\'s job:** a written timeline with evidence, the exact data fields exported, containment actions with times, and the scope search results for other accounts.',
								'**Do not:** speculate about attribution, minimize ("only contact details") before you know what fields were included, or let the 72 h pass waiting for certainty.',
								'Separate this from [[coordinated-disclosure|vulnerability disclosure]], which is about reporting and fixing weaknesses; this is a legal duty triggered by actual compromise.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · Threats',
			eyebrow: 'Part 5 · 25 minutes',
			title: 'Threat modeling',
			meta: 'STRIDE · abuse cases · enumeration · classification',
			minutes: 25,
			questions: [
				{
					id: 't1-stride',
					title: 'Threat-model the public share links',
					tag: 'design',
					minutes: 8,
					prompt: [
						{
							type: 'p',
							text: 'A file-sharing product is adding "anyone with the link can view" for documents. Proposed flow:'
						},
						{
							type: 'flow',
							steps: [
								{ label: 'Owner clicks Share', note: 'POST /docs/:id/links' },
								{ label: 'API', note: 'creates link id' },
								{ label: 'Link: /s/{id}', note: 'id = doc id base62' },
								{ label: 'Viewer opens link', note: 'no login' },
								{ label: 'Renderer', note: 'converts to PDF, caches on CDN 24 h', tone: 'warn' }
							]
						},
						{ type: 'p', text: 'Use [[stride|STRIDE]] to list the five most important threats, ranked, with mitigations.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Information disclosure: guessable links',
									body: 'Link id = document id in base62: sequential, so links are enumerable and every document has a predictable public URL once sharing exists. Link ids must be independent random tokens (≥ 128 bits from a [[csprng|CSPRNG]]) stored separately from document ids.'
								},
								{
									title: 'Information disclosure: revocation does not reach the CDN',
									body: 'Disabling a link while the rendered PDF stays cached on the [[cdn|CDN]] for 24 h means "unshare" does not work. Use short TTLs with purge on revoke, or serve through a check that hits the origin.'
								},
								{
									title: 'Elevation of privilege: link grants more than view',
									body: 'Make sure the token authorizes only `view` of that document version: not comments with the owner\'s identity, not sibling documents, not the edit API.'
								},
								{
									title: 'Denial of service: renderer cost',
									body: 'Unauthenticated viewers can trigger expensive PDF rendering of huge documents; rate limit per link and per IP, cap document size, render asynchronously.'
								},
								{
									title: 'Repudiation: who viewed?',
									body: 'Owners will ask who saw a leaked document. Log link views (IP, time, user agent; account if logged in) and show them to owners; support link expiry and "require sign-in" for sensitive data.'
								}
							]
						},
						{ type: 'p', text: 'Spoofing and tampering matter less here (view-only, no identity), and saying so is part of a good answer.' }
					]
				},
				{
					id: 't2-referrals',
					title: 'Referral credits',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Product launches "Give $20, get $20": a new customer who signs up with a referral link gets $20 credit, and the referrer gets $20 after the new customer\'s first payment. Credit can pay for any plan, including the $15/month plan. Write the abuse cases you would raise in the design review.'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Self-referral farms:** one person creates many accounts with throwaway emails and prepaid cards. Each "first payment" of $15 can itself be paid with the new account\'s $20 credit, so the referrer earns $20 for zero real money. **Fix:** the qualifying first payment must be at least $X **from a payment method**, not credit.',
								'**Card reuse:** the same card or device across referred accounts; require unique payment fingerprints per referral chain.',
								'**Credit cash-out:** credit buys gift subscriptions or transferable seats that can be resold.',
								'**Refund loop:** pay, trigger the referrer bonus, then refund or charge back. Credit should vest only after the refund window.',
								'**Velocity:** cap referrals per referrer per month, and hold credits for review above a threshold.',
								'Each of these is an [[abuse-case|abuse case]]: no bug, no vulnerability scanner will find it, and all of them are cheaper to prevent in the design than to claw back later.'
							]
						}
					]
				},
				{
					id: 't3-enumeration',
					title: 'Password-reset traffic at 02:14',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'auth · reset & login',
								range: '02:00 – 03:00 UTC',
								panels: [
									{
										kind: 'timeseries',
										title: 'POST /password-reset per minute',
										span: 3,
										x: lx,
										series: [{ name: 'requests', points: resetRequests }],
										markers: [{ at: 14, label: 'spike' }]
									},
									{
										kind: 'timeseries',
										title: 'Distinct source IPs per minute (reset)',
										span: 3,
										x: lx,
										series: [{ name: 'IPs', points: resetIps, color: 2 }]
									},
									{
										kind: 'timeseries',
										title: 'Failed logins per minute',
										span: 3,
										x: lx,
										series: [{ name: 'failed', points: loginFails, color: 3 }]
									},
									{
										kind: 'table',
										title: 'Reset responses during spike',
										span: 3,
										head: ['Status', 'Body', 'p50 latency', 'Share'],
										numeric: [2, 3],
										rows: [
											['200', '"Check your email"', '310 ms', '22%'],
											['200', '"Check your email"', '9 ms', '78%']
										]
									}
								]
							}
						},
						{ type: 'p', text: 'There is a per-IP limit of 20 resets/hour. Failed logins are flat. Is anything being attacked? What would you change?' }
					],
					answer: [
						{
							type: 'p',
							text: 'Yes: **[[account-enumeration|account enumeration]] through response timing**. The body is identical for all responses, but existing accounts take ~310 ms (token generation, DB write, email enqueue) and unknown emails return in 9 ms. Roughly 2,100 requests/min from ~1,900 IPs is ~1 request per IP per minute, so the per-IP limit never fires. 22% of the tested emails exist; that list will feed [[credential-stuffing]] or targeted phishing next, which is why failed logins are still flat.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Equalize the work',
									body: 'Respond immediately for every request and do the work asynchronously (enqueue a job for both known and unknown emails), so latency carries no signal.'
								},
								{
									title: 'Limit on the right keys',
									body: 'Per-IP limits fail against distributed traffic. Add global limits on the endpoint, per-target-email limits, bot challenges when global volume is anomalous, and per-ASN or per-/64 IPv6 aggregation.'
								},
								{
									title: 'Close the other doors',
									body: 'Signup ("email already registered") and login ("no such user") often leak the same fact. Fix all three or none.'
								}
							]
						}
					]
				},
				{
					id: 't4-classify',
					title: 'Classify these fields',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'Your scheme: Public, Internal, Confidential, Restricted. Restricted data may not be copied to analytics or logs and needs approval to access. Classify each field of the `customers` export the data team wants for a churn model, and say which can go to the warehouse and how.'
						},
						{
							type: 'table',
							head: ['Field', 'Example'],
							rows: [
								['customer_id', '`c_8812`'],
								['email_sha256', 'unsalted SHA-256 of email'],
								['plan', '`pro`'],
								['last_login_ip', '`102.89.14.7`'],
								['card_last4', '`4242`'],
								['support_ticket_text', 'free text'],
								['date_of_birth', '`1988-04-12`']
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Field', 'Class', 'Warehouse?'],
							rows: [
								['customer_id', 'Internal', 'Yes; it is a pseudonym only if the mapping stays protected'],
								['email_sha256', '**Confidential** (still personal data)', 'Not as-is: an unsalted hash of an email is reversible by hashing candidate emails. Use a keyed HMAC with a key the warehouse cannot access, or drop it'],
								['plan', 'Internal', 'Yes'],
								['last_login_ip', 'Confidential', 'Truncate to /24 or country for churn modeling'],
								['card_last4', 'Confidential (PCI scope is limited, but it identifies)', 'Not needed for churn: drop'],
								['support_ticket_text', '**Restricted** (can contain anything: health, passwords, payment data)', 'No raw text. Derive features (ticket count, sentiment score) inside a restricted environment'],
								['date_of_birth', 'Restricted', 'Bucket into age bands']
							]
						},
						{
							type: 'p',
							text: 'The trap answers: "hashed = anonymous" and "the data team is internal so Internal data rules apply". [[data-classification|Classification]] follows the data, not the team, and minimization ("does the model need it?") removes most of the debate.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 6 ─────────────────────────
		{
			id: 'p6',
			nav: '6 · Lab',
			eyebrow: 'Part 6 · 15 minutes · interactive',
			title: 'Lab: a leaked access key',
			meta: 'contain without breaking production',
			minutes: 15,
			questions: [
				{
					id: 'lab-leaked-key',
					title: 'Secret scanning just paged you',
					tag: 'tricky',
					minutes: 15,
					prompt: [{ type: 'lab', lab: leakedKey }],
					hints: [
						'The leaked key is also production\'s credential. What can block the attacker but not production?',
						'Exfiltration did not stop when you thought you contained it? Something else may be making calls. Read CloudTrail.'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Contain first, with a condition production satisfies',
									body: 'An inline deny on the user for requests from outside the corp NAT ranges lands in seconds, stops the attacker\'s calls (they come from Tor exit nodes), and leaves billing working. Deactivating the key first is also defensible (containment over availability), but it takes billing down until you move it to another credential.'
								},
								{
									title: 'Move billing off static keys',
									body: 'The task role already had the permissions. Switching to it removes the dependency on the leaked key permanently, rather than replacing one static key with another ([[workload-identity]]).'
								},
								{
									title: 'Deactivate the leaked key; keep the user',
									body: 'Deleting the user is the trap: billing breaks instantly and you lose the identity that maps CloudTrail events to the key during the investigation. Deactivate keys; delete identities after the post-incident review.'
								},
								{
									title: 'Read CloudTrail and look for persistence',
									body: 'If you were slower than ~90 s, the attacker used the key to create a second key on `deploy-bot` (an admin user). Containing the first key does nothing about it; you either deactivate that key or apply an account-wide IP [[scp|SCP]] (which also breaks vendors calling from their own IPs, a real trade-off).'
								}
							]
						},
						{
							type: 'p',
							text: '**After the incident:** scope what was read from `customer-exports` (enable S3 data events if they were off), decide on breach notification, remove remaining IAM users with [[access-key|access keys]], require secret scanning push protection, and add an alert on `CreateAccessKey` by anything but the provisioning pipeline. See [[incident-containment]].'
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'teasers',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Rapid fire',
			minutes: 10,
			questions: [
				{
					id: 'x1',
					title: '"The database is encrypted at rest, so SQL injection can\'t leak data"',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Wrong. Encryption at rest protects disks and backups from someone who steals the storage. SQL injection runs through the application\'s authenticated connection, and the database decrypts transparently for it.'
						}
					]
				},
				{
					id: 'x2',
					title: 'A 6-digit OTP with no attempt limit',
					tag: 'teaser',
					minutes: 2,
					prompt: [{ type: 'p', text: 'An attacker can try 1,000 codes/s against one account. How long, on average, to guess a code that stays valid for 10 minutes?' }],
					answer: [
						{
							type: 'p',
							text: '10⁶ codes, expected half the space: 500,000 tries ÷ 1,000/s = **500 s ≈ 8.3 min**, inside the 10-minute validity. In 10 minutes they try 600,000 codes: a 60% chance per issued code. Limit attempts per code (e.g. 5, then invalidate) and per account; 5 tries gives a 0.0005% chance.'
						}
					]
				},
				{
					id: 'x3',
					title: '"We store SHA-256(salt + password). Salted, so fine?"',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Salt stops precomputed tables, but SHA-256 is designed to be fast: a GPU computes billions per second, so common passwords fall in minutes. Use a slow, memory-hard [[password-hashing|password hash]] ([[argon2|Argon2id]], scrypt, or bcrypt).'
						}
					]
				},
				{
					id: 'x4',
					title: 'API key in the query string, but it\'s HTTPS',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'TLS protects the wire, not the URL\'s afterlife: URLs land in server and proxy access logs, browser history, analytics, and Referer headers to third parties. Send credentials in headers.'
						}
					]
				},
				{
					id: 'x5',
					title: 'UUIDv4 as a password-reset token?',
					tag: 'teaser',
					minutes: 1,
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Usually acceptable *if* generated from a [[csprng|CSPRNG]] (Python\'s `uuid4` is; some libraries are not): 122 random bits. It still needs expiry, single use and hashed storage. Prefer an explicit `secrets.token_urlsafe(32)` so the intent and entropy are obvious.'
						}
					]
				},
				{
					id: 'x6',
					title: 'Base64 the secrets in the config file?',
					tag: 'teaser',
					minutes: 1,
					prompt: [],
					answer: [{ type: 'p', text: 'Base64 is an encoding, not encryption. It hides secrets from casual reading and from nothing else. Use a secrets manager and inject at runtime.' }]
				}
			]
		}
	]
};

export default a15;
