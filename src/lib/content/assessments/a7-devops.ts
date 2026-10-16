import type { Assessment, Panel, Question, Series, SeriesColor } from '../types';
import { dayAxis, gap, periodic, ramp, shape, timeAxis, window_ } from '../series';
import zonalPvc from '../labs/a7-zonal-pvc';
import pdbDrain from '../labs/a7-pdb-drain';
import secretRotation from '../labs/a7-secret-rotation';
import hpaRequests from '../labs/a7-hpa-requests';

// ───────────────────────── tiny builders ─────────────────────────

type TS = Extract<Panel, { kind: 'timeseries' }>;
const S = (name: string, points: (number | null)[], color?: SeriesColor, dashed?: boolean): Series => ({ name, points, color, dashed });
const ts = (title: string, x: string[], series: Series[], o: Partial<TS> = {}): Panel => ({ kind: 'timeseries', title, x, series, ...o });
const stat = (title: string, value: string, o: { delta?: string; tone?: 'ok' | 'warn' | 'crit' | 'info'; spark?: number[]; span?: 1 | 2 | 3 } = {}): Panel => ({
	kind: 'stat',
	title,
	value,
	...o
});

// ═════════════════════════ PART 1 · Kubernetes ═════════════════════════

const k1: Question = {
	id: 'k1-zonal-pvc-lab',
	group: 'Interactive labs',
	title: 'Lab: Pending after a spot reclaim',
	tag: 'tricky',
	minutes: 12,
	prompt: [
		{ type: 'p', text: 'Fix it in the console. The clock starts on your first change. Read the pod events and node-group details before you touch anything.' },
		{ type: 'lab', lab: zonalPvc }
	],
	hints: [
		'The pod event lists two reasons. Which one would adding *any* node fix, and which one only a node in a specific place would fix?',
		'Zone a is where the volumes are. Why isn\'t the autoscaler replacing the zone-a nodes by itself?'
	],
	answer: [
		{
			type: 'p',
			text: '**The tempting move**: the [[cluster-autoscaler]] "isn\'t working", so add nodes yourself in zone b where spot capacity exists. Nodes come up, sit idle, the bill rises, and the three pods stay Pending.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Read the scheduling message: `volume node affinity conflict`.',
					body: 'search-0/3/6 own EBS volumes in eu-west-1a. A [[persistent-volume-claim|PVC]] pins its pod to the disk\'s zone, so only zone-a capacity helps ([[volume-node-affinity]]).'
				},
				{
					title: 'Read why zone a isn\'t growing: `InsufficientInstanceCapacity (spot, m6i.4xlarge, eu-west-1a)`.',
					body: 'The autoscaler is doing its job; the node group can only launch one instance type from one spot pool, and that pool was just reclaimed. It will keep retrying with backoff indefinitely.'
				},
				{
					title: 'Fix the capacity source of the zone-a group.',
					body: 'Diversify the instance types (any of m6i/m6a/m7i/r6i.4xlarge satisfies the pod\'s 14-vCPU request) or switch to on-demand for this stateful group. Both win; diversification is cheaper and also cuts future reclaim risk.'
				}
			]
		},
		{
			type: 'callout',
			tone: 'crit',
			title: 'The destructive "fix"',
			text: 'Deleting the PVCs lets the pods schedule anywhere, onto **empty** volumes. Their shards\' other copies sat on the reclaimed nodes\' volumes, so two shards now exist nowhere. Never delete a stateful workload\'s volumes to unblock scheduling unless you have proven another copy exists.'
		},
		{
			type: 'p',
			text: '**Prevent:** don\'t run single-instance-type spot pools for stateful workloads; set a capacity-rebalance / mixed-instances policy; spread replicas so each shard\'s copies live in different zones *and* different capacity pools.'
		}
	]
};

const k2: Question = {
	id: 'k2-pdb-drain-lab',
	group: 'Interactive labs',
	title: 'Lab: the upgrade that waits forever',
	tag: 'tricky',
	minutes: 10,
	prompt: [{ type: 'lab', lab: pdbDrain }],
	hints: ['How many disruptions does the PDB allow right now, and what would have to be true for it to allow one?', 'If one pod is evicted, can the other carry 520 req/s?'],
	answer: [
		{
			type: 'p',
			text: '**What\'s happening:** `minAvailable: 2` with 2 replicas means `disruptionsAllowed = 0`. The eviction API refuses; the drain retries every 5 s until the window closes, and then the provider force-drains, taking both pods at once. Waiting is not neutral: it ends in the worst outcome.'
		},
		{
			type: 'table',
			head: ['Move', 'What happens'],
			rows: [
				['Delete the PDB', 'Drain evicts both payments pods in the same pass → 0 ready for 45 s → checkout down'],
				['`minAvailable: 1`', 'One pod evicted → 300 req/s of capacity for 520 req/s for ~45 s → 42% errors'],
				['**Scale to 3**, leave the PDB', 'New pod Ready on a 1.29 node → 1 disruption allowed → drain evicts one, replacement warms, then the next. Never below 2 ready.']
			]
		},
		{
			type: 'p',
			text: 'The PDB was right to block you; it was protecting capacity you actually need. The fix is to **add surge capacity** so a voluntary disruption is affordable. Long-term: replicas ≥ 3 for anything with a 2-pod capacity floor, `maxUnavailable: 1` instead of `minAvailable: N`, and spread replicas across nodes so one drain never hits two at once ([[pod-disruption-budget]]).'
		}
	]
};

const k3: Question = {
	id: 'k3-hpa-lab',
	group: 'Interactive labs',
	title: 'Lab: traffic tripled, the autoscaler shrugged',
	tag: 'tricky',
	minutes: 10,
	prompt: [{ type: 'lab', lab: hpaRequests }],
	hints: ['What is the highest CPU utilization this pod can ever report to the HPA?', 'What does "utilization" divide by?'],
	answer: [
		{
			type: 'p',
			text: '**The trap:** the pods look saturated, so raise the CPU limit and `maxReplicas`. Nothing changes: HPA CPU utilization is `usage ÷ request` ([[horizontal-pod-autoscaler]]). A single-process Node.js server can use at most ~1 core, and it requests 2000m, so utilization tops out at **50%** against a 70% target. The HPA sees a calm service; it actually computes a *smaller* desired count than it has.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Set the request to what the process can use (1000m).',
					body: 'Utilization now reaches 100% under load, the HPA doubles every sync, and you also stop paying for a core per pod that was never used. This is the real fix ([[resource-requests]]).'
				},
				{
					title: 'Or lower the target below the reachable ceiling (e.g. 40%).',
					body: 'Works, but bakes in a lie: "40%" now means "80% busy". The next person who changes the request breaks scaling again.'
				},
				{
					title: 'Better still: scale on a load metric (req/s or event-loop lag per pod).',
					body: 'CPU is a proxy; for an event-loop service, [[event-loop]] lag or concurrency per pod tracks saturation directly.'
				}
			]
		},
		{
			type: 'p',
			text: '**How you would have spotted it on the console:** HPA `cpu: 50% / 70%` flat at exactly 50 while latency explodes is the signature of a request the workload can\'t reach.'
		}
	]
};

