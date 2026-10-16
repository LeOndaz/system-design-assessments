import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'server-sent-events',
		term: 'Server-Sent Events (SSE)',
		aliases: ['SSE', 'EventSource'],
		category: 'frontend & network',
		short:
			'A one-way stream from server to browser over a plain HTTP response that never ends: the server writes `data:` lines and the browser\'s `EventSource` fires an event per message, reconnecting automatically with `Last-Event-ID`. Simpler than a [[websocket|WebSocket]] when only the server talks, but it rides on ordinary HTTP, so anything that buffers HTTP responses (corporate proxies, some CDNs, compression middleware) can hold messages back until a buffer fills.',
		analogy: 'A news ticker you subscribe to by opening one long-lived page that keeps growing.',
		related: ['websocket', 'head-of-line-blocking', 'reconnect-storm']
	},
	{
		id: 'file-descriptor',
		term: 'File descriptor',
		aliases: ['fd', 'ulimit nofile'],
		category: 'cloud & infra',
		short:
			'The small integer the kernel hands a process for every open file, pipe or socket. Each live connection costs one, and the per-process limit (`ulimit -n`, often 1,024 by default) silently caps how many sockets a server can hold: past it, `accept()` fails with `EMFILE` even though CPU and memory look idle.',
		related: ['ephemeral-ports', 'websocket']
	},
	{
		id: 'reconnect-storm',
		term: 'Reconnect storm',
		aliases: ['reconnection storm', 'thundering herd of reconnects'],
		category: 'latency & capacity',
		short:
			'When many long-lived clients lose their connection at once (deploy, failover, network blip) and all reconnect at the same moment. Reconnecting is far more expensive than staying connected (TLS handshake, auth, resubscribe, state resync), so the burst can exceed capacity, fail, and trigger synchronised retries that keep the system down. The cure is spreading reconnects out: [[jitter|jittered]] backoff on clients, server-side [[admission-control|admission control]] with a randomised `Retry-After`, and draining connections gradually during deploys.',
		analogy: 'A stadium emptying after the power cuts: everyone rushes the same exits at once, and the crush is worse than the outage.',
		related: ['metastable-failure', 'exponential-backoff', 'connection-draining', 'admission-control']
	},
	{
		id: 'admission-control',
		term: 'Admission control',
		category: 'latency & capacity',
		short:
			'Deciding at the front door how much work to accept, and rejecting the rest cheaply and early, before it consumes downstream capacity. Unlike [[load-shedding|load shedding]] in general, it is usually a fixed budget set just below the true bottleneck\'s capacity, so everything admitted actually succeeds. Pair it with a `Retry-After` that is randomised, or the rejected clients come back together.',
		related: ['load-shedding', 'reconnect-storm', 'token-bucket', 'retry-after']
	},
	{
		id: 'presence',
		term: 'Presence',
		aliases: ['online status', 'who is online'],
		category: 'distributed systems',
		short:
			'Showing who is currently online or active. It looks trivial and is really a distributed liveness problem: a user may have several devices and tabs, connections die without a goodbye, and "offline" events can arrive before the matching "online". Robust presence treats each connection as a lease that expires unless renewed by a [[heartbeat]], derives the user\'s status from the union of live leases, and adds a short grace period so a reconnect doesn\'t flash "offline".',
		related: ['heartbeat', 'websocket', 'eventual-consistency']
	},
	{
		id: 'slow-consumer',
		term: 'Slow consumer',
		category: 'messaging',
		short:
			'A subscriber that reads more slowly than messages are produced for it, such as a phone on a weak network. Unless the sender limits how much it queues per consumer, the backlog grows in the sender\'s memory and one slow client can take down a server that serves thousands. Standard answers: a bounded per-connection queue, coalescing (keep only the latest cursor or presence state), and disconnecting consumers that stay behind.',
		related: ['backpressure', 'stream-backpressure', 'memory-leak']
	},
	{
		id: 'udp',
		term: 'UDP',
		aliases: ['User Datagram Protocol'],
		category: 'frontend & network',
		short:
			'The internet\'s minimal transport: independent datagrams with no connection, ordering or retransmission. That sounds worse than [[tcp|TCP]], but for live audio, video and games a late packet is useless, so retransmitting it only delays the packets behind it. Real-time protocols run on UDP and add exactly the reliability they need (sequence numbers, selective retransmit, forward error correction). Some corporate firewalls block UDP entirely, which is why WebRTC needs a TCP/TLS fallback.',
		related: ['tcp', 'head-of-line-blocking', 'webrtc', 'turn-relay']
	},
	{
		id: 'operational-transformation',
		term: 'Operational transformation (OT)',
		aliases: ['OT'],
		category: 'distributed systems',
		short:
			'A technique for collaborative editing where each edit is an operation (insert "X" at 5, delete at 9) and concurrent operations are *transformed* against each other so every replica converges. If Alice inserts at position 1 while Bob deletes position 3, Bob\'s delete must shift to position 4 once Alice\'s insert is applied. OT is usually run through a central server that orders operations; the alternative is a [[crdt|CRDT]].',
		related: ['crdt', 'op-log-compaction', 'eventual-consistency'],
		page: [
			{ type: 'heading', text: 'The core idea: rebase concurrent edits' },
			{
				type: 'p',
				text: 'Both users start from `"abc"` (positions 0, 1, 2). At the same time, Alice inserts `X` at position 1 and Bob deletes position 2 (the `c`). Each applies their own edit locally first, then receives the other\'s.'
			},
			{
				type: 'table',
				head: ['Replica', 'Local edit', 'Then applies', 'Naive result', 'Transformed result'],
				rows: [
					['Alice', '`ins(1,X)` → `aXbc`', "Bob's `del(2)`", '`aXc` (deleted the **b**, wrong)', '`del(2)` becomes `del(3)` because Alice inserted before position 2 → `aXb`'],
					['Bob', '`del(2)` → `ab`', "Alice's `ins(1,X)`", '`aXb`', '`ins(1,X)` is unaffected (it is before the delete) → `aXb`']
				]
			},
			{ type: 'p', text: 'With transformation both replicas converge on `aXb`. Without it they diverge, and nobody notices until someone reloads.' },
			{ type: 'heading', text: 'OT vs CRDT in one table' },
			{
				type: 'table',
				head: ['', 'OT', 'CRDT'],
				rows: [
					['Ordering', 'A central server picks one order; clients rebase onto it', 'No central order needed; merge is commutative'],
					['Offline / peer-to-peer', 'Hard: long offline branches need many transforms', 'Natural: merge whenever replicas meet'],
					['Metadata cost', 'Small: positions are plain integers', 'Each character carries a unique id; deletes leave tombstones until garbage-collected'],
					['Where it is used', 'Server-mediated editors', 'Local-first apps, offline sync, multi-region']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Common misreading',
				text: '"CRDTs mean you don\'t need a server" is wrong in practice: you still need a server for auth, persistence, snapshots and fan-out. The difference is that the server doesn\'t have to decide the order of edits.'
			}
		]
	},
	{
		id: 'op-log-compaction',
		term: 'Operation-log compaction',
		aliases: ['snapshotting', 'op log compaction'],
		category: 'distributed systems',
		short:
			'Replacing a long history of edit operations with a snapshot of the current state plus only the recent operations. Without it, opening an old document means replaying millions of ops. The catch: a client that was offline and edited against a version older than the snapshot can no longer be rebased, so you keep a retention window of ops and force a full resync for anyone older than that.',
		related: ['operational-transformation', 'crdt', 'event-sourced-ledger']
	},
	{
		id: 'webrtc',
		term: 'WebRTC',
		category: 'frontend & network',
		short:
			'The browser and mobile standard for real-time audio, video and data directly between peers. It negotiates a path between two devices that are usually both behind NAT ([[ice-candidates|ICE]]), sends media over [[udp|UDP]] with encryption, and adapts bitrate to the network. When no direct path exists, traffic is relayed through a [[turn-relay|TURN]] server, which you pay for.',
		related: ['ice-candidates', 'stun', 'turn-relay', 'sfu', 'udp'],
		page: [
			{ type: 'heading', text: 'How two devices find each other' },
			{
				type: 'flow',
				steps: [
					{ label: 'Gather candidates', note: 'local IPs, public IP from STUN, relay address from TURN' },
					{ label: 'Exchange via signalling', note: 'your own WebSocket/HTTP server' },
					{ label: 'Connectivity checks', note: 'try candidate pairs, best first' },
					{ label: 'Media flows', note: 'direct if possible, relayed if not', tone: 'ok' }
				]
			},
			{
				type: 'list',
				items: [
					'**[[stun|STUN]]** answers "what is my public IP and port?" It is cheap: one small request per session.',
					'**Direct paths fail** when both sides are behind symmetric NATs or when a firewall blocks UDP. Typical consumer traffic needs a relay for roughly 10–20% of sessions; locked-down enterprise networks can be close to 100%.',
					'**[[turn-relay|TURN]]** relays every media packet through your server. It is the only thing that always works, and the only thing that costs real bandwidth.'
				]
			},
			{ type: 'heading', text: 'TURN cost, worked' },
			{
				type: 'p',
				text: '4,000 concurrent 1:1 calls on average, 18% relayed = **720 relayed calls**. Each call carries 1.5 Mbps in each direction, and the relay forwards both: 720 × 2 × 1.5 = **2,160 Mbps** of relay egress. Over a 30-day month that is 2.16 Gb/s × 2,592,000 s ÷ 8 = **699,840 GB ≈ 700 TB**: about **$35k/month at $0.05/GB**.'
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'Offer TURN over TCP and TLS on port 443 as well as UDP 3478. Corporate firewalls that block UDP almost always allow outbound 443.'
			}
		]
	},
	{
		id: 'ice-candidates',
		term: 'ICE (Interactive Connectivity Establishment)',
		aliases: ['ICE', 'ICE candidates'],
		category: 'frontend & network',
		short:
			'The procedure [[webrtc|WebRTC]] uses to find a working network path. Each side lists candidate addresses (local, public via [[stun|STUN]], relayed via [[turn-relay|TURN]]), exchanges them through your signalling server, and tests pairs until one works. "ICE failed" means no pair succeeded, usually because UDP is blocked and no TURN-over-TCP/TLS candidate was offered.',
		related: ['webrtc', 'stun', 'turn-relay']
	},
	{
		id: 'stun',
		term: 'STUN',
		category: 'frontend & network',
		short:
			'A tiny protocol a device uses to ask a public server "what IP and port do you see me as?" That public address lets two peers behind NAT try to reach each other directly. STUN is cheap because it only helps set up the path; it does not carry media. It cannot help when a NAT assigns a different port per destination (symmetric NAT) or when UDP is blocked.',
		related: ['webrtc', 'ice-candidates', 'turn-relay', 'cgnat']
	},
	{
		id: 'turn-relay',
		term: 'TURN relay',
		aliases: ['TURN'],
		category: 'frontend & network',
		short:
			'A server that relays media between two [[webrtc|WebRTC]] peers who cannot reach each other directly. It always works (if offered over TCP/TLS 443, even through strict firewalls) but it carries every byte of the call in both directions, so it is a real bandwidth bill and a capacity planning item, unlike [[stun|STUN]].',
		related: ['webrtc', 'stun', 'ice-candidates']
	},
	{
		id: 'sfu',
		term: 'SFU (Selective Forwarding Unit)',
		aliases: ['SFU', 'MCU', 'mesh topology'],
		category: 'frontend & network',
		short:
			'A media server that receives each participant\'s stream once and forwards it to everyone else without decoding it. Compared with a mesh (everyone sends to everyone), it keeps each participant\'s upload at one stream. Compared with an MCU (which decodes and mixes into one stream), it is cheap on CPU. The cost moves to server egress, which grows with the square of the room size.',
		related: ['webrtc', 'simulcast', 'fan-out'],
		page: [
			{ type: 'heading', text: 'Three topologies, same 8-person call at 1.5 Mbps per video' },
			{
				type: 'table',
				head: ['Topology', 'Each participant uploads', 'Each participant downloads', 'Server cost'],
				numeric: [],
				rows: [
					['Mesh', '7 × 1.5 = **10.5 Mbps** (most home uplinks fail here)', '7 × 1.5 = 10.5 Mbps', 'None'],
					['SFU', '1 stream (≈2.15 Mbps with 3 simulcast layers)', '7 streams, layer chosen per receiver', 'Egress = N × (N−1) streams = **56 streams ≈ 84 Mbps**'],
					['MCU', '1 stream', '1 mixed stream', 'Decode 8 + encode a composite: heavy CPU, adds latency']
				]
			},
			{ type: 'heading', text: 'Why big rooms need "last-N"' },
			{
				type: 'p',
				text: 'SFU egress grows as N(N−1). At 50 participants that is 2,450 forwarded streams, or 3,675 Mbps if everyone gets full quality. Real systems forward only the active speaker at high quality plus a few thumbnails (e.g. 1.5 + 4 × 0.15 = 2.1 Mbps per receiver, 105 Mbps for the room).'
			}
		]
	},
	{
		id: 'simulcast',
		term: 'Simulcast',
		aliases: ['SVC', 'scalable video coding'],
		category: 'frontend & network',
		short:
			'The sender encodes the same video at several qualities at once (e.g. 1.5 Mbps, 500 kbps, 150 kbps) and an [[sfu|SFU]] forwards to each receiver the layer its network can take. Without it, the SFU can only forward one quality, and the sender tends to drop to whatever the worst receiver can handle, degrading everyone. SVC achieves the same by layering one encoding.',
		related: ['sfu', 'webrtc']
	},
	{
		id: 'network-jitter',
		term: 'Network jitter',
		aliases: ['packet delay variation'],
		category: 'frontend & network',
		short:
			'Variation in how long packets take to arrive. Packets sent every 20 ms might arrive at 18, 45, 21 and 60 ms. Not to be confused with retry [[jitter]], which is randomness you add on purpose. Real-time media absorbs network jitter with a [[jitter-buffer|jitter buffer]]; a packet that arrives after its playout time is as good as lost.',
		related: ['jitter-buffer', 'udp', 'packet-loss-concealment']
	},
	{
		id: 'jitter-buffer',
		term: 'Jitter buffer',
		category: 'frontend & network',
		short:
			'A short queue on the receiver that holds incoming audio/video packets for a few tens of milliseconds so they can be played at a steady pace despite [[network-jitter|network jitter]]. Too small, and late packets are discarded (sounding like packet loss even when the network lost nothing). Too large, and conversation latency grows. Adaptive jitter buffers resize based on measured jitter.',
		related: ['network-jitter', 'packet-loss-concealment']
	},
	{
		id: 'packet-loss-concealment',
		term: 'Packet loss concealment (PLC)',
		aliases: ['PLC', 'FEC', 'forward error correction'],
		category: 'frontend & network',
		short:
			'Tricks a media decoder uses to hide missing packets: stretching or repeating the last audio, interpolating video. Forward error correction (FEC) goes further by sending a little redundant data so a lost packet can be rebuilt without a retransmission round trip. Both trade some bandwidth or quality for not stalling.',
		related: ['jitter-buffer', 'udp']
	},
	{
		id: 'hls',
		term: 'HLS / DASH',
		aliases: ['HTTP Live Streaming', 'MPEG-DASH', 'LL-HLS', 'low-latency HLS'],
		category: 'frontend & network',
		short:
			'The standard way to stream video at scale: the encoder cuts video into short files (segments) at several bitrates, a playlist lists them, and players download them over plain HTTP through a CDN, switching bitrate as bandwidth changes. It scales beautifully but latency is roughly a few segment lengths. Low-latency variants (LL-HLS, LL-DASH) publish small *partial* segments to get down to a few seconds.',
		related: ['glass-to-glass-latency', 'cdn']
	},
	{
		id: 'glass-to-glass-latency',
		term: 'Glass-to-glass latency',
		aliases: ['end-to-end video latency'],
		category: 'latency & capacity',
		short:
			'The time from light hitting the camera lens to the frame appearing on a viewer\'s screen. For segment-based streaming it is dominated by segment length times the number of segments the player buffers, not by the network.',
		related: ['hls'],
		page: [
			{ type: 'heading', text: 'Where the seconds go' },
			{
				type: 'table',
				head: ['Stage', '6 s segments', '2 s segments', 'LL-HLS (0.33 s parts)'],
				numeric: [1, 2, 3],
				rows: [
					['Encode', '1', '1', '1'],
					['Wait for the segment (or part) to finish', '6', '2', '0.33'],
					['Package + CDN', '1', '1', '0.5'],
					['Player buffer (3 segments / 3 parts)', '18', '6', '≈1'],
					['**Total**', '**26 s**', '**10 s**', '**≈2.8 s**']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Shorter segments cut latency but multiply playlist and segment requests per viewer, which the CDN and origin have to absorb, and give the player less runway to ride out a network hiccup. Below about 1 s you are in WebRTC territory, which costs far more per viewer.'
			}
		]
	},
	{
		id: 'tick-rate',
		term: 'Tick rate',
		category: 'latency & capacity',
		short:
			'How many times per second a game server simulates the world and sends updates (e.g. 20, 60 or 128 Hz). Each tick has a hard compute budget (1000 ÷ 60 ≈ 16.7 ms at 60 Hz) and bandwidth grows linearly with it. Doubling the tick rate doubles snapshot traffic for every player.',
		related: ['interest-management', 'client-side-prediction']
	},
	{
		id: 'client-side-prediction',
		term: 'Client-side prediction & reconciliation',
		aliases: ['prediction', 'server reconciliation', 'lag compensation', 'rubber-banding'],
		category: 'distributed systems',
		short:
			'Games feel responsive despite network latency because the client applies your input immediately (prediction) while also sending it to the authoritative server. When the server\'s answer arrives, the client resets to the server state and re-applies inputs the server hasn\'t processed yet (reconciliation). Get the replay wrong and the player visibly snaps back ("rubber-banding").',
		related: ['lag-compensation', 'tick-rate', 'deterministic-lockstep'],
		page: [
			{ type: 'heading', text: 'The loop' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Client stamps each input with a sequence number, applies it locally, stores it in a pending list, and sends it.',
					'Server applies inputs in order and sends back its authoritative state plus the **last input sequence it processed**.',
					'Client sets its state to the server\'s, discards pending inputs up to that sequence, then **re-applies the remaining pending inputs** on top.'
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'The classic bug: discarding *all* pending inputs on each server update (or re-applying ones the server already processed). Either produces a snap-back proportional to round-trip time, which players report as "lag" even on a good connection.'
			},
			{ type: 'heading', text: 'Lag compensation (the other side)' },
			{
				type: 'p',
				text: 'For hit detection the server rewinds other players\' positions by the shooter\'s latency, so what you saw when you clicked is what gets judged. The side effect is that the target can be hit "behind a wall" they already ducked behind on their own screen. Servers cap the rewind window (e.g. 200 ms) to bound the unfairness.'
			}
		]
	},
	{
		id: 'lag-compensation',
		term: 'Lag compensation',
		category: 'distributed systems',
		short:
			'Server-side rewinding of the world to the moment a player acted, based on their latency, so their shot is judged against what they actually saw. It is why victims sometimes die after reaching cover: the shooter\'s view was older. Servers cap how far back they will rewind to limit the unfairness to low-latency players.',
		related: ['client-side-prediction', 'tick-rate']
	},
	{
		id: 'interest-management',
		term: 'Interest management',
		aliases: ['area of interest', 'relevancy filtering'],
		category: 'latency & capacity',
		short:
			'Sending each client only the part of the world it can see or affect, instead of everything. It is the biggest bandwidth lever in multiplayer games and also an anti-cheat measure: a client that never receives hidden enemies\' positions cannot draw them through walls.',
		related: ['tick-rate', 'fan-out']
	},
	{
		id: 'deterministic-lockstep',
		term: 'Deterministic lockstep',
		aliases: ['lockstep'],
		category: 'distributed systems',
		short:
			'A networking model where peers exchange only inputs, and every machine runs the exact same simulation. Bandwidth is tiny, but it requires bit-identical results everywhere. Floating-point differences between CPUs, compilers or math libraries (fused multiply-add, different `sin` implementations) make simulations drift apart ("desync"), so lockstep games use fixed-point math or carefully controlled float code and compare per-tick checksums.',
		related: ['floating-point', 'client-side-prediction']
	},
	{
		id: 'ptp',
		term: 'PTP (Precision Time Protocol)',
		aliases: ['IEEE 1588', 'PTP'],
		category: 'distributed systems',
		short:
			'A clock synchronisation protocol that, with hardware timestamping in network cards and switches, keeps machines within microseconds or better of each other. [[ntp|NTP]] over typical networks gives milliseconds. Use PTP when you must order or correlate events across machines closer together than NTP\'s error, as in trading, telecom or audio/video production; otherwise prefer logical clocks.',
		related: ['ntp', 'clock-skew', 'hybrid-logical-clock']
	},
	{
		id: 'priority-inversion',
		term: 'Priority inversion',
		category: 'latency & capacity',
		short:
			'A high-priority task is stuck waiting for a lock held by a low-priority task, which itself can\'t run because medium-priority work keeps preempting it. The urgent thread is effectively running at the lowest priority. Famous from the Mars Pathfinder resets; common today when an audio or render thread shares a mutex with logging or UI code. Fixes: priority inheritance, or lock-free handoff (a ring buffer) on real-time paths.',
		related: ['tail-latency', 'gc-pause']
	},
	{
		id: 'timer-drift',
		term: 'Timer drift',
		aliases: ['setInterval drift'],
		category: 'latency & capacity',
		short:
			'Repeating timers like `setInterval(fn, 16)` don\'t fire exactly on schedule: each callback runs late by however long the event loop was busy, browsers clamp or throttle timers in background tabs (to about once per second), and the errors accumulate. Anything that must stay in time computes elapsed time from a monotonic clock (`performance.now()`) and catches up with an accumulator, rather than counting ticks.',
		related: ['event-loop', 'injected-clock']
	},
	{
		id: 'matchmaking',
		term: 'Matchmaking',
		category: 'latency & capacity',
		short:
			'Grouping waiting players into matches under constraints such as skill range, region and party size. It is a queueing problem: the stricter the constraints, the fewer eligible players arrive per second and the longer everyone waits. Most systems start strict and widen the acceptable range the longer someone has waited.',
		related: ['littles-law']
	},
	{
		id: 'rtp-rtcp',
		term: 'RTP / RTCP',
		aliases: ['RTP', 'RTCP', 'sender report'],
		category: 'frontend & network',
		short:
			'RTP carries real-time media packets with sequence numbers and media timestamps; RTCP is its control channel, carrying loss and jitter reports and *sender reports* that map each stream\'s media clock to a shared wall-clock time. Players use those mappings to keep audio and video in sync even though each stream has its own clock.',
		related: ['webrtc', 'ntp', 'network-jitter']
	}
];

export default terms;
