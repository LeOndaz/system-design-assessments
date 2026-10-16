import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	// ───────────── Terraform ─────────────
	{
		id: 'terraform-state',
		term: 'Terraform state',
		category: 'cloud & infra',
		short:
			'The file where Terraform records which real resource (by ID) each address in your code corresponds to. Terraform plans by diffing *code vs state vs reality*, so the state is the only thing linking `aws_db_instance.main` to `db-7Q2…`. Lose or desync it and Terraform either forgets a resource exists or thinks it must create/destroy one.',
		analogy: 'A cloakroom ticket book: the coats are real, but without the stubs nobody knows which coat is whose.',
		related: ['moved-block', 'state-lock', 'terraform-forces-replacement']
	},
	{
		id: 'terraform-forces-replacement',
		term: 'Forces replacement',
		aliases: ['-/+ destroy and then create', 'replace'],
		category: 'cloud & infra',
		short:
			'A `plan` line marked `-/+` or `# forces replacement`: the change can\'t be applied in place, so Terraform will destroy the resource and create a new one. Some attributes are immutable at the provider level (a DB\'s `identifier`, an instance\'s `availability_zone`, a disk\'s encryption flag), and renaming a resource *address* in code looks like "delete old, create new" unless you tell Terraform it moved. On stateful resources this is data loss with a green checkmark.',
		related: ['moved-block', 'prevent-destroy', 'terraform-state']
	},
	{
		id: 'moved-block',
		term: '`moved` block',
		category: 'cloud & infra',
		short:
			'A Terraform declaration (`moved { from = A, to = B }`) that tells Terraform an existing resource was renamed or moved into a module, so state is re-pointed instead of destroying and recreating it. It\'s code-reviewed and repeatable, unlike running `terraform state mv` by hand from a laptop.',
		related: ['terraform-state', 'terraform-forces-replacement']
	},
	{
		id: 'prevent-destroy',
		term: '`prevent_destroy`',
		category: 'cloud & infra',
		short:
			'A lifecycle flag that makes any plan which would destroy the resource fail. It\'s a seatbelt for databases, buckets and KMS keys: it won\'t stop someone deleting the resource in the console, and it won\'t stop deleting the resource block plus the flag in one PR, but it does stop the accidental `-/+` from sliding through CI.',
		related: ['terraform-forces-replacement']
	},
	{
		id: 'state-lock',
		term: 'State lock',
		category: 'cloud & infra',
		short:
			'A lock (e.g. a DynamoDB item next to the S3 state file) that stops two `apply` runs writing state at the same time. A cancelled CI job can leave a stale lock behind; `force-unlock` clears it, but only after you have proved no other apply is actually running, otherwise two writers corrupt state.',
		related: ['terraform-state']
	},

	// ───────────── IAM ─────────────
	{
		id: 'iam-evaluation',
		term: 'IAM policy evaluation',
		category: 'security & compliance',
		short:
			'How AWS decides allow or deny for one API call: everything starts as an implicit deny; any **explicit Deny** anywhere wins; then the request must be allowed by *every* guardrail that applies (SCPs, permission boundaries, session policies) **and** by an identity policy or resource policy. That\'s why adding yet another Allow to a role so often changes nothing.',
		analogy: 'A building where you need your own key card *and* the floor must be unlocked *and* the company must not have banned you. Any single "no" wins.',
		related: ['explicit-deny', 'scp', 'permission-boundary', 'resource-based-policy'],
		page: [
			{ type: 'heading', text: 'The order of questions AWS asks' },
			{
				type: 'flow',
				steps: [
					{ label: 'Explicit Deny anywhere?', note: 'identity, resource, SCP, boundary, session', tone: 'crit' },
					{ label: 'SCPs allow it?', note: 'org guardrail; never grants', tone: 'warn' },
					{ label: 'Resource policy allows?', note: 'can grant on its own (same account)' },
					{ label: 'Permission boundary allows?', note: 'caps what identity policies can grant', tone: 'warn' },
					{ label: 'Session policy allows?', note: 'assumed-role sessions only' },
					{ label: 'Identity policy allows?', note: 'the thing everyone looks at first', tone: 'ok' }
				],
				caption: 'Simplified. A "no" at any guardrail ends it; the grants at the end only count if nothing earlier said no.'
			},
			{ type: 'heading', text: 'Worked example: "the role has s3:* and still gets AccessDenied"' },
			{
				type: 'table',
				head: ['Layer', 'What it says', 'Effect on `s3:PutObject` to `reports-prod`'],
				rows: [
					['Identity policy', '`Allow s3:*` on `*`', 'would allow'],
					['Permission boundary', '`Allow s3:GetObject, s3:ListBucket`', '**not in boundary → implicit deny**'],
					['Bucket policy', '`Deny *` when `aws:SecureTransport = false`', 'n/a (TLS used)'],
					['SCP', '`Deny` all actions outside `eu-*`', 'n/a (bucket in eu-west-1)']
				]
			},
			{
				type: 'p',
				text: 'The boundary is the culprit: the identity policy is irrelevant because the effective permissions are the **intersection** of identity policy and boundary. The CloudTrail event and the error message (`…because no permissions boundary allows the s3:PutObject action`) say so. Modern AccessDenied messages name the policy type that blocked you; read them before editing anything.'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Cross-account is different',
				text: 'Across accounts, **both** sides must allow: the caller\'s identity policy *and* the resource policy. In the same account, a resource policy alone can grant access.'
			}
		]
	},
	{
		id: 'explicit-deny',
		term: 'Explicit deny',
		category: 'security & compliance',
		short:
			'A policy statement with `"Effect": "Deny"`. It overrides every Allow in every policy, which makes it the tool for guardrails ("never outside eu-*", "never without MFA") and the first thing to search for when access is mysteriously refused.',
		related: ['iam-evaluation', 'scp']
	},
	{
		id: 'scp',
		term: 'Service control policy (SCP)',
		category: 'security & compliance',
		short:
			'An AWS Organizations policy attached to an account or OU that sets the *maximum* permissions anyone in that account can have, root included. SCPs never grant anything; they only filter. They\'re invisible from inside the account\'s IAM console, which is why they cause the most confusing AccessDenied errors.',
		related: ['iam-evaluation', 'explicit-deny']
	},
	{
		id: 'permission-boundary',
		term: 'Permission boundary',
		category: 'security & compliance',
		short:
			'A managed policy attached to a user or role that caps what its identity policies can grant: effective permissions are the intersection. Used so teams can create their own roles without being able to create a role more powerful than themselves.',
		related: ['iam-evaluation']
	},
	{
		id: 'resource-based-policy',
		term: 'Resource-based policy',
		category: 'security & compliance',
		short:
			'A policy attached to the resource (S3 bucket policy, KMS key policy, SQS queue policy) saying *who* may act on it. KMS key policies are special: if the key policy doesn\'t delegate to IAM, no identity policy can grant access to the key.',
		related: ['iam-evaluation']
	},

	// ───────────── VPC ─────────────
	{
		id: 'security-group',
		term: 'Security group',
		category: 'cloud & infra',
		short:
			'A **stateful** virtual firewall on a network interface. Stateful means if you allow a connection in, the replies are automatically allowed out (and vice versa). Rules are allow-only and can reference other security groups instead of IPs, which is how "only the app tier may reach the DB" is usually expressed.',
		related: ['nacl', 'ephemeral-ports']
	},
	{
		id: 'nacl',
		term: 'Network ACL (NACL)',
		category: 'cloud & infra',
		short:
			'A **stateless** firewall on a subnet. Stateless means every packet is judged on its own: a reply packet is a new packet that must match an outbound (or inbound) rule too. Allow inbound 443 but forget outbound to the client\'s **ephemeral ports** and every TCP handshake silently times out, even though the security groups are wide open.',
		analogy: 'A security group remembers who you let in and lets them leave. A NACL is a turnstile that checks your ticket again on the way out, and the return ticket has a random seat number.',
		related: ['security-group', 'ephemeral-ports', 'route-table'],
		page: [
			{ type: 'heading', text: 'The classic "hardening" outage' },
			{
				type: 'table',
				head: ['Rule #', 'Direction', 'Protocol', 'Port range', 'Source/Dest', 'Action'],
				rows: [
					['100', 'Inbound', 'TCP', '443', '0.0.0.0/0', 'ALLOW'],
					['*', 'Inbound', 'All', 'All', '0.0.0.0/0', 'DENY'],
					['100', 'Outbound', 'TCP', '443', '0.0.0.0/0', 'ALLOW'],
					['*', 'Outbound', 'All', 'All', '0.0.0.0/0', 'DENY']
				],
				caption: 'Looks tight and symmetric. It breaks every inbound HTTPS connection.'
			},
			{
				type: 'list',
				ordered: true,
				items: [
					'Client `203.0.113.7:51234` → server `10.0.1.10:443`: inbound rule 100 matches. ✓',
					'Server replies `10.0.1.10:443` → `203.0.113.7:51234`: outbound destination port is **51234**, not 443. Rule 100 does not match, `*` denies. ✗',
					'The client retransmits SYNs until it times out. No RST, no log line in the app: the packets never reach it.'
				]
			},
			{
				type: 'p',
				text: 'Fix: outbound allow TCP **1024–65535** (the [[ephemeral-ports]] range) to the client CIDRs, and the mirror image for any connection the instance *initiates* (inbound 1024–65535 for replies from, say, a package mirror). Also remember the instance\'s own outbound calls: a NAT\'d `apt-get` needs inbound return traffic on ephemeral ports.'
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'How to spot it',
				text: 'Timeouts (not refusals) that started at a network change; security groups look correct; VPC Flow Logs show `ACCEPT` on the inbound packet and `REJECT` on the reply. Reachability Analyzer names the NACL rule.'
			}
		]
	},
	{
		id: 'ephemeral-ports',
		term: 'Ephemeral ports',
		category: 'cloud & infra',
		short:
			'The temporary source port the OS picks for the client side of a connection (Linux: 32768–60999; others vary; AWS recommends allowing 1024–65535). Replies go back *to* that port, so stateless firewalls must allow it. They are also a finite resource: one source IP can hold only ~28k–64k concurrent connections to one destination, which is how NAT port exhaustion happens.',
		related: ['nacl', 'nat-port-exhaustion']
	},
	{
		id: 'route-table',
		term: 'Route table',
		category: 'cloud & infra',
		short:
			'The per-subnet list of "for destination X, send traffic to Y" (local VPC, internet gateway, NAT gateway, peering, transit gateway, gateway endpoint). The most specific prefix wins. A "private subnet" is simply one whose default route points at a NAT instead of an internet gateway; nothing else makes it private.',
		related: ['internet-gateway', 'nat-gateway', 'vpc-endpoint']
	},
	{
		id: 'internet-gateway',
		term: 'Internet gateway',
		category: 'cloud & infra',
		short:
			'The VPC attachment that lets instances with a **public IP** talk to the internet. An instance in a subnet routed to the IGW but without a public/Elastic IP still can\'t reach out: the IGW only performs 1:1 NAT for addresses that have a public mapping.',
		related: ['route-table', 'nat-gateway']
	},
	{
		id: 'nat-gateway',
		term: 'NAT gateway',
		category: 'cloud & infra',
		short:
			'A managed service in one AZ that lets private-subnet instances open outbound connections via its public IP. It bills per hour **and per GB processed** (about $0.045/GB), so anything high-volume routed through it, especially S3 or another AWS service in the same region, becomes a surprise line item. Routing other AZs through it adds cross-AZ transfer fees and a single-AZ dependency.',
		related: ['vpc-endpoint', 'cross-az-transfer', 'nat-port-exhaustion']
	},
	{
		id: 'vpc-endpoint',
		term: 'VPC endpoint',
		aliases: ['gateway endpoint', 'interface endpoint', 'PrivateLink'],
		category: 'cloud & infra',
		short:
			'A private path from your VPC to an AWS service that bypasses the NAT gateway. **Gateway** endpoints (S3, DynamoDB) are free and work by adding a prefix-list route to the route tables you associate. **Interface** endpoints (most other services) are ENIs with hourly and per-GB charges, still usually much cheaper than NAT for heavy traffic.',
		related: ['nat-gateway', 'route-table', 'cross-az-transfer'],
		page: [
			{ type: 'heading', text: 'Why the bill exploded' },
			{
				type: 'table',
				head: ['Path for 1 TB from S3 (same region)', 'NAT processing', 'Cross-AZ', 'Total'],
				numeric: [1, 2, 3],
				rows: [
					['Private subnet → NAT in same AZ → S3', '$45', '$0', '**$45**'],
					['Private subnet in az-b → NAT in az-a → S3', '$45', '$20', '**$65**'],
					['Private subnet → S3 gateway endpoint', '$0', '$0', '**$0**']
				],
				caption: 'Illustrative list prices. S3 → EC2 data transfer in the same region is itself free; the NAT is what charges.'
			},
			{ type: 'heading', text: 'Gotchas' },
			{
				type: 'list',
				items: [
					'**Association is per route table.** Attach the endpoint to `rtb-private-a` only and az-b/az-c keep paying NAT rates. Check every private route table.',
					'**Endpoint policies** can restrict which buckets are reachable; a tight policy can break third-party buckets (package mirrors hosted on S3) after you add it.',
					'**Cross-region S3** doesn\'t go through a gateway endpoint; those calls still use the NAT.',
					'**Interface endpoints** need private DNS enabled to be picked up transparently by SDKs.'
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'How to find it',
				text: 'Cost Explorer grouped by *usage type*: `NatGateway-Bytes` and `DataTransfer-Regional-Bytes` jumping together. VPC Flow Logs aggregated by destination show S3 prefix IPs at the top.'
			}
		]
	},
	{
		id: 'cross-az-transfer',
		term: 'Cross-AZ data transfer',
		category: 'cloud & infra',
		short:
			'Traffic between availability zones in the same region is billed in both directions (about $0.01/GB each way). Chatty microservices, a service mesh without zone-aware routing, or a single NAT gateway serving three AZs can quietly turn this into one of the biggest lines on the bill.',
		related: ['nat-gateway', 'availability-zone']
	},
	{
		id: 'savings-plan',
		term: 'Savings Plan / reserved capacity',
		category: 'cloud & infra',
		short:
			'A commitment to spend a fixed $/h on compute for 1–3 years in exchange for ~30–70% discounts. It only discounts *compute* (and only up to the commitment); it does nothing for data transfer, NAT processing or storage. Buying one in response to a cost spike you haven\'t diagnosed is a classic way to lock in waste.',
		related: ['nat-gateway', 'spot-instance']
	},

	// ───────────── Compute & capacity ─────────────
	{
		id: 'spot-instance',
		term: 'Spot instance',
		category: 'cloud & infra',
		short:
			'Spare cloud capacity sold at a deep discount (often 60–90% off) that the provider can reclaim with a **2-minute notice**. Each instance type in each AZ is a separate *capacity pool*; when one pool runs dry, every spot instance in it can be reclaimed at once and replacements from the same pool fail. Spot is safe only for workloads that tolerate interruption and fleets spread across many pools.',
		analogy: 'Standby airline seats: cheap, usually fine, but when the flight fills up everyone on standby from that fare class gets bumped together.',
		related: ['capacity-pool', 'interruption-notice', 'savings-plan'],
		page: [
			{ type: 'heading', text: 'Why "just use spot" fails as one big wave' },
			{
				type: 'p',
				text: 'A fleet of 40 × `c6i.xlarge` in one AZ is **one** capacity pool. When demand for that pool rises, the provider reclaims capacity from that pool: you can lose most of the fleet within a minute, and the Auto Scaling group\'s replacement launches fail with `InsufficientInstanceCapacity` because it keeps asking the same empty pool.'
			},
			{
				type: 'table',
				head: ['Design', 'Pools', 'One pool reclaimed'],
				rows: [
					['1 type × 1 AZ', '1', 'lose up to 100%'],
					['1 type × 3 AZs', '3', 'lose ~33%, replacements may land in other AZs'],
					['6 types × 3 AZs, price-capacity-optimized', '18', 'lose a few %, replacements come from deep pools']
				]
			},
			{ type: 'heading', text: 'The checklist' },
			{
				type: 'list',
				items: [
					'**Diversify**: many instance types of similar size (c6i/c7i/m6i/m7i/c6a…) × all AZs, with the `price-capacity-optimized` allocation strategy.',
					'**Handle the notice**: on the 2-minute warning, fail the LB health check, stop pulling work, finish or checkpoint in-flight jobs. Without it, every reclaim is a burst of 502s.',
					'**On-demand base** for the capacity you can never lose (and a budget for it); spot above that.',
					'**Capacity rebalancing** so the ASG launches replacements when the provider signals elevated risk, before the reclaim.',
					'**Not for**: single-instance stateful services, long jobs without checkpoints, anything where a 2-minute exit loses data.'
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'The tempting wrong fix',
				text: 'Moving the whole fleet to on-demand in the middle of a wave doubles or triples the bill, may itself hit on-demand capacity or quota limits in that AZ, and leaves the design flaw (one pool) in place for next time.'
			}
		]
	},
	{
		id: 'capacity-pool',
		term: 'Spot capacity pool',
		category: 'cloud & infra',
		short:
			'The unit in which spot capacity is supplied and reclaimed: one instance type in one availability zone. Diversifying across pools is what turns a correlated "everything reclaimed at once" event into a trickle.',
		related: ['spot-instance']
	},
	{
		id: 'interruption-notice',
		term: 'Interruption notice',
		category: 'cloud & infra',
		short:
			'The ~2-minute warning a spot instance gets before being reclaimed (via instance metadata and an EventBridge event). It is useless unless something acts on it: deregister from the load balancer, drain connections, checkpoint work.',
		related: ['spot-instance', 'connection-draining', 'graceful-shutdown']
	},
	{
		id: 'service-quota',
		term: 'Service quota',
		aliases: ['vCPU limit', 'account limit'],
		category: 'cloud & infra',
		short:
			'A per-account, per-region cap (vCPUs per instance family, Elastic IPs, Lambda concurrency…). Autoscaling silently stops at the quota and logs an error like `VcpuLimitExceeded`; raising it is a request that can take minutes to days. DR regions are where quotas bite: they were sized for the standby, not for the whole production load.',
		related: ['warm-standby', 'autoscaling']
	},
	{
		id: 'warm-standby',
		term: 'Warm standby',
		category: 'reliability practice',
		short:
			'A DR posture where the second region runs a scaled-down but fully working copy (data replicated, a few instances serving or idle) that must *scale out* during failover. Cheaper than active-active, faster than restoring from backup, and only as good as its ability to scale: quotas, AMIs, capacity and warm caches in the target region are part of the plan.',
		related: ['rto-rpo', 'service-quota', 'failover']
	},
	{
		id: 'rto-rpo',
		term: 'RTO and RPO',
		aliases: ['recovery time objective', 'recovery point objective'],
		category: 'reliability practice',
		short:
			'**RTO** (recovery time objective) is how long you may be down; **RPO** (recovery point objective) is how much recent data you may lose, measured in time. A nightly backup is an RPO of up to 24 h, and its RTO is however long a *full restore plus verification* actually takes, which nobody knows until they rehearse it.',
		analogy: 'RPO: how many pages of your notebook you can afford to lose. RTO: how long you can be without a notebook at all.',
		related: ['warm-standby', 'failover'],
		page: [
			{ type: 'heading', text: 'Matching strategy to objectives' },
			{
				type: 'table',
				head: ['Strategy', 'Typical RPO', 'Typical RTO', 'Cost'],
				rows: [
					['Backup & restore (snapshots to another region)', 'hours (backup interval)', 'hours (restore size ÷ throughput)', '$'],
					['Pilot light (data replicated, compute off)', 'seconds–minutes', '10–60 min', '$$'],
					['[[warm-standby|Warm standby]] (scaled-down copy running)', 'seconds', 'minutes (scale-out)', '$$$'],
					['Active-active (both regions serve)', '~0 (with conflict handling)', '~0 (shift traffic)', '$$$$']
				]
			},
			{ type: 'heading', text: 'The arithmetic people skip' },
			{
				type: 'p',
				text: 'A 4 TB database restored from snapshot at an effective 150 MB/s takes **~7.5 hours** before the first query, then index warm-up and verification. If the business says "RTO 1 hour", backups alone cannot meet it no matter how often they succeed. Lazy-loaded snapshot restores also start fast but serve the first reads from cold storage at a fraction of normal speed.'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'The only proof is a drill',
				text: 'Schedule restores and region failovers, time them, and write the measured number next to the objective. "Backups green for 400 days" proves the backup job runs, not that recovery works.'
			}
		]
	},
	{
		id: 'weighted-routing',
		term: 'Weighted DNS routing',
		category: 'cloud & infra',
		short:
			'DNS records that split answers between targets by weight (e.g. 80/20). Shifting weights gradually lets you move traffic between regions or stacks in steps you can watch, but only as fast as resolvers re-query, so the record TTL is your minimum step time.',
		related: ['dns-ttl', 'warm-standby']
	},
	{
		id: 'negative-caching',
		term: 'Negative caching (NXDOMAIN)',
		category: 'frontend & network',
		short:
			'Resolvers also cache *"this name does not exist"*, for a time set by the zone\'s SOA record (often 900–3600 s), independent of the record TTL. Delete-and-recreate a record, or query a name moments before creating it, and some clients will keep getting NXDOMAIN long after the record is back.',
		related: ['dns-ttl', 'dns-caching']
	},
	{
		id: 'connection-draining',
		term: 'Connection draining',
		aliases: ['deregistration delay'],
		category: 'cloud & infra',
		short:
			'When a target is removed from a load balancer, the LB stops sending it *new* requests but lets in-flight ones finish for a configured delay. Too short and deploys cut requests mid-flight; too long (the 300 s default) and deploys or scale-ins crawl. It pairs with graceful shutdown in the app.',
		related: ['graceful-shutdown', 'slow-start']
	},
	{
		id: 'slow-start',
		term: 'Slow start (load balancer)',
		category: 'cloud & infra',
		short:
			'A target-group setting that ramps a newly healthy target from a small share of traffic to its full share over N seconds. It protects instances that are *alive* but not yet *fast* (JIT not warmed, caches empty, connection pools not filled) from receiving a full share on second one.',
		related: ['jit-warmup', 'connection-draining', 'health-check-flapping']
	},
	{
		id: 'jit-warmup',
		term: 'JIT / cache warm-up',
		category: 'latency & capacity',
		short:
			'A freshly started process is slower than a long-running one: the JIT hasn\'t compiled hot paths, in-process caches are empty, connection pools are cold. Warm-up only happens by serving real traffic, so a cold instance that is pulled out of service as soon as it struggles never gets warm.',
		related: ['slow-start', 'health-check-flapping']
	},
	{
		id: 'health-check-flapping',
		term: 'Health-check flapping',
		category: 'reliability practice',
		short:
			'Targets repeatedly bouncing between healthy and unhealthy. Typical cause: a health check that measures *load* rather than *liveness* (a deep check on the busy request pool with a tight timeout). The LB removes a slow target, its traffic moves to the others, they slow and fail too: a self-inflicted cascade.',
		related: ['deep-health-check', 'slow-start', 'cascading-failure']
	},
	{
		id: 'inode',
		term: 'Inode',
		category: 'cloud & infra',
		short:
			'The filesystem record that describes one file or directory. Many filesystems (ext4) create a fixed number of inodes when formatted, so a disk can be "full" of *files* while mostly empty of *bytes*: millions of tiny files (sessions, cache entries, mail spool) exhaust inodes and every create fails with `ENOSPC`, the same error as a full disk.',
		analogy: 'A library with plenty of shelf space but no index cards left: you cannot shelve one more book, however thin.',
		related: ['filesystem-resize'],
		page: [
			{ type: 'heading', text: 'How to tell bytes from inodes in 10 seconds' },
			{
				type: 'code',
				lang: 'text',
				code: `$ df -h /var/lib/app
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme1n1    100G   38G   62G  38% /var/lib/app

$ df -i /var/lib/app
Filesystem       Inodes   IUsed IFree IUse% Mounted on
/dev/nvme1n1    6553600 6553600     0  100% /var/lib/app

$ sudo find /var/lib/app -xdev -type f | cut -d/ -f1-5 | sort | uniq -c | sort -rn | head -3
6421987 /var/lib/app/sessions`
			},
			{ type: 'heading', text: 'Fixes that work vs fixes that don\'t' },
			{
				type: 'table',
				head: ['Action', 'Helps?', 'Why'],
				rows: [
					['Delete big log archives', 'No', 'Frees bytes, not inodes.'],
					['Grow the EBS volume', 'Not by itself', 'The block device grows; the filesystem (and its inode table) doesn\'t until `growpart` + `resize2fs`. Even then the creator refills it.'],
					['Delete the small files', 'Yes, temporarily', 'Use `find -delete`, not `rm *` (argument list too long). Deleting millions of files takes minutes.'],
					['Stop whatever creates them', 'Yes', 'Rate-limit the bot, move sessions to Redis, rotate the cache.'],
					['Reformat with more inodes / XFS', 'Long-term', '`mkfs.ext4 -i 4096` or XFS (dynamic inode allocation) for small-file workloads.']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'Alert on it',
				text: 'node_exporter exposes `node_filesystem_files_free`. Most disk alerts only watch bytes, which is why this incident always starts with "but the disk is 38% full".'
			}
		]
	},
	{
		id: 'filesystem-resize',
		term: 'Filesystem resize',
		category: 'cloud & infra',
		short:
			'Growing a cloud volume enlarges the *block device* only. The partition (`growpart`) and the filesystem (`resize2fs` / `xfs_growfs`) must be grown separately before `df` shows the new space. Until then the console says 200 GB and the machine still sees 100 GB.',
		related: ['inode']
	}
];

export default terms;