const kEvictX = timeAxis('02:00', 60);
const k4: Question = {
	id: 'k4-evicted-flat-memory',
	group: 'Read the evidence',
	title: 'Evicted, but memory is flat',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{
			type: 'p',
			text: '`ledger-sync` pods get replaced several times a night. The on-call note says "OOM again, bump memory limit to 4Gi?". Look before you approve.'
		},
		{
			type: 'code',
			lang: 'text',
			code: `$ kubectl describe pod ledger-sync-7d9c6-xk2lp
Status:         Failed
Reason:         Evicted
Message:        The node was low on resource: ephemeral-storage. Threshold quantity: 10%,
                available: 7612Mi. Container ledger-sync was using 13Gi, request is 0,
                has larger consumption of ephemeral-storage.
Containers:
  ledger-sync:
    Limits:    cpu: 1, memory: 2Gi
    Requests:  cpu: 500m, memory: 2Gi
    Last State: Terminated  Reason: Error  Exit Code: 137 (2 days ago)
QoS Class:     Burstable
Events:
  Warning  Evicted   3m  kubelet  The node was low on resource: ephemeral-storage.`
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'node ip-10-0-7-41',
				range: '02:00 – 03:00',
				panels: [
					ts('Container memory (working set)', kEvictX, [S('ledger-sync', shape(60, { base: 1.1, noise: 0.03, seed: 2, round: 2 }, window_(44, 46, 0.3))), S('limit', Array(60).fill(2), 4, true)], { unit: ' GiB', span: 3 }),
					ts('Node filesystem used', kEvictX, [S('/var/lib (kubelet + logs)', shape(60, { base: 62, noise: 0.005, seed: 3, round: 1 }, ramp(10, 44, 62, 90.5), window_(44, 46, 63), ramp(46, 60, 63, 75)))], {
						unit: '%',
						span: 3,
						thresholds: [{ value: 90, label: 'eviction (10% free)' }],
						markers: [{ at: 10, label: 'batch starts' }, { at: 44, label: 'evicted' }]
					}),
					ts('Log lines/s (ledger-sync stdout)', kEvictX, [S('lines/s', shape(60, { base: 40, noise: 0.1, seed: 5 }, window_(10, 44, 9200), window_(46, 60, 9100)))], { span: 3 }),
					ts('CPU throttled %', kEvictX, [S('throttled', shape(60, { base: 18, noise: 0.25, seed: 7 }))], { unit: '%', span: 3 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Not OOM.** The pod was *evicted* for **ephemeral-storage**: the node\'s disk crossed the 90% eviction threshold, and ledger-sync was the biggest consumer (13 Gi, request 0). Memory sat at ~1.1 GiB of a 2 GiB limit the whole time. Bumping the memory limit changes nothing ([[eviction]] vs [[oomkilled]]).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Container logs are ephemeral storage.',
					body: 'From 02:10 the batch logs ~9,200 lines/s to stdout. The kubelet keeps those log files on the node disk, so the filesystem climbs to 90.5% by 02:44, and the kubelet evicts the top consumer ([[ephemeral-storage]]).',
					confirm: '`du` under `/var/log/pods/…ledger-sync…` on the node; container log rotation settings (`containerLogMaxSize`).'
				},
				{
					title: 'Why it repeats.',
					body: 'The replacement lands on another node, resumes the batch, and fills that disk too. Each eviction looks like a fresh, unrelated "crash".'
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Red herrings',
			text: '**Exit code 137 two days ago** was a real OOM kill, but an old one, unrelated to tonight. **18% CPU throttling** is ordinary for a 1-core limit and doesn\'t move with the incident.'
		},
		{
			type: 'p',
			text: '**Fix:** turn the per-record DEBUG logging off (it\'s 9k lines/s of nothing), set `ephemeral-storage` requests/limits so the scheduler accounts for it, cap log rotation size, and alert on node filesystem % before the kubelet does it for you.'
		}
	]
};

const k5: Question = {
	id: 'k5-ndots',
	group: 'Read the evidence',
	title: 'Partner API calls take exactly 5 seconds, sometimes',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{
			type: 'p',
			text: 'Since a traffic increase, ~2% of calls from `payments` to `api.partner-bank.com` take 5.0–5.1 s, a few take 10 s. Calls to in-cluster services (`ledger.payments`) are fine. The partner says their p99 is 80 ms. Someone proposes scaling CoreDNS from 2 to 10 replicas.'
		},
		{
			type: 'trace',
			trace: {
				title: 'POST /payouts (slow sample)',
				traceId: '9f2c…a71',
				spans: [
					{ id: 'a', service: 'payments', name: 'POST /payouts', start: 0, duration: 5190 },
					{ id: 'b', parent: 'a', service: 'payments', name: 'ledger.payments GET /balance', start: 4, duration: 21 },
					{ id: 'c', parent: 'a', service: 'payments', name: 'dns.lookup api.partner-bank.com', start: 30, duration: 5012, note: '8 queries sent; the AAAA query for the third search domain got no reply; resolver timeout is 5 s.' },
					{ id: 'd', parent: 'a', service: 'payments', name: 'https POST api.partner-bank.com/payouts', start: 5045, duration: 140 }
				]
			}
		},
		{
			type: 'code',
			lang: 'text',
			caption: 'From inside the pod.',
			code: `$ cat /etc/resolv.conf
nameserver 172.20.0.10
search payments.svc.cluster.local svc.cluster.local cluster.local eu-west-1.compute.internal
options ndots:5

$ conntrack -S | grep insert_failed
cpu=0 ... insert_failed=1834 ...`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The 5 s is a resolver timeout, not latency.** With `ndots:5`, `api.partner-bank.com` (2 dots) is tried with every search domain first: 4 failing names × (A + AAAA) + the real one = up to 10 queries ([[ndots]]). glibc sends A and AAAA in parallel over one UDP socket; under load the node\'s conntrack table races (`insert_failed` climbing) and drops one, and the resolver waits its full 5 s timeout. Two drops = 10 s.'
		},
		{
			type: 'p',
			text: 'In-cluster calls are fast because `ledger.payments` resolves on the **first** search domain: one query pair, small chance of a drop.'
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Why scaling CoreDNS is the wrong fix',
			text: 'CoreDNS isn\'t slow; packets are lost *before* reaching it. Ten replicas answer the same 10 wasted queries; the drop happens in the node\'s conntrack.'
		},
		{
			type: 'list',
			items: [
				'**Now:** use the FQDN with a trailing dot (`api.partner-bank.com.`) in config, or set `dnsConfig.options ndots: "2"` on `payments`.',
				'**Properly:** NodeLocal DNSCache (TCP to upstream, no conntrack race), `single-request-reopen` where glibc is used, and cache resolved partner addresses in the HTTP client ([[dns-caching]]).',
				'**Verify:** the slow-sample rate should go to ~0, and DNS queries per payout from ~10 to 2.'
			]
		}
	]
};

const k6: Question = {
	id: 'k6-image-pull-429',
	group: 'Read the evidence',
	title: 'Only the new nodes can\'t start pods',
	tag: 'core',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'A scale-out added 40 nodes for a load test. Pods on old nodes are fine; ~70% of pods on new nodes are stuck. Docker Hub\'s status page is green.'
		},
		{
			type: 'logs',
			logs: {
				style: 'terminal',
				title: 'kubectl get events -A --field-selector reason=Failed',
				lines: [
					{ ts: '14:02:11', level: 'WARN', source: 'kubelet/ip-10-0-9-12', msg: 'Failed to pull image "envoyproxy/envoy:v1.30.1": toomanyrequests: You have reached your unauthenticated pull rate limit.' },
					{ ts: '14:02:11', level: 'WARN', source: 'kubelet/ip-10-0-9-40', msg: 'Failed to pull image "envoyproxy/envoy:v1.30.1": 429 Too Many Requests' },
					{ ts: '14:02:13', level: 'INFO', source: 'kubelet/ip-10-0-9-07', msg: 'Successfully pulled image "123456789.dkr.ecr.eu-west-1.amazonaws.com/api:4f1c2" in 2.1s' },
					{ ts: '14:02:19', level: 'WARN', source: 'kubelet/ip-10-0-9-33', msg: 'Back-off pulling image "envoyproxy/envoy:v1.30.1"' },
					{ ts: '14:02:24', level: 'INFO', source: 'kubelet/ip-10-0-2-15', msg: 'Container image "envoyproxy/envoy:v1.30.1" already present on machine' }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Anonymous pull rate limit per source IP.** The app image comes from your private registry and pulls fine; the **sidecar** (`envoyproxy/envoy`) comes from Docker Hub anonymously. Every node egresses through the same NAT gateway IPs, so the whole cluster shares one quota. Old nodes have the image cached ("already present"); 40 fresh nodes pulling at once exhaust it ([[image-pull-rate-limit]]).'
		},
		{
			type: 'p',
			text: '**Tempting but wrong:** "registry outage" (status green, and your own registry works) or raising back-off (it just waits longer for a quota window).'
		},
		{
			type: 'list',
			items: [
				'**Now:** mirror the image into your private registry (or a pull-through cache) and point the sidecar injector at it; or authenticate pulls.',
				'**Properly:** policy that bans public-registry images in prod manifests, pin images by digest ([[image-digest]]), and bake common images into the node AMI so scale-outs don\'t depend on the internet at all.'
			]
		}
	]
};

const k7: Question = {
	id: 'k7-configmap',
	group: 'Read the evidence',
	title: 'The config change that half-applied',
	tag: 'tricky',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'You raised `RATE_LIMIT_PER_MIN` from 600 to 1200 in a ConfigMap at 10:00 to unblock a partner. At 15:00 the partner says ~60% of their requests still get 429 after 600/min. Roughly 40% of pods do enforce 1200.'
		},
		{
			type: 'code',
			lang: 'yaml',
			code: `spec:
  template:
    spec:
      containers:
        - name: gateway
          envFrom:
            - configMapRef: { name: gateway-config }
---
# HPA history today
10:42  scaled 12 -> 18   (load)
13:10  scaled 18 -> 20`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Env vars are read at container start.** `envFrom` copies the ConfigMap into the environment once; editing the ConfigMap never touches running containers. The ~40% of pods that enforce 1200 are exactly the **8 created by HPA scale-ups after 10:00** (12 → 20). The original 12 still run with 600 ([[configmap-reload]]).'
		},
		{
			type: 'p',
			text: 'That is the tricky bit: partial rollout *looks* like a caching or propagation delay, and someone will wait another hour. Nothing will change until those pods restart, and an HPA scale-down could even remove the new ones first.'
		},
		{
			type: 'list',
			items: [
				'**Now:** `kubectl rollout restart deploy/gateway` (staged, respecting the PDB).',
				'**Properly:** a `checksum/config` annotation computed from the ConfigMap in the pod template (Helm/Kustomize), so config changes roll out like code; or immutable, versioned ConfigMaps (`gateway-config-v7`) referenced by the Deployment, so a rollback restores the old config too.'
			]
		}
	]
};

