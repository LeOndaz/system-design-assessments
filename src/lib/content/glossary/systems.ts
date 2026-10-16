import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'split-brain',
		term: 'Split brain',
		category: 'distributed systems',
		short:
			'Two nodes both believe they are the leader (primary) at the same time, usually after a network partition, so both accept writes and the data diverges. It happens because each side can only see "I can\'t reach the other one", which looks identical whether the other node is dead or merely unreachable. Timeouts alone cannot tell those apart; only a [[quorum]] or a [[fencing-token]] can.',
		analogy:
			'Two managers on opposite sides of a cut phone line, each assuming the other quit, both promoting themselves and signing contracts in the company\'s name.',
		related: ['quorum', 'fencing-token', 'failover', 'distributed-lock'],
		page: [
			{ type: 'heading', text: 'How it happens' },
			{
				type: 'flow',
				steps: [
					{ label: 'Primary A serving writes' },
					{ label: 'Network partition', note: 'A ↔ B link drops', tone: 'warn' },
					{ label: 'B times out on A', note: '"A must be dead"' },
					{ label: 'B promotes itself', tone: 'crit' },
					{ label: 'A still alive, still writing', tone: 'crit' },
					{ label: 'Partition heals: two histories', tone: 'crit' }
				]
			},
			{
				type: 'p',
				text: 'The failure detector is not wrong, it is *incomplete*: a node that stops answering might be dead, paused by a [[gc-pause|GC pause]], or on the other side of a partition. Any design that promotes on timeout alone will eventually produce two leaders.'
			},
			{ type: 'heading', text: 'The two real defences' },
			{
				type: 'table',
				head: ['Defence', 'What it guarantees', 'Cost'],
				rows: [
					[
						'[[quorum|Majority quorum]] for leadership',
						'At most one side of any partition has a majority, so at most one leader can be *elected*.',
						'Needs ≥3 voters; the minority side becomes read-only or unavailable.'
					],
					[
						'[[fencing-token|Fencing tokens]] at the storage layer',
						'Even if an old leader *thinks* it still leads, storage rejects writes carrying an older epoch.',
						'Every write path must carry and check the epoch.'
					]
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Why quorum alone is not enough',
				text: 'Quorum stops two leaders being elected, but the old leader may not *know* it lost (paused process, slow clock). It keeps writing until it next checks in. Fencing makes the storage, not the leader, the judge of who is current.'
			},
			{ type: 'heading', text: 'How to spot it after the fact' },
			{
				type: 'list',
				items: [
					'Two nodes report `role=primary` in overlapping time ranges (check each node\'s own logs, not the orchestrator\'s view).',
					'Sequence numbers or LSNs fork: both sides have rows with ids the other side doesn\'t.',
					'Unique-constraint violations or duplicate ids appear only after the partition heals and replication resumes.'
				]
			}
		]
	},
	{
		id: 'quorum',
		term: 'Quorum',
		category: 'distributed systems',
		short:
			'The minimum number of replicas that must agree for a read or write to count. With N copies, writing to W and reading from R guarantees you see the latest write when R + W > N, because the read set and write set must overlap in at least one node. A majority quorum (more than N/2) also means two disjoint groups can never both act, which is what prevents [[split-brain|split brain]].',
		analogy:
			'A committee of 5 where any decision needs 3 votes: two rival meetings in different rooms can never both reach 3, so only one can decide.',
		related: ['split-brain', 'fencing-token', 'eventual-consistency'],
		page: [
			{ type: 'heading', text: 'The overlap rule' },
			{
				type: 'table',
				head: ['N', 'W', 'R', 'R + W > N?', 'What you get'],
				rows: [
					['3', '2', '2', 'yes (4 > 3)', 'Read always overlaps the latest write. Survives 1 node down for both reads and writes.'],
					['3', '3', '1', 'yes', 'Fast reads, but any single node down blocks all writes.'],
					['3', '1', '1', 'no', 'Fast and available, but reads can be stale: classic eventual consistency.'],
					['5', '3', '3', 'yes', 'Survives 2 nodes down.']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'The subtle part',
				text: '`R + W > N` guarantees overlap, not linearizability. With concurrent writes, sloppy quorums (hinted handoff to non-home nodes) or last-writer-wins conflict resolution, you can still read an older value. "Quorum" in a vendor doc rarely means "strongly consistent" without extra machinery.'
			},
			{ type: 'heading', text: 'Even numbers buy nothing' },
			{
				type: 'p',
				text: 'A 4-node cluster needs 3 for a majority, so it tolerates 1 failure: exactly the same as 3 nodes, with more hardware and more ways to split 2–2 (where *nobody* has a majority and the whole cluster stalls). Use odd numbers for voting members.'
			}
		]
	},
	{
		id: 'crdt',
		term: 'CRDT',
		aliases: ['conflict-free replicated data type'],
		category: 'distributed systems',
		short:
			'A data structure designed so that replicas can each accept updates independently and still converge to the same value when they sync, without coordination and without losing updates. It works by making the merge operation order-independent (commutative, associative, idempotent): e.g. a counter stores a separate tally per replica and the value is their sum. The price is limited operations and growing metadata.',
		analogy:
			'Each cashier keeps their own tally sheet; at closing you add the sheets. Nobody overwrites anyone, and the order you collect the sheets in doesn\'t matter.',
		related: ['last-writer-wins', 'active-active', 'eventual-consistency'],
		page: [
			{ type: 'heading', text: 'Why a plain counter loses increments' },
			{
				type: 'p',
				text: 'Two regions each read `likes = 100`, each add 1, each write `101`. Under [[last-writer-wins]], one write replaces the other: the true value is 102, the stored value is 101. No clock fix helps, because the problem is that "set to 101" carries no information about *which* increments it includes.'
			},
			{ type: 'heading', text: 'G-Counter and PN-Counter' },
			{
				type: 'code',
				lang: 'python',
				code: `# G-Counter: one slot per replica, each replica only increments its own slot.
state = {"eu": 0, "us": 0}

def increment(state, replica, n=1):
    state[replica] += n

def merge(a, b):          # commutative, associative, idempotent
    return {r: max(a.get(r, 0), b.get(r, 0)) for r in a.keys() | b.keys()}

def value(state):
    return sum(state.values())

# PN-Counter = two G-Counters (increments P, decrements N); value = sum(P) - sum(N).`
			},
			{
				type: 'p',
				text: 'Merge with `max` per slot works because each slot only ever grows and only one replica writes it: whichever copy has the bigger number for a slot has seen strictly more of that replica\'s increments. Merging twice, or in any order, gives the same answer.'
			},
			{ type: 'heading', text: 'Where CRDTs do not fit' },
			{
				type: 'table',
				head: ['Need', 'CRDT?', 'Why'],
				rows: [
					['Like counts, view counts, presence sets', 'Yes', 'Commutative updates, approximate timing is fine.'],
					['Collaborative text editing', 'Yes (sequence CRDTs)', 'Designed for it, with metadata overhead.'],
					['Inventory that must never go below 0', 'No (alone)', 'A CRDT converges, but two regions can each sell the last unit before merging. Invariants that span replicas need coordination or reservations.'],
					['Bank balance with overdraft rules', 'No', 'Same invariant problem.']
				]
			}
		]
	},
	{
		id: 'last-writer-wins',
		term: 'Last-writer-wins (LWW)',
		aliases: ['LWW'],
		category: 'distributed systems',
		short:
			'A conflict rule for replicated data: when two replicas have different values, keep the one with the later timestamp and throw the other away. It is simple and always converges, but it silently drops concurrent updates (both increments in a counter, both edits to a document), and "later" depends on wall clocks, so a node with a fast clock wins arguments it shouldn\'t.',
		related: ['crdt', 'clock-skew', 'active-active', 'hybrid-logical-clock'],
		analogy: 'Two people edit the same whiteboard from photos; whoever re-draws it last erases the other\'s changes entirely.'
	},
	{
		id: 'active-active',
		term: 'Active-active (multi-region)',
		category: 'distributed systems',
		short:
			'Running the same service in two or more regions where every region accepts writes at the same time, instead of one primary and standby replicas. Users get low latency and survive a region loss, but any data both regions can change can conflict, so you must choose per entity: conflict-free types ([[crdt|CRDTs]]), a single "home" region per record, or coordination for invariants like stock levels.',
		related: ['crdt', 'last-writer-wins', 'replication-lag', 'idempotency-key']
	},
	{
		id: 'hybrid-logical-clock',
		term: 'Hybrid logical clock (HLC)',
		category: 'distributed systems',
		short:
			'A timestamp that combines wall-clock time with a logical counter, so it stays close to real time but still orders causally related events correctly even when clocks drift. When a node receives a message stamped later than its own clock, it moves its clock forward instead of producing an earlier timestamp. It reduces, but does not remove, the risk of [[clock-skew]] deciding [[last-writer-wins]] conflicts.',
		related: ['clock-skew', 'last-writer-wins']
	},
	{
		id: 'watermark',
		term: 'Watermark (stream processing)',
		category: 'distributed systems',
		short:
			'A stream processor\'s running estimate of "I have probably seen all events up to time T". When the watermark passes the end of a time window, the window is closed and its result emitted. Events that arrive later with an event time inside that closed window are *late*: dropped, sent to a side output, or used to issue a correction, depending on configuration. A watermark is a bet, not a fact.',
		analogy:
			'A teacher collecting exams says "everything before 3 pm is in" and starts grading. A student who slides one under the door at 3:20 either gets ignored or forces a re-grade.',
		related: ['late-arriving-data', 'eventual-consistency', 'out-of-order-delivery'],
		page: [
			{ type: 'heading', text: 'Event time vs processing time' },
			{
				type: 'p',
				text: '**Event time** is when something happened (the order was placed at 23:58). **Processing time** is when the pipeline saw it (00:07, because a phone was offline). Revenue "for Monday" must use event time, but the pipeline only ever knows processing time, so it needs a rule for when Monday is "done". That rule is the watermark.'
			},
			{ type: 'heading', text: 'A common watermark rule' },
			{
				type: 'code',
				lang: 'text',
				code: `watermark = max(event_time seen so far) − allowed_lateness

window [00:00, 01:00) closes when watermark ≥ 01:00
  i.e. when we've seen an event stamped ≥ 01:00 + allowed_lateness`
			},
			{
				type: 'table',
				head: ['Allowed lateness', 'Result arrives', 'Late events dropped', 'Use when'],
				rows: [
					['0 s', 'Immediately', 'Many (any reordering)', 'Rough live dashboards'],
					['5 min', '5 min after window end', 'Few', 'Most operational metrics'],
					['24 h', 'Next day', 'Almost none', 'Finance close (or: emit early, then correct)']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'One fast clock moves everyone',
				text: 'Because the watermark follows the *maximum* event time seen, a single producer with a clock 10 minutes fast drags the watermark forward and makes everyone else\'s on-time events "late". Clamp event times to arrival time + a small bound, or compute watermarks per source and take the minimum.'
			},
			{ type: 'heading', text: 'Three ways to handle late data' },
			{
				type: 'list',
				items: [
					'**Drop:** simplest; the number is final but wrong by the late fraction.',
					'**Side output:** route late events to a separate sink so finance can reconcile.',
					'**Retract and re-emit:** update the closed window and emit a correction; consumers must handle "Monday changed after it was published".'
				]
			}
		]
	},
	{
		id: 'late-arriving-data',
		term: 'Late-arriving data',
		category: 'distributed systems',
		short:
			'Events that reach a pipeline after the window they belong to (by event time) has already been closed and published. Common sources: mobile clients offline, retries from a dead-letter queue, batch uploads, a partition that lagged. The symptom is "yesterday\'s number changed" or "yesterday\'s number is slightly low forever", depending on whether the pipeline corrects or drops.',
		related: ['watermark', 'out-of-order-delivery', 'reconciliation']
	},
	{
		id: 'hyperloglog',
		term: 'HyperLogLog (HLL)',
		category: 'distributed systems',
		short:
			'A probabilistic structure that estimates how many *distinct* items you have seen (unique visitors, unique buyers) using a few kilobytes no matter how many items there are. It hashes each item and remembers, per bucket, the longest run of leading zeros seen: rare long runs imply many distinct values. The answer has a known standard error of about 1.04 ÷ √(buckets), e.g. ~0.8% with 16,384 buckets, so small drift is expected, not a bug.',
		analogy:
			'Guessing how many people flipped coins from the longest streak of heads anyone reported: 10 heads in a row suggests about a thousand flippers.',
		related: ['bloom-filter', 'count-min-sketch', 'cardinality'],
		page: [
			{ type: 'heading', text: 'What the error actually means' },
			{
				type: 'table',
				head: ['Registers (m)', 'Memory (approx)', 'Standard error 1.04/√m', '95% of estimates within'],
				numeric: [1, 2, 3],
				rows: [
					['1,024', '~1 KB', '3.25%', '±6.5%'],
					['16,384', '~12 KB', '0.81%', '±1.6%'],
					['65,536', '~48 KB', '0.41%', '±0.8%']
				]
			},
			{
				type: 'p',
				text: 'So a dashboard tile backed by a 16k-register HLL reporting 41,600 unique buyers when the exact `COUNT(DISTINCT)` is 42,000 is **within normal error** (−0.95%). A drift of −8%, or a drift that always goes the same direction and grows over time, is a bug: usually hashing a non-unique key, merging sketches with different precisions, or counting before deduplicating identity.'
			},
			{ type: 'heading', text: 'Properties that make it useful' },
			{
				type: 'list',
				items: [
					'**Mergeable:** the union of two HLLs is the per-register max, so daily sketches roll up to weekly without re-scanning raw data.',
					'**Not subtractable:** you cannot compute "unique this week minus unique last week" reliably; intersections are noisy.',
					'**Exact for tiny sets:** good implementations switch to exact counting below a threshold, so small numbers being exact and large ones being fuzzy is normal.'
				]
			}
		]
	},
	{
		id: 'bloom-filter',
		term: 'Bloom filter',
		category: 'distributed systems',
		short:
			'A compact bit array that answers "have I seen this item?" with either "definitely not" or "probably yes". It never gives false negatives, only false positives, at a rate set by its size and number of hash functions. Used to skip expensive lookups (disk reads, remote calls) for items that are certainly absent.',
		related: ['hyperloglog', 'count-min-sketch']
	},
	{
		id: 'count-min-sketch',
		term: 'Count-min sketch',
		category: 'distributed systems',
		short:
			'A small table of counters that estimates how often each item occurs in a stream (heavy hitters, top-k) without storing every item. Each item increments one counter per row via different hashes; the estimate is the minimum across rows. It can only over-count (collisions add), never under-count, which makes it safe for "who are the top talkers" questions.',
		related: ['hyperloglog', 'bloom-filter', 'top-k']
	},
	{
		id: 'oversharding',
		term: 'Oversharding',
		category: 'databases',
		short:
			'Splitting an index or table into far more shards than the data or hardware needs. Every shard has fixed overhead (heap for metadata, file handles, a thread for each merge and refresh, cluster-state entries), so thousands of tiny shards make a cluster slower and less stable, and adding nodes can make it *worse* by triggering mass shard relocation. Rule of thumb for search clusters: tens of GB per shard, and shard count planned against heap.',
		related: ['hot-partition', 'fan-out', 'tail-latency']
	},
	{
		id: 'aead',
		term: 'AEAD (authenticated encryption)',
		aliases: ['AES-GCM', 'ChaCha20-Poly1305'],
		category: 'security & compliance',
		short:
			'Encryption that also produces a tag proving the ciphertext wasn\'t tampered with, e.g. AES-GCM or ChaCha20-Poly1305. You give it a key, a unique *nonce* per message, the plaintext and optional "associated data" (like a record id) that is authenticated but not encrypted. Its safety depends completely on never repeating a nonce with the same key.',
		related: ['nonce-reuse']
	},
	{
		id: 'nonce-reuse',
		term: 'Nonce reuse',
		category: 'security & compliance',
		short:
			'Encrypting two different messages with the same key and the same nonce in a stream-style cipher like AES-GCM. The two ciphertexts then XOR to the XOR of the two plaintexts, leaking structure (and full plaintext if one is known), and with GCM the attacker can also recover the authentication subkey and forge valid messages. One repeat is enough; it is a key-compromise event, not a bug to patch quietly.',
		analogy:
			'Using the same one-time pad twice: lay the two encrypted pages on top of each other and the pad cancels out.',
		related: ['aead']
	},
	{
		id: 'consistent-hashing',
		term: 'Consistent hashing',
		category: 'distributed systems',
		short:
			'A way to assign keys to servers so that adding or removing one server moves only about 1/N of the keys instead of nearly all of them. Servers and keys are hashed onto the same circle; each key belongs to the first server clockwise from it. Plain `hash(key) % N` reshuffles almost everything when N changes, which cold-starts every cache at once.',
		analogy:
			'Seats around a round table: when a new guest sits down, only the people between them and the next guest change who serves them.',
		related: ['virtual-nodes', 'hot-partition', 'cache-stampede'],
		page: [
			{ type: 'heading', text: 'Mod-N vs ring' },
			{
				type: 'table',
				head: ['Change', '`hash % N` keys moved', 'Consistent hashing keys moved'],
				rows: [
					['10 → 11 servers', '~91% (10/11)', '~9% (1/11)'],
					['10 → 9 servers (one dies)', '~90%', '~10% (only the dead node\'s keys)'],
					['100 → 101', '~99%', '~1%']
				]
			},
			{
				type: 'p',
				text: 'For a cache tier this is the difference between a deploy that warms 9% of keys and one that sends 91% of reads to the database at once (a [[cache-stampede]] you scheduled yourself).'
			},
			{ type: 'heading', text: 'The catch: uneven arcs' },
			{
				type: 'p',
				text: 'With one point per server, random placement leaves some servers owning arcs several times larger than others. [[virtual-nodes|Virtual nodes]] fix this: each server gets 100–200 points on the ring, so each owns many small arcs and the load averages out. Weighted servers simply get more points.'
			},
			{
				type: 'code',
				lang: 'python',
				code: `import bisect, hashlib

def h(s: str) -> int:
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

class Ring:
    def __init__(self, vnodes=128):
        self.vnodes, self.points, self.owner = vnodes, [], {}

    def add(self, node: str):
        for i in range(self.vnodes):
            p = h(f"{node}#{i}")
            bisect.insort(self.points, p)
            self.owner[p] = node

    def get(self, key: str) -> str:
        i = bisect.bisect(self.points, h(key)) % len(self.points)   # wrap around
        return self.owner[self.points[i]]`
			}
		]
	},
	{
		id: 'virtual-nodes',
		term: 'Virtual nodes',
		aliases: ['vnodes'],
		category: 'distributed systems',
		short:
			'Placing each physical server at many points on a [[consistent-hashing]] ring instead of one. Many small arcs per server average out to an even share of keys, and when a server leaves, its keys spread across all remaining servers instead of dumping onto its single neighbour.',
		related: ['consistent-hashing', 'hot-partition']
	},
	{
		id: 'headroom',
		term: 'Headroom',
		category: 'latency & capacity',
		short:
			'The spare capacity you deliberately keep unused so the system survives the things you know will happen: a traffic spike, losing an availability zone, a deploy taking pods out, a retry wave. Queues make latency explode as utilization approaches 100%, so "we\'re only at 80%" can already be the edge. Headroom is sized from failure scenarios, not from a round percentage.',
		related: ['capacity-planning', 'littles-law', 'availability-zone', 'saturation']
	},
	{
		id: 'capacity-planning',
		term: 'Capacity planning',
		category: 'latency & capacity',
		short:
			'Turning expected load into a concrete number of servers, connections and dollars. The core arithmetic is [[littles-law|Little\'s law]] (concurrency = throughput × latency), then dividing by per-unit capacity at a safe utilization, then adding [[headroom]] for failure modes (N+1, a lost zone). The trap is planning on average latency when slots are held for tail latency, or on average traffic when peaks drive cost.',
		related: ['littles-law', 'headroom', 'autoscaling', 'connection-pool'],
		page: [
			{ type: 'heading', text: 'The five-line method' },
			{
				type: 'list',
				ordered: true,
				items: [
					'**Peak throughput** λ (not daily average). Include retries.',
					'**Concurrency** L = λ × W, with W the *mean* time a slot is held (Little\'s law uses the mean, but check the tail separately).',
					'**Units** = L ÷ (slots per unit × target utilization). Target utilization is ~60–70% for latency-sensitive services because queueing delay grows sharply above that.',
					'**Failure headroom:** with 3 zones and the requirement to survive one, the remaining 2 must carry everything, so multiply by 3/2.',
					'**Downstream check:** units × connections per unit must fit the database\'s limit, or you need a pooler.'
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Why ~65%, not 95%',
				text: 'For a simple queue, waiting time scales like ρ/(1−ρ). At 50% utilization that factor is 1; at 80% it is 4; at 95% it is 19. A small traffic bump at 90% turns into a large latency jump.'
			}
		]
	},
	{
		id: 'vpc-gateway-endpoint',
		term: 'VPC gateway endpoint',
		category: 'cloud & infra',
		short:
			'A route-table entry that sends traffic from private subnets to S3 or DynamoDB over the provider\'s network directly, instead of out through a NAT gateway. It costs nothing, removes per-GB NAT processing charges, and stops bulk object traffic from competing with every other outbound connection for the NAT\'s ports and bandwidth.',
		related: ['nat-port-exhaustion', 'availability-zone']
	},
	{
		id: 'traffic-shifting',
		term: 'Traffic shifting',
		category: 'reliability practice',
		short:
			'Moving a share of requests from one target (region, version, cluster) to another by changing weights at the load balancer or DNS. The destination must have capacity for the new share *before* the shift lands, because traffic moves in seconds while autoscaling takes minutes. With DNS, the shift is also gradual and uneven because clients cache answers for the record\'s TTL.',
		related: ['dns-ttl', 'autoscaling', 'cascading-failure', 'headroom']
	},
	{
		id: 'cache-warming',
		term: 'Cache warming',
		category: 'caching',
		short:
			'Filling a new or empty cache with the hot working set before it takes real traffic, e.g. by dual-writing to old and new clusters or replaying recent keys. Switching readers to a cold cache turns every read into a miss, so the database suddenly receives the full read load the cache was absorbing.',
		related: ['cache-stampede', 'cache-hit-rate', 'consistent-hashing']
	},
	{
		id: 'quota-leasing',
		term: 'Quota leasing',
		category: 'distributed systems',
		short:
			'Handling a global limit (rate limit, budget, stock) across regions by having a central allocator hand each region a slice of the quota for a short period, which the region spends locally with no cross-region call per request. Unused slices are returned or expire. It trades a small, bounded overshoot or under-use for removing a remote round trip from every request.',
		related: ['token-bucket', 'active-active', 'oversell']
	}
];

export default terms;
