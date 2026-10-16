import type { Assessment, Series } from '../types';
import { timeAxis, dayAxis, shape, step, ramp, bump, periodic, sawtooth, wave } from '../series';
import reconnectLab from '../labs/a17-reconnect-storm';

// ── shared chart data ──────────────────────────────────────────

// ws2: per-pod sockets plateau at 2 × 28,232 while CPU and memory are idle
const capX = timeAxis('17:00', 60);
const PORT_WALL = 56_464;
const podA = shape(60, { base: 30_000, noise: 0 }, ramp(0, 24, 30_000, PORT_WALL));
const podB = shape(60, { base: 28_500, noise: 0 }, ramp(0, 27, 28_500, PORT_WALL));
const podC = shape(60, { base: 31_200, noise: 0 }, ramp(0, 22, 31_200, PORT_WALL));
const connErr = shape(60, { base: 0, noise: 0.25, seed: 3 }, ramp(22, 59, 30, 940));
const gwCpu = shape(60, { base: 31, noise: 0.05, seed: 4 }, ramp(0, 24, 31, 38));
const gwMem = shape(60, { base: 36, noise: 0.02, seed: 5 }, ramp(0, 24, 36, 47));
const envoyCpu = shape(60, { base: 19, noise: 0.06, seed: 6 }, ramp(0, 30, 19, 26));

// ws3: lifetime of closed sockets, 5 s buckets
const lifeX = ['0–5s', '5–10', '10–15', '15–20', '20–25', '25–30', '30–35', '35–40', '40–45', '45–50', '50–55', '55–60', '60–65', '65–70', '70–75', '75–80', '80–85', '85–90', '90–95', '>95'];
const lifeCounts = [410, 380, 350, 330, 300, 290, 280, 270, 260, 250, 245, 240, 18_900, 120, 110, 100, 95, 90, 85, 2_300];

// ws6: one slow consumer per pod grows the send queue until OOM
const oomX = timeAxis('09:00', 90);
const podMem = shape(90, { base: 600, noise: 0.01, seed: 11 }, sawtooth(30, 48));
const sendQ = shape(90, { base: 2, noise: 0.02, seed: 12, round: 1 }, sawtooth(30, 45));
const podConns = shape(90, { base: 25_000, noise: 0.004, seed: 13 }, periodic(30, 1, -25_000, 29), periodic(30, 1, -16_000, 0));
const gcP99 = shape(90, { base: 18, noise: 0.25, seed: 14 }, sawtooth(30, 0.9));
const restarts = Array.from({ length: 90 }, (_, i) => Math.floor((i + 1) / 30));

// md1: ICE failures for one organisation since their firewall change
const iceX = dayAxis('Oct 01', 16);
const iceNorthwind = shape(16, { base: 3, noise: 0.25, seed: 21, round: 1 }, step(12, 59));
const iceOthers = shape(16, { base: 2.6, noise: 0.2, seed: 22, round: 1 });
const relayShare = shape(16, { base: 17, noise: 0.08, seed: 23, round: 1 });

// md3: all-hands at 10:00, largest room grows to 120, SFU NIC tops out
const ahX = timeAxis('09:30', 60);
const roomSize = Array.from({ length: 60 }, (_, i) => (i < 25 ? 9 : Math.min(120, 9 + (i - 25) * 8)));
const egressGbps = roomSize.map((nn, i) => Math.min(9.4, Number((((nn * (nn - 1) * 1.5) / 1000) + 0.6 + (i % 3) * 0.05).toFixed(2))));
const sfuCpu = roomSize.map((nn, i) => Math.round(24 + nn * 0.1 + (i % 4)));
const sfuLoss = egressGbps.map((g, i) => Number((g >= 9.4 ? 7 + (i % 5) * 0.6 : 0.2 + (i % 3) * 0.05).toFixed(1)));

// md4: robotic audio. Loss is low, jitter is high, late discards are the real loss.
const auX = timeAxis('14:00', 60);
const netLoss = shape(60, { base: 0.4, noise: 0.2, seed: 31, round: 2 });
const jitterP95 = shape(60, { base: 12, noise: 0.15, seed: 32 }, step(18, 47), wave(15, 0.12));
const lateDiscard = shape(60, { base: 0.3, noise: 0.2, seed: 33, round: 1 }, step(18, 6.4));
const jbTarget = shape(60, { base: 20, noise: 0 });
const audioKbps = shape(60, { base: 32, noise: 0.03, seed: 34 });

// tm1: deadline misses line up with GC
const dlX = timeAxis('11:00', 60);
const p50 = shape(60, { base: 4, noise: 0.1, seed: 41, round: 1 });
const p999 = shape(60, { base: 9, noise: 0.15, seed: 42 }, periodic(2, 1, 112, 1));
const gcPause = shape(60, { base: 2, noise: 0.3, seed: 43 }, periodic(2, 1, 108, 1));
const missed = shape(60, { base: 0, noise: 0, seed: 44 }, periodic(2, 1, 37, 1));

// ce4: document open time vs history length
const openBuckets = ['<10k ops', '10–100k', '100k–500k', '500k–1M', '1–2M', '>2M'];
const openP95 = [140, 380, 1_900, 3_800, 7_200, 9_400];

const s = (name: string, points: number[], color?: Series['color'], dashed?: boolean): Series => ({ name, points, color, dashed });

// ── assessment ─────────────────────────────────────────────────