const k8: Question = {
	id: 'k8-ca-useless-nodes',
	group: 'Read the evidence',
	title: 'The autoscaler keeps buying GPU nodes nobody uses',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{
			type: 'p',
			text: 'Finance flags three idle `g5.2xlarge` nodes ($1.21/h each) appearing every afternoon. The cluster has a `gpu-ng` group (min 0) for the ML team, plus `general-ng` at its max of 30. During afternoon peaks, some API pods are Pending.'
		},
		{
			type: 'logs',
			logs: {
				style: 'terminal',
				title: 'cluster-autoscaler + scheduler',
				lines: [
					{ ts: '15:31:02', level: 'INFO', source: 'cluster-autoscaler', msg: 'Pod api/api-6b8f9-q2x is unschedulable' },
					{ ts: '15:31:02', level: 'INFO', source: 'cluster-autoscaler', msg: 'Best option to resize: gpu-ng (template node fits pod)' },
					{ ts: '15:31:02', level: 'INFO', source: 'cluster-autoscaler', msg: 'Final scale-up plan: [{gpu-ng 0->3 (max: 10)}]' },
					{ ts: '15:33:40', level: 'WARN', source: 'default-scheduler', msg: 'api-6b8f9-q2x: 0/33 nodes are available: 3 node(s) had untolerated taint {nvidia.com/gpu: present}, 30 Insufficient cpu.' },
					{ ts: '15:41:02', level: 'INFO', source: 'cluster-autoscaler', msg: 'gpu-ng: node ip-10-0-12-5 unneeded for 10m, but scale-down skipped: recently scaled up' }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The autoscaler\'s template of `gpu-ng` is wrong.** A group at 0 nodes has no live node to copy, so the [[cluster-autoscaler]] builds a template from the node group\'s tags. The real GPU nodes get a `nvidia.com/gpu` taint at boot (from the device plugin / user data), but the group isn\'t tagged with it, so the autoscaler simulates "an API pod fits on a GPU node", buys three, and then the scheduler (which sees the real taint) refuses to place the pod.'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Declare the taint (and labels) on the node group template.',
					body: 'e.g. ASG tag `k8s.io/cluster-autoscaler/node-template/taint/nvidia.com/gpu: present:NoSchedule`. Now the simulation matches reality and gpu-ng is never chosen for API pods.'
				},
				{
					title: 'Then fix the actual shortage: general-ng is at max.',
					body: 'The Pending API pods are a real capacity problem the GPU detour was hiding. Raise the max or add a second general group, and use an expander priority so expensive groups are last resort.'
				}
			]
		},
		{
			type: 'p',
			text: '**Wrong first guesses:** "the ML team is leaving jobs running" (logs show the autoscaler chose gpu-ng for an API pod) and "set gpu-ng max to 0" (stops the waste, but hides that API pods still can\'t schedule).'
		}
	]
};

// ═════════════════════════ PART 2 · Pipelines & releases ═════════════════════════

const r1: Question = {
	id: 'r1-rollback-same-tag',
	group: 'Pipelines & releases',
	title: 'The rollback deployed the bug again',
	tag: 'tricky',
	minutes: 7,
	prompt: [
		{ type: 'p', text: 'v2.14 broke checkout. On-call ran the "rollback" job, which re-applies yesterday\'s manifest. Pods restarted. Checkout is still broken.' },
		{
			type: 'code',
			lang: 'text',
			code: `# yesterday's manifest (re-applied by rollback job)
image: registry.internal/checkout:stable
imagePullPolicy: Always

# registry history for checkout:stable
2026-10-15 17:02  stable -> sha256:4b1e…  (v2.13, built 10-15)
2026-10-16 09:40  stable -> sha256:9c07…  (v2.14, built 10-16)   ← promote job moved the tag

$ kubectl get pods -o jsonpath='{..imageID}' | sort | uniq -c
     24 registry.internal/checkout@sha256:9c07…`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The manifest didn\'t change; the tag did.** `checkout:stable` is a movable pointer, and the promote job moved it to v2.14 this morning. Re-applying yesterday\'s YAML pulls whatever `stable` means *now*: the broken build. Every pod reports digest `9c07…` ([[image-digest]]).'
		},
		{
			type: 'list',
			items: [
				'**Now:** deploy `checkout@sha256:4b1e…` explicitly (or re-point `stable` to it, but that leaves the trap in place).',
				'**Properly:** CI resolves tags to digests at deploy time and writes the digest into the manifest; registry tag immutability for release tags; rollbacks redeploy a previous *digest*, never rebuild and never re-resolve a tag.',
				'**Also suspect:** `imagePullPolicy: Always` with a movable tag means any pod restart (node drain, eviction) can silently upgrade a pod mid-week.'
			]
		}
	]
};

