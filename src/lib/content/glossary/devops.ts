import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	// ───────────── Kubernetes scheduling & resources ─────────────
	{
		id: 'resource-requests',
		term: 'Requests vs limits',
		aliases: ['resource requests', 'cpu request', 'cpu limit', 'memory limit'],
		category: 'cloud & infra',
		short:
			'A container\'s **request** is what the scheduler reserves for it on a node; its **limit** is the most it may use. Requests decide *placement* and what the autoscaler sees as "utilization"; limits decide *enforcement*: CPU over the limit is throttled, memory over the limit gets the process killed. Most Kubernetes capacity bugs come from treating the two as the same number.',
		analogy: 'A restaurant reservation (request) guarantees your table; the fire-code capacity (limit) is the most people allowed in, however many you booked.',
		related: ['qos-class', 'cpu-throttling', 'oomkilled', 'horizontal-pod-autoscaler', 'eviction'],
		page: [
			{ type: 'heading', text: 'What each number controls' },
			{
				type: 'table',
				head: ['', 'CPU', 'Memory'],
				rows: [
					['**Request**', 'Scheduler reserves it. HPA utilization = usage ÷ request. Sets the CFS share under contention.', 'Scheduler reserves it. Used to rank pods for eviction under node pressure.'],
					['**Limit**', 'Hard cap per [[cfs-quota|CFS period]]: over it, the container is *throttled* (slower, not killed).', 'Hard cap: over it, the kernel *OOM-kills* the container (exit 137).'],
					['**Neither set**', 'Can use any idle CPU; gets the smallest share under contention.', 'Can grow until the node is under pressure; first to be evicted.']
				]
			},
			{ type: 'heading', text: 'Three classic traps' },
			{
				type: 'list',
				items: [
					'**Request higher than the process can use.** A single-threaded Node.js app requesting 2 CPU can never exceed 50% "utilization", so an HPA targeting 70% never scales, however overloaded it is.',
					'**CPU limit equal to the request on a bursty service.** Average usage looks like 40% while p99 latency suffers from throttling within each 100 ms period.',
					'**Memory request far below real usage.** The scheduler packs pods onto a node that cannot hold them; when they grow, the kubelet evicts (or the kernel OOM-kills) them, and they land somewhere else and repeat.'
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'Rule of thumb',
				text: 'Set the CPU request to what the process *can actually use at the load you want per pod*, set memory request ≈ limit (memory is not compressible), and be deliberate about CPU limits: many teams drop them for latency-sensitive services and rely on requests for fairness.'
			}
		]
	},
	{
		id: 'qos-class',
		term: 'QoS class',
		aliases: ['Guaranteed', 'Burstable', 'BestEffort'],
		category: 'cloud & infra',
		short:
			'Kubernetes labels every pod **Guaranteed** (requests = limits for every container), **Burstable** (some requests set) or **BestEffort** (none). When a node runs short of memory or disk, the kubelet evicts BestEffort first, then Burstable pods using the most above their request, and Guaranteed last. It\'s the "who gets thrown off the lifeboat" order.',
		related: ['resource-requests', 'eviction']
	},
	{
		id: 'eviction',
		term: 'Eviction (node pressure)',
		aliases: ['evicted pod', 'node-pressure eviction', 'kubelet eviction'],
		category: 'cloud & infra',
		short:
			'The kubelet deleting pods because the *node* is running out of memory, disk ([[ephemeral-storage]]) or PIDs. Unlike an OOM kill, which is one container exceeding its own limit, eviction is about the whole node, so the evicted pod may not be the one that caused the pressure. The pod status says `Evicted` with the exact resource in the message: read it before guessing.',
		related: ['oomkilled', 'ephemeral-storage', 'qos-class', 'pod-disruption-budget']
	},
	{
		id: 'ephemeral-storage',
		term: 'Ephemeral storage',
		category: 'cloud & infra',
		short:
			'The node-local disk a pod uses without a volume: its writable container layer, `emptyDir` volumes and **its container logs** (stdout/stderr files the kubelet keeps on the node). It counts against the node\'s disk and can trigger eviction, so a pod that logs at DEBUG to stdout can be evicted for "ephemeral-storage" while its memory graph stays perfectly flat.',
		related: ['eviction', 'resource-requests']
	},
	{
		id: 'oomkilled',
		term: 'OOMKilled',
		aliases: ['exit code 137', 'OOM kill'],
		category: 'cloud & infra',
		short:
			'The Linux kernel killed a container because it exceeded its memory **limit** (cgroup), reported as `OOMKilled`, exit code 137. It happens instantly, at the peak, so a 1-minute-average memory graph often shows nothing near the limit. Compare with eviction (node-wide pressure, graceful) and CPU throttling (slow, never fatal).',
		related: ['eviction', 'resource-requests', 'memory-leak']
	},
	{
		id: 'pod-disruption-budget',
		term: 'PodDisruptionBudget (PDB)',
		aliases: ['PDB', 'minAvailable', 'maxUnavailable'],
		category: 'cloud & infra',
		short:
			'A rule that limits how many of an app\'s pods may be taken down **voluntarily** at once: by node drains, upgrades, or the cluster autoscaler. The eviction API refuses requests that would break it. It does not protect against crashes or node failures, and a PDB that allows zero disruptions (e.g. `minAvailable` equal to replicas) blocks every drain forever.',
		analogy: 'A rota rule that says "at least two nurses on the ward at all times": you can send nurses on break, one at a time, only if a third is on shift.',
		related: ['eviction', 'graceful-shutdown', 'readiness-probe', 'rolling-update'],
		page: [
			{
				type: 'p',
				text: 'A PDB protects availability during **voluntary** disruptions. Node drains (upgrades, scale-in, spot handling) call the eviction API; the API server checks `disruptionsAllowed = currentHealthy − minAvailable` and refuses the eviction when it is 0. The drain then retries forever.'
			},
			{
				type: 'code',
				lang: 'yaml',
				caption: 'The deadlock: 2 replicas, 2 must stay available ⇒ 0 disruptions allowed.',
				code: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: payments-api-pdb }
spec:
  minAvailable: 2          # == replicas
  selector:
    matchLabels: { app: payments-api }`
			},
			{ type: 'heading', text: 'Fixing a blocked drain, ranked' },
			{
				type: 'ranked',
				items: [
					{ title: 'Add surge capacity, then let the drain proceed.', body: 'Scale to 3; once the new pod is Ready, one disruption is allowed, and the drain evicts one pod at a time.' },
					{ title: 'Lower minAvailable only if the remaining pods can carry the load.', body: 'Check per-pod capacity first: 1 pod at 300 req/s does not carry 520 req/s.' },
					{ title: 'Never delete the PDB mid-drain.', body: 'Without it, the drain evicts every pod on the node immediately: all your replicas if they share a node.' }
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Design rule',
				text: 'Use `maxUnavailable: 1` (or a percentage) instead of `minAvailable: N`, run replicas ≥ 2 with pod anti-affinity, and make sure the readiness probe is honest, because "healthy" in the PDB means Ready.'
			}
		]
	},
	{
		id: 'rolling-update',
		term: 'Rolling update (maxSurge / maxUnavailable)',
		aliases: ['maxSurge', 'maxUnavailable', 'rollout restart'],
		category: 'cloud & infra',
		short:
			'How a Deployment replaces pods: `maxSurge` is how many extra pods may exist above the desired count, `maxUnavailable` how many may be missing. `maxUnavailable: 100%` turns a "rolling" restart into stopping everything at once, which also means every new pod opens its DB connections in the same second.',
		related: ['pod-disruption-budget', 'connection-storm', 'readiness-probe']
	},
	{
		id: 'horizontal-pod-autoscaler',
		term: 'Horizontal Pod Autoscaler (HPA)',
		aliases: ['HPA'],
		category: 'cloud & infra',
		short:
			'Adjusts a Deployment\'s replica count toward `desired = ceil(current × currentMetric ÷ target)`. For CPU, the metric is usage **as a percentage of the request**, not of the node or the limit. So the request you set silently defines what "busy" means, and a request the process can never reach makes the HPA blind.',
		related: ['resource-requests', 'cluster-autoscaler', 'autoscaling']
	},
	{
		id: 'cluster-autoscaler',
		term: 'Cluster autoscaler',
		aliases: ['CA', 'Karpenter'],
		category: 'cloud & infra',
		short:
			'Adds nodes when pods are Pending and could fit on a new node, and removes underused ones. It *simulates* scheduling using a template of each node group (labels, taints, zones). If the template is wrong, or capacity for that instance type is unavailable, it either adds nodes the pods still cannot use or keeps failing to add any. Read its events and the pod\'s scheduling message, not just "it\'s on".',
		related: ['horizontal-pod-autoscaler', 'volume-node-affinity', 'availability-zone']
	},
	{
		id: 'persistent-volume-claim',
		term: 'PersistentVolumeClaim (PVC)',
		aliases: ['PVC', 'PersistentVolume'],
		category: 'cloud & infra',
		short:
			'A pod\'s request for durable storage, bound to an actual disk (PersistentVolume). Block disks like EBS live in one [[availability-zone]], so once bound, the PVC pins every future incarnation of that pod to that zone.',
		related: ['volume-node-affinity', 'cluster-autoscaler']
	},
	{
		id: 'volume-node-affinity',
		term: 'Volume node affinity conflict',
		category: 'cloud & infra',
		short:
			'The scheduler message meaning "this pod\'s disk is in a different zone from every node with room". The pod stays Pending even if other zones have plenty of capacity, so adding nodes in the wrong zone, or a bigger cluster, changes nothing. You need capacity in the volume\'s zone, or you must move the data.',
		related: ['persistent-volume-claim', 'cluster-autoscaler']
	},
	{
		id: 'ndots',
		term: 'ndots (DNS search expansion)',
		aliases: ['ndots:5', 'resolv.conf search domains'],
		category: 'cloud & infra',
		short:
			'A resolver option: names with **fewer dots than `ndots`** are first tried with every search domain appended. Kubernetes pods default to `ndots:5`, so `api.partner.com` (2 dots) is looked up as `api.partner.com.default.svc.cluster.local`, `.svc.cluster.local`, `.cluster.local`, the VPC domain, and only then as itself, each for A and AAAA. That is 8+ queries per lookup, and one slow or dropped query adds seconds.',
		related: ['dns-caching', 'timeout'],
		page: [
			{
				type: 'code',
				lang: 'text',
				caption: 'A typical pod `/etc/resolv.conf`.',
				code: `nameserver 172.20.0.10
search payments.svc.cluster.local svc.cluster.local cluster.local eu-west-1.compute.internal
options ndots:5`
			},
			{
				type: 'table',
				head: ['Lookup of `api.partner.com`', 'Result'],
				rows: [
					['api.partner.com.payments.svc.cluster.local (A, AAAA)', 'NXDOMAIN'],
					['api.partner.com.svc.cluster.local (A, AAAA)', 'NXDOMAIN'],
					['api.partner.com.cluster.local (A, AAAA)', 'NXDOMAIN'],
					['api.partner.com.eu-west-1.compute.internal (A, AAAA)', 'forwarded upstream → NXDOMAIN (slow)'],
					['api.partner.com (A, AAAA)', 'answer']
				]
			},
			{ type: 'heading', text: 'Why it shows up as "5 seconds, sometimes"' },
			{
				type: 'p',
				text: 'glibc sends A and AAAA queries in parallel from the same UDP socket. Under load, a conntrack race on the node can drop one of them; the resolver then waits the full `timeout:5` before retrying. Multiply by many queries per lookup and some external calls take exactly 5 s, 10 s… while in-cluster names (`orders.payments`, which match on the second search domain, `svc.cluster.local`) stay fast.'
			},
			{
				type: 'list',
				items: [
					'Use fully-qualified names with a trailing dot (`api.partner.com.`) for external hosts.',
					'Set `dnsConfig.options: [{name: ndots, value: "2"}]` on pods that mostly call external services.',
					'Run NodeLocal DNSCache (cuts the conntrack race and the hop to CoreDNS).',
					'**Not** a fix: scaling CoreDNS. More replicas answer the same 8 wasted queries.'
				]
			}
		]
	},
	{
		id: 'image-pull-rate-limit',
		term: 'Image pull rate limit',
		aliases: ['toomanyrequests', 'ImagePullBackOff 429'],
		category: 'cloud & infra',
		short:
			'Public registries cap anonymous pulls per source IP (e.g. 100 per 6 h). A whole cluster egresses through a few NAT IPs, so it shares one quota. Old nodes have the image cached and never notice; a scale-out of fresh nodes all pull at once and hit `429 Too Many Requests` together.',
		related: ['image-digest', 'nat-port-exhaustion']
	},
	{
		id: 'configmap-reload',
		term: 'ConfigMap reload',
		category: 'cloud & infra',
		short:
			'Editing a ConfigMap does not restart pods. Values injected as environment variables are fixed at container start; files mounted as a volume update after a delay (but not with `subPath`); and the app must re-read them anyway. The usual fix is a checksum annotation on the pod template, so a config change triggers a rollout like a code change.',
		related: ['rolling-update', 'config-drift']
	},

	// ───────────── Delivery ─────────────
	{
		id: 'image-digest',
		term: 'Image digest (immutable artifact)',
		aliases: ['sha256 digest', 'mutable tag', 'latest tag', 'immutable tags'],
		category: 'reliability practice',
		short:
			'A container image\'s content hash, `repo@sha256:…`. Tags like `latest`, `stable` or even `v1.4` are movable pointers: the same tag can mean different bytes tomorrow. Deploying by digest makes "roll back to what ran yesterday" literally yesterday\'s bytes; deploying by tag makes it whatever the tag points at now.',
		related: ['rollback', 'canary-analysis', 'ci-cache-poisoning']
	},
	{
		id: 'flaky-test',
		term: 'Flaky test',
		category: 'reliability practice',
		short:
			'A test that passes and fails on the same code. Some flakes are test bugs (timing, shared fixtures, order dependence); some are **real race conditions in the product** that the test happens to expose. Automatic retries make both kinds green, so they also hide the second kind until production hits it at scale.',
		related: ['race-condition']
	},
	{
		id: 'ci-cache-poisoning',
		term: 'CI cache poisoning',
		aliases: ['build cache poisoning', 'self-hosted runner persistence'],
		category: 'security & compliance',
		short:
			'Getting attacker-controlled content into a cache (dependencies, build layers, a persistent runner workspace) that a later, trusted build restores. The release is then built from files that were never in the reviewed source. Caches must be scoped by trust level, and release builds should be reproducible from a clean environment.',
		related: ['image-digest']
	},
	{
		id: 'canary-analysis',
		term: 'Canary analysis',
		aliases: ['canary release', 'canary deploy'],
		category: 'reliability practice',
		short:
			'Sending a small share of traffic to a new version and comparing its health with the baseline before rolling out. It only works if the canary sees **enough of the traffic the change affects** to detect a difference: a 5% canary of a code path used by 0.3% of requests sees a handful of samples, and "no errors" means "no evidence", not "safe".',
		related: ['feature-flag', 'rollback', 'low-traffic-ratio', 'image-digest'],
		page: [
			{ type: 'heading', text: 'The power problem in one calculation' },
			{
				type: 'table',
				head: ['Input', 'Value'],
				numeric: [1],
				rows: [
					['Total traffic', '400 req/s'],
					['Canary share', '5% → 20 req/s'],
					['Requests that hit the changed path (coupons)', '0.3% → 0.06 req/s'],
					['Canary duration', '30 min → **~108 coupon requests**'],
					['Bug: coupon checkout fails 20% of the time', '~22 expected failures… *if* you look at coupon errors'],
					['Overall canary error rate change', '22 ÷ 36,000 = **+0.06 pp**, invisible next to a 0.4% baseline']
				]
			},
			{
				type: 'p',
				text: 'The canary "passed" because it measured the whole service. Analyse **the metrics of the changed path**, size duration × share so the changed path gets enough samples (power), or exercise it with synthetic traffic. For rarely-used paths, a [[feature-flag]] targeted at internal users is a better release mechanism than a traffic canary.'
			}
		]
	},
	{
		id: 'affected-targets',
		term: 'Affected-target detection',
		aliases: ['monorepo CI', 'path filters'],
		category: 'reliability practice',
		short:
			'Monorepo CI that only builds and tests projects "affected" by a change. It is only as correct as the dependency graph behind it: a path filter like `apps/billing/**` misses a change in a shared library billing imports, so billing ships untested with code it never ran against.',
		related: ['flaky-test']
	},
	{
		id: 'flag-debt',
		term: 'Feature-flag debt',
		category: 'reliability practice',
		short:
			'Flags that outlived their purpose. Each one doubles a code path, and the *default* in code is a live switch: delete the flag in the dashboard, or lose the flag service, and every client silently falls back to whatever the code default was years ago.',
		related: ['feature-flag']
	},

	// ───────────── IaC & config ─────────────
	{
		id: 'terraform-plan-replace',
		term: 'Plan that replaces (forces replacement)',
		aliases: ['must be replaced', 'destroy and recreate', 'moved block', 'prevent_destroy'],
		category: 'cloud & infra',
		short:
			'A Terraform plan line `# … must be replaced` or a destroy paired with a create. For stateless resources it is routine; for databases, queues and buckets it means data loss. It happens when an attribute can\'t be changed in place (e.g. enabling storage encryption) or when the resource *address* changed in a refactor, which Terraform reads as "delete the old one, create a new one".',
		related: ['state-lock', 'config-drift'],
		page: [
			{
				type: 'code',
				lang: 'text',
				caption: 'Two different reasons for a destroy, in one plan.',
				code: `  # aws_db_instance.orders will be destroyed
  # (because aws_db_instance.orders is not in configuration)
  - resource "aws_db_instance" "orders" { ... }

  # module.db.aws_db_instance.this will be created
  + resource "aws_db_instance" "this" { ... }

  # aws_s3_bucket.exports must be replaced
-/+ resource "aws_s3_bucket" "exports" {
      ~ bucket = "exports-prod" -> "exports-prod-eu" # forces replacement
    }

Plan: 2 to add, 0 to change, 2 to destroy.`
			},
			{
				type: 'table',
				head: ['Cause', 'What it looks like', 'Fix'],
				rows: [
					['Address changed (moved into a module, renamed)', 'destroy *A* + create *B* with the same arguments', 'A `moved { from = … to = … }` block (or `terraform state mv`): the plan becomes 0 to destroy'],
					['Immutable attribute changed', '`-/+ must be replaced`, `# forces replacement`', 'A real migration: snapshot/restore, new resource alongside, cut over, then remove the old'],
					['Provider default changed on upgrade', 'replace with no code change', 'Pin the attribute explicitly to its current value']
				]
			},
			{
				type: 'callout',
				tone: 'crit',
				title: 'Guardrails',
				text: '`lifecycle { prevent_destroy = true }` on stateful resources, a CI policy that fails plans containing deletes of tagged resources, and never "fix" a scary plan with `-target`: that applies a partial plan and leaves state and code disagreeing.'
			}
		]
	},
	{
		id: 'config-drift',
		term: 'Configuration drift',
		aliases: ['drift', 'ClickOps'],
		category: 'cloud & infra',
		short:
			'Real infrastructure differing from what code declares, usually after someone fixed something by hand during an incident. The next apply "corrects" it back, re-breaking production, and it looks like a mysterious recurring outage tied to unrelated deploys. Detect drift with scheduled plans; backport every manual change to code.',
		related: ['state-lock', 'terraform-plan-replace']
	},
	{
		id: 'secret-rotation',
		term: 'Secret rotation (dual validity)',
		aliases: ['credential rotation', 'alternating users'],
		category: 'security & compliance',
		short:
			'Replacing a credential without downtime needs a window where **both** old and new are valid: create the new one, roll clients onto it gradually, then revoke the old one once nothing uses it. Changing a password in place ("single user" rotation) invalidates every client still holding the old value, which is every running pod that read it at startup.',
		related: ['scram-authentication', 'rolling-update', 'connection-storm'],
		page: [
			{
				type: 'flow',
				steps: [
					{ label: 'Create new credential', note: 'old still valid' },
					{ label: 'Publish as current', note: 'secret store: AWSCURRENT → new' },
					{ label: 'Roll clients', note: 'staged restart / reload' },
					{ label: 'Verify', note: 'no logins with old user' },
					{ label: 'Revoke old', tone: 'ok' }
				]
			},
			{
				type: 'table',
				head: ['Strategy', 'Overlap', 'Risk'],
				rows: [
					['Single user (change password)', 'none', 'Every running client fails new connections; failures grow as pools recycle'],
					['Alternating users (A/B)', 'until you revoke', 'Safe if you wait for clients to move; revoke too early = same outage'],
					['Short-lived credentials (IAM auth, Vault dynamic)', 'continuous', 'Clients must refresh tokens; no "big bang" rotation at all']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'The second trap',
				text: 'Restarting every pod at once to pick up the new secret causes a connection storm: hundreds of new DB connections authenticating in the same second (SCRAM is deliberately CPU-expensive), so the DB saturates, pods fail readiness and crash-loop. Stage the restart.'
			}
		]
	},
	{
		id: 'scram-authentication',
		term: 'SCRAM authentication cost',
		aliases: ['scram-sha-256'],
		category: 'databases',
		short:
			'Postgres\' default password authentication runs thousands of hash iterations per login, which makes it deliberately expensive in CPU. That is negligible for a steady pool, but hundreds of connections opening at once (a fleet restart, a failover) turn authentication itself into the bottleneck.',
		related: ['connection-storm', 'secret-rotation', 'pgbouncer']
	},

	// ───────────── SRE practice ─────────────
	{
		id: 'burn-rate-alert',
		term: 'Multiwindow burn-rate alert',
		aliases: ['multi-burn-rate alerting', 'SLO alerting'],
		category: 'observability',
		short:
			'Alerting on how fast you are spending the [[error-budget]], checked over a long and a short window together. A fast burn (e.g. 14× over 1 h *and* 5 min) pages; a slow burn (e.g. 1× over 3 days) opens a ticket. The long window gives significance and the short window makes the alert stop once the problem stops, so noisy blips are ignored but slow leaks are not.',
		related: ['burn-rate', 'slo', 'error-budget', 'low-traffic-ratio'],
		page: [
			{
				type: 'table',
				head: ['Severity', 'Burn rate', 'Long window', 'Short window', 'Budget spent when it fires'],
				numeric: [1],
				rows: [
					['Page', '14.4×', '1 h', '5 min', '2% of 30 days'],
					['Page', '6×', '6 h', '30 min', '5%'],
					['Ticket', '1×', '3 days', '6 h', '10%']
				],
				caption: 'For a 99.9% / 30-day SLO, budget = 0.1% errors. Burn rate 14.4× means an error rate of 1.44%.'
			},
			{
				type: 'p',
				text: 'Compare with "error rate > 1% for 5 minutes": it pages at 3 a.m. when 3 of 200 requests fail during the quiet hour (statistically meaningless, see [[low-traffic-ratio]]), and it never fires for a steady 0.4% that quietly eats 4× the budget for days.'
			}
		]
	},
	{
		id: 'postmortem',
		term: 'Blameless postmortem',
		aliases: ['incident review', 'action items'],
		category: 'reliability practice',
		short:
			'A write-up of what happened, why the system allowed it, and what changes make it less likely or less harmful. Good action items change the *system* (a guardrail, an alert, a default) and have an owner and a date; "be more careful" changes nothing, because the next person will be just as careful and just as tired.',
		related: ['severity-triage']
	},
	{
		id: 'chaos-engineering',
		term: 'Chaos engineering',
		aliases: ['fault injection', 'game day'],
		category: 'reliability practice',
		short:
			'Deliberately injecting failure (latency, errors, killed nodes) to test a hypothesis about how the system behaves, e.g. "checkout p99 stays under 800 ms if inventory slows by 300 ms". The first thing to verify is that the fault actually landed where you meant it to: "no impact" from an experiment that never touched real traffic is a false sense of safety.',
		related: ['retry-budget', 'circuit-breaker', 'service-mesh']
	},
	{
		id: 'restore-drill',
		term: 'Restore drill (RTO / RPO)',
		aliases: ['RTO', 'RPO', 'recovery time objective', 'recovery point objective'],
		category: 'reliability practice',
		short:
			'**RPO** is how much data you can afford to lose (time since the last recoverable point); **RTO** is how long recovery may take. A green backup job proves neither: only restoring, end to end, timed, into something usable shows your real RTO, which is usually dominated by data volume, lazy-loaded snapshots, log replay and index rebuilds rather than by the backup itself.',
		related: ['data-remediation', 'failover']
	},
	{
		id: 'telemetry-cost',
		term: 'Telemetry cost',
		aliases: ['log volume', 'observability bill'],
		category: 'observability',
		short:
			'Logs are billed by volume ingested and indexed; metrics by the number of unique time series. A forgotten DEBUG flag multiplies log GB; one high-cardinality label (user id, request id) on a histogram multiplies series by users × buckets. The bill reacts within hours, long before anyone looks at a dashboard.',
		related: ['metric-cardinality', 'histogram-metric', 'trace-sampling']
	}
];

export default terms;
