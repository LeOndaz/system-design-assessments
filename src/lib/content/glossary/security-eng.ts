import type { GlossaryTerm } from '../types';

/** Security engineering terms for Assessment 15 (design, crypto, supply chain, detection & response). */
const terms: GlossaryTerm[] = [
	// ───────── authorization models ─────────
	{
		id: 'rbac',
		term: 'RBAC (role-based access control)',
		aliases: ['role-based access control', 'roles'],
		category: 'security & compliance',
		short:
			'Permissions are attached to roles ("billing-admin", "viewer") and users get roles. It is easy to audit ("who is an admin?") but coarse: it cannot express "editors of *this* project" without minting a role per project, which is how role explosion starts. In multi-tenant systems a role must always be scoped to a tenant, or "admin" quietly means admin of everything.',
		analogy: 'Job titles on a badge: "nurse" opens the nurse doors in every ward, whichever ward you work on.',
		related: ['abac', 'rebac', 'least-privilege', 'tenant-isolation']
	},
	{
		id: 'abac',
		term: 'ABAC (attribute-based access control)',
		aliases: ['attribute-based access control', 'policy-based access control'],
		category: 'security & compliance',
		short:
			'Access decisions are computed from attributes of the user, the resource and the context: `user.department == resource.department && request.time in business_hours`. Very expressive and good for rules like data residency or clearance levels, but policies get hard to reason about, and the answer to "who can see this document?" requires evaluating the policy against everyone.',
		related: ['rbac', 'rebac', 'data-classification']
	},
	{
		id: 'rebac',
		term: 'ReBAC (relationship-based access control)',
		aliases: ['relationship-based access control', 'Zanzibar', 'relationship tuples', 'fine-grained authorization'],
		category: 'security & compliance',
		short:
			'Permissions follow relationships stored as tuples like `doc:roadmap#viewer@group:eng#member`: "members of group eng are viewers of doc roadmap". A check walks the graph (doc → folder → group → user), which naturally expresses sharing, nesting and inheritance, the model Google described in its Zanzibar paper. The hard parts are graph-walk latency and consistency: a check evaluated on a stale snapshot can show content to someone who was just removed.',
		analogy: 'A family tree for permissions: you can open the door if someone in your chain of relationships was given the key.',
		related: ['new-enemy-problem', 'consistency-token', 'rbac', 'abac'],
		page: [
			{ type: 'heading', text: 'Tuples and checks' },
			{
				type: 'code',
				lang: 'text',
				code: `folder:q3-plans#viewer@group:finance#member
doc:budget#parent@folder:q3-plans
group:finance#member@user:sara

check(user:sara, viewer, doc:budget)
  doc:budget#viewer? no direct tuple
  → inherit from parent folder:q3-plans#viewer
  → group:finance#member → user:sara ✓  (3 hops)`
			},
			{
				type: 'p',
				text: 'Each hop is a lookup, so deep nesting costs latency. Production systems cache sub-results and denormalize hot paths ("leopard index" for group membership), but every cache is a place where a revoked permission can linger.'
			},
			{ type: 'heading', text: 'The new-enemy problem' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Alice removes Bob from folder `q3-plans` (write W1 at time 100).',
					'Alice adds a sensitive doc to the folder (write W2 at time 101).',
					'Bob loads the doc. The check runs against a replica still at time 99: Bob is a member, the doc exists in the folder → **allowed**.'
				]
			},
			{
				type: 'p',
				text: 'Neither write is lost; the check simply used a snapshot that saw W2\'s effect (the doc) but not W1 (the removal) because content and ACLs were read from different points in time. The fix is a [[consistency-token]]: the content write records the ACL snapshot it was made at, and checks for that content must be evaluated at a snapshot at least that new.'
			},
			{
				type: 'table',
				head: ['Model', 'Good at', 'Struggles with'],
				rows: [
					['[[rbac|RBAC]]', 'Audits, simple apps, ops roles', 'Per-object sharing, nested orgs'],
					['[[abac|ABAC]]', 'Context rules (time, region, clearance)', '"Who can see X?" queries, debugging'],
					['ReBAC', 'Sharing, hierarchies, multi-tenant SaaS', 'Graph latency, snapshot consistency']
				]
			}
		]
	},
	{
		id: 'new-enemy-problem',
		term: 'New-enemy problem',
		category: 'security & compliance',
		short:
			'An authorization race: someone is removed from an ACL, then new content is added, and a check evaluated on a stale snapshot lets the removed person see the new content. It is not a lost write; it is reading content and permissions from different points in time. Fixed by making checks for content at least as fresh as the ACL state when that content was written.',
		related: ['rebac', 'consistency-token', 'eventual-consistency']
	},
	{
		id: 'consistency-token',
		term: 'Consistency token (zookie)',
		aliases: ['zookie', 'snapshot token', 'causality token'],
		category: 'security & compliance',
		short:
			'An opaque token returned by the authorization service on writes that encodes "the permission state as of this moment". The app stores it next to the content, and later checks for that content pass it back so the service evaluates at a snapshot at least that new. It gives cheap reads from caches and replicas most of the time while guaranteeing removals are respected for newer content.',
		related: ['new-enemy-problem', 'rebac', 'read-your-writes']
	},
	{
		id: 'row-level-security',
		term: 'Row-level security (RLS)',
		aliases: ['RLS', 'Postgres row level security'],
		category: 'databases',
		short:
			'A database feature that attaches a filter to every query on a table, e.g. `tenant_id = current_setting(\'app.tenant_id\')`, so even a query that forgets the WHERE clause cannot return another tenant\'s rows. It moves tenant isolation from "every developer remembers" to "the database enforces". Caveats: the session variable must be set per request (pooled connections!), and table owners and superusers bypass it unless forced.',
		related: ['tenant-isolation', 'multi-tenancy', 'idor', 'pgbouncer']
	},
	// ───────── tokens & sessions ─────────
	{
		id: 'jwt-alg-confusion',
		term: 'JWT algorithm confusion',
		aliases: ['alg confusion', 'alg none', 'key confusion'],
		category: 'security & compliance',
		short:
			'A family of verification bugs where the token\'s own header decides how it gets checked: accepting `alg: none`, or verifying an HS256 (shared-secret) token using the server\'s RSA *public* key as the HMAC secret. The defense is that the verifier, not the token, chooses: pin the allowed algorithm per key, look keys up by `kid` from a trusted set, and reject anything else before reading claims.',
		related: ['jwt', 'hmac', 'token-revocation']
	},
	{
		id: 'token-revocation',
		term: 'Token revocation',
		aliases: ['revoking JWTs', 'session revocation', 'logout everywhere'],
		category: 'security & compliance',
		short:
			'Self-contained tokens (JWTs) are valid until they expire because nobody calls home to check them, so "disable this user now" needs a design. Options: short access-token lifetimes plus revocable refresh tokens, a denylist of token ids (`jti`) checked at the gateway, or a per-user "session version" claim compared with a fast store. Each trades latency or availability for how quickly a revoke takes effect.',
		analogy: 'A printed concert ticket: you cannot cancel it once it is in someone\'s pocket unless the door staff check a list.',
		related: ['jwt', 'refresh-token-rotation', 'sso'],
		page: [
			{ type: 'p', text: 'The question to answer first: **how long may a fired employee or a stolen token keep working?** Then pick the cheapest design that meets it.' },
			{
				type: 'table',
				head: ['Design', 'Revocation delay', 'Cost'],
				rows: [
					['Long-lived JWT (12 h), no checks', 'Up to 12 h', 'None. Usually unacceptable.'],
					['Access token 5–15 min + refresh token checked against DB', 'Up to the access TTL', 'One DB check per refresh, not per request'],
					['`jti` denylist in Redis, checked at gateway', 'Seconds', 'One cache read per request; denylist only holds unexpired revoked ids'],
					['Per-user `sv` (session version) claim vs cached current version', 'Seconds', 'One cache read per request; revoking bumps a single counter (logs out all sessions)'],
					['Opaque session id + server store', 'Immediate', 'Store lookup on every request; simplest to reason about']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'The denylist only needs to hold revoked tokens until their `exp`. With 10-minute access tokens it stays tiny. With 30-day tokens it becomes a database you are pretending is not one.'
			}
		]
	},
	{
		id: 'pkce',
		term: 'PKCE (proof key for code exchange)',
		aliases: ['proof key for code exchange', 'code verifier', 'code challenge'],
		category: 'security & compliance',
		short:
			'An OAuth extension where the client invents a random secret (code verifier), sends only its hash (code challenge) when starting login, and must present the original secret when exchanging the authorization code for tokens. A stolen authorization code is useless without the verifier. Required for apps that cannot keep a client secret (SPAs, mobile) and recommended for everyone.',
		related: ['redirect-uri-validation', 'oauth-state-nonce', 'sso']
	},
	{
		id: 'redirect-uri-validation',
		term: 'Redirect URI validation',
		aliases: ['open redirect', 'redirect_uri'],
		category: 'security & compliance',
		short:
			'The authorization server must send codes and tokens only to redirect URIs registered for that client, compared by **exact string match**. Prefix or "contains" checks fail on look-alikes (`https://app.example.com.attacker.net`) and open redirects on the allowed host can bounce the code elsewhere. Wildcards for preview deployments are the usual way this regresses.',
		related: ['pkce', 'oauth-state-nonce', 'lookalike-domain']
	},
	{
		id: 'oauth-state-nonce',
		term: 'OAuth state and OIDC nonce',
		aliases: ['state parameter', 'nonce claim'],
		category: 'security & compliance',
		short:
			'Two random values with different jobs. `state` round-trips through the login redirect so the client can tell the response belongs to a login *it* started (stops login CSRF). `nonce` is placed inside the ID token by the provider so the client can tell the token was minted for this login and is not a replayed one. Both must be unguessable, single-use and checked.',
		related: ['pkce', 'csrf', 'replay-attack']
	},
	{
		id: 'workload-identity',
		term: 'Workload identity',
		aliases: ['SPIFFE', 'IRSA', 'service identity', 'task role'],
		category: 'security & compliance',
		short:
			'Giving a running service an identity issued by the platform (a Kubernetes service account mapped to a cloud role, an ECS task role, a SPIFFE ID in an mTLS certificate) instead of a long-lived secret copied into its config. Credentials are short-lived and rotated automatically, and nothing static exists to leak into a repo or a log.',
		related: ['mtls', 'access-key', 'least-privilege', 'ci-oidc-federation']
	},
	{
		id: 'confused-deputy',
		term: 'Confused deputy',
		category: 'security & compliance',
		short:
			'A privileged service is tricked into using *its own* authority on behalf of a caller who should not have it. Example: service A calls service B over mTLS to fetch "invoice 991 for the current user", and B trusts A completely, so any user who can make A ask for an id gets that invoice. The fix is to carry the end user\'s identity (or a down-scoped token) to B and authorize there too.',
		related: ['idor', 'mtls', 'ssrf', 'least-privilege']
	},
	// ───────── crypto & secrets ─────────
	{
		id: 'envelope-encryption',
		term: 'Envelope encryption',
		aliases: ['DEK', 'KEK', 'data key', 'key wrapping'],
		category: 'security & compliance',
		short:
			'Data is encrypted with a data key (DEK); the DEK is encrypted ("wrapped") by a key-encryption key (KEK) that never leaves the KMS, and the wrapped DEK is stored next to the data. Rotating the KEK means re-wrapping small DEKs, not re-encrypting terabytes. How many DEKs you have decides how expensive rotation and revocation are.',
		analogy: 'Lock the documents in a box, then put only the box key in the bank vault. Changing the vault combination never requires reopening the boxes.',
		related: ['kms', 'secret-rotation', 'aead', 'nonce-budget'],
		page: [
			{
				type: 'flow',
				steps: [
					{ label: 'Plaintext', note: '2 MB object' },
					{ label: 'Encrypt with DEK', note: 'AES-256-GCM, local' },
					{ label: 'Wrap DEK with KEK', note: 'KMS call, 32 bytes' },
					{ label: 'Store ciphertext + wrapped DEK', tone: 'ok' }
				]
			},
			{ type: 'heading', text: 'Rotation arithmetic' },
			{
				type: 'p',
				text: 'Suppose every object got its own DEK and you have 2.4 billion objects. Re-wrapping each DEK is one KMS call. At a KMS limit of 10,000 requests/s: 2.4 × 10⁹ ÷ 10⁴ = 240,000 s ≈ **66.7 hours** of saturating KMS, while the application also needs KMS to decrypt. At $0.03 per 10,000 requests the re-wrap costs about **$7,200**.'
			},
			{
				type: 'p',
				text: 'With a hierarchy (one DEK per tenant per day, say 40,000 tenants × 30 days = 1.2 M DEKs), the same rotation is 1.2 × 10⁶ ÷ 10⁴ = **120 s** and about $3.60. Hierarchies also make crypto-shredding cheap: destroying a tenant\'s keys makes all their data unreadable without touching the data.'
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Rotating the KEK does **not** protect data whose DEK was already exposed. If a DEK leaked, the affected data must be re-encrypted under a new DEK. Know which of the two your incident is.'
			}
		]
	},
	{
		id: 'password-hashing',
		term: 'Password hashing (work factor)',
		aliases: ['work factor', 'cost factor', 'key stretching'],
		category: 'security & compliance',
		short:
			'Passwords are stored as the output of a deliberately slow, salted function (bcrypt, scrypt, Argon2id) so a stolen database costs an attacker enormous compute per guess. The work factor is a dial: higher means slower cracking but also more CPU (or memory) per legitimate login, which makes login a capacity problem and a denial-of-service target.',
		related: ['bcrypt', 'argon2', 'credential-stuffing', 'rate-limiting'],
		page: [
			{ type: 'heading', text: 'Capacity math' },
			{
				type: 'table',
				head: ['bcrypt cost', 'Iterations (2^cost)', 'Time per hash (1 core, example)', 'Logins/s per core'],
				numeric: [1, 2, 3],
				rows: [
					['10', '1,024', '70 ms', '14.3'],
					['11', '2,048', '140 ms', '7.1'],
					['12', '4,096', '280 ms', '3.6'],
					['13', '8,192', '560 ms', '1.8']
				]
			},
			{
				type: 'p',
				text: 'Each +1 doubles the work. At cost 12 and a peak of 400 logins/s you need 400 × 0.28 = **112 cores** busy just hashing. During [[credential-stuffing]] at 5,000 attempts/s that becomes 1,400 cores, so rate limiting and bot filtering must happen **before** the hash, not after.'
			},
			{
				type: 'p',
				text: 'Argon2id adds a memory cost (e.g. 64 MiB per hash), which hurts GPU crackers far more than CPUs, but 400 concurrent hashes × 64 MiB = 25 GiB of RAM: memory, not CPU, becomes the limit.'
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'bcrypt only uses the first 72 bytes of input. Pre-hashing long passwords is common, but pre-hash to a fixed-length encoding (e.g. base64 of SHA-256) to avoid NUL-byte truncation surprises.'
			}
		]
	},
	{
		id: 'argon2',
		term: 'Argon2id',
		aliases: ['argon2'],
		category: 'security & compliance',
		short:
			'The modern password-hashing function (winner of the Password Hashing Competition). Its parameters are time cost, memory cost and parallelism. Memory-hardness means each guess needs real RAM, which GPUs and ASICs have little of per core, so cracking is far more expensive than with bcrypt at the same login latency.',
		related: ['password-hashing', 'bcrypt']
	},
	{
		id: 'nonce-budget',
		term: 'Nonce budget (AES-GCM usage limits)',
		aliases: ['GCM invocation limit', '2^32 messages per key'],
		category: 'security & compliance',
		short:
			'AES-GCM is catastrophically broken if a (key, nonce) pair repeats. With random 96-bit nonces, collision odds become unacceptable after about 2³² ≈ 4.3 billion encryptions under one key, so NIST caps random-nonce use there. High-volume services must count encryptions per key and rotate DEKs before the budget runs out, or use a nonce-misuse-resistant mode (AES-GCM-SIV).',
		related: ['nonce-reuse', 'aead', 'envelope-encryption']
	},
	{
		id: 'timing-safe-compare',
		term: 'Constant-time comparison',
		aliases: ['timing-safe compare', 'timingSafeEqual', 'hmac.compare_digest'],
		category: 'security & compliance',
		short:
			'Comparing secrets (signatures, tokens) with `==` stops at the first differing byte, so response time leaks how many leading bytes were right. Over many requests that can reveal a valid MAC byte by byte. Use the library\'s constant-time compare (`hmac.compare_digest`, `crypto.timingSafeEqual`), and compare fixed-length digests, not raw variable-length strings.',
		related: ['hmac', 'webhook-signature']
	},
	{
		id: 'csprng',
		term: 'CSPRNG (cryptographically secure random)',
		aliases: ['secure random', 'secrets module', 'crypto.randomBytes'],
		category: 'security & compliance',
		short:
			'A random generator whose output cannot be predicted even after seeing previous outputs (the OS source behind `secrets`, `crypto.getRandomValues`, `crypto/rand`). General-purpose generators like `Math.random` or Python\'s `random` are fast and statistically fine but predictable from a few outputs, so they must never mint reset tokens, session ids or API keys. Aim for at least 128 bits of entropy per secret.',
		related: ['token-revocation', 'account-enumeration']
	},
	{
		id: 'certificate-pinning',
		term: 'Certificate pinning',
		aliases: ['SSL pinning', 'public key pinning', 'SPKI pin'],
		category: 'security & compliance',
		short:
			'A client (usually a mobile app) refuses TLS connections unless the server presents a specific certificate or public key, defeating interception by a rogue or compromised CA. The price is operational: rotate the pinned cert without shipping a new app first and every installed old version goes dark. Pin the public key (SPKI), include a backup key, and prefer Certificate Transparency monitoring unless the threat model really needs pinning.',
		related: ['tls-certificate', 'tls-handshake']
	},
	{
		id: 'webhook-signature',
		term: 'Webhook signature verification',
		aliases: ['signed webhooks', 'X-Signature'],
		category: 'security & compliance',
		short:
			'The sender HMACs the exact raw request body (plus a timestamp) with a shared secret; the receiver recomputes over the same raw bytes and compares in constant time **before** parsing or acting. Verifying a re-serialized JSON body fails randomly or, worse, verifies different bytes than you act on. Reject old timestamps and remember event ids to stop replays.',
		related: ['webhook', 'hmac', 'timing-safe-compare', 'replay-attack']
	},
	{
		id: 'replay-attack',
		term: 'Replay attack',
		category: 'security & compliance',
		short:
			'Re-sending a valid, correctly signed message that was captured earlier, such as a webhook or a signed API request. Signatures prove who created a message, not that it is fresh. Defenses: include a timestamp and reject anything outside a short window, and record message ids (nonces) for at least that window to drop duplicates.',
		related: ['webhook-signature', 'oauth-state-nonce', 'idempotency-key']
	},
	// ───────── supply chain & CI ─────────
	{
		id: 'dependency-confusion',
		term: 'Dependency confusion',
		aliases: ['namespace confusion', 'substitution attack'],
		category: 'security & compliance',
		short:
			'A build that can resolve a package name from both a private registry and the public one may pick the public package if it has a higher version. Someone publishes `acme-utils@99.0.0` publicly and your CI installs it, running its install scripts with CI\'s secrets. Prevented by scoped names bound to the private registry, lockfiles with integrity hashes, and claiming your internal names publicly.',
		related: ['typosquatting', 'lockfile-integrity', 'npm-lifecycle-scripts', 'slsa'],
		page: [
			{
				type: 'code',
				lang: 'text',
				code: `# .npmrc (vulnerable)
registry=https://npm.internal.acme/
# internal mirror proxies the public registry for anything it doesn't have,
# and "anything newer" counts as "doesn't have"

# package.json
"dependencies": { "acme-utils": "^2.3.0" }

# public registry: acme-utils@99.0.0  ← satisfies ^2.3.0? no. But:
"acme-utils": "*"  or a fresh install without lockfile → 99.0.0 wins`
			},
			{
				type: 'list',
				items: [
					'**Scope** internal packages (`@acme/utils`) and map the scope to the private registry: `@acme:registry=https://npm.internal.acme/`.',
					'**Lockfile + `npm ci`**: CI installs exactly the resolved URL and integrity hash, never re-resolves.',
					'**Block upstream** for internal names at the proxy, and register placeholder names publicly.',
					'**Detect**: alert when a lockfile diff changes a `resolved` host or adds a package with install scripts.'
				]
			}
		]
	},
	{
		id: 'typosquatting',
		term: 'Typosquatting (packages)',
		aliases: ['typosquat'],
		category: 'security & compliance',
		short:
			'Publishing malicious packages with names one keystroke away from popular ones (`reqeusts`, `lodahs`) or swapped separators (`python-dateutil` vs `dateutil-python`). Defenses: review new dependencies in PRs, flag packages that are very new or have few downloads, and pin through lockfiles so a typo cannot silently resolve later.',
		related: ['dependency-confusion', 'lockfile-integrity']
	},
	{
		id: 'lockfile-integrity',
		term: 'Lockfile integrity',
		aliases: ['package-lock integrity', 'npm ci', 'resolved URL'],
		category: 'security & compliance',
		short:
			'A lockfile records the exact version, download URL and content hash of every dependency. Installing with `npm ci` / `pip install --require-hashes` refuses anything that does not match. The lockfile itself is code: a PR that changes a `resolved` URL to another host or swaps an integrity hash deserves the same review as a code change, and tools like lockfile-lint can enforce allowed hosts.',
		related: ['dependency-confusion', 'typosquatting', 'image-digest']
	},
	{
		id: 'pull-request-target',
		term: 'pull_request_target (CI from forks)',
		aliases: ['pwn request', 'fork PR secrets'],
		category: 'security & compliance',
		short:
			'A GitHub Actions trigger that runs workflows for fork PRs **with the base repo\'s secrets and write token**, intended for labeling or commenting. If such a workflow checks out and builds the PR\'s code, the fork author\'s code runs with your secrets. Keep untrusted builds on `pull_request` (no secrets), and if you need privileges, split into a privileged job that never executes PR code.',
		related: ['ci-oidc-federation', 'ci-cache-poisoning', 'least-privilege']
	},
	{
		id: 'ci-oidc-federation',
		term: 'CI OIDC federation',
		aliases: ['GitHub OIDC to AWS', 'keyless CI credentials'],
		category: 'security & compliance',
		short:
			'Instead of storing cloud access keys as CI secrets, the CI job gets a short-lived OIDC token describing itself (repo, branch, environment) and exchanges it for temporary cloud credentials. Security now lives in the trust policy\'s conditions: a `sub` condition like `repo:acme/*` lets every repo in the org, including a freshly created one, assume a production role.',
		related: ['workload-identity', 'pull-request-target', 'least-privilege', 'iam-evaluation']
	},
	{
		id: 'artifact-signing',
		term: 'Artifact signing',
		aliases: ['cosign', 'Sigstore', 'image signing'],
		category: 'security & compliance',
		short:
			'The build system signs what it produced (a container image digest, a binary), and deploy-time admission checks the signature before running it. The check is only as strong as its policy: verify the **digest** (not a mutable tag), require the expected **signer identity** (this repo\'s release workflow), and reject everything else rather than "any valid signature".',
		related: ['slsa', 'image-digest', 'mutable-image-tag', 'sbom']
	},
	{
		id: 'sbom',
		term: 'SBOM (software bill of materials)',
		aliases: ['software bill of materials', 'CycloneDX', 'SPDX'],
		category: 'security & compliance',
		short:
			'A machine-readable list of every component and version inside an artifact, generated at build time. When a new CVE lands it turns "are we affected?" from a week of grepping repos into a query, provided SBOMs exist for what is actually deployed (not just what is in main).',
		related: ['cve', 'vulnerability-reachability', 'artifact-signing']
	},
	{
		id: 'distroless-image',
		term: 'Distroless / minimal images',
		aliases: ['distroless', 'scratch image'],
		category: 'cloud & infra',
		short:
			'Container images that contain only the application and its runtime libraries: no shell, no package manager, no curl. Fewer components means fewer CVEs to patch and fewer tools for an intruder to use. Debugging needs ephemeral debug containers instead of `exec bash`.',
		related: ['sbom', 'least-privilege']
	},
	// ───────── detection & response ─────────
	{
		id: 'security-logging',
		term: 'Security logging',
		aliases: ['audit logging', 'auth logs'],
		category: 'security & compliance',
		short:
			'Logging designed for investigations: who (user, session, client, source IP), did what (action, target object, result), when (UTC, synchronized clocks), from where, with a request id to join systems. Equally important is what never to log: passwords, tokens, full card numbers, session cookies, and PII beyond what the investigation needs. Logs that attackers can edit are not evidence.',
		related: ['audit-trail', 'pii', 'hash-chain-audit', 'cloudtrail']
	},
	{
		id: 'incident-containment',
		term: 'Incident containment',
		aliases: ['contain eradicate recover', 'rotate revoke isolate'],
		category: 'security & compliance',
		short:
			'The first response phase: stop the damage from growing while keeping evidence and keeping the business running. The main tools are **revoke** (disable a credential), **rotate** (issue a new one and move consumers), and **isolate** (cut network access to a host or account). Order matters: isolating before snapshotting can tip off an attacker; deleting before investigating destroys evidence.',
		related: ['forensic-preservation', 'blast-radius', 'access-key', 'postmortem'],
		page: [
			{
				type: 'table',
				head: ['Situation', 'First move', 'Then', 'Avoid'],
				rows: [
					['Leaked static key still used by prod', 'Deny-by-condition (source IP / VPC) so prod keeps working', 'Move prod to a role, deactivate the key, review audit logs', 'Deleting the user: breaks prod and attribution'],
					['Compromised VM', 'Isolate with a quarantine security group; snapshot disk; capture memory', 'Revoke the instance role\'s sessions; rebuild from a known-good image', 'Terminating it: the evidence dies with it'],
					['Stolen user session', 'Revoke sessions / bump session version; force MFA re-enrollment if MFA changed', 'Check for persistence: new API tokens, OAuth grants, mail rules', 'Only resetting the password'],
					['Malicious dependency published', 'Block the version at the proxy; stop deploys', 'Find every build that pulled it; rotate secrets those builds could read', 'Assuming "we never deployed it" without checking CI']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Always look for **persistence**: attackers with any write access create a second foothold (another key, user, OAuth app, scheduled job) within minutes. Closing the door you saw them use is not the end.'
			}
		]
	},
	{
		id: 'forensic-preservation',
		term: 'Forensic preservation',
		aliases: ['evidence preservation', 'chain of custody'],
		category: 'security & compliance',
		short:
			'Capturing evidence before it changes: disk snapshots, memory captures, copies of logs with integrity hashes, and notes of who collected what when. Volatile evidence (memory, running processes, network connections) disappears on reboot or termination, so "just kill it" destroys the answers to "what did they take?" and "how did they get in?".',
		related: ['incident-containment', 'audit-trail', 'hash-chain-audit']
	},
	{
		id: 'coordinated-disclosure',
		term: 'Coordinated disclosure',
		aliases: ['responsible disclosure', 'vulnerability disclosure policy', 'security.txt'],
		category: 'security & compliance',
		short:
			'The process for receiving vulnerability reports from outsiders and publishing fixes: a clear contact (`security.txt`), an acknowledgment SLA, a safe-harbor statement, a fix-and-disclose timeline agreed with the reporter. It is distinct from breach notification, which is a legal duty to tell regulators and affected people when personal data was actually compromised.',
		related: ['personal-data-breach', 'cve']
	},
	{
		id: 'cloudtrail',
		term: 'CloudTrail (cloud audit log)',
		aliases: ['AWS CloudTrail', 'audit log', 'event history'],
		category: 'cloud & infra',
		short:
			'The cloud provider\'s record of API calls: who (principal and access key), what (action and resource), when, from which IP and user agent. It is the primary source for "what did this credential do?" Data-plane events (individual S3 object reads) are usually off by default and must be enabled ahead of time, or exfiltration through them is invisible.',
		related: ['security-logging', 'access-key', 'vpc-flow-logs']
	},
	{
		id: 'access-key',
		term: 'Access key (long-lived cloud credential)',
		aliases: ['AKIA', 'IAM access key', 'static credentials'],
		category: 'cloud & infra',
		short:
			'A key id and secret that sign cloud API requests as an IAM user, valid until someone deactivates them. They end up in repos, laptops, CI variables and logs, and are the most common root cause of cloud breaches. Prefer roles and [[workload-identity|workload identity]] with short-lived credentials; keep any remaining keys scoped, monitored and conditioned on source network.',
		related: ['workload-identity', 'secret-rotation', 'incident-containment', 'cloudtrail']
	},
	{
		id: 'email-authentication',
		term: 'Email authentication (SPF, DKIM, DMARC)',
		aliases: ['SPF', 'DKIM', 'DMARC'],
		category: 'security & compliance',
		short:
			'SPF lists which servers may send mail for a domain; DKIM signs messages so receivers can verify the domain and that content was not altered; DMARC tells receivers what to do when both fail to align with the visible From domain (none / quarantine / reject) and where to send reports. They stop exact-domain spoofing, but do nothing against look-alike domains.',
		related: ['lookalike-domain', 'transactional-email']
	},
	{
		id: 'lookalike-domain',
		term: 'Look-alike domain',
		aliases: ['homoglyph domain', 'cousin domain'],
		category: 'security & compliance',
		short:
			'A domain registered to resemble yours (`acme-billing.com`, `acrne.com`, Cyrillic "а" in place of Latin "a") for phishing. Your SPF/DKIM/DMARC cannot help because the attacker legitimately controls that domain. Responses: monitor new registrations and certificate transparency logs, request takedowns, and teach customers where your real messages come from.',
		related: ['email-authentication', 'redirect-uri-validation', 'unicode-normalization']
	},
	{
		id: 'cve',
		term: 'CVE (common vulnerabilities and exposures)',
		aliases: ['CVE', 'CVSS', 'vulnerability advisory'],
		category: 'security & compliance',
		short:
			'A public identifier for a known vulnerability (CVE-2026-12345), usually with a CVSS severity score. The score describes the worst case in general, not your exposure: whether you are affected depends on having the vulnerable version deployed, the vulnerable code path being reachable, and attacker-controlled input reaching it.',
		related: ['sbom', 'vulnerability-reachability', 'coordinated-disclosure']
	},
	{
		id: 'vulnerability-reachability',
		term: 'Vulnerability reachability',
		aliases: ['reachability analysis', 'exploitability'],
		category: 'security & compliance',
		short:
			'Asking whether a vulnerable dependency is actually exploitable in your system: is the vulnerable function called, with input an attacker controls, on a network path they can reach? It is how teams triage hundreds of scanner findings, but "not reachable" must be shown with evidence (call graph, config) and still patched on a schedule, because code paths change.',
		related: ['cve', 'sbom', 'severity-triage']
	},
	// ───────── threat modeling ─────────
	{
		id: 'stride',
		term: 'STRIDE',
		aliases: ['threat modeling', 'threat model'],
		category: 'security & compliance',
		short:
			'A checklist for threat modeling each component and data flow: **S**poofing (pretending to be someone), **T**ampering (changing data), **R**epudiation (denying an action with no proof), **I**nformation disclosure, **D**enial of service, **E**levation of privilege. Its value is forcing you to ask every question at every trust boundary instead of only the ones you already worry about.',
		related: ['abuse-case', 'data-classification', 'blast-radius'],
		page: [
			{ type: 'p', text: 'Walk the diagram boundary by boundary. Example: a profile-photo upload pipeline.' },
			{
				type: 'flow',
				steps: [
					{ label: 'Browser' },
					{ label: 'API', note: 'issues presigned PUT' },
					{ label: 'Object storage', note: 'uploads/ bucket' },
					{ label: 'Image worker', note: 'resize, strip EXIF' },
					{ label: 'CDN', note: 'public avatars/', tone: 'info' }
				]
			},
			{
				type: 'table',
				head: ['Letter', 'Question at this boundary', 'Example finding'],
				rows: [
					['S', 'Can someone upload as another user?', 'Presigned URL key includes user id from the request body, not the session'],
					['T', 'Can the object change between check and use?', 'Worker validates content type, then reads the object again by key (could be overwritten)'],
					['R', 'Can a user deny uploading abusive content?', 'No upload audit log tying object key to session'],
					['I', 'Can private data leak?', 'EXIF GPS coordinates published via CDN; bucket listing allowed'],
					['D', 'Can someone exhaust resources?', 'No size limit in the presigned policy: 5 GB "avatars"; decompression-bomb images'],
					['E', 'Can processing run attacker code?', 'Image library with a parsing CVE runs with a role that can write to every bucket']
				]
			}
		]
	},
	{
		id: 'abuse-case',
		term: 'Abuse case',
		aliases: ['misuse case'],
		category: 'security & compliance',
		short:
			'A user story written from the attacker\'s or fraudster\'s side: "as a fraudster, I create 500 accounts to farm the referral bonus". Many costly incidents abuse features working exactly as designed (referrals, coupons, free trials, invites), so they never show up as bugs. Writing them next to normal user stories surfaces the rate limits, verification steps and monitoring a feature needs.',
		related: ['stride', 'account-enumeration', 'rate-limiting']
	},
	{
		id: 'account-enumeration',
		term: 'Account enumeration',
		aliases: ['user enumeration'],
		category: 'security & compliance',
		short:
			'Learning which emails or usernames have accounts by watching how the system responds: different messages ("wrong password" vs "no such user"), different status codes, or different response times (a password hash is computed only for existing users). Enumerated lists feed credential stuffing and targeted phishing. Uniform responses, equalized timing and rate limits across login, signup and password reset close it.',
		related: ['credential-stuffing', 'rate-limiting', 'timing-safe-compare']
	},
	{
		id: 'data-classification',
		term: 'Data classification',
		aliases: ['data sensitivity levels'],
		category: 'security & compliance',
		short:
			'Labelling data by how much harm its exposure would cause (e.g. public, internal, confidential, restricted) and attaching required controls to each level: encryption, access approvals, retention, where it may be logged or copied. It lets engineers make consistent decisions ("restricted data never goes to analytics") without a security review for every field.',
		related: ['pii', 'phi', 'security-logging', 'stride']
	}
];

export default terms;