const r2: Question = {
	id: 'r2-flaky-retry',
	group: 'Pipelines & releases',
	title: 'The flaky test that was telling the truth',
	tag: 'tricky',
	minutes: 7,
	prompt: [
		{
			type: 'p',
			text: 'To speed up merges, CI was set to retry failed tests up to 3 times. `test_concurrent_refunds` fails ~8% of first attempts and always passes on retry, so it\'s been marked "flaky, known". This week production issued duplicate refunds for 11 orders.'
		},
		{
			type: 'logs',
			logs: {
				style: 'terminal',
				title: 'CI · unit-tests (attempt 1 of 3)',
				lines: [
					{ ts: '00:01:12', msg: 'test_concurrent_refunds ... FAILED' },
					{ ts: '00:01:12', level: 'ERROR', msg: 'AssertionError: expected 1 refund for order 42, found 2' },
					{ ts: '00:01:12', msg: '  refund_ids = [r_81f2, r_81f3]  (created 3 ms apart)' },
					{ ts: '00:01:31', msg: 'Retrying 1 failed test (attempt 2 of 3)' },
					{ ts: '00:01:33', msg: 'test_concurrent_refunds ... PASSED' },
					{ ts: '00:01:33', msg: '✓ All tests passed (1 flaky)' }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The test found the production bug weeks ago.** Its failure message is the incident: two refunds 3 ms apart for one order, a check-then-act [[race-condition]] in the refund path. It fails 8% of the time because the race window is small; retries turned a correct red into a misleading green ([[flaky-test]]).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Classify flakes before quarantining.',
					body: 'Infra flakes (network, slow runner) fail with timeouts; product races fail with *wrong results*. An assertion about business data ("2 refunds") is never noise.'
				},
				{ title: 'Track flake rate per test as a signal.', body: 'A retry that passes should still be reported and trended, with an owner and a ticket when it exceeds a threshold.' },
				{ title: 'Reproduce with load, not luck.', body: 'Run the test 500× in parallel, or with a deliberate delay between check and write; fix with a unique constraint / conditional update on `(order_id)` for refunds.' }
			]
		},
		{ type: 'p', text: '**Remediation:** find all orders with >1 refund since the retry policy shipped, reverse the extras, then fix the code.' }
	]
};

const r3: Question = {
	id: 'r3-cache-poisoning',
	group: 'Pipelines & releases',
	title: 'The release contained code nobody wrote',
	tag: 'tricky',
	minutes: 9,
	prompt: [
		{
			type: 'p',
			text: 'A customer\'s security team reports that your published SDK `v3.2.0` sends telemetry to an unknown domain. The string is not in your git history at any commit. Release builds run on your fleet of **self-hosted CI runners**, which also run pull-request builds (including from forks) to save money. Runners keep `~/.npm`, `node_modules` and the Docker build cache between jobs.'
		},
		{
			type: 'code',
			lang: 'yaml',
			code: `on: [push, pull_request]
jobs:
  build:
    runs-on: [self-hosted, linux]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci --prefer-offline
      - run: npm run build
      - if: startsWith(github.ref, 'refs/tags/v')
        run: npm publish   # NPM_TOKEN from repo secrets`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Cache poisoning through a shared, persistent runner** ([[ci-cache-poisoning]]). A fork PR\'s build runs arbitrary code (`npm ci` runs install scripts; the PR can change `package.json` and the build itself) on the same machine that later builds the release. It can write into `~/.npm`, leave a modified package in the cache, or plant a Docker layer. The release job then restores it with `--prefer-offline` and publishes it: reviewed source, unreviewed artifact.'
		},
		{
			type: 'p',
			text: '**Why it wasn\'t found in git:** the malicious bytes never entered the repository. Diffing the published tarball against a clean rebuild is how you prove it.'
		},
		{
			type: 'list',
			items: [
				'**Now:** unpublish/deprecate 3.2.0, rotate `NPM_TOKEN` and every secret those runners could read, rebuild from a clean environment, notify customers.',
				'**Properly:** ephemeral runners (fresh VM per job); never run untrusted PRs on runners that touch release credentials; scope caches by trust (fork PRs read-only at most); `npm ci --ignore-scripts` where possible; build provenance (SLSA attestation) and a reproducible-build check that compares the artifact to a clean build before publish.'
			]
		}
	]
};

const canX = timeAxis('10:00', 60);
const r4: Question = {
	id: 'r4-canary-power',
	group: 'Pipelines & releases',
	title: 'The canary passed. Coupons broke for everyone.',
	tag: 'tricky',
	minutes: 9,
	prompt: [
		{
			type: 'p',
			text: 'v5.8 changed coupon redemption. Policy: 5% canary for 30 min, auto-promote if canary error rate ≤ baseline + 0.2 pp. It promoted at 10:30; at 10:41 support reports "coupon codes give a payment error". Total traffic ~400 req/s; ~0.3% of requests redeem a coupon.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'datadog',
				title: 'checkout · canary analysis v5.8',
				range: '10:00 – 11:00',
				panels: [
					ts('Error rate (all endpoints)', canX, [S('baseline', shape(60, { base: 0.41, noise: 0.08, seed: 3, round: 2 })), S('canary', gap(shape(60, { base: 0.43, noise: 0.25, seed: 4, round: 2 }), 30, 60), 3)], {
						unit: '%',
						span: 3,
						markers: [{ at: 30, label: 'promoted 100%' }]
					}),
					ts('Coupon redemptions failing', canX, [S('failures/min', shape(60, { base: 0, noise: 0, seed: 1 }, window_(30, 60, 13), periodic(7, 1, 1, 2)))], { span: 3, markers: [{ at: 30, label: 'promoted' }] }),
					stat('Canary coupon requests (30 min)', '108', { tone: 'warn' }),
					stat('Canary coupon failures', '23', { tone: 'crit', delta: 'nobody looked at this panel' }),
					stat('Canary total requests', '36,000'),
					stat('Analysis verdict', 'PASS', { tone: 'ok', delta: 'Δ +0.06 pp ≤ 0.2 pp' })
				]
			}
		}
	],
	hints: ['How many coupon requests did the canary actually see?', 'How much does 23 failures move a rate computed over 36,000 requests?'],
	answer: [
		{
			type: 'p',
			text: '**The canary had no statistical power for the change it was testing** ([[canary-analysis]]). 5% × 0.3% × 400 req/s × 1,800 s ≈ **108 coupon requests**. 23 of them failed (21%), a catastrophic regression, but diluted into 36,000 canary requests it shifts the overall error rate by **+0.06 pp**, well inside the 0.2 pp gate.'
		},
		{
			type: 'ranked',
			items: [
				{ title: 'Gate on the metrics of the changed path.', body: 'Per-endpoint (or per-feature) error rate and latency for whatever the diff touches, not just service-wide.' },
				{ title: 'Size the canary for the path, not the service.', body: 'Duration × share must yield enough samples of the changed path to detect the failure rate you care about, or add synthetic traffic that exercises it.' },
				{ title: 'Ship rare paths behind a flag instead.', body: 'Turn coupons-v2 on for staff and 1% of users with coupons; a [[feature-flag]] targets the behaviour, a traffic canary only targets requests.' }
			]
		},
		{ type: 'p', text: '**Rule out:** "baseline was noisy". Baseline and canary overall rates are within noise of each other, which is precisely the problem.' }
	]
};

