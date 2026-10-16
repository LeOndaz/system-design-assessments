import type { Assessment } from '../types';
import { dayAxis, shape, step } from '../series';
import flashSale from '../labs/flash-sale-backlog';
import spotWave from '../labs/a6-spot-wave';
import lbFlapping from '../labs/a6-lb-flapping';
import dnsCutover from '../labs/a6-dns-cutover';
import natEgress from '../labs/a6-nat-egress';
import regionFailover from '../labs/a6-region-failover';
import dbFailover from '../labs/a6-db-failover';
import inodes from '../labs/a6-inodes';

const days = dayAxis('Sep 20', 28);

const a6: Assessment = {
	id: 'cloud-labs',
	number: 6,
	title: 'Cloud console labs',
	tagline: 'Hands-on incidents in a simulated cloud console: scale, reroute, fail over and cut cost while the metrics react.',
	description:
		'Eight live incident labs plus artifact-reading questions. In every lab the **obvious move is wrong or insufficient**, and the console already contains the evidence that says so: a status pill, a detail row, an activity line. Read before you click. Changes take time to roll out, the clock keeps running, and some buttons make things worse.',
	minutes: 190,
	difficulty: 'advanced',
	track: 'interactive',
	topics: ['interactive labs', 'capacity', 'spot', 'DNS', 'failover', 'NAT & egress cost', 'IAM', 'Terraform', 'VPC'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Capacity labs', minutes: 45 },
				{ label: '2 · Network & edge', minutes: 30 },
				{ label: '3 · Failover & ops labs', minutes: 45 },
				{ label: '4 · Cost', minutes: 25 },
				{ label: '5 · Read the artifact', minutes: 35 },
				{ label: 'Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: 'How a lab works',
					items: [
						'**Start incident** or make any change: the clock starts.',
						'Pick a resource on the left, edit its config, **Apply changes**. Changes land after a rollout delay.',
						'Actions are buttons; destructive ones ask for confirmation first.',
						'Win by holding the goal for the stated time. Lose by breaching an SLA, a budget, or data.'
					]
				},
				{
					title: 'What separates a pass from a fail',
					items: [
						'Reading **details and the activity log** before acting.',
						'Naming the real constraint (connections, quota, pool, TTL, inodes) instead of adding capacity blindly.',
						'Preferring reversible moves; never trading a partial outage for a full one.',
						'Knowing what to do *after*: the prevention that makes this boring next time.'
					]
				},
				{
					title: 'Use the speed control',
					items: [
						'2× to read, 10–20× to watch a rollout land.',
						'Pause freely: real incidents don\'t pause, but learning does.',
						'Reset and try the tempting move on purpose: seeing it fail is half the lesson.'
					]
				}
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Write first, then click',
			text: 'For each lab, spend two minutes writing your hypothesis and plan *before* starting the clock. In a real assessment or incident, the written reasoning is what gets graded; the lab just tells you whether it was right.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Capacity',
			eyebrow: 'Part 1 · 45 minutes · interactive',
			title: 'Capacity & scaling labs',
			meta: 'queues · connections · spot pools · load balancer health',
			questions: [
				{
					id: 'lab-flash-sale',
					title: 'Flash sale: the order queue is backing up',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'lab', lab: flashSale }],
					hints: [
						'Before scaling, look at the **ASG details**: how many workers are *connected to the DB* compared to running?',
						'25 connections per worker, `max_connections` 500. What is the most workers that can ever hold a connection?'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The binding constraint is DB connections, not worker count.',
									body: 'Each worker opens a [[connection-pool|pool]] of 25. With `max_connections = 500`, at most 20 workers can ever be connected; worker 21+ crash-loop on `FATAL: too many connections` (the *Worker errors/s* tile and the ASG status pill "N failing" show this). Scaling to 80 workers leaves throughput stuck at 400 orders/s while the queue grows ~800/s.',
									confirm: 'ASG details "Connected to DB" vs "Running"; DB connections tile pinned at the 500 line.'
								},
								{
									title: 'Put a pooler in front first, then scale within DB capacity.',
									body: 'RDS Proxy / [[pgbouncer|PgBouncer]] in transaction mode multiplexes many client connections onto a few server connections, so the connection count stops scaling with workers. With it attached, ~70 workers push the DB to ~90% CPU and drain the backlog after the sale traffic subsides.'
								},
								{
									title: 'Raising `max_connections` to 2,000 is the second trap.',
									body: 'Every Postgres backend is a process with its own memory; thousands of mostly idle backends add context-switching and lock contention, so the DB gets *slower* per query exactly when you need throughput. It is a reboot-required parameter on many managed setups, too.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'crit',
							title: 'Never purge',
							text: 'Purging a queue of paid orders is not mitigation, it is data loss. The lab ends the run if you do it.'
						},
						{
							type: 'p',
							text: '**After the incident:** size per-pod pools from a connection *budget* (`max_connections` ÷ max pods), cap the ASG max from downstream capacity rather than CPU, alarm on [[queue-age|age of oldest message]] (not queue depth), and ask marketing for a launch calendar. [[littles-law]] tells you the backlog math in advance: 1,200/s arriving vs 200/s processed fills 60k messages a minute.'
						}
					]
				},
				{
					id: 'lab-spot',
					title: 'Spot interruption wave',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'lab', lab: spotWave }],
					hints: [
						'Watch the [[autoscaling|ASG]]\'s *Last activity* line after the wave. Why aren\'t replacements launching?',
						'How many capacity pools does "1 pool: c6i.xlarge" give you? What would six give you?'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'One capacity pool means one correlated failure.',
									body: 'The fleet is a single [[capacity-pool|spot pool]]. When it is reclaimed, the ASG keeps asking the same empty pool and logs `InsufficientInstanceCapacity`, so capacity stays at ~14 of 40 and errors sit around 65%.',
									confirm: 'ASG details: *Last activity* and *Allocation: lowest-price*.'
								},
								{
									title: 'Diversify the instance types (and let the allocator pick deep pools).',
									body: 'Six similar types × the AZs = many independent pools with `price-capacity-optimized`. Replacements come back within a minute at spot prices (~$2.7/h).'
								},
								{
									title: 'Honour the 2-minute [[interruption-notice|notice]].',
									body: 'Even diversified, spot reclaims single instances now and then. Without a [[connection-draining|drain handler]] each reclaim drops in-flight requests (a burst of 5xx that keeps the 60 s stability window from completing). With it, the instance leaves the LB before it dies.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Why "move everything to on-demand" loses',
							text: '40 × $0.17 = $6.8/h against a $5/h ceiling, and the instances come up one by one while errors continue. It also leaves the design flaw in place. A small **on-demand base** (say 8–10 instances) under a diversified spot layer is fine and stays within budget; replacing the whole layer is not.'
						},
						{
							type: 'p',
							text: '**After:** capacity rebalancing on, a spot-interruption dashboard by pool, chaos test that terminates 30% of the fleet weekly, and a written rule that anything stateful never runs on spot.'
						}
					]
				},
				{
					id: 'lab-flapping',
					title: 'A deploy that flaps itself to death',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'lab', lab: lbFlapping }],
					hints: [
						'Read the target group details: what does `/health/deep` actually do, and on which thread pool?',
						'A target that is pulled out of service gets no traffic. How does a JIT warm up without traffic?'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'p',
							text: '**Causal chain:** new target boots cold → receives a full 1/10 share on its first second → its request pool saturates → the [[deep-health-check|deep health check]], which runs *on that same pool* with a 2 s timeout, times out → after 2 failures the LB pulls it → its share moves to the remaining targets → *they* saturate and fail checks → [[health-check-flapping|flapping]] and a cascade. Pulled targets never warm because [[jit-warmup|warm-up needs traffic]].'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Make the LB check answer "alive and ready", not "fast right now".',
									body: 'Point the target group at `/healthz` (dedicated lightweight handler, no downstream calls). Dependency health belongs in metrics and alerts, not in the signal that removes capacity.',
									confirm: 'In the lab, `/healthz` alone stops the cascade; errors fall as targets stay in service and warm.'
								},
								{
									title: 'Add [[slow-start]] so cold targets ramp in.',
									body: 'With 60–120 s of slow start, a new target starts at a few percent of its share. On its own it is not enough while the deep check keeps pulling targets; together with the shallow check it gives the smoothest deploy.'
								},
								{
									title: 'Loosening the deep check (10 s timeout, 5 failures) also gets you through.',
									body: 'It is a legitimate *mitigation*, but it keeps a check whose job is wrong: next time a dependency blips, the LB will still remove every target at once.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Why rollback isn\'t the fix',
							text: 'Rolling back replaces targets with freshly booted v2.30 instances: **also cold**, also hit by the same health check. In the lab it ends the incident without finishing the deploy; in production it often keeps flapping. The canary passed because 1% traffic never saturates a cold target.'
						},
						{
							type: 'p',
							text: '**After:** a deploy policy that waits for each batch to be warm (not just healthy), load-test cold-start behaviour, and a capacity headroom target so losing one target never pushes the rest over 85%.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Network',
			eyebrow: 'Part 2 · 30 minutes · interactive + reading',
			title: 'Network, DNS & edge',
			meta: 'TTL · negative caching · NACLs · route tables',
			questions: [
				{
					id: 'lab-dns',
					title: 'DNS cutover with a deadline',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'lab', lab: dnsCutover }],
					hints: [
						'If you change the TTL now, which resolvers learn about the new TTL, and when?',
						'Look at lb-old\'s *Top client by requests*. What does `Java/1.8` with cache TTL -1 mean for any DNS change?'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Cancel the scheduled deletion first. Everything else depends on it.',
									body: 'Resolvers keep the old answer for up to the cached TTL (300 s). If lb-old is deleted at T+2:00, everyone who hasn\'t re-queried gets connection errors. The safe order is: stop the clock on the irreversible step, *then* migrate.'
								},
								{
									title: 'Lowering the TTL now does not speed this cutover.',
									body: 'Caches already hold the record with TTL 300; they only learn the new TTL when they next re-query. Lowering TTL is a step you take **one old-TTL in advance** of a migration, not during it. (Watch *Max cached TTL in the wild* in the record details.)'
								},
								{
									title: 'Expect a long tail that DNS can never move.',
									body: '6% of traffic comes from a partner [[jvm|JVM]] with `networkaddress.cache.ttl=-1` ([[dns-caching]]): it resolves once at startup and never again. Keep lb-old alive (or proxy it to lb-new) until that partner restarts, and tell them.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'crit',
							title: 'Delete & recreate is worse than doing nothing',
							text: 'For the seconds the record doesn\'t exist, resolvers that query get NXDOMAIN and **cache the absence** for the zone\'s SOA negative TTL (900 s here), independent of the record TTL. That\'s [[negative-caching]]: a 15-minute outage for a random subset of clients from a "harmless" edit.'
						},
						{
							type: 'p',
							text: '**After:** migration runbooks with "lower TTL ≥ 1 old-TTL before", traffic-based (not time-based) decommission gates ("delete when lb-old < 0.1% for 24 h"), and a client-side [[dns-ttl]] requirement in partner integration docs.'
						}
					]
				},
				{
					id: 'nacl',
					title: 'The NACL hardening that broke HTTPS',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Security tightened the public subnet\'s network ACL on Tuesday. Since then, every request to the [[load-balancer|ALB]] times out. [[security-group|Security groups]] are unchanged and allow 443 from anywhere. The ALB itself reports no errors and almost no requests.'
						},
						{
							type: 'table',
							head: ['Rule #', 'Direction', 'Protocol', 'Ports', '[[cidr|CIDR]]', 'Action'],
							rows: [
								['100', 'Inbound', '[[tcp|TCP]]', '443', '0.0.0.0/0', 'ALLOW'],
								['110', 'Inbound', 'TCP', '1024–65535', '10.0.0.0/16', 'ALLOW'],
								['*', 'Inbound', 'All', 'All', '0.0.0.0/0', 'DENY'],
								['100', 'Outbound', 'TCP', '443', '0.0.0.0/0', 'ALLOW'],
								['110', 'Outbound', 'TCP', '8080', '10.0.0.0/16', 'ALLOW'],
								['*', 'Outbound', 'All', 'All', '0.0.0.0/0', 'DENY']
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: '[[nacl|NACLs]] are **stateless**. The client\'s [[tcp-handshake|SYN]] arrives on 443 (inbound rule 100 ✓). The ALB\'s reply goes *to the client\'s* [[ephemeral-ports|ephemeral port]] (e.g. 51234) on the internet: outbound rule 100 only allows destination port 443, and rule 110 only allows 8080 inside the VPC, so the reply hits `*` DENY. The client retries the SYN until it times out. The ALB never sees a complete connection, hence "no errors, almost no requests".'
						},
						{
							type: 'p',
							text: '**Fix:** add outbound `TCP 1024–65535 → 0.0.0.0/0 ALLOW` (replies to clients). Rule 110 inbound already covers the replies from targets on 8080, which is why ALB → target still works.'
						},
						{
							type: 'callout',
							tone: 'info',
							title: 'How to prove it in 2 minutes',
							text: '[[vpc-flow-logs]] on the ALB ENIs: `ACCEPT` for inbound 443 and `REJECT` for the outbound reply to the high port. [[reachability-analyzer]] names the NACL rule. Timeouts (not refusals) right after a network change point to NACLs or routes, not apps.'
						},
						{
							type: 'p',
							text: 'Security groups would never cause this: they are stateful and allow replies automatically. That is also why "security groups look fine" is a red herring here.'
						}
					]
				},
				{
					id: 'routes',
					title: '"The new private subnet can\'t reach the internet, but has a route to the IGW"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'table',
							head: ['Route table', 'Destination', 'Target'],
							rows: [
								['rtb-app-c (new, az-c)', '10.40.0.0/16', 'local'],
								['rtb-app-c (new, az-c)', '0.0.0.0/0', 'igw-0f3'],
								['rtb-app-a (az-a)', '10.40.0.0/16', 'local'],
								['rtb-app-a (az-a)', '0.0.0.0/0', 'nat-0a1'],
								['rtb-app-a (az-a)', 'pl-s3', 'vpce-s3']
							]
						},
						{
							type: 'p',
							text: 'Instances in the new az-c subnet were launched by the same launch template as az-a (`AssociatePublicIpAddress: false`). `curl https://api.vendor.io` hangs. Copying az-a\'s routing "would add a NAT dependency on az-a", so the engineer pointed az-c straight at the internet gateway.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'An [[internet-gateway]] only translates for instances that **have a public IP**. These instances have private IPs only, so packets leave via the IGW with a private source address and replies can never come back. The route is "correct" and useless.'
						},
						{
							type: 'list',
							items: [
								'**Right fix:** a [[nat-gateway]] *in az-c* (keeps the [[availability-zone|AZ]] independence the engineer wanted) and `0.0.0.0/0 → nat-0c3` in `rtb-app-c`.',
								'**Also missing:** the S3 [[vpc-endpoint|gateway endpoint]] association; az-c will pay NAT rates for S3 that az-a doesn\'t.',
								'**Wrong fix:** giving app instances public IPs to make the IGW route work: it exposes them directly and the subnet stops being private.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Failover',
			eyebrow: 'Part 3 · 45 minutes · interactive',
			title: 'Failover & operations labs',
			meta: 'DR regions · quotas · stale pools · inodes',
			questions: [
				{
					id: 'lab-region',
					title: 'Evacuate a degraded region',
					tag: 'tricky',
					minutes: 15,
					prompt: [{ type: 'lab', lab: regionFailover }],
					hints: [
						'Read the west ASG\'s *Last activity* after raising desired capacity. Why does it stop at 16?',
						'Shifting 100% at once sends 4,000 req/s to 400 req/s of capacity. Shift in steps that track the instance count.'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Capacity in the DR region is gated by three numbers, not one.',
									body: 'Running = min(desired, ASG max, [[service-quota|vCPU quota]] ÷ 4). The standby\'s ASG max is 10 and the region\'s quota is 64 vCPU = 16 instances. Raising desired alone gets you 10; raising max too gets you 16 and an activity line saying `VcpuLimitExceeded`.',
									confirm: 'West ASG details: *Target (min of desired, max, quota)* and *Last activity*.'
								},
								{
									title: 'Request the quota first: it\'s the slowest step.',
									body: 'The increase takes ~2.5 minutes to approve. Start it before anything else, then raise max/desired so instances keep launching the moment it lands.'
								},
								{
									title: 'Move traffic in steps that follow capacity.',
									body: '[[weighted-routing|Weighted]] shifts of 40% → 60% → 80% → 100% as instance count passes 16 → 24 → 32 → 40. Every step reduces errors; none overloads the west fleet.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Why "100% to west, now" loses',
							text: 'It turns a 60%-error regional problem into a 90%-error overload, then plateaus at 60% because the fleet can\'t grow past 16. A [[warm-standby]] is only as good as its ability to scale; that ability is quotas, capacity and [[ami|AMIs]] in the *other* region.'
						},
						{
							type: 'p',
							text: '**After:** pre-raise DR quotas to full production size (quota requests are free), game-day the failover quarterly with a timer, and keep the runbook\'s weight steps tied to observed capacity rather than to the clock. Check your [[rto-rpo|RTO]] against what the drill measured.'
						}
					]
				},
				{
					id: 'lab-db-failover',
					title: 'The failover nobody noticed',
					tag: 'tricky',
					minutes: 12,
					prompt: [{ type: 'lab', lab: dbFailover }],
					hints: [
						'Read the *Sample error* in the storefront details. Which host are the pools connected to, and what role does it have now?',
						'Whatever you do must also survive the planned failover at T+7:00. A one-off fix will be undone.'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'p',
							text: 'The database did its job: Aurora promoted `shop-db-b` in 30 s and the old writer **rejoined as a reader**. The app didn\'t: each pod\'s pool still holds connections to `10.0.1.23`, which now accepts reads and rejects writes with `cannot execute INSERT in a read-only transaction`. Two settings keep it there: the JVM caches DNS forever ([[dns-caching]]), and the pool never recycles connections that look healthy.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Ship the config that makes failover self-healing.',
									body: 'JVM `networkaddress.cache.ttl=30` and a pool `maxLifetime` of ~60 s. Shipping it is itself a rolling deploy, so fresh pods connect to the real writer right away, and the next failover (T+7:00) heals within about a minute with no human.'
								},
								{
									title: 'A rolling restart alone fixes *this* failover only.',
									body: 'New pods resolve DNS at startup, so writes recover, but at T+7:30 every pool is stale again and you are back to square one. Valid, but it is toil.'
								},
								{
									title: 'Deleting all pods at once trades a write outage for a full outage.',
									body: 'All 12 pods restart together: cold JVMs, 240 connections arriving at once, storefront reads fail too. The lab ends the run after 30 s of that.'
								}
							]
						},
						{
							type: 'p',
							text: '**Rebooting the writer** is the other tempting move. It adds a minute of guaranteed write outage and changes nothing on the app side. **After:** use the cluster endpoint (never instance endpoints), a driver that understands failover ([[failover-aware-driver|AWS JDBC wrapper]] / `targetServerType=primary`), a test that runs `failover-db-cluster` in staging weekly, and an alert on "write errors with healthy DB" as its own signature.'
						}
					]
				},
				{
					id: 'lab-inodes',
					title: 'Disk full at 38%',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'lab', lab: inodes }],
					hints: [
						'Compare `df -h` and `df -i` in the fleet details.',
						'After you delete files, watch *New files/s*. How long until you are back at 100%?'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'p',
							text: '`ENOSPC` is returned for both "no bytes left" and "no **[[inode|inodes]]** left". `df -h` says 38%; `df -i` says 100%. `/var/lib/app/sessions` holds ~3.9 million tiny files: the app creates a session file for every request without a cookie, and a crawler is sending ~12k of those per second.'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Delete the session files to restore service now.', body: '`find … -mmin +10 -delete` frees inodes at ~30k/s. Errors stop within seconds of the first inodes freeing up.' },
								{
									title: 'Stop the creation or you will be back in four minutes.',
									body: 'Rate-limit the crawler at the WAF (the details name it: `SEOCrawler/2.1`, 41 IPs) **or** move sessions to Redis. Moving to Redis alone stops new files but leaves the 3.9M old ones in place: you still need the cleanup.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'The two traps',
							text: '**Growing the [[ebs|EBS]] volume** changes the block device, not the filesystem: until `growpart` + `resize2fs` run, `df` doesn\'t move ([[filesystem-resize]]); and even then the bot refills it. **Deleting /var/log/*.gz** frees 41 GB of bytes and zero inodes. Both look productive in a status update.'
						},
						{
							type: 'p',
							text: '**After:** alert on `node_filesystem_files_free`, don\'t create sessions for unauthenticated non-browser requests (webhooks shouldn\'t have sessions at all), and put session files on tmpfs or Redis with a TTL.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Cost',
			eyebrow: 'Part 4 · 25 minutes · interactive + dashboard',
			title: 'Cost incidents',
			meta: 'NAT processing · cross-AZ · commitments',
			questions: [
				{
					id: 'lab-nat',
					title: 'The NAT gateway bill',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'lab', lab: natEgress }],
					hints: [
						'Open **[[cost-explorer]] (live)** first. Which usage type is the money in?',
						'The pipeline reads from [[object-storage|S3]] in the same region. Why does that traffic go through a NAT at all?'
					],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'p',
							text: 'Cost Explorer says it: `NatGateway-Bytes` ≈ $85/h and `DataTransfer-Regional-Bytes` ≈ $25/h, compute only $30/h. The pipeline pulls ~1.8 TB/h from S3; with no endpoint, every byte goes through the single [[nat-gateway|NAT gateway]] in az-a at $0.045/GB, and two thirds of it crosses AZs first ([[cross-az-transfer]]).'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Add an S3 gateway endpoint to **all** private route tables.',
									body: 'Gateway [[vpc-endpoint|endpoints]] are free and route S3 traffic privately. Spend drops to ~$35/h with no change to the pipeline.'
								},
								{
									title: 'Associating it with `rtb-private-a` only is the subtle miss.',
									body: 'az-b and az-c keep paying NAT + cross-AZ for their two thirds: spend ~$113/h. The route-table details show which tables have the `pl-s3` route.'
								},
								{
									title: 'Per-AZ NAT gateways help the cross-AZ part only.',
									body: 'They remove ~$25/h of cross-AZ transfer and add three gateway-hours; NAT processing stays.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Why buying a Savings Plan is the trap',
							text: 'A [[savings-plan|Savings Plan]] discounts compute, the one line that didn\'t change. It saves ~$10/h of a $110/h problem and commits you to a year of spend. Removing the NAT routes "to stop the bleeding" stalls the pipeline unless the endpoint is already in place.'
						},
						{
							type: 'p',
							text: '**After:** a cost anomaly monitor per usage type, VPC endpoints as part of the account baseline module, and Flow Logs aggregated by destination in the monthly cost review.'
						}
					]
				},
				{
					id: 'cross-az-mesh',
					title: 'Compute flat, bill up 38%',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{
							type: 'p',
							text: 'Finance flags that the platform bill rose 38% in the second half of September. The team insists "nothing big shipped". You pull daily cost by usage type.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'cloudwatch',
								title: 'Cost Explorer · daily, by usage type',
								range: 'Sep 20 – Oct 17',
								filters: ['account: platform-prod', 'granularity: daily'],
								panels: [
									{
										kind: 'bars',
										title: 'Daily cost by usage type ($)',
										span: 6,
										x: days,
										stacked: true,
										series: [
											{ name: 'EC2 BoxUsage', points: shape(28, { base: 2400, noise: 0.02, seed: 4 }) },
											{ name: 'DataTransfer-Regional-Bytes', points: shape(28, { base: 120, noise: 0.08, seed: 5 }, step(12, 1150)) },
											{ name: 'NatGateway-Bytes', points: shape(28, { base: 310, noise: 0.06, seed: 6 }) },
											{ name: 'EBS', points: shape(28, { base: 380, noise: 0.01, seed: 7 }) }
										],
										markers: [{ at: 12, label: 'mesh 1.4 rollout' }]
									},
									{
										kind: 'timeseries',
										title: 'Inter-AZ bytes (GB/day) by service',
										span: 3,
										x: days,
										stacked: true,
										series: [
											{ name: 'orders ↔ inventory', points: shape(28, { base: 2100, noise: 0.08, seed: 8 }, step(12, 21000)) },
											{ name: 'other', points: shape(28, { base: 3800, noise: 0.08, seed: 9 }, step(12, 30000)) }
										],
										markers: [{ at: 12, label: 'mesh 1.4' }]
									},
									{
										kind: 'stat',
										title: 'Requests / day',
										value: '1.92B',
										delta: '+1% vs prior 2 weeks',
										spark: shape(20, { base: 100, noise: 0.03, seed: 10 }),
										span: 2
									},
									{
										kind: 'stat',
										title: 'EC2 instance-hours',
										value: '57.6k',
										delta: '±0%',
										spark: shape(20, { base: 100, noise: 0.01, seed: 11 }),
										span: 1
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '`DataTransfer-Regional-Bytes` jumps from ~$120/day to ~$1,150/day on Oct 2, exactly at the mesh 1.4 rollout marker; inter-AZ bytes go up ~10×. Requests and instance-hours are flat, so this is not growth. The leading hypothesis: the mesh upgrade changed load balancing from **zone-aware (locality) routing to plain [[round-robin|round-robin]]**, so ~2/3 of calls now cross AZs instead of staying local, and every byte is billed both ways ([[cross-az-transfer]]).'
						},
						{
							type: 'list',
							items: [
								'**Confirm:** mesh config diff for `localityLbSetting` / topology-aware routing; per-destination-zone request counts from the sidecars.',
								'**Fix:** re-enable locality-weighted routing (with failover to other zones when a zone is unhealthy), and keep chatty pairs like orders ↔ inventory zone-affine.',
								'**Red herring:** `NatGateway-Bytes` is high but *flat*: an optimization opportunity, not the cause of this change.',
								'**Lesson:** cost charts by **usage type** answer "what changed"; by **service** they mostly say "EC2".'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · Artifacts',
			eyebrow: 'Part 5 · 35 minutes · reading',
			title: 'Read the artifact',
			meta: 'terraform plan · state locks · IAM · restore math',
			questions: [
				{
					id: 'tf-plan',
					title: 'A refactor PR whose plan looks "mostly cosmetic"',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{
							type: 'p',
							text: 'A PR moves the orders database into a reusable module and bumps the engine version. CI posts this plan. Two reviewers approved with "LGTM, just the module move".'
						},
						{
							type: 'code',
							lang: 'text',
							code: `  # aws_db_instance.orders will be destroyed
  # (because aws_db_instance.orders is not in configuration)
  - resource "aws_db_instance" "orders" {
      - identifier = "orders-prod" -> null
      ...
    }

  # module.orders_db.aws_db_instance.this will be created
  + resource "aws_db_instance" "this" {
      + identifier           = "orders-prod"
      + engine_version       = "16.4"
      + snapshot_identifier  = (known after apply)
      + deletion_protection  = false
      ...
    }

  # module.orders_db.aws_security_group.db must be replaced
-/+ resource "aws_security_group" "db" {
      ~ name = "orders-db" -> "orders-prod-db" # forces replacement
    }

Plan: 2 to add, 0 to change, 2 to destroy.`
						}
					],
					answer: [
						{
							type: 'p',
							text: 'This plan **deletes the production database** and creates an empty one with the same name. Terraform sees the old address `aws_db_instance.orders` disappear from code and a new address `module.orders_db.aws_db_instance.this` appear: without a hint, that is "destroy one, create another" ([[terraform-forces-replacement]]). The create may even fail on the duplicate identifier *after* the destroy has run.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Add a [[moved-block|`moved` block]] for the DB (and the security group).',
									body: '`moved { from = aws_db_instance.orders  to = module.orders_db.aws_db_instance.this }`. The plan should then show `0 to destroy` and an in-place `~ engine_version`.'
								},
								{
									title: 'Separate the refactor from the engine upgrade.',
									body: 'One PR = state move (plan shows no changes), the next = the version bump with its own maintenance window and snapshot.'
								},
								{
									title: 'Guardrails.',
									body: '[[prevent-destroy|`prevent_destroy = true`]] on stateful resources, `deletion_protection = true` (the new resource has it **false**), and a CI check that fails any plan with destroys on resource types in a deny-list unless a label approves it.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							title: 'Also replaced: the security group',
							text: 'Renaming a security group forces replacement. With [[create-before-destroy|create_before_destroy]] absent, the old SG is destroyed first, which fails (in use) or, worse, briefly detaches the DB from its rules. Plans are read **line by line**, not by the summary at the bottom.'
						}
					]
				},
				{
					id: 'tf-lock',
					title: '"Error acquiring the state lock"',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'text',
							code: `Error: Error acquiring the state lock

Lock Info:
  ID:        9b1c2e0d-…
  Path:      tf-state-prod/network/terraform.tfstate
  Operation: OperationTypeApply
  Who:       runner@ci-7f9c
  Created:   2026-10-16 09:41:07 UTC`
						},
						{
							type: 'p',
							text: 'It\'s 09:58. A teammate says "CI flaked earlier, just run `terraform force-unlock 9b1c…` and re-apply".'
						}
					],
					answer: [
						{
							type: 'list',
							ordered: true,
							items: [
								'**Find runner `ci-7f9c` first.** Is its job still running (stuck on a long `aws_db_instance` modify, waiting on an approval step)? A [[state-lock]] held for 17 minutes is not proof of a dead process.',
								'If the job is alive: wait or cancel it *through CI* so it releases the lock and writes state.',
								'If the job died mid-apply: some resources may have been created but not recorded. Run `terraform plan` after unlocking and expect surprises (resources that already exist → import them).',
								'Only then `force-unlock`. Two concurrent applies on the same state can each write a version missing the other\'s resources: that is how resources become orphaned and later get destroyed as "not in state".'
							]
						}
					]
				},
				{
					id: 'iam',
					title: 'The role has `s3:*` and still gets AccessDenied',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{
							type: 'code',
							lang: 'text',
							code: `# identity policy on role/report-exporter
{ "Effect": "Allow", "Action": "s3:*", "Resource": "*" }

# permission boundary on role/report-exporter
{ "Effect": "Allow", "Action": ["s3:GetObject","s3:ListBucket","s3:PutObject"], "Resource": "*" }

# bucket policy on reports-prod
{ "Effect": "Deny", "Principal": "*", "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::reports-prod/*",
  "Condition": { "StringNotEquals": { "s3:x-amz-server-side-encryption": "aws:kms" } } }

# SCP on the OU
{ "Effect": "Deny", "Action": "*", "Resource": "*",
  "Condition": { "StringNotEquals": { "aws:RequestedRegion": ["eu-west-1","eu-central-1"] } } }`
						},
						{
							type: 'p',
							text: 'The exporter calls `PutObject` to `reports-prod` (in eu-west-1) with default settings and gets `AccessDenied`. The on-call engineer\'s fix is to add `"Action": "s3:*"` to the [[permission-boundary|boundary]]. Will it work? What will?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Walk the [[iam-evaluation|evaluation order]]. **[[explicit-deny|Explicit denies]] first:** the bucket policy denies `PutObject` unless the request sets [[kms|SSE-KMS]]. Default settings send no such header, so the request is explicitly denied. Nothing else matters after that: no Allow anywhere can override it.'
						},
						{
							type: 'list',
							items: [
								'**Boundary edit:** irrelevant; `PutObject` was already in the boundary. Widening it to `s3:*` only expands blast radius.',
								'**SCP:** irrelevant; eu-west-1 is allowed.',
								'**Fix:** send `x-amz-server-side-encryption: aws:kms` (and the key id), *and* make sure the role is allowed to `kms:GenerateDataKey` on that key; otherwise you trade an S3 AccessDenied for a KMS one. Alternatively set default bucket encryption to SSE-KMS and relax the bucket policy accordingly.',
								'**Read the error.** Modern AccessDenied messages say *"…with an explicit deny in a [[resource-based-policy|resource-based policy]]"*. That one sentence saves the hour.'
							]
						}
					]
				},
				{
					id: 'restore-math',
					title: '"Backups are green, so our RTO is fine"',
					tag: 'design',
					minutes: 8,
					prompt: [
						{
							type: 'list',
							items: [
								'Postgres, 4.2 TB, daily snapshot at 02:00 plus continuous [[write-ahead-log|WAL]] archiving to S3.',
								'Business-stated objectives: **RTO 1 h, RPO 5 min**.',
								'Last restore test: never. Snapshot restores create a new volume that lazy-loads blocks from S3 on first read.'
							]
						},
						{ type: 'p', text: 'Is the objective met? What would you measure, and what would you change?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'RPO is probably met; RTO almost certainly isn\'t.',
									body: 'Continuous WAL archiving gives point-in-time recovery to within minutes ([[rto-rpo|RPO]] ✓, if archiving lag is monitored). But a restore is snapshot + WAL replay from 02:00 until the failure: up to ~20 h of WAL to replay. Plus lazy-loaded blocks make the first full scan (and every index used) run at a fraction of normal speed for hours.'
								},
								{
									title: 'Measure it, don\'t estimate it.',
									body: 'Restore to a scratch instance on a schedule; record time-to-first-query, time-to-consistent, time-to-normal-latency. That number is your real RTO; write it next to the objective.'
								},
								{
									title: 'Change the architecture if the gap is real.',
									body: 'A streaming replica in another AZ (and ideally region) promoted on failure meets RTO 1 h easily; backups remain for corruption and "oops" deletes (which replicas faithfully copy). Pre-warm restores ([[lazy-snapshot-restore|fast snapshot restore]] / initialize volumes) if restore remains part of the plan.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'Replicas protect against *loss of a machine*; backups protect against *loss of data correctness* (bad migration, `DELETE` without `WHERE`). You need both, and they have different RTOs.'
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'rapid',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Infra reflexes',
			questions: [
				{
					id: 't1',
					title: 'NAT math',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A batch job copies 30 TB/month from S3 to instances in a private subnet (same region) through a NAT gateway. Rough monthly NAT processing cost?' }],
					answer: [{ type: 'p', text: '30,000 GB × $0.045 ≈ **$1,350/month** for traffic that would cost **$0** through an S3 [[vpc-endpoint|gateway endpoint]].' }]
				},
				{
					id: 't2',
					title: 'Stateful or stateless?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Which of security groups and NACLs needs a rule for return traffic?' }],
					answer: [{ type: 'p', text: '[[nacl|NACLs]] (stateless). [[security-group|Security groups]] track connections and allow replies automatically.' }]
				},
				{
					id: 't3',
					title: 'TTL lowering timing',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A record has TTL 86,400. The migration is Saturday 10:00. When must you lower the TTL to 60 for it to matter?' }],
					answer: [{ type: 'p', text: 'At least **24 hours before**, i.e. by Friday 10:00 (plus margin). Caches only learn the new TTL when their old entry, cached for up to a day, expires.' }]
				},
				{
					id: 't4',
					title: 'Can an Allow beat an SCP deny?',
					tag: 'teaser',
					prompt: [],
					answer: [{ type: 'p', text: 'No. An [[explicit-deny|explicit deny]] anywhere wins, and SCPs can only restrict, never grant ([[scp]]).' }]
				},
				{
					id: 't5',
					title: 'Spot notice',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'How much warning does a [[spot-instance|spot instance]] get, and name two things your app must do with it.' }],
					answer: [{ type: 'p', text: '**~2 minutes.** Deregister/fail the LB health check so no new requests arrive, and drain or checkpoint in-flight work (stop pulling from queues, finish or release messages). See [[interruption-notice]].' }]
				},
				{
					id: 't6',
					title: '`df` says 38%',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Writes fail with `No space left on device`. Name two causes besides bytes.' }],
					answer: [{ type: 'p', text: '[[inode|Inode]] exhaustion (`df -i`), a deleted-but-still-open file held by a process (space not freed until it closes; [[lsof]] finds it: `lsof +L1`), reserved blocks for root on ext4, or a full *different* mount (e.g. `/tmp` or the overlay layer).' }]
				},
				{
					id: 't7',
					title: 'Reboot to fix stale connections?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'After a DB failover, apps write to the old writer. Will rebooting the new writer help?' }],
					answer: [{ type: 'p', text: 'No. The problem lives in the **clients** (cached DNS, pooled connections). Rebooting the DB adds an outage and leaves the client state untouched. Recycle client connections; fix DNS TTL and pool lifetime ([[dns-caching]]).' }]
				}
			]
		}
	]
};

export default a6;