const a17: Assessment = {
	id: 'real-time',
	number: 17,
	title: 'Real-time systems',
	tagline: 'Millions of open sockets, collaborative editors, calls, live video and game servers: where a few milliseconds and a lot of arithmetic decide the outcome.',
	description:
		'Real-time systems fail differently. Requests don\'t finish, they stay open; capacity is measured in sockets, ports and streams, not requests per second; and the network is a lossy, jittery thing you design around. Many of these questions have a number in them, and the number is usually the answer: do the arithmetic before you guess.',
	minutes: 175,
	difficulty: 'advanced',
	track: 'core',
	topics: ['WebSockets & SSE', 'collaborative editing', 'WebRTC & TURN', 'live video', 'game netcode', 'time & scheduling', 'live lab'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Sockets at scale', minutes: 45 },
				{ label: '2 · Collaborative editing', minutes: 25 },
				{ label: '3 · Media', minutes: 35 },
				{ label: '4 · Games & ticks', minutes: 25 },
				{ label: '5 · Time & scheduling', minutes: 15 },
				{ label: '6 · Live lab', minutes: 15 },
				{ label: 'Rapid fire', minutes: 15 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: 'Count the expensive thing',
					items: [
						'Sockets: memory, [[file-descriptor|file descriptors]], [[ephemeral-ports|ports]].',
						'Media: streams × bitrate, and who pays for egress.',
						'Games: entities × bytes × [[tick-rate|tick rate]].'
					]
				},
				{
					title: 'Reconnecting is the incident',
					items: [
						'Staying connected is cheap; reconnecting costs TLS, auth, resync.',
						'Anything that drops everyone at once needs a [[reconnect-storm|storm]] plan.'
					]
				},
				{
					title: 'Late = lost',
					items: [
						'A packet after its playout time is as bad as a dropped one.',
						'"Real-time" means meeting deadlines at p99.9, not being fast on average.'
					]
				}
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'What a reviewer grades',
			text: 'Show the arithmetic, name the binding constraint (it is rarely CPU or RAM), and say what the tempting fix would do to the rest of the system. A ranked answer with "confirm by…" steps beats a list of technologies.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Sockets',
			eyebrow: 'Part 1 · 45 minutes',
			title: 'WebSockets & SSE at scale',
			meta: 'connections · ports · heartbeats · presence · ordering · slow consumers',
			questions: [
				{
					id: 'ws1',
					title: 'Two million sockets: how many gateway nodes?',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'You are sizing a [[websocket|WebSocket]] gateway (Go) for **2,000,000** concurrent connections. Load testing shows ~**40 KB** of memory per idle connection, including goroutines and buffers. Nodes have 64 GB RAM. A colleague says: "64 GB × 70% usable ÷ 40 KB ≈ 1.17M sockets per node, so two nodes, three for safety."'
						},
						{ type: 'p', text: 'Is three nodes right? What else limits sockets per node, and what number would you actually pick?' }
					],
					hints: ['Memory is one constraint. List the others before you decide.', 'What happens to 1M users when one of those nodes restarts?'],
					answer: [
						{
							type: 'p',
							text: 'The memory arithmetic is right: 2M × 40 KB ≈ **76 GB**, and one node fits ~1.17M sockets. Memory just isn\'t the constraint that decides the node count.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Blast radius and reconnect cost',
									body: 'With three nodes, every deploy, crash or kernel patch drops ~700k sockets at once, and they all reconnect together: TLS handshakes, token checks, resubscribes. That [[reconnect-storm|reconnect storm]] is the real capacity event, not steady state. Size so one node\'s worth of clients can reconnect within your auth and handshake budget (e.g. 100k per node → 20 nodes).',
									confirm: 'Measure handshakes/s per core and auth capacity; divide sockets per node by that to get recovery time.'
								},
								{
									title: 'File descriptors and kernel limits',
									body: 'Each socket is a [[file-descriptor|file descriptor]]. Default `ulimit -n` is often 1,024; you need `nofile`, `fs.file-max` and `net.core.somaxconn` raised. Kernel socket buffers also grow under load and aren\'t in your app\'s heap profile.',
									confirm: '`cat /proc/<pid>/limits`, `ss -s` under load.'
								},
								{
									title: 'Ports between proxy and gateway',
									body: 'If an L7 proxy sits in front, each proxy IP can open only ~28k connections to one gateway IP:port ([[ephemeral-ports|ephemeral port]] range 32768–60999 = 28,232). That caps sockets per gateway long before memory.',
									confirm: 'Next question shows exactly this.'
								},
								{
									title: 'Heartbeat and TLS CPU',
									body: '1M sockets with a 30 s [[heartbeat]] is ~33k pings/s per node, each a syscall pair plus TLS framing; fine, but not free, and it spikes during reconnects.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'ok',
							text: 'A defensible answer: 15–25 nodes at 80–130k sockets each, chosen by "one node restart must recover in under a minute", with deploys that [[connection-draining|drain]] gradually instead of closing everything.'
						}
					]
				},
				{
					id: 'ws2',
					title: 'Every pod stops at 56,464 connections',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'Evening peak. New users can\'t connect ("connection failed, retrying"). Six gateway pods sit behind **two Envoy proxy instances** (each with one IP). The on-call wants to raise pod memory limits and add pods. Three pods shown; the other three look identical.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'ws-gateway · connections',
								range: '17:00 – 17:59',
								filters: ['cluster=prod-us', 'svc=ws-gateway'],
								panels: [
									{ kind: 'timeseries', title: 'Open sockets per pod', x: capX, series: [s('pod-a', podA, 0), s('pod-b', podB, 2), s('pod-c', podC, 5)], span: 4 },
									{ kind: 'stat', title: 'Max sockets on any pod', value: '56,464', tone: 'warn', span: 2 },
									{ kind: 'timeseries', title: 'Envoy upstream connect errors /s', x: capX, series: [s('connect errors', connErr, 4)], span: 2 },
									{ kind: 'timeseries', title: 'Gateway CPU %', x: capX, series: [s('cpu', gwCpu, 1)], unit: '%', yMax: 100, span: 2 },
									{ kind: 'timeseries', title: 'Gateway memory % of limit', x: capX, series: [s('memory', gwMem, 3)], unit: '%', yMax: 100, span: 2 },
									{ kind: 'timeseries', title: 'Envoy CPU %', x: capX, series: [s('envoy', envoyCpu, 2)], unit: '%', yMax: 100, span: 6 }
								]
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'kubernetes.container:envoy AND message:"upstream connect error"',
								total: '41,822 hits',
								lines: [
									{ ts: '17:31:04.112', level: 'WARN', source: 'envoy-1', msg: 'upstream connect error or disconnect/reset before headers. reset reason: connection failure, transport failure reason: delayed connect error: 99', fields: { upstream: '10.4.2.17:8080', errno: 'EADDRNOTAVAIL' } },
									{ ts: '17:31:04.118', level: 'WARN', source: 'envoy-2', msg: 'upstream connect error or disconnect/reset before headers. reset reason: connection failure, transport failure reason: delayed connect error: 99', fields: { upstream: '10.4.3.9:8080', errno: 'EADDRNOTAVAIL' } },
									{ ts: '17:31:04.130', level: 'INFO', source: 'envoy-1', msg: 'cluster ws-gateway: active connections 338,784' }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**56,464 = 2 × 28,232.** Every pod hits the same ceiling at once regardless of CPU (38%) or memory (47%), and Envoy logs `errno 99 EADDRNOTAVAIL`: "cannot assign requested address". This is [[ephemeral-ports|ephemeral port]] exhaustion on the **proxy side**. A TCP connection is identified by (source IP, source port, destination IP, destination port). Each Envoy instance has one source IP and each pod one IP:port, so each Envoy → pod pair can have at most one connection per local port: 28,232 with the default range 32768–60999. Two Envoys × 28,232 = 56,464 per pod.'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'More pods helps only linearly, and memory limits not at all.', body: 'Each new pod adds another 56,464 slots, so the tempting fix "works" partially, which makes it easy to mis-diagnose.' },
								{ title: 'Real fixes (pick one or combine)', body: 'Give each gateway pod several listening ports (or several IPs) that Envoy treats as separate endpoints; add Envoy source IPs; widen `net.ipv4.ip_local_port_range` (to ~1024–65535 → ~64k per pair); or terminate WebSockets on an L4 load balancer that passes the client\'s connection straight through so no proxy-to-pod connection exists per user.' },
								{ title: 'Watch for the same wall elsewhere', body: 'Any [[nat-gateway|NAT]] or egress proxy has the same 4-tuple limit per destination.' }
							]
						},
						{ type: 'p', text: '**Red herrings:** CPU and memory panels: both have headroom. Envoy CPU is fine too: it isn\'t overloaded, it\'s out of ports.' }
					]
				},
				{
					id: 'ws3',
					title: 'Idle sockets die at exactly one minute',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Users of a dashboard that only receives occasional updates complain that it "goes stale" and needs a refresh. Chatty pages are fine. The gateway sends a WebSocket ping every **90 s**. Traffic goes browser → cloud load balancer → gateway.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'kibana',
								title: 'Closed sockets by lifetime (idle clients, last 24 h)',
								panels: [{ kind: 'bars', title: 'Count of closes by connection lifetime bucket', x: lifeX, series: [s('closes', lifeCounts, 1)], span: 6 }]
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								query: 'service:ws-gateway AND event:close AND idle:true',
								lines: [
									{ ts: '08:12:40.004', level: 'INFO', source: 'gw-3', msg: 'socket closed code=1006 reason="" lifetime=60.0s last_frame=60.0s ago', fields: { user: 'u_8812', idle: true } },
									{ ts: '08:12:41.117', level: 'INFO', source: 'gw-1', msg: 'socket closed code=1006 reason="" lifetime=60.1s last_frame=60.0s ago', fields: { user: 'u_1203', idle: true } },
									{ ts: '08:13:02.551', level: 'INFO', source: 'gw-2', msg: 'socket closed code=1006 reason="" lifetime=62.4s last_frame=60.0s ago', fields: { user: 'u_7724', idle: true } }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'The spike is at **60–65 s**, every close is code **1006** (abnormal: no close frame), and `last_frame=60.0s ago`. Something in the path kills connections that have been silent for 60 s, before the 90 s ping can keep them alive. That is the load balancer\'s idle timeout (60 s is the default on several cloud LBs; other hops have their own, such as ~350 s on some [[nat-gateway|NAT gateways]] and corporate proxies with even less).'
						},
						{
							type: 'list',
							items: [
								'**Fix:** send a [[heartbeat]] at well under the smallest idle timeout in the path, e.g. every 25–30 s, from the server (and expect a pong; drop the socket if two are missed).',
								'Or raise the LB idle timeout. Do both: you don\'t control idle timeouts in users\' networks.',
								'**Client side:** treat 1006 as "reconnect with [[jitter|jitter]] and resync from the last seen message id", so a dropped socket is invisible rather than stale.',
								'The `>95s` bucket is normal (users closing tabs). The tempting conclusion "random network drops" ignores how sharp the 60 s spike is.'
							]
						}
					]
				},
				{
					id: 'ws4',
					title: 'Presence: ghosts and flicker',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Priya N.',
								role: 'Support lead',
								time: 'Tue 10:14',
								body: 'Two complaints keep coming in about the green "online" dot:\n\n1) People show as online for ages after they\'ve closed the laptop.\n\n2) People with the app open on phone AND laptop flicker offline/online every time they lock their phone.\n\nCan we just make it more accurate?'
							}
						},
						{
							type: 'code',
							lang: 'typescript',
							caption: 'Current presence handler on each gateway pod.',
							code: `ws.on('open', () => redis.set(\`presence:\${userId}\`, 'online'));
ws.on('close', () => redis.del(\`presence:\${userId}\`));

// presence API
const online = (await redis.get(\`presence:\${userId}\`)) === 'online';`
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Ghosts: closes that never happen',
									body: 'A laptop that sleeps or loses Wi-Fi doesn\'t send a close; the gateway only notices on the next failed write or heartbeat, and if the pod crashes, the `close` handler never runs. The key lives forever.',
									confirm: 'Count presence keys vs open sockets; the difference is ghosts.'
								},
								{
									title: 'Flicker: one key for many connections',
									body: 'Phone locks → its socket closes → `del` removes the key even though the laptop socket is still open. Then the laptop\'s next action sets it again.'
								},
								{
									title: 'Race: close and open from different pods',
									body: 'A reconnect\'s `set` (new pod) can land before the old socket\'s `del` (old pod), leaving the user offline while connected.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** model [[presence]] as **per-connection leases**: `SET presence:{user}:{connId} 1 EX 60`, refreshed by each [[heartbeat]] (every 20–25 s). A user is online if any lease exists. Expiry handles crashes and sleeping laptops, the union handles multiple devices, and per-connection keys remove the cross-pod race. Add a ~10 s grace period before showing "offline" so a reconnect doesn\'t flash.'
						},
						{
							type: 'p',
							text: '**Reply to Priya:** "Yes. We\'ll switch to a model where each device has to check in every 20 seconds and someone shows offline about a minute after their last device goes quiet. Phone locking won\'t make you appear offline while your laptop is open."'
						}
					]
				},
				{
					id: 'ws5',
					title: 'Chat messages arrive out of order, some never',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'Chat: clients send messages to any `chat-svc` pod (round-robin), which stores the message and `PUBLISH`es it to Redis channel `room:{id}`. Every gateway subscribes to the rooms its users are in. Users report replies appearing above the question, and occasionally a message only shows after a refresh.'
						},
						{
							type: 'trace',
							trace: {
								title: 'Two messages in room 42, 30 ms apart',
								traceId: 'room42-msgs',
								spans: [
									{ id: 'a', service: 'chat-svc-1', name: 'POST /rooms/42/messages "Is it fixed?"', start: 0, duration: 190 },
									{ id: 'a1', parent: 'a', service: 'postgres', name: 'INSERT message (id 9001)', start: 10, duration: 150, note: 'Slow insert: index page split.' },
									{ id: 'a2', parent: 'a', service: 'redis', name: 'PUBLISH room:42', start: 165, duration: 3 },
									{ id: 'b', service: 'chat-svc-2', name: 'POST /rooms/42/messages "Yes, deployed"', start: 30, duration: 40 },
									{ id: 'b1', parent: 'b', service: 'postgres', name: 'INSERT message (id 9002)', start: 34, duration: 18 },
									{ id: 'b2', parent: 'b', service: 'redis', name: 'PUBLISH room:42', start: 55, duration: 3, note: 'Published 110 ms before the earlier message.' },
									{ id: 'g', service: 'ws-gateway-7', name: 'deliver room:42 to 1,200 sockets', start: 58, duration: 130 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Out of order:** two pods handle consecutive messages independently, and whichever finishes its insert first publishes first. Message 9002 is published 110 ms before 9001. Nothing defines an order per room.'
						},
						{
							type: 'p',
							text: '**Missing:** Redis [[pub-sub|pub/sub]] is fire-and-forget: a gateway that is reconnecting to Redis, or whose subscriber connection was cut for exceeding `client-output-buffer-limit pubsub`, simply never sees those messages. There is no replay.'
						},
						{
							type: 'list',
							items: [
								'**Give each room one sequencer:** route all writes for a room to the same partition ([[consistent-hashing|consistent hashing]] on room id, or a [[kafka|Kafka]] partition keyed by room) and assign a per-room sequence number in the same transaction as the insert.',
								'**Deliver from a log, not fire-and-forget:** Redis Streams or Kafka let a gateway resume from the last sequence it delivered after a reconnect.',
								'**Clients order by sequence and detect gaps:** if a client sees 9003 after 9001, it fetches 9002. Message ids from different writers (or wall-clock timestamps from different pods) must never be the ordering key.'
							]
						}
					]
				},
				{
					id: 'ws6',
					title: 'One phone on a train takes down 25,000 users',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'Gateway pods (2 GiB memory limit) get OOM-killed roughly every 30 minutes during the morning. Each kill disconnects ~25,000 users. The team suspects a memory leak or GC tuning and wants to double the limit.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'ws-gateway-4 · memory',
								range: '09:00 – 10:29',
								panels: [
									{ kind: 'timeseries', title: 'Pod memory (MiB)', x: oomX, series: [s('rss', podMem, 3)], thresholds: [{ value: 2048, label: 'limit 2 GiB', tone: 'crit' }], span: 3 },
									{ kind: 'timeseries', title: 'Largest per-socket send queue (MiB)', x: oomX, series: [s('top socket queue', sendQ, 4)], span: 3 },
									{ kind: 'timeseries', title: 'Open sockets', x: oomX, series: [s('sockets', podConns, 0)], span: 2 },
									{ kind: 'timeseries', title: 'GC pause p99 (ms)', x: oomX, series: [s('gc p99', gcP99, 1)], span: 2 },
									{ kind: 'timeseries', title: 'Container restarts (OOMKilled)', x: oomX, series: [s('restarts', restarts, 5)], span: 2 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Memory and the **largest single socket\'s send queue** rise together and reset together at each restart: ~1.4 GB of the growth is one connection. A [[slow-consumer|slow consumer]] (a phone on a train, reading at a few KB/s) is subscribed to a busy room, and the gateway keeps appending outgoing messages to its unbounded write buffer. Nothing is leaked; it is unbounded queueing without [[backpressure]].'
						},
						{
							type: 'list',
							items: [
								'**Bound every per-connection queue** (by bytes and message count). When it\'s full: coalesce (for cursors, presence and typing indicators keep only the latest state), then drop the client with a "resync" close code. Never let one socket hold more than, say, 1 MB.',
								'**Check `bufferedAmount`/write readiness** before sending, rather than writing blindly.',
								'**Doubling the limit** only stretches the cycle to an hour and makes each kill take down the same 25,000 users.',
								'**Red herring:** GC pause p99 grows with heap size because there is more heap to scan. It is a consequence, not the cause.'
							]
						}
					]
				},
				{
					id: 'ws7',
					title: 'Live updates arrive in 30-second bursts, one customer only',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Daniel R.',
								role: 'IT manager, Contoso Logistics',
								subject: 'Your tracking dashboard is not live for us',
								body: 'Our dispatchers see shipment updates in big batches every 30 seconds or so, then nothing. From home on a phone the same dashboard is instant. Our network is fine; everything else works.'
							}
						},
						{
							type: 'p',
							text: 'The dashboard uses [[server-sent-events|Server-Sent Events]] over HTTP/1.1. Your server logs show each event written and flushed immediately.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'A buffering proxy in the customer\'s network (inspecting TLS-intercepted HTTP, which is common in enterprises) collects the response body until a buffer fills or a timer fires, then forwards it in one batch. SSE is "just HTTP", so middleboxes treat it like a slow download. Your flush happens; theirs doesn\'t.'
						},
						{
							type: 'list',
							items: [
								'Confirm with a test endpoint that emits a timestamp every second from their network, and check the `Via`/proxy headers.',
								'Mitigations: send `Cache-Control: no-transform` and `X-Accel-Buffering: no`, pad early events to push past small buffers, and send comment heartbeats (`: ping`) every 15 s. Many proxies pass WebSockets through untouched once upgraded, so a WebSocket fallback is the robust fix.',
								'Also check the per-origin limit: HTTP/1.1 browsers allow ~6 connections per host, so several dashboard tabs each holding an SSE stream can starve other requests. HTTP/2 multiplexes them.'
							]
						},
						{
							type: 'p',
							text: '**Reply:** "Your company\'s web proxy is holding our live updates and releasing them in batches. We\'re adding a connection type that proxies pass straight through; until then your IT team can exempt our domain from response buffering."'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Collab',
			eyebrow: 'Part 2 · 25 minutes',
			title: 'Collaborative editing',
			meta: 'OT · CRDTs · undo · snapshots',
			questions: [
				{
					id: 'ce1',
					title: 'Two edits, two different documents',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Both clients have `"abc"`. Alice inserts `"X"` at index 1. At the same moment Bob deletes index 2 (`"c"`). Each applies their own edit immediately and then applies the other\'s operation **as received**.'
						},
						{
							type: 'code',
							lang: 'typescript',
							code: `type Op = { kind: 'ins'; at: number; ch: string } | { kind: 'del'; at: number };

function apply(doc: string, op: Op): string {
  return op.kind === 'ins' ? doc.slice(0, op.at) + op.ch + doc.slice(op.at)
                           : doc.slice(0, op.at) + doc.slice(op.at + 1);
}
// remote ops are applied directly: apply(localDoc, remoteOp)`
						},
						{ type: 'p', text: 'What does each user end up with? What is the fix, and why does nobody notice in testing?' }
					],
					answer: [
						{
							type: 'table',
							head: ['', 'After own edit', 'After remote op (naive)', 'With transformation'],
							rows: [
								['Alice', '`aXbc`', '`del(2)` removes `b` → **`aXc`**', '`del(2)` → `del(3)` → `aXb`'],
								['Bob', '`ab`', '`ins(1,X)` → **`aXb`**', 'unchanged → `aXb`']
							]
						},
						{
							type: 'p',
							text: 'The replicas diverge silently: Alice lost a `b` she never deleted. The fix is [[operational-transformation|operational transformation]]: before applying a concurrent remote op, shift its position by every local op it didn\'t know about (an insert at or before its index shifts it right by one, a delete before it shifts it left). Real systems route ops through a server that assigns an order and returns transformed ops, or use a [[crdt|CRDT]] that addresses characters by unique ids instead of indexes.'
						},
						{
							type: 'p',
							text: '**Why tests miss it:** single-user tests and sequential "type, then sync" tests never produce truly concurrent ops. Property-test it: generate random concurrent op pairs, apply them in both orders, and assert the documents are equal.'
						}
					]
				},
				{
					id: 'ce2',
					title: 'OT or CRDT for an offline-first field app?',
					tag: 'design',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'Inspectors fill in long structured reports on tablets, often offline for a full day in basements, then sync. Two inspectors sometimes edit the same report. Data is stored in two regions. The current editor uses server-side OT and loses offline work on conflicts. A teammate proposes "just use a CRDT, then we don\'t need a server".'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'A [[crdt|CRDT]] is the better fit here: day-long offline branches and two writable regions mean edits must merge without a central order, which is exactly what CRDTs are for and where OT struggles (every op in a long branch must be transformed against every concurrent server op).'
						},
						{
							type: 'list',
							items: [
								'**"No server" is wrong.** You still need auth, persistence, backups, fan-out, snapshots, and authorization on what each inspector may change. The server just doesn\'t decide the order of edits.',
								'**Structure beats text:** model the report as a map of fields (last-writer-wins registers per field, or multi-value registers that surface true conflicts to a human) and use a text CRDT only for long free-text fields.',
								'**Tombstones and metadata grow:** deleted characters keep ids until every replica has seen the delete. You need [[op-log-compaction|compaction]] and a rule for devices that have been offline longer than the retention window (full resync).',
								'**Semantic conflicts still exist:** two inspectors setting "status: passed" and "status: failed" merge deterministically, but someone must review it. Show conflicts; don\'t silently pick a winner for safety-relevant fields.'
							]
						}
					]
				},
				{
					id: 'ce3',
					title: '"Undo deleted my coworker\'s paragraph"',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							caption: 'Undo in the shared editor.',
							code: `const history: Op[] = [];           // every op applied to the doc, local or remote
function onOp(op: Op) { history.push(op); doc = apply(doc, op); }

function undo() {
  const last = history.pop();
  if (last) send(inverse(last));     // ins ↔ del at the same index
}`
						}
					],
					answer: [
						{
							type: 'p',
							text: '`history` contains **everyone\'s** operations, so Ctrl-Z undoes whatever happened last in the document, which is often a collaborator\'s edit. Even when the last op is your own, its inverse uses the index from when it was applied; later remote edits have shifted positions, so the inverse deletes the wrong text.'
						},
						{
							type: 'list',
							items: [
								'**Undo only your own operations** (keep a per-user undo stack).',
								'**Transform the inverse** against every operation that happened after the original (the same [[operational-transformation|transformation]] used for concurrent edits), or with a CRDT, undo by id ("re-delete this character id") instead of by index.',
								'Group keystrokes into undo units (a word or a pause), as users expect.'
							]
						}
					]
				},
				{
					id: 'ce4',
					title: 'Old documents take 9 seconds to open',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'docs · open latency by history length',
								panels: [
									{ kind: 'bars', title: 'Open time p95 (ms) by number of ops in history', x: openBuckets, series: [s('p95 ms', openP95, 0)], span: 4 },
									{ kind: 'stat', title: 'Docs over 1M ops', value: '3.1%', delta: 'but 40% of daily opens', tone: 'warn', span: 2 }
								]
							}
						},
						{
							type: 'p',
							text: 'Opening a document loads its entire op log from the database and replays it on the server. An engineer adds nightly snapshots and deletes ops older than the snapshot. The next week, tablet users who were offline for a few days report "your edits could not be saved, please reload", losing work.'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Open time scales with history length because every open replays every op ever made. Snapshots are the right idea: load the latest snapshot, then replay only newer ops.'
						},
						{
							type: 'p',
							text: '**Why it broke offline clients:** a client that went offline at version 10,000 sends ops based on version 10,000. To rebase them, the server needs every op since 10,000. Deleting ops older than the nightly snapshot destroyed that history, so the server could only reject the edits.'
						},
						{
							type: 'list',
							items: [
								'Keep a **retention window** of ops behind the latest snapshot that covers realistic offline periods (e.g. 30 days), and snapshot more often than you truncate.',
								'Clients whose base is older than the window get a deliberate, user-friendly path: keep their edits locally, fetch the latest snapshot, and offer a three-way merge or "your version / their version", never a silent reject.',
								'For CRDT-based docs the equivalent is tombstone garbage collection: only safe once every replica has acknowledged the deletes. See [[op-log-compaction|op-log compaction]].'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Media',
			eyebrow: 'Part 3 · 35 minutes',
			title: 'Calls, conferences and live video',
			meta: 'WebRTC · TURN · SFU · jitter · HLS latency',
			questions: [
				{
					id: 'md1',
					title: '"Calls drop for one of our biggest customers"',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Marta K.',
								role: 'Customer Success Manager',
								time: 'Thu 16:02',
								body: 'Northwind (2,400 seats, renewal in 6 weeks) says video calls "drop after connecting" or never connect since Monday. Only from their offices; from home it\'s fine. Their IT says nothing changed except "tightening the firewall". Can engineering look today? This one is escalating.'
							}
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'calls · connection health',
								range: 'Oct 01 – Oct 16',
								panels: [
									{ kind: 'timeseries', title: 'ICE failure rate (%)', x: iceX, series: [s('Northwind offices', iceNorthwind, 3), s('all other orgs', iceOthers, 1)], unit: '%', span: 4 },
									{ kind: 'timeseries', title: 'Sessions relayed via TURN (%)', x: iceX, series: [s('all orgs', relayShare, 0)], unit: '%', span: 2 },
									{
										kind: 'table',
										title: 'Northwind sessions, last 24 h',
										head: ['candidate pairs tried', 'host', 'srflx (STUN)', 'relay UDP 3478', 'relay TCP/TLS 443'],
										rows: [
											['offered by client', '✓', '✓', '✓', '—'],
											['succeeded', '0', '0', '0', 'n/a']
										],
										highlight: [1],
										span: 6
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Since Oct 13 (Monday), 59% of Northwind\'s sessions fail [[ice-candidates|ICE]], against ~3% everywhere else. Their firewall change almost certainly blocked outbound [[udp|UDP]]: host and [[stun|STUN]] candidates fail, and so does your [[turn-relay|TURN]] relay because it is only offered on **UDP 3478**. The ~41% that still work probably sit on network segments with different rules. Calls that "connect then drop" are the ones that got through on a candidate the firewall later expired.'
						},
						{
							type: 'list',
							items: [
								'**Fix on your side (today):** run TURN on **TCP and TLS port 443** and include those relay candidates. Locked-down networks nearly always allow outbound 443. This is the standard enterprise fallback.',
								'**Confirm:** ask Northwind IT for a test from an office machine with UDP blocked vs a TURN-TLS-only config; the client logs will show only `relay tcp` succeeding.',
								'**Cost note:** every Northwind call will now be relayed (see the next question for what that costs), and TCP media suffers more under loss ([[head-of-line-blocking|head-of-line blocking]]). Long term, ask them to allow UDP to your media ranges.'
							]
						},
						{
							type: 'p',
							text: '**Reply to Marta:** "Their firewall now blocks the type of traffic calls normally use. We\'re enabling a fallback that goes over the same port as normal secure web traffic; it should fix their offices without any change on their side. We\'ll confirm with their IT tomorrow and share a one-line firewall rule that would improve call quality further."'
						}
					]
				},
				{
					id: 'md2',
					title: 'What does TURN cost us?',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Finance asks for a monthly budget for [[turn-relay|TURN]] after the fix. Data: on average **4,000 concurrent 1:1 calls** (peak 10,000), **18%** of sessions relayed, **1.5 Mbps** video+audio in each direction, cloud egress **$0.05/GB**. Estimate monthly relay egress and cost. What would you tell Finance about peak vs average?'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Step', 'Value'],
							numeric: [1],
							rows: [
								['Relayed calls (average)', '4,000 × 0.18 = **720**'],
								['Relay egress per call', 'forwards both directions: 2 × 1.5 = **3 Mbps**'],
								['Total relay egress', '720 × 3 = **2,160 Mbps**'],
								['Per month (30 days)', '2.16 Gb/s × 2,592,000 s ÷ 8 = **699,840 GB ≈ 700 TB**'],
								['Cost at $0.05/GB', '**≈ $35,000 / month**']
							]
						},
						{
							type: 'list',
							items: [
								'**Bill on average, provision for peak:** cost follows the average (720 relayed calls), but servers and network must handle the peak, 10,000 × 0.18 = 1,800 relayed calls → 5.4 Gb/s of relay egress.',
								'**Sensitivity:** relay share is the lever. A customer like Northwind at 100% relay adds a lot; a single 2,400-seat customer with ~300 concurrent calls adds 300 × 3 Mbps = 0.9 Gb/s, about +$14.6k/month on its own.',
								'Ingress to the relay is usually free in cloud pricing; check your provider. Hosting TURN on a provider with cheaper or flat-rate bandwidth often saves more than any software change.'
							]
						}
					]
				},
				{
					id: 'md3',
					title: 'All-hands calls fall apart for everyone',
					tag: 'tricky',
					minutes: 8,
					prompt: [
						{
							type: 'p',
							text: 'Your [[sfu|SFU]] forwards every participant\'s 1.5 Mbps video to every other participant (no [[simulcast|simulcast]]). Small meetings are fine. Monday\'s 10:00 company all-hands grows past 80 people and everyone\'s video freezes, including the CEO\'s. The SFU node has a 10 Gbps NIC. Someone suggests "bigger instances, more CPU".'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'sfu-eu-3 · all-hands',
								range: '09:30 – 10:29',
								panels: [
									{ kind: 'timeseries', title: 'Participants in largest room', x: ahX, series: [s('participants', roomSize, 0)], span: 3 },
									{ kind: 'timeseries', title: 'NIC egress (Gbps)', x: ahX, series: [s('egress', egressGbps, 3)], thresholds: [{ value: 9.4, label: 'NIC practical max', tone: 'crit' }], span: 3 },
									{ kind: 'timeseries', title: 'SFU CPU %', x: ahX, series: [s('cpu', sfuCpu, 1)], unit: '%', yMax: 100, span: 3 },
									{ kind: 'timeseries', title: 'Packet loss to receivers (%)', x: ahX, series: [s('loss', sfuLoss, 4)], unit: '%', span: 3 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Egress grows as **N × (N − 1) × 1.5 Mbps**: 8 people = 84 Mbps, 50 = 3.7 Gbps, 80 = 9.5 Gbps. The NIC saturates at ~80 participants (10:12 on the chart), loss jumps for **every** receiver on that node, and everyone freezes. CPU sits around 35%: an SFU forwards without decoding, so CPU is the wrong resource to scale.'
						},
						{
							type: 'list',
							items: [
								'**Don\'t send everyone to everyone:** forward the active speaker(s) at full quality and others as thumbnails, or not at all ("last-N"). With speaker at 1.5 + 4 thumbnails at 0.15 Mbps, each receiver needs 2.1 Mbps: 80 people ≈ 168 Mbps instead of 9.5 Gbps.',
								'**[[simulcast|Simulcast]]:** senders publish 1.5 Mbps / 500 kbps / 150 kbps layers; the SFU picks a layer per receiver. This also fixes the related complaint that one participant on a bad connection degrades everyone\'s quality.',
								'**Cascade SFUs** across nodes for very large rooms, and for 500+ audience members switch to one-to-many streaming ([[hls|HLS]] / LL-HLS) rather than conferencing.',
								'Mesh is out of the question: each person would upload 79 streams. An MCU fixes bandwidth but costs a full decode + composite encode per room and adds latency.'
							]
						}
					]
				},
				{
					id: 'md4',
					title: 'Robotic audio with 0.4% packet loss',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'Since 14:18 a large share of users on one ISP describe audio as "robotic and choppy". The network team says loss is under half a percent, which Opus handles easily, so it "can\'t be the network".'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'audio quality · ISP AS64500',
								range: '14:00 – 14:59',
								panels: [
									{ kind: 'timeseries', title: 'Network packet loss (%)', x: auX, series: [s('loss', netLoss, 1)], unit: '%', yMax: 10, span: 2 },
									{ kind: 'timeseries', title: 'Jitter p95 (ms)', x: auX, series: [s('jitter p95', jitterP95, 3), s('jitter buffer target', jbTarget, 5, true)], unit: 'ms', span: 2 },
									{ kind: 'timeseries', title: 'Late packets discarded (%)', x: auX, series: [s('late discards', lateDiscard, 4)], unit: '%', yMax: 10, span: 2 },
									{ kind: 'timeseries', title: 'Audio bitrate (kbps)', x: auX, series: [s('bitrate', audioKbps, 0)], span: 6 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'The network loses 0.4%, but **6.4% of packets arrive too late to play**. [[network-jitter|Jitter]] p95 jumped from ~12 ms to ~47 ms at 14:18, while the receiver\'s [[jitter-buffer|jitter buffer]] is fixed at 20 ms. Every packet delayed more than 20 ms beyond its slot is discarded, which sounds exactly like loss ([[packet-loss-concealment|concealment]] stretching audio = "robotic").'
						},
						{
							type: 'list',
							items: [
								'**Fix:** use an adaptive jitter buffer (grow towards ~p95 jitter, here ~50–60 ms, shrink when the network calms), and enable Opus in-band FEC for the loss that remains.',
								'**Trade-off:** +40 ms of buffer adds 40 ms of mouth-to-ear delay. Conversation stays comfortable under ~150 ms one-way, so this is the right trade.',
								'**Red herring:** bitrate is flat at 32 kbps; bandwidth isn\'t the problem. The network team is right about loss and wrong about the conclusion: "late" is "lost" for real-time media.'
							]
						}
					]
				},
				{
					id: 'md5',
					title: 'Live stream is 26 seconds behind; product wants under 5',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'A live auction streams over [[hls|HLS]] with **6 s segments**; the player starts 3 segments behind live. Encode takes ~1 s and packaging + [[cdn|CDN]] ~1 s. Bidders watching the stream lose to bidders in the room. Product asks for **under 5 s** glass-to-glass. Estimate today\'s latency, then evaluate: 2 s segments; LL-HLS with 0.33 s parts; WebRTC.'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Option', 'Estimate', 'Cost / risk'],
							rows: [
								['Today: 6 s segments, 3 buffered', '1 + 6 + 1 + 18 = **26 s**', '—'],
								['2 s segments, 3 buffered', '1 + 2 + 1 + 6 = **10 s**', '3× more segment and playlist requests per viewer; still over target'],
								['LL-HLS, 0.33 s parts', '≈1 + 0.33 + 0.5 + ~1 = **≈3 s**', 'Needs encoder, packager, CDN and player support for partial segments and blocking playlist reloads'],
								['WebRTC to viewers', '**< 1 s**', 'Per-viewer server egress (no ordinary CDN caching); much more expensive at thousands of viewers']
							]
						},
						{
							type: 'p',
							text: 'Recommend **LL-HLS**: it meets the target while keeping CDN economics. Use WebRTC only if bids must be sub-second fair, and even then the fairness fix is to timestamp bids against the stream position ("bid at media time 01:02:03.4"), not just to lower latency. See [[glass-to-glass-latency|glass-to-glass latency]] for the breakdown.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Games',
			eyebrow: 'Part 4 · 25 minutes',
			title: 'Games & tick-based servers',
			meta: 'tick rate · prediction · lag compensation · lockstep',
			questions: [
				{
					id: 'gm1',
					title: 'Raising the tick rate: what does it cost?',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'A 64-player shooter sends every player a full snapshot of all 64 players each tick: **40 bytes per entity**. Design wants to go from 20 Hz to **60 Hz** "for competitive feel". Compute per-player downstream and per-match server egress at 60 Hz. Then estimate with [[interest-management|interest management]] (each player only receives the ~16 entities near them) and delta compression (~25% of a full entity on average).'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['', 'Per player', 'Per match (×64)'],
							rows: [
								['Full snapshots, 60 Hz', '64 × 40 B × 60 = 153,600 B/s ≈ **1.23 Mbps**', '≈ **78.6 Mbps**'],
								['+ interest mgmt (16 entities) + deltas (25%)', '16 × 40 × 60 × 0.25 = 9,600 B/s ≈ **77 kbps**', '≈ **4.9 Mbps**']
							]
						},
						{
							type: 'list',
							items: [
								'Going from 20 → 60 Hz triples bandwidth *and* cuts the per-tick CPU budget from 50 ms to 16.7 ms, so a server hosting 10 matches at 20 Hz may only host 3 at 60 Hz.',
								'The two optimisations are a 16× reduction, which pays for the higher [[tick-rate|tick rate]] several times over.',
								'Interest management also removes a cheat: clients never receive positions of enemies they can\'t see, so wallhacks have nothing to draw.'
							]
						}
					]
				},
				{
					id: 'gm2',
					title: 'Players rubber-band on good connections',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							caption: 'Client reconciliation, called when a server snapshot arrives. Server sends { state, lastProcessedInput }.',
							code: `function onServerSnapshot(snap: Snapshot) {
  player.state = snap.state;                 // trust the server
  pendingInputs = pendingInputs.filter(
    (i) => i.seq > snap.lastProcessedInput
  );
  // inputs will be re-sent; nothing else to do
}`
						},
						{ type: 'p', text: 'At 80 ms ping, players snap backwards a little every time they run, and it gets worse as ping rises. Movement on the server looks correct.' }
					],
					answer: [
						{
							type: 'p',
							text: 'The client resets to the server\'s (older) position but **never re-applies the inputs the server hasn\'t processed yet**. Those inputs are still in `pendingInputs`, but the predicted movement they produced is thrown away, so the player jumps back by one round-trip\'s worth of movement and then catches up. Hence "worse with ping".'
						},
						{
							type: 'code',
							lang: 'typescript',
							code: `function onServerSnapshot(snap: Snapshot) {
  player.state = snap.state;
  pendingInputs = pendingInputs.filter((i) => i.seq > snap.lastProcessedInput);
  for (const input of pendingInputs) player.state = simulate(player.state, input); // replay
}`
						},
						{
							type: 'p',
							text: 'That is [[client-side-prediction|prediction + reconciliation]]. Also smooth small corrections over a few frames instead of snapping, and make sure `simulate` on client and server is the same code, or every replay drifts.'
						}
					]
				},
				{
					id: 'gm3',
					title: '"I got shot after I was behind the wall"',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'The top complaint on the forum: dying a fraction of a second after reaching cover. Replays from the victim\'s view confirm it. A developer proposes "fix it by only accepting hits if the target is visible on the **server\'s current** state".'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'This is [[lag-compensation|lag compensation]] working as designed. The server rewinds targets by the shooter\'s latency, so it judges the shot against what the **shooter** saw. With 100 ms on each side, the victim reaches cover on their screen while the shooter still sees them in the open.'
						},
						{
							type: 'list',
							items: [
								'The proposed fix ("judge against current server state") removes the problem by making every high-ping player miss shots that were on target on their screen: aiming would require leading by your own ping.',
								'Balanced approach: keep rewind but cap it (e.g. 150–200 ms) so very-high-ping shooters don\'t get extreme advantage, prioritise lower-latency matchmaking, and show kill-cam from the shooter\'s view so players understand.',
								'Never trust client hit claims outright: the server re-runs the hit test against its rewound history.'
							]
						}
					]
				},
				{
					id: 'gm4',
					title: 'RTS matches desync after ten minutes, only cross-platform',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'p',
							text: 'An RTS uses [[deterministic-lockstep|deterministic lockstep]]: peers exchange only inputs and each runs the full simulation. Matches between two PCs never desync; PC vs Mac (ARM) matches desync after 8–12 minutes. Per-tick state checksums show:'
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								lines: [
									{ ts: 'tick 35998', source: 'pc', msg: 'checksum 0x9f3a11c2' },
									{ ts: 'tick 35998', source: 'mac', msg: 'checksum 0x9f3a11c2' },
									{ ts: 'tick 35999', source: 'pc', msg: 'checksum 0x41e0b7d9' },
									{ ts: 'tick 35999', source: 'mac', msg: 'checksum 0x41e0b7da' },
									{ ts: 'tick 35999', level: 'ERROR', source: 'sync', msg: 'DESYNC: unit 4412 position.x pc=1023.4999 mac=1023.5000 (projectile arc: sin/cos)' }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Different CPUs, compilers and math libraries give slightly different [[floating-point|floating-point]] results: fused multiply-add on ARM, different `sin`/`cos` implementations, different evaluation order. A 1-ulp difference in one projectile eventually flips a branch (hit vs miss) and the simulations diverge. Same-platform matches agree because they run identical instructions.'
						},
						{
							type: 'list',
							items: [
								'**Fix:** run the simulation in fixed-point (integers with an implied scale) or with a deterministic math library and strict compiler flags (no FMA contraction, no fast-math), identical on every platform.',
								'Keep per-tick checksums (as here) so desyncs are detected the tick they happen, with a dump for debugging.',
								'Rendering can stay in floats: only the authoritative simulation must be bit-exact.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · Time',
			eyebrow: 'Part 5 · 15 minutes',
			title: 'Time & scheduling',
			meta: 'deadlines · timers · clocks',
			questions: [
				{
					id: 'tm1',
					title: 'Average 4 ms, but the 50 ms deadline is missed every two minutes',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'A pricing service must answer within **50 ms** or the quote is discarded upstream. Median latency is 4 ms and the team calls it "real-time". Upstream reports bursts of missed quotes.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'pricing · latency',
								range: '11:00 – 11:59',
								panels: [
									{ kind: 'timeseries', title: 'Latency (ms)', x: dlX, series: [s('p50', p50, 0), s('p99.9', p999, 4)], thresholds: [{ value: 50, label: 'deadline', tone: 'crit' }], span: 3 },
									{ kind: 'timeseries', title: 'GC pause max (ms)', x: dlX, series: [s('gc pause', gcPause, 3)], span: 3 },
									{ kind: 'timeseries', title: 'Quotes past deadline /min', x: dlX, series: [s('missed', missed, 4)], span: 6 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Every two minutes a [[gc-pause|GC pause]] of ~110 ms stops the process, and everything in flight misses the deadline. [[percentiles|p50]] says nothing about this; real-time means meeting the deadline at the [[tail-latency|tail]] (p99.9 or max), every time.'
						},
						{
							type: 'list',
							items: [
								'Reduce allocation on the hot path (pools, preallocated buffers), and switch to a low-pause collector (e.g. ZGC/Shenandoah on the JVM) or tune heap size so collections are frequent and small.',
								'Run two instances and send each request to both (hedging), taking the first answer, so one paused process doesn\'t miss the deadline.',
								'If 50 ms is truly hard (missing it is a failure, not a slowdown), consider a runtime without stop-the-world GC for this component.'
							]
						}
					]
				},
				{
					id: 'tm2',
					title: 'The browser metronome drifts',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							caption: 'A rhythm-training web app plays a click every beat.',
							code: `const beatMs = 60_000 / bpm;       // 500 ms at 120 bpm
setInterval(() => playClick(), beatMs);`
						},
						{ type: 'p', text: 'Users say it slowly drifts behind a real metronome and goes completely wrong if they switch tabs for a moment.' }
					],
					answer: [
						{
							type: 'list',
							items: [
								'**[[timer-drift|Drift]]:** each callback fires when the [[event-loop|event loop]] gets to it, a few ms late, and the next one is scheduled from that late point. Errors accumulate rather than cancel.',
								'**Background tabs:** browsers throttle timers in hidden tabs to about once per second, so beats bunch up or vanish.',
								'**Fix for audio:** schedule clicks on the Web Audio clock (`audioContext.currentTime`), a little ahead of time ("lookahead scheduling"): compute each beat\'s exact time as `start + n × beatSeconds`, not "previous + interval". Audio scheduled on that clock plays on time even if JavaScript is late.',
								'General rule: compute when things should happen from a monotonic start time; never count ticks.'
							]
						}
					]
				},
				{
					id: 'tm3',
					title: 'Sorting events from two servers by timestamp',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'Merged audit log, sorted by wall-clock timestamp',
								lines: [
									{ ts: '12:00:00.1012', source: 'api-2', msg: 'order 77 cancelled by user' },
									{ ts: '12:00:00.1018', source: 'api-1', msg: 'order 77 created' },
									{ ts: '12:00:00.1031', source: 'api-1', msg: 'order 77 payment captured' }
								]
							}
						},
						{ type: 'p', text: 'Both servers sync with [[ntp|NTP]] and report offsets under 2 ms. Compliance wants a provably correct order of events.' }
					],
					answer: [
						{
							type: 'p',
							text: 'The events are 0.6 ms apart, but NTP over a normal network is only accurate to roughly a millisecond or a few. A "cancel" before "create" is impossible causally; the wall clocks simply can\'t order events this close together.'
						},
						{
							type: 'list',
							items: [
								'**For causal order:** carry a logical clock. A [[hybrid-logical-clock|hybrid logical clock]] stays close to wall time but guarantees that an event caused by another always sorts after it; or derive order from a single writer per order (sequence numbers per aggregate).',
								'**If physical time really matters** (e.g. trading regulation), use [[ptp|PTP]] with hardware timestamping for microsecond accuracy and record the clock error bound with each timestamp.',
								'Here the honest answer for compliance is: order per order id by sequence number, not by timestamp.'
							]
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
			title: 'Live lab',
			meta: 'reconnect storm after a deploy',
			questions: [
				{
					id: 'lab1',
					title: '400,000 clients reconnecting at once',
					tag: 'tricky',
					minutes: 15,
					prompt: [{ type: 'lab', lab: reconnectLab }],
					hints: [
						'Compare how many handshakes the gateways accept with how many `auth` can validate. What happens to the extra?',
						'You can\'t change client retry behaviour today, but every client honours one thing the server sends.'
					],
					answer: [
						{
							type: 'p',
							text: '**Evidence in the console:** auth errors ~97%, auth p99 at the timeout, gateway CPU pinned at 100%, and auth\'s effective capacity is 8,000/s (12,000/s at most: the Redis session store caps it). Meanwhile 400k clients retry every second in lockstep. The gateways accept 30,000 handshakes/s and push all of them at an auth service that can do 8,000. Auth queues, requests time out, almost nothing succeeds, and the failed clients retry immediately: a [[metastable-failure|metastable]] [[reconnect-storm|reconnect storm]]. Saturated gateways then miss heartbeats and drop sockets that had already reconnected.'
						},
						{
							type: 'list',
							items: [
								'**Trap: scale gateways (and auth).** 40 gateways accept 120,000 handshakes/s, so auth is even further past capacity; scaling auth stops at the 12k Redis ceiling. Goodput stays near 1,000/s and the incident runs past the SLO window.',
								'**Fix: [[admission-control|admission control]] below auth capacity**, e.g. an admit budget of **7,000/s**, rejecting the rest with a jittered `Retry-After`. Everything admitted succeeds, rejected clients come back spread over 0–20 s, and the fleet is reconnected in under two minutes.',
								'**Budget matters:** turning admission on with the default 20,000/s budget still overloads auth at first and takes about three times longer to recover.',
								'**Prevent it:** deploy gateways with gradual [[connection-draining|connection draining]] (close a few thousand sockets per second, not all at once), ship client [[exponential-backoff|exponential backoff]] with [[jitter]], and keep admission control on permanently with the budget tied to auth capacity.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'teasers',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 2 minutes each',
			title: 'Rapid fire',
			questions: [
				{
					id: 'te1',
					title: 'Heartbeat load',
					tag: 'teaser',
					minutes: 2,
					prompt: [{ type: 'p', text: '1,000,000 sockets, one ping every 30 s. Messages per second?' }],
					answer: [{ type: 'p', text: '1,000,000 ÷ 30 ≈ **33,333 pings/s** (plus as many pongs). Small in bytes, real in syscalls and TLS records, and it spikes when everyone reconnects.' }]
				},
				{
					id: 'te2',
					title: 'How many connections from one proxy IP to one backend?',
					tag: 'teaser',
					minutes: 2,
					prompt: [{ type: 'p', text: 'Linux default `ip_local_port_range` is 32768–60999.' }],
					answer: [{ type: 'p', text: '60999 − 32768 + 1 = **28,232** per (source IP, destination IP, destination port). More IPs or more destination ports multiply it.' }]
				},
				{
					id: 'te3',
					title: 'Why not stream voice over TCP?',
					tag: 'teaser',
					minutes: 2,
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'One lost packet stalls everything behind it until it is retransmitted ([[head-of-line-blocking|head-of-line blocking]]), and by then that audio is too late to play. [[udp|UDP]] lets the receiver skip or conceal the gap and keep going.'
						}
					]
				},
				{
					id: 'te4',
					title: 'Small messages take 40 ms extra',
					tag: 'teaser',
					minutes: 2,
					prompt: [{ type: 'p', text: 'A game sends tiny inputs over TCP. Latency has a suspicious ~40 ms floor.' }],
					answer: [{ type: 'p', text: '[[nagle-algorithm|Nagle\'s algorithm]] waiting on the receiver\'s delayed ACK. Set `TCP_NODELAY`.' }]
				},
				{
					id: 'te5',
					title: 'Lip sync after one hour',
					tag: 'teaser',
					minutes: 2,
					prompt: [{ type: 'p', text: 'Audio and video capture clocks differ by 50 ppm and nothing corrects for it. Drift after 1 hour? After a day?' }],
					answer: [
						{
							type: 'p',
							text: '3,600 s × 50 × 10⁻⁶ = **180 ms** after an hour (clearly visible; people notice beyond ~45 ms early or ~125 ms late), **4.32 s** after a day. Players resync using [[rtp-rtcp|RTCP]] sender reports that map each stream\'s clock to wall time.'
						}
					]
				},
				{
					id: 'te6',
					title: 'Matchmaking after splitting into regions',
					tag: 'teaser',
					minutes: 2,
					prompt: [
						{
							type: 'p',
							text: '600 players/min queue; a player\'s skill band contains 10% of them; a match needs 10 players. Expected wait to find 9 others? What happens if you split the queue into 4 regions?'
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Eligible arrivals = 600 × 0.1 = 60/min → 9 others ≈ **9 s**. Four equal regions → 15/min → **36 s**. [[matchmaking|Matchmaking]] constraints multiply: widen the skill band the longer someone waits.'
						}
					]
				},
				{
					id: 'te7',
					title: 'The audio thread waits on the logger',
					tag: 'teaser',
					minutes: 2,
					prompt: [{ type: 'p', text: 'Audio glitches appear only when debug logging is on. The audio callback takes a mutex that the logging thread also holds while writing to disk.' }],
					answer: [
						{
							type: 'p',
							text: '[[priority-inversion|Priority inversion]]: the real-time audio thread waits for a low-priority thread doing slow I/O. Never block on locks in a real-time callback; hand data off through a lock-free ring buffer.'
						}
					]
				}
			]
		}
	]
};

export default a17;