const r5: Question = {
	id: 'r5-irreversible-migration',
	group: 'Pipelines & releases',
	title: 'Rollback failed: column does not exist',
	tag: 'core',
	minutes: 6,
	prompt: [
		{ type: 'p', text: 'v41 shipped with a migration. v41 has a bug, so on-call rolls back to v40. v40 crash-loops immediately.' },
		{
			type: 'code',
			lang: 'text',
			code: `-- migrations/0187_cleanup.sql (ran during v41 deploy)
ALTER TABLE orders DROP COLUMN legacy_status;

-- v40 pod log
psycopg.errors.UndefinedColumn: column orders.legacy_status does not exist
LINE 1: SELECT id, status, legacy_status FROM orders WHERE ...`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The release combined a code change with a destructive schema change, so it can\'t be rolled back.** v40 still reads `legacy_status`; the column is gone. Rolling back code doesn\'t roll back the database. This violates [[expand-contract-migration|expand/contract]]: the "contract" step (drop) must ship at least one release *after* no deployed version reads the column.'
		},
		{
			type: 'list',
			items: [
				'**Now:** roll **forward**: hotfix v41\'s bug, or re-add the column (nullable) so v40 boots, then decide. Recovering dropped data needs a restore/PITR, which you should avoid if the data was truly unused.',
				'**Properly:** a CI check that runs version N\'s test suite against N+1\'s schema (proves rollback compatibility); destructive migrations require a separate, later release; ORMs that select `*` explicitly listed columns make drops even riskier.'
			]
		}
	]
};

const r6: Question = {
	id: 'r6-monorepo-affected',
	group: 'Pipelines & releases',
	title: 'Billing broke, but billing\'s CI never ran',
	tag: 'core',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'A PR changed `libs/money/round.ts` (banker\'s → half-up rounding). CI was green; it ran `libs/money` tests and the `apps/web` tests. Three days later an unrelated billing change deployed, and invoice totals changed by a cent for thousands of customers.'
		},
		{
			type: 'code',
			lang: 'yaml',
			code: `# .github/workflows/billing.yml
on:
  pull_request:
    paths: ['apps/billing/**']

# apps/billing/src/invoice.ts
import { roundMoney } from '../../../libs/money/round';  // relative import`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Path filters are not a dependency graph** ([[affected-targets]]). Billing\'s workflow only triggers on `apps/billing/**`, so a change to a library billing imports never ran billing\'s tests. The broken behaviour then shipped silently with the *next* billing deploy, three days later, attributed to the wrong PR.'
		},
		{
			type: 'list',
			items: [
				'**Properly:** compute affected projects from the build tool\'s graph (Nx, Bazel, Turborepo, Pants) so `libs/money` → every dependant; forbid deep relative imports across package boundaries (they hide edges); nightly full build as a backstop.',
				'**And:** a golden-file test on invoice totals in billing would have caught a one-cent change in seconds.'
			]
		}
	]
};

const r7: Question = {
	id: 'r7-flag-cleanup',
	group: 'Pipelines & releases',
	title: 'Cleaning up flags turned on a 2-year-old experiment',
	tag: 'tricky',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'A product manager archived 40 "stale" flags in the flag dashboard on Friday. Since then, a handful of EU customers see a new tax calculation that was abandoned in 2024. No deploy happened.'
		},
		{
			type: 'code',
			lang: 'typescript',
			code: `// tax/engine.ts (last touched 2024-03)
const useNewTax = flags.bool('new_tax_engine_v2', /* default */ true);
//                                                  ^ set to true while testing locally`
		},
		{
			type: 'logs',
			logs: {
				style: 'kibana',
				query: 'message:"flag not found"',
				lines: [
					{ ts: 'Fri 17:02:11', level: 'WARN', source: 'billing', msg: 'flag not found: new_tax_engine_v2, using default' },
					{ ts: 'Fri 17:02:11', level: 'WARN', source: 'billing', msg: 'flag not found: checkout_v3_layout, using default' }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Deleting a flag hands control to the code default** ([[flag-debt]]). While the flag existed it evaluated to `false` for everyone; archived, the SDK returns the hard-coded default `true`, set long ago for local testing. "Only some EU customers" = the code path only runs for EU tax jurisdictions.'
		},
		{
			type: 'list',
			items: [
				'**Now:** recreate the flag as `false` (fastest, no deploy), then remove the dead code.',
				'**Properly:** flag removal = code removal first, dashboard last; defaults must be the safe/old behaviour; alert on "flag not found" (it is never benign); every flag gets an owner and an expiry date.'
			]
		}
	]
};

// ═════════════════════════ PART 3 · IaC & config ═════════════════════════

const i1: Question = {
	id: 'i1-secret-rotation-lab',
	group: 'Interactive labs',
	title: 'Lab: rotate the DB password without an outage',
	tag: 'tricky',
	minutes: 14,
	prompt: [{ type: 'lab', lab: secretRotation }],
	hints: [
		'When the password changes, which pods break, and when? (Think about pool connections being recycled.)',
		'Look at the Deployment\'s rolling update setting before you restart anything.',
		'Is there a way for both the old and the new credential to be valid for a while?'
	],
	answer: [
		{
			type: 'p',
			text: 'Two traps stacked on top of each other ([[secret-rotation]]):'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'Single-user rotation has no overlap.',
					body: 'The password changes instantly; every running pod still holds the old one. Existing pooled connections keep working, so it looks fine for a minute, then failures rise as connections recycle (5 min max lifetime) and can\'t reconnect. Even a perfect staged restart can\'t outrun it.'
				},
				{
					title: '`maxUnavailable: 100%` turns the restart into a connection storm.',
					body: '30 pods × 20 connections authenticating in the same seconds: [[scram-authentication|SCRAM]] is deliberately CPU-expensive, the DB saturates, readiness fails, pods crash-loop and retry together ([[connection-storm]], [[rolling-update]]).'
				}
			]
		},
		{
			type: 'p',
			text: '**The winning sequence:** switch to **alternating users** (two valid credentials) → rotate (new user becomes current; old still valid) → set `maxUnavailable` to ~10% → rollout restart → wait until zero pods use the previous credential → **then** revoke it.'
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'Long-term',
			text: 'Make rotation a non-event: short-lived DB credentials (IAM auth / dynamic secrets), clients that reload credentials without restarting, and a connection pooler (PgBouncer/RDS Proxy) so a fleet restart doesn\'t mean hundreds of fresh logins.'
		}
	]
};

const i2: Question = {
	id: 'i2-terraform-plan',
	group: 'Infrastructure as code',
	title: 'Approve this plan?',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{
			type: 'p',
			text: 'A PR titled "refactor: move RDS into module, enable encryption" has this plan. The author notes "the destroy is just Terraform being weird about modules, it\'ll recreate it". You\'re the approver.'
		},
		{
			type: 'code',
			lang: 'text',
			code: `Terraform will perform the following actions:

  # aws_db_instance.orders will be destroyed
  # (because aws_db_instance.orders is not in configuration)
  - resource "aws_db_instance" "orders" {
      - identifier        = "orders-prod" -> null
      - allocated_storage = 2000 -> null
      ...
    }

  # module.orders_db.aws_db_instance.this will be created
  + resource "aws_db_instance" "this" {
      + identifier        = "orders-prod"
      + storage_encrypted = true
      + allocated_storage = 2000
      ...
    }

Plan: 1 to add, 0 to change, 1 to destroy.`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Reject.** Applying this deletes the production orders database and creates an empty one with the same name ([[terraform-plan-replace]]). Two separate problems are hidden in one diff:'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'The address moved.',
					body: 'Terraform tracks resources by address; `aws_db_instance.orders` → `module.orders_db.aws_db_instance.this` reads as delete + create. A `moved { from = aws_db_instance.orders, to = module.orders_db.aws_db_instance.this }` block makes it a no-op.'
				},
				{
					title: 'Encryption can\'t be enabled in place.',
					body: 'Even with the move fixed, `storage_encrypted = true` forces replacement. Encrypting an existing RDS instance is a migration: encrypted snapshot copy → restore → cut over (or a replica-based switchover), with a maintenance plan.'
				}
			]
		},
		{
			type: 'list',
			items: [
				'Split the PR: (1) refactor with `moved` → plan must say **0 to destroy**; (2) encryption as a planned migration.',
				'Add `lifecycle { prevent_destroy = true }` to stateful resources and a CI policy that fails any plan deleting a resource tagged `data=critical`.',
				'Never "get around it" with `-target`; it applies part of the plan and leaves code and state disagreeing.'
			]
		}
	]
};

const i3: Question = {
	id: 'i3-state-lock',
	group: 'Infrastructure as code',
	title: 'The lock that\'s been held for three days',
	tag: 'core',
	minutes: 6,
	prompt: [
		{ type: 'p', text: 'Every Terraform run in `network-prod` fails. A colleague says "just force-unlock it, the CI job crashed on Tuesday".' },
		{
			type: 'code',
			lang: 'text',
			code: `Error: Error acquiring the state lock
Lock Info:
  ID:        5d0f2a7e-…
  Path:      tf-state/network-prod/terraform.tfstate
  Operation: OperationTypeApply
  Who:       runner@ci-runner-17
  Version:   1.9.4
  Created:   2026-10-13 16:48:02 UTC`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Force-unlock is the last step, not the first** ([[state-lock]]). The lock says an **apply** started Tuesday on `ci-runner-17`. Two things to establish:'
		},
		{
			type: 'ranked',
			items: [
				{ title: 'Is anything still running?', body: 'Check the runner and the CI job. A hung apply waiting on a slow resource (e.g. a NAT gateway delete) may still wake up and write state. Unlocking under it lets two writers corrupt the state.' },
				{ title: 'How far did the crashed apply get?', body: 'An apply that died mid-way may have created/changed real resources without recording them. After unlocking, run `terraform plan` (refresh) and reconcile: import orphans, don\'t blindly apply.' }
			]
		},
		{
			type: 'p',
			text: '**Then** `terraform force-unlock 5d0f2a7e-…`. **Properly:** CI jobs with a timeout and a cleanup step, one serialized pipeline per state, alerts on locks older than an hour, and state bucket versioning so a bad write can be reverted.'
		}
	]
};

const i4: Question = {
	id: 'i4-drift',
	group: 'Infrastructure as code',
	title: 'The outage that comes back every Thursday',
	tag: 'tricky',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'For three weeks, the partner webhook integration breaks for ~20 minutes every Thursday afternoon, then someone "fixes" it by adding an inbound rule in the cloud console. The weekly infra release goes out Thursdays at 14:00. Each time the plan showed "1 to change", which reviewers approved as routine.'
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Configuration drift being "corrected" back** ([[config-drift]]). The console fix (an inbound security-group rule for the partner\'s new IPs) never made it into code. Every Thursday\'s apply sees a difference from the declared state and removes it: Terraform is doing exactly its job. The "1 to change" line was the outage, approved weekly.'
		},
		{
			type: 'list',
			items: [
				'**Now:** add the rule to code; apply; stop the ClickOps loop.',
				'**Properly:** a nightly `terraform plan` that alerts on any drift; read-only console access in prod (break-glass with an audit trail); incident runbooks that end with "backport the manual change"; plan review that shows *what* changes, not just counts.',
				'**Don\'t:** `lifecycle { ignore_changes = [ingress] }`. That hides the drift forever and makes the code lie about production.'
			]
		}
	]
};

// ═════════════════════════ PART 4 · SRE practice ═════════════════════════

const burnX = dayAxis('Sep 01', 30);
const s1: Question = {
	id: 's1-burn-rate',
	group: 'SRE practice',
	title: 'An alert that pages for nothing and sleeps through the fire',
	tag: 'design',
	minutes: 10,
	prompt: [
		{
			type: 'p',
			text: 'SLO: 99.9% of API requests succeed over 30 days. Current alert: **error rate > 1% for 5 min → page**. Last month it paged 19 times between 02:00 and 04:00 (traffic ~3 req/s) and didn\'t page at all for a regression that ran at ~0.4% errors for 9 days.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'api · SLO',
				range: 'September',
				panels: [
					ts('Daily error rate', burnX, [S('errors %', shape(30, { base: 0.05, noise: 0.3, seed: 8, round: 3 }, window_(12, 21, 0.4)))], {
						unit: '%',
						span: 4,
						thresholds: [{ value: 1, label: 'current page threshold' }, { value: 0.1, tone: 'warn', label: 'SLO (0.1%)' }]
					}),
					ts('Error budget remaining', burnX, [S('budget %', shape(30, { base: 100, noise: 0, seed: 1, round: 0 }, ramp(0, 12, 100, 82), ramp(12, 21, 82, -38), ramp(21, 30, -38, -43)))], { unit: '%', span: 2 })
				]
			}
		},
		{ type: 'p', text: 'Design the alerting. Be specific: windows, thresholds, what pages vs what opens a ticket.' }
	],
	answer: [
		{
			type: 'p',
			text: '**Both failures have the same cause:** a threshold on the instantaneous ratio. At 3 req/s, 5 minutes is ~900 requests; 10 failures = 1.1% → page, statistically meaningless ([[low-traffic-ratio]]). Meanwhile 0.4% is under 1%, so it never fires, yet it is a 4× [[burn-rate]] that blew through the entire budget in 9 days.'
		},
		{
			type: 'table',
			head: ['Alert', 'Condition (budget = 0.1%)', 'Action'],
			rows: [
				['Fast burn', 'error rate > 1.44% (14.4×) over **1 h** AND over **5 min**', 'page'],
				['Medium burn', '> 0.6% (6×) over **6 h** AND over **30 min**', 'page'],
				['Slow burn', '> 0.1% (1×) over **3 days** AND over **6 h**', 'ticket, business hours'],
				['Low-traffic guard', 'require ≥ N requests in the window (or use synthetic probes)', 'suppress noise']
			]
		},
		{
			type: 'p',
			text: 'The long window gives significance (the 02:00 blips vanish in a 1-hour average); the short window resets the alert quickly once fixed. The 9-day regression trips the 3-day/1× ticket alert by day 2 ([[burn-rate-alert]]).'
		}
	]
};

const s2: Question = {
	id: 's2-postmortem-items',
	group: 'SRE practice',
	title: 'Rewrite these action items',
	tag: 'template',
	minutes: 8,
	answerLabel: 'Show rewritten items',
	prompt: [
		{
			type: 'p',
			text: 'Incident: an engineer ran a data-fix script against prod instead of staging (both shells open; prompts look identical). It deleted 3,100 active subscriptions; restore took 4 h. Draft action items from the review:'
		},
		{
			type: 'list',
			ordered: true,
			items: [
				'Be more careful when running scripts in production.',
				'Add more monitoring.',
				'Senior engineer to double-check all scripts going forward.',
				'Improve communication during incidents.',
				'Look into backups.'
			]
		}
	],
	answer: [
		{
			type: 'p',
			text: 'Each original item depends on humans being better next time. Good items change the **system**, are **verifiable**, have an **owner and date**, and are labelled prevent / detect / mitigate ([[postmortem]]).'
		},
		{
			type: 'table',
			head: ['Type', 'Action item', 'Owner · due'],
			rows: [
				['Prevent', 'Data-fix scripts run only via the `ops-runner` job with an approved PR; direct prod DB write credentials removed from laptops.', 'Platform · Nov 15'],
				['Prevent', 'Destructive scripts require `--confirm-env=prod` and print row counts + a dry-run diff before writing; abort if > 500 rows.', 'Billing team · Nov 8'],
				['Prevent', 'Prod shells/DB clients get a red prompt and `[PROD]` in the terminal title.', 'Platform · Nov 1'],
				['Detect', 'Alert when active subscriptions drop > 1% in 10 minutes.', 'Billing team · Nov 4'],
				['Mitigate', 'Soft-delete subscriptions (`deleted_at`) so a revert is an UPDATE, not a restore.', 'Billing team · Dec 1'],
				['Mitigate', 'Quarterly timed restore drill of the subscriptions DB; target RTO 30 min, currently 4 h.', 'DBA · first drill Nov 20'],
				['Process', 'Incident roles (commander, comms) + a status-page template; replaces "improve communication".', 'Eng mgmt · Nov 10']
			]
		},
		{
			type: 'p',
			text: 'Item 3 ("senior double-check") is deliberately dropped: review by a tired human is the control that already failed. "Look into backups" becomes the drill with a measurable target.'
		}
	]
};

const chaosX = timeAxis('11:00', 40);
const s3: Question = {
	id: 's3-chaos-no-impact',
	group: 'SRE practice',
	title: 'The chaos experiment proved we\'re resilient',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{
			type: 'p',
			text: 'Game day: "inject 300 ms latency into `inventory` for 15 minutes; hypothesis: checkout p99 stays < 800 ms". Result: no change at all. The team wants to write "checkout is resilient to inventory latency" in the reliability report. The fault was injected with a mesh VirtualService on subset `v1`.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'game day · inventory latency',
				range: '11:00 – 11:40',
				panels: [
					ts('checkout p99', chaosX, [S('p99', shape(40, { base: 420, noise: 0.06, seed: 2 }))], { unit: ' ms', span: 2, markers: [{ at: 10, label: 'inject' }, { at: 25, label: 'stop' }] }),
					ts('inventory p50 by subset', chaosX, [S('v1', shape(40, { base: 18, noise: 0.05, seed: 3 }, window_(10, 25, 318))), S('v2', shape(40, { base: 17, noise: 0.05, seed: 4 }), 2)], { unit: ' ms', span: 2 }),
					ts('inventory requests by subset', chaosX, [S('v1', shape(40, { base: 0.4, noise: 0.5, seed: 5, round: 1 })), S('v2', shape(40, { base: 380, noise: 0.05, seed: 6 }), 2)], { unit: '/s', span: 2 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The experiment never touched production traffic** ([[chaos-engineering]]). The fault targeted subset `v1`, and v1 latency did jump to ~318 ms, but v1 handles **0.4 req/s** (leftover canary pods). 99.9% of traffic goes to `v2`, whose latency never moved. "No impact" means "no exposure", not "resilient".'
		},
		{
			type: 'list',
			items: [
				'**Always verify the fault landed:** measure at the injection point (the caller\'s view of the dependency), not just the system outcome.',
				'**State steady-state and exposure up front:** "≥ 20% of checkout\'s inventory calls are delayed" is part of the hypothesis.',
				'**Watch for masking too:** when it does land, retries and caches can hide latency while tripling load on inventory. Measure calls per checkout, not only p99 ([[retry-budget]]).',
				'Rerun targeting the subset that carries traffic, with abort conditions (checkout error rate > 1%).'
			]
		}
	]
};

const s4: Question = {
	id: 's4-restore-drill',
	group: 'SRE practice',
	title: 'Backups green for two years, RTO nine hours',
	tag: 'core',
	minutes: 7,
	prompt: [
		{
			type: 'p',
			text: 'The DR plan promises a 1-hour RTO for the 4 TB `orders` Postgres. The first-ever timed restore drill gives:'
		},
		{
			type: 'table',
			head: ['Step', 'Duration'],
			numeric: [1],
			rows: [
				['Restore snapshot to new instance (API returns "available")', '22 min'],
				['Replay WAL to target time (PITR)', '2 h 10 min'],
				['App smoke test: first queries', '"timeouts, then very slow"'],
				['Queries reach normal latency', '+5 h 40 min'],
				['Repoint apps, DNS, verify', '35 min']
			]
		}
	],
	answer: [
		{
			type: 'p',
			text: '**"Available" isn\'t "usable."** Block-storage snapshot restores are **lazy-loaded**: blocks are fetched from object storage on first read, so a 4 TB database is "available" in minutes and then crawls for hours as every cold block is pulled. That plus WAL replay is the real RTO ([[restore-drill]]).'
		},
		{
			type: 'ranked',
			items: [
				{ title: 'Measure, then promise.', body: 'RTO is what the drill measured: ~9 h. The plan\'s 1 h was never tested. Tell the business now.' },
				{ title: 'Shrink the slow parts.', body: 'Pre-warm (fast snapshot restore, or read every block in parallel), more frequent snapshots so less WAL to replay, and restore the hot tables first if the app can run degraded.' },
				{ title: 'For a 1-hour RTO, don\'t restore at all.', body: 'A warm standby / cross-region replica you promote. Backups remain the answer for corruption and "oops, deleted" (RPO), not for fast recovery.' },
				{ title: 'Drill quarterly, timed, end to end.', body: 'Including app traffic, not just "the API said available".' }
			]
		}
	]
};

const costX = dayAxis('Oct 01', 21);
const s5: Question = {
	id: 's5-telemetry-bill',
	group: 'SRE practice',
	title: 'The observability bill tripled',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{ type: 'p', text: 'Finance escalates: the monitoring vendor invoice is on track for 3× last month. The platform lead proposes "sample all logs at 10%".' },
		{
			type: 'dashboard',
			dashboard: {
				style: 'datadog',
				title: 'observability usage',
				range: 'Oct 01 – Oct 21',
				panels: [
					ts('Log ingest (GB/day)', costX, [S('GB', shape(21, { base: 310, noise: 0.05, seed: 2 }, window_(6, 21, 520)))], { span: 3, markers: [{ at: 6, label: 'search v8.2' }] }),
					ts('Active metric series', costX, [S('series', shape(21, { base: 0.42, noise: 0.02, seed: 3, round: 2 }, ramp(11, 14, 0.42, 3.9)))], { unit: 'M', span: 3, markers: [{ at: 11, label: 'checkout v3.1' }] }),
					{ kind: 'table', title: 'Top series by metric (Oct 21)', span: 6, head: ['metric', 'labels', 'series'], numeric: [2], highlight: [0], rows: [
						['checkout_request_duration_seconds_bucket', 'route, status, le, user_id', '3,310,442'],
						['http_server_requests_total', 'service, route, status', '41,208'],
						['jvm_memory_used_bytes', 'pod, area, pool', '9,870']
					] },
					stat('Cost driver: metrics', '71%', { tone: 'crit' }),
					stat('Cost driver: logs', '24%', { tone: 'warn' })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**Two independent causes; the bigger one isn\'t logs.**'
		},
		{
			type: 'ranked',
			items: [
				{
					title: 'A `user_id` label on a histogram (71% of cost).',
					body: 'checkout v3.1 added `user_id` to `request_duration_seconds`. Series = routes × statuses × ~12 `le` buckets × users: 0.42 M → 3.9 M series in three days ([[metric-cardinality]], [[telemetry-cost]]). Remove the label; if per-user latency matters, use trace exemplars or logs, not metric labels.'
				},
				{
					title: 'search v8.2 logs +210 GB/day (24%).',
					body: 'Check what changed (a DEBUG level shipped on? a per-hit log line?) and fix that at the source. Sampling *all* logs at 10% throws away the 90% of errors you\'ll need in the next incident to save money on one service\'s noise.'
				}
			]
		},
		{
			type: 'p',
			text: '**Guardrails:** series-count limits per metric in the collector (drop/alert on new high-cardinality labels), per-team usage dashboards with budgets, and log levels changeable at runtime with an auto-expiry.'
		}
	]
};

// ═════════════════════════ PART 5 · Teasers ═════════════════════════

const teasers: Question[] = [
	{
		id: 't1-qos',
		title: 'Which pod is evicted first?',
		tag: 'teaser',
		prompt: [
			{
				type: 'p',
				text: 'Node under memory pressure. Pod A: requests = limits = 1Gi, using 0.9Gi. Pod B: request 256Mi, no limit, using 1.5Gi. Pod C: no requests or limits, using 100Mi.'
			}
		],
		answer: [
			{
				type: 'p',
				text: '**C first** (BestEffort, even though it uses the least), then **B** (Burstable, far over its request), A last (Guaranteed). Usage isn\'t the ranking: QoS class and usage *above request* are ([[qos-class]]).'
			}
		]
	},
	{
		id: 't2-surge-zero',
		title: 'maxSurge: 0, maxUnavailable: 0',
		tag: 'teaser',
		prompt: [{ type: 'p', text: 'What happens when you apply a Deployment with both set to 0?' }],
		answer: [{ type: 'p', text: 'The API rejects it: the rollout could never make progress (no pod may be added or removed). With `maxSurge: 0, maxUnavailable: 1` and replicas 1, every rollout is a full outage of that one pod ([[rolling-update]]).' }]
	},
	{
		id: 't3-undo-config',
		title: 'Does `kubectl rollout undo` restore the old config?',
		tag: 'teaser',
		prompt: [],
		answer: [
			{
				type: 'p',
				text: 'Only what\'s in the pod template. A ConfigMap or Secret edited in place is **not** versioned with the ReplicaSet, so undo brings back old code with new config. Versioned config names (`app-config-v12`) make undo restore both.'
			}
		]
	},
	{
		id: 't4-budget-math',
		title: '99.95% over 30 days',
		tag: 'teaser',
		prompt: [{ type: 'p', text: 'How many minutes of full downtime is the error budget?' }],
		answer: [{ type: 'p', text: '30 × 24 × 60 × 0.0005 = **21.6 minutes**. One slow 25-minute deploy-and-rollback spends more than the whole month ([[error-budget]]).' }]
	},
	{
		id: 't5-cronjob-overlap',
		title: 'The CronJob that ran twice at once',
		tag: 'teaser',
		prompt: [{ type: 'p', text: 'An hourly CronJob usually takes 20 min. During a slow week it took 70 min. What happened at the next hour, by default?' }],
		answer: [
			{
				type: 'p',
				text: '`concurrencyPolicy` defaults to **Allow**: a second run started while the first was still going, so two jobs processed the same batch. Set `Forbid` (or `Replace`) and make the job idempotent anyway; also set `startingDeadlineSeconds` ([[duplicate-scheduler]]).'
			}
		]
	},
	{
		id: 't6-docker-layer',
		title: 'Why does every build reinstall dependencies?',
		tag: 'teaser',
		prompt: [
			{
				type: 'code',
				lang: 'text',
				code: `FROM node:22
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build`
			}
		],
		answer: [
			{
				type: 'p',
				text: '`COPY . .` comes before `npm ci`, so any source change invalidates the dependency layer. Copy `package.json` + lockfile, `npm ci`, *then* copy the source. Bonus: add a `.dockerignore` (a local `node_modules` or `.env` copied into the image is a size and secret leak).'
			}
		]
	},
	{
		id: 't7-plan-no-changes',
		title: '"No changes" but the console disagrees',
		tag: 'teaser',
		prompt: [{ type: 'p', text: '`terraform plan` says *No changes*, yet the console shows a security group rule that isn\'t in your code. How?' }],
		answer: [
			{
				type: 'p',
				text: 'Terraform only compares what it manages. The rule was added as a separate resource outside this state (or the code uses `ignore_changes`, or rules are managed inline in one config and as separate resources in another). Unmanaged ≠ absent. Drift detection needs an inventory, not only plans ([[config-drift]]).'
			}
		]
	}
];

// ═════════════════════════ ASSESSMENT ═════════════════════════

const assessment: Assessment = {
	id: 'devops',
	number: 7,
	title: 'DevOps & delivery',
	tagline: 'Kubernetes, pipelines, Terraform, secrets and SRE practice: four live console labs and a lot of plausible wrong answers.',
	description:
		'The infrastructure is doing exactly what it was told. Your job is to find out what it was told. Four interactive labs (drains, autoscaling, spot capacity, secret rotation) plus evidence-reading on pods, pipelines, plans and SLOs. Every scenario has a tempting fix that makes it worse.',
	minutes: 150,
	difficulty: 'advanced',
	track: 'interactive',
	topics: ['Kubernetes', 'CI/CD', 'release engineering', 'Terraform', 'secrets', 'SLOs', 'cost'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Kubernetes', minutes: 50 },
				{ label: '2 · Pipelines & releases', minutes: 40 },
				{ label: '3 · IaC & config', minutes: 25 },
				{ label: '4 · SRE practice', minutes: 30 },
				{ label: 'Teasers', minutes: 5 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'How the labs work',
			text: 'Each lab is a small simulation in a console: pick a resource on the left, edit its configuration (changes take time to roll out, like the real thing), or run an action. Live metrics and the activity log react. You win when the goal holds for 30 s; destructive moves can lose outright. **Read every status pill and detail row before your first change.**'
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'What a reviewer looks for',
			text: 'You named the **constraint** (the PDB math, the request ÷ usage ratio, the zone of the volume) before naming a fix; you said why the obvious action fails; you separated *now* from *properly*; you thought about what else the fix touches (cost, capacity, the next rollback).'
		}
	],
	parts: [
		{
			id: 'k8s',
			nav: '1 · Kubernetes',
			eyebrow: 'Part 1 · 50 minutes · labs + evidence',
			title: 'Kubernetes operations',
			meta: 'scheduling · autoscaling · drains · eviction · DNS · images · config',
			minutes: 50,
			intro: [
				{
					type: 'cards',
					items: [
						{ title: 'Pending pod?', items: ['Read the scheduler message verbatim', '`Insufficient cpu` vs `node affinity` vs `untolerated taint` vs `volume node affinity`', 'Then ask why the autoscaler can\'t fix *that* reason'] },
						{ title: 'Pod died?', items: ['`OOMKilled` (exit 137): container over its memory limit', '`Evicted`: the *node* ran short; read which resource', 'CrashLoopBackOff: read the previous container\'s logs (`--previous`)'] },
						{ title: 'Slow but healthy?', items: ['[[cpu-throttling|CPU throttling]] under a limit', 'DNS lookups ([[ndots]])', 'Connection pools and readiness gaps during rollouts'] }
					]
				}
			],
			questions: [k1, k2, k3, k4, k5, k6, k7, k8]
		},
		{
			id: 'release',
			nav: '2 · Releases',
			eyebrow: 'Part 2 · 40 minutes · evidence',
			title: 'Pipelines & releases',
			meta: 'artifacts · flaky tests · supply chain · canaries · migrations · flags',
			minutes: 40,
			questions: [r1, r2, r3, r4, r5, r6, r7]
		},
		{
			id: 'iac',
			nav: '3 · IaC & config',
			eyebrow: 'Part 3 · 25 minutes · lab + evidence',
			title: 'Infrastructure as code & secrets',
			meta: 'rotation · plans · locks · drift',
			minutes: 25,
			questions: [i1, i2, i3, i4]
		},
		{
			id: 'sre',
			nav: '4 · SRE',
			eyebrow: 'Part 4 · 30 minutes · written',
			title: 'SRE practice',
			meta: 'alerting · postmortems · chaos · restores · cost',
			minutes: 30,
			questions: [s1, s2, s3, s4, s5]
		},
		{
			id: 'teasers',
			nav: 'Teasers',
			eyebrow: 'Rapid fire · 1 min each',
			title: 'Brain teasers',
			minutes: 5,
			questions: teasers
		}
	]
};

export default assessment;
