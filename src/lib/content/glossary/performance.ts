import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'flame-graph',
		term: 'Flame graph',
		aliases: ['icicle graph', 'folded stacks'],
		category: 'observability',
		short:
			'A picture of many sampled call stacks merged together. Each box is a function; its **width** is the share of samples in which it was on the stack, and boxes stacked on top are the functions it called. The x-axis is not time: it is sorted alphabetically so identical stacks merge, so you read it by width, never by left-to-right order.',
		analogy:
			'A skyline where each building\'s width is how much of the day a department was busy, and the floors above it are the teams it handed work to.',
		related: ['profiling', 'sampling-profiler', 'off-cpu-analysis', 'self-time'],
		page: [
			{ type: 'heading', text: 'From samples to a picture' },
			{
				type: 'p',
				text: 'A [[sampling-profiler]] interrupts the program ~100 times a second and records the current call stack. The tool counts identical stacks and prints them "folded": one line per unique stack, frames joined by `;`, followed by the count. A flame graph draws exactly those counts.'
			},
			{
				type: 'code',
				lang: 'text',
				caption: 'Folded stacks: 10,000 on-CPU samples from one minute of a Go service.',
				code: `main;http.serve;handler.Search;search.Run;json.Marshal;reflect.Value.Field 2100
main;http.serve;handler.Search;search.Run;json.Marshal;strconv.AppendFloat 1700
main;http.serve;handler.Search;search.Run;index.Lookup 2600
main;http.serve;handler.Search;search.Rank 900
main;http.serve;middleware.Log 400
runtime.gcBgMarkWorker;runtime.scanobject 2300`
			},
			{
				type: 'table',
				head: ['Function', 'Total (on stack)', 'Self (top of stack)'],
				numeric: [1, 2],
				rows: [
					['`handler.Search`', '73%', '0%'],
					['`search.Run`', '64%', '0%'],
					['`json.Marshal`', '38%', '0%'],
					['`index.Lookup`', '26%', '26%'],
					['`runtime.scanobject` (GC)', '23%', '23%'],
					['`reflect.Value.Field`', '21%', '21%']
				]
			},
			{ type: 'heading', text: 'How to read it' },
			{
				type: 'list',
				items: [
					'**Wide boxes at the top** (large [[self-time|self time]]) are where CPU is actually burned. That is `index.Lookup`, GC scanning and reflection here.',
					'**Wide boxes lower down** with no width of their own are just callers. Optimizing `handler.Search`\'s own code can save 0%.',
					'**Tall, narrow towers** are deep call chains (recursion, middleware layers). They look dramatic and usually cost little.',
					'**Separate towers can be one problem.** GC (`runtime.gcBgMarkWorker`) runs on its own goroutines, so allocation in `json.Marshal` shows up as a separate 23% tower.',
					'**An on-CPU flame graph cannot show waiting.** Locks, I/O and sleeps need an [[off-cpu-analysis|off-CPU]] or wall-clock profile.'
				]
			}
		]
	},
	{
		id: 'self-time',
		term: 'Self time vs total time',
		aliases: ['exclusive time', 'inclusive time'],
		category: 'observability',
		short:
			'**Total** (inclusive) time counts every sample where a function is anywhere on the stack; **self** (exclusive) time counts only samples where it is the function currently running. A function with 45% total but 2% self is a coordinator: speeding up its own lines can save at most 2%; the cost is in what it calls.',
		related: ['flame-graph', 'profiling']
	},
	{
		id: 'sampling-profiler',
		term: 'Sampling profiler',
		aliases: ['statistical profiler', 'py-spy', 'async-profiler', 'perf'],
		category: 'observability',
		short:
			'A profiler that periodically interrupts the program (often 99 Hz) and records the stack, instead of instrumenting every call. Overhead is low and doesn\'t depend on how many calls you make, but results are statistical: a function seen in 30 samples has roughly ±18% error, so small differences between two profiles are often noise.',
		analogy: 'Checking what a worker is doing at random moments, rather than following them with a stopwatch all day.',
		related: ['profiling', 'flame-graph', 'safepoint-bias', 'instrumenting-profiler']
	},
	{
		id: 'instrumenting-profiler',
		term: 'Instrumenting (deterministic) profiler',
		aliases: ['cProfile', 'tracing profiler'],
		category: 'observability',
		short:
			'A profiler that hooks every function call and return (Python\'s `cProfile`, most "tracing" profilers). It gives exact call counts but adds a fixed cost to *each call*, so code that makes millions of tiny calls looks far more expensive than it is, and the profile can point you at the wrong function.',
		related: ['sampling-profiler', 'profiling']
	},
	{
		id: 'off-cpu-analysis',
		term: 'Off-CPU analysis',
		aliases: ['wall-clock profile', 'off-CPU flame graph'],
		category: 'observability',
		short:
			'Profiling where threads spend time **not** running: blocked on locks, disk, network, sleep or the scheduler queue. A request that takes 900 ms with 30 ms of CPU is 97% off-CPU, so a normal on-CPU profile cannot explain it; you need wall-clock or off-CPU samples (async-profiler `wall`, eBPF `offcputime`, Go block/mutex profiles).',
		related: ['flame-graph', 'lock-contention', 'sampling-profiler']
	},
	{
		id: 'safepoint-bias',
		term: 'Safepoint bias',
		category: 'observability',
		short:
			'Older JVM profilers can only sample a thread when it reaches a *safepoint* (method returns, loop back-edges). Hot code between safepoints is never seen and its time is blamed on the next safepoint, so profiles point at innocent loops. Profilers that use OS signals (async-profiler, JFR with debug info) avoid it.',
		related: ['sampling-profiler', 'method-inlining', 'jvm']
	},
	{
		id: 'method-inlining',
		term: 'Inlining',
		aliases: ['inlined frames'],
		category: 'latency & capacity',
		short:
			'A compiler or JIT optimization that copies a small function\'s body into its caller, removing call overhead and enabling further optimizations. Profilers that don\'t record inlining metadata then charge the inlined function\'s cost to the caller, so a method whose only code is a loop can show 40% self time.',
		related: ['jit-warmup', 'safepoint-bias', 'flame-graph']
	},
	{
		id: 'cache-line',
		term: 'Cache line',
		category: 'latency & capacity',
		short:
			'The unit in which CPUs move memory between RAM and caches, typically **64 bytes**. Reading one byte loads the whole line, which is why sequential access is fast (the next values are already there) and why two cores writing *different* variables in the same line fight over it.',
		related: ['false-sharing', 'memory-bandwidth-vs-latency', 'latency-numbers']
	},
	{
		id: 'false-sharing',
		term: 'False sharing',
		category: 'latency & capacity',
		short:
			'Two threads write to *different* variables that happen to sit in the same [[cache-line]]. Every write invalidates the other core\'s copy of the whole line, so the cores take turns owning it and run slower together than one thread alone, even though they share no data logically.',
		analogy: 'Two people editing different paragraphs of one shared page that only one of them can hold at a time.',
		related: ['cache-line', 'lock-contention'],
		page: [
			{
				type: 'code',
				lang: 'go',
				caption: 'Per-worker counters: no locks, no shared data, and it gets slower with more threads.',
				code: `type Stats struct {
    counts [8]int64 // 8 × 8 bytes = 64 bytes = ONE cache line
}

func worker(s *Stats, id int, n int) {
    for i := 0; i < n; i++ {
        s.counts[id]++ // each core writes its own slot... in the same line
    }
}`
			},
			{
				type: 'table',
				head: ['Threads', 'Packed counters', 'Padded to 64 B'],
				numeric: [0, 1, 2],
				caption: 'Illustrative benchmark, 100M increments per thread on an 8-core laptop.',
				rows: [
					['1', '0.21 s', '0.21 s'],
					['2', '0.96 s', '0.21 s'],
					['8', '1.90 s', '0.22 s']
				]
			},
			{ type: 'heading', text: 'Fixes' },
			{
				type: 'list',
				items: [
					'Pad each hot per-thread field to its own line (`[56]byte` padding, Java `@Contended`). Some CPUs prefetch line pairs, so 128 B padding is safer.',
					'Better: accumulate in a local variable and write the shared slot once at the end.',
					'How to spot it: CPU at 100%, throughput falling as threads rise, and `perf c2c` showing contended lines (HITM events).'
				]
			}
		]
	},
	{
		id: 'branch-prediction',
		term: 'Branch prediction',
		aliases: ['branch misprediction'],
		category: 'latency & capacity',
		short:
			'CPUs guess which way an `if` will go so they can keep their pipeline full. A correct guess is nearly free; a wrong one throws away work, about 15–20 cycles. On random data a branch is wrong ~50% of the time, which is why the same loop over sorted data can be several times faster.',
		related: ['cache-line', 'big-o-notation']
	},
	{
		id: 'memory-bandwidth-vs-latency',
		term: 'Memory bandwidth vs latency',
		aliases: ['pointer chasing', 'memory wall'],
		category: 'latency & capacity',
		short:
			'Streaming through an array runs at memory *bandwidth* (tens of GB/s, with hardware prefetching), but following pointers to unpredictable addresses pays memory *latency* (~80–100 ns) per hop. Two O(n) algorithms over the same data can differ by 100× because one is bandwidth-bound and the other is latency-bound.',
		related: ['cache-line', 'latency-numbers', 'numa']
	},
	{
		id: 'numa',
		term: 'NUMA',
		aliases: ['non-uniform memory access'],
		category: 'cloud & infra',
		short:
			'On multi-socket servers each CPU socket has its own local memory; reaching the other socket\'s memory is ~1.5–2× slower. Linux places a page on the node of the thread that *first touches* it, so if one thread initializes a big buffer, every other socket later reads it remotely. Tools: `numastat`, `numactl --interleave`.',
		related: ['memory-bandwidth-vs-latency']
	},
	{
		id: 'allocation-rate',
		term: 'Allocation rate',
		category: 'latency & capacity',
		short:
			'How many bytes per second a program allocates on the heap. In garbage-collected runtimes it sets how often the young generation fills up and is collected, so it often matters more than heap size: halving allocation halves GC frequency.',
		related: ['generational-gc', 'gc-pause', 'premature-promotion']
	},
	{
		id: 'generational-gc',
		term: 'Generational garbage collection',
		aliases: ['young generation', 'old generation', 'minor GC', 'full GC'],
		category: 'latency & capacity',
		short:
			'Most objects die young, so the heap is split: new objects go in a small **young generation** that is collected often and cheaply (only live objects are copied out), and survivors of several collections are **promoted** to the **old generation**, which is collected rarely and expensively. Pauses come from copying survivors and, worse, from full collections of the old gen.',
		related: ['gc-pause', 'premature-promotion', 'allocation-rate', 'gc-throughput-vs-pause'],
		page: [
			{
				type: 'flow',
				steps: [
					{ label: 'Eden', note: 'new objects' },
					{ label: 'Survivor spaces', note: 'copied at each young GC' },
					{ label: 'Old gen', note: 'after N survivals (tenuring threshold)', tone: 'warn' },
					{ label: 'Full / mixed GC', note: 'expensive, often stop-the-world', tone: 'crit' }
				]
			},
			{ type: 'heading', text: 'Worked example' },
			{
				type: 'p',
				text: 'Allocation 1.5 GB/s with a 512 MB young gen means a young GC every 0.512 ÷ 1.5 ≈ **0.34 s**. Request buffers that live 1.2 s are still alive at three or four collections in a row, exceed the tenuring threshold and get promoted. The old gen fills with garbage that was "almost dead", and full GCs follow. With a 2 GB young gen, collections come every 1.33 s, longer than the buffers live, so they die young and nothing is promoted.'
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'A bigger *total* heap only spaces full GCs further apart and makes each one longer. Fix promotion first.'
			}
		]
	},
	{
		id: 'premature-promotion',
		term: 'Premature promotion',
		category: 'latency & capacity',
		short:
			'Objects that are short-lived *in wall-clock terms* survive several young collections because those collections happen too often (small young gen, high [[allocation-rate]]). They are promoted to the old generation, fill it with soon-dead data and trigger expensive full collections.',
		related: ['generational-gc', 'allocation-rate', 'gc-pause']
	},
	{
		id: 'gc-throughput-vs-pause',
		term: 'Throughput vs low-pause collectors',
		aliases: ['ZGC', 'Shenandoah', 'G1', 'Parallel GC'],
		category: 'latency & capacity',
		short:
			'Throughput collectors (Parallel) stop the application and use all cores to collect fast, maximizing total work done but with long pauses. Low-pause collectors (ZGC, Shenandoah) do most work concurrently with the app, keeping pauses under a millisecond, at the cost of extra CPU and needing heap headroom; if the app allocates faster than they collect, threads stall.',
		related: ['generational-gc', 'gc-pause']
	},
	{
		id: 'object-pooling',
		term: 'Object pooling',
		aliases: ['buffer pool', 'sync.Pool'],
		category: 'latency & capacity',
		short:
			'Reusing objects or buffers instead of allocating new ones. It helps for expensive objects (connections, large buffers), but for small objects in a generational GC it often hurts (pooled objects become old and are scanned forever). It is also dangerous: returning an object to the pool while something still references it lets two requests share one buffer.',
		related: ['allocation-rate', 'generational-gc', 'race-condition']
	},
	{
		id: 'memory-fragmentation',
		term: 'Memory fragmentation',
		aliases: ['malloc arenas', 'MALLOC_ARENA_MAX', 'jemalloc'],
		category: 'latency & capacity',
		short:
			'Free memory that the process can\'t return to the OS because it is scattered between live allocations. With glibc malloc, many threads each get their own *arena*, so RSS can grow far above what the program thinks it uses. Symptoms: [[rss-memory|RSS]] 2–3× the heap size, OOM kills. Fixes: fewer arenas (`MALLOC_ARENA_MAX=2`), jemalloc/tcmalloc.',
		related: ['rss-memory', 'oomkilled', 'memory-leak']
	},
	{
		id: 'transparent-huge-pages',
		term: 'Transparent huge pages (THP)',
		aliases: ['huge pages', 'THP'],
		category: 'cloud & infra',
		short:
			'Linux can back memory with 2 MB pages instead of 4 KB ones, reducing TLB misses. But compacting memory into huge pages causes latency stalls, and after `fork()` a single write copies a whole 2 MB page instead of 4 KB. That is why Redis and many databases recommend disabling THP.',
		related: ['copy-on-write', 'redis']
	},
	{
		id: 'copy-on-write',
		term: 'Copy-on-write (fork)',
		category: 'cloud & infra',
		short:
			'After `fork()`, parent and child share memory pages until one of them writes; then that page is copied. Snapshotting by forking (Redis `BGSAVE`, Postgres backends) is cheap only while few pages are written. Heavy writes during the snapshot, or huge pages, can double memory use.',
		related: ['transparent-huge-pages', 'redis']
	},
	{
		id: 'lock-contention',
		term: 'Lock contention',
		category: 'latency & capacity',
		short:
			'Threads waiting for a lock another thread holds. While they wait they use no CPU, so a contended service shows low CPU, high latency, and throughput that stops rising (or falls) as you add threads. Fixes shrink the critical section, shard the lock (striping), or remove shared mutable state.',
		related: ['amdahls-law', 'universal-scalability-law', 'off-cpu-analysis', 'shared-mutable-state']
	},
	{
		id: 'amdahls-law',
		term: "Amdahl's law",
		category: 'latency & capacity',
		short:
			'If a fraction *s* of the work is serial, the speedup on *N* cores is at most 1 ÷ (s + (1 − s)/N), and never more than 1/s. With 10% serial work, 16 cores give 6.4×, 64 cores 8.8×, infinite cores 10×. The serial part, often one lock, sets the ceiling.',
		related: ['universal-scalability-law', 'lock-contention'],
		page: [
			{
				type: 'table',
				head: ['Serial share', '4 cores', '16 cores', '64 cores', 'Ceiling'],
				numeric: [1, 2, 3, 4],
				rows: [
					['1%', '3.88×', '13.9×', '39.3×', '100×'],
					['5%', '3.48×', '9.14×', '15.4×', '20×'],
					['10%', '3.08×', '6.40×', '8.77×', '10×'],
					['25%', '2.29×', '3.37×', '3.82×', '4×']
				]
			},
			{
				type: 'p',
				text: 'It also applies to optimization: making a function that takes 5% of the time twice as fast speeds the whole program up by 1 ÷ (0.95 + 0.025) ≈ **1.026×**. Profile first, then optimize the wide parts.'
			}
		]
	},
	{
		id: 'universal-scalability-law',
		term: 'Universal Scalability Law (USL)',
		aliases: ['retrograde scaling', 'coherency penalty'],
		category: 'latency & capacity',
		short:
			"Neil Gunther's extension of [[amdahls-law|Amdahl's law]]: X(N) = N·X₁ ÷ (1 + σ(N−1) + κN(N−1)). σ is contention (waiting for a shared resource); κ is *coherency*, the cost of keeping shared state consistent, which grows with every pair of workers. Because of κ, throughput peaks at N* = √((1−σ)/κ) and then **falls**: more threads make it slower.",
		related: ['amdahls-law', 'lock-contention', 'capacity-planning'],
		page: [
			{
				type: 'table',
				head: ['Threads N', 'Throughput (σ = 0.05, κ = 0.002, X₁ = 1,000/s)'],
				numeric: [0, 1],
				rows: [
					['1', '1,000'],
					['4', '3,407'],
					['8', '5,472'],
					['16', '7,175'],
					['22 (peak)', '7,397'],
					['32', '7,058'],
					['64', '5,240']
				]
			},
			{
				type: 'p',
				text: 'Fit σ and κ from a few load-test points (throughput at 1, 2, 4, 8, 16 workers) and you can predict the peak before production finds it. If κ > 0, adding threads beyond N* is a capacity *reduction*.'
			}
		]
	},
	{
		id: 'thread-pool-sizing',
		term: 'Thread pool sizing',
		category: 'latency & capacity',
		short:
			'For CPU-bound work, about one thread per core. For work that waits, threads ≈ cores × (1 + wait time ÷ compute time). But the pool must also respect what is downstream: threads beyond the database [[connection-pool]] size just queue for a connection instead of a thread.',
		related: ['worker-pool', 'connection-pool', 'littles-law']
	},
	{
		id: 'event-loop-lag',
		term: 'Event loop lag',
		aliases: ['event loop delay', 'blocking the event loop'],
		category: 'latency & capacity',
		short:
			'How late an [[event-loop]] runs callbacks compared with when they were due. In Node.js or asyncio, any synchronous work (a big `JSON.parse`, a CPU-heavy hash, a blocking library call) delays *every* other request in that process. Measure it (`monitorEventLoopDelay`, asyncio debug mode) and alert on p99 lag.',
		related: ['event-loop', 'main-thread']
	},
	{
		id: 'gomaxprocs',
		term: 'GOMAXPROCS (in containers)',
		aliases: ['ActiveProcessorCount', 'container-aware runtimes'],
		category: 'cloud & infra',
		short:
			'How many OS threads the Go runtime runs Go code on in parallel. Before Go 1.25 it defaulted to the *host\'s* core count, ignoring the container CPU limit. A pod limited to 2 CPUs on a 64-core node would run 64 threads, burn its CFS quota in ~3 ms and be throttled for the rest of each 100 ms period. Older JVMs had the same bug.',
		related: ['cfs-quota', 'cpu-throttling']
	},
	{
		id: 'coordinated-omission',
		term: 'Coordinated omission',
		category: 'observability',
		short:
			'A load-testing flaw where the client waits for each response before sending the next request. When the server stalls, the requests that *should* have been sent during the stall are never sent, so they are never measured. Reported p99 can look perfect while real users see seconds.',
		analogy: 'Measuring a shop\'s queue time by only timing the customers who were already at the till when it froze.',
		related: ['open-vs-closed-workload', 'percentiles', 'hdr-histogram'],
		page: [
			{ type: 'heading', text: 'A worked minute' },
			{
				type: 'p',
				text: 'Intended load: 100 req/s for 60 s (6,000 requests), normal latency 5 ms. The server freezes for 2 s once. A closed-loop tester with 10 virtual users records 5,800 normal samples plus **10** samples of ~2 s, the requests that were in flight. Reported p99 = **5 ms**.'
			},
			{
				type: 'p',
				text: 'Real users keep arriving: 200 requests arrive during the freeze and wait between 2 s and ~0 s (mean 1 s). In the true distribution of 6,000, the top 1% (60 requests) all arrived in the first 0.6 s of the stall, so true p99 ≈ **1,405 ms**. That is 280× the reported number.'
			},
			{
				type: 'list',
				items: [
					'Use open-model generators (k6 `constant-arrival-rate`, wrk2, Gatling `constantUsersPerSec`) that send on a schedule regardless of responses.',
					'Or correct latencies from the *intended* send time (HdrHistogram `recordValueWithExpectedInterval`).'
				]
			}
		]
	},
	{
		id: 'open-vs-closed-workload',
		term: 'Open vs closed workload',
		category: 'latency & capacity',
		short:
			'In a **closed** model a fixed number of users each wait for a response before sending the next request, so when the server slows down, load drops automatically. In an **open** model requests arrive independently of how fast you respond, as public traffic does. Testing an open system with a closed tool hides overload: throughput falls instead of latency exploding.',
		related: ['coordinated-omission', 'littles-law', 'queueing-theory']
	},
	{
		id: 'queueing-theory',
		term: 'Queueing theory (M/M/1)',
		aliases: ['utilization vs latency', 'hockey stick curve'],
		category: 'latency & capacity',
		short:
			'The math of waiting lines. For a single server with random arrivals, mean response time is service time ÷ (1 − utilization): at 50% busy it doubles, at 80% it is 5×, at 95% it is 20×. Tail latency grows the same way, which is why "only 80% CPU" can already break a p99 SLO.',
		related: ['littles-law', 'saturation', 'headroom'],
		page: [
			{
				type: 'p',
				text: 'M/M/1: random (Poisson) arrivals at rate λ, one server with exponential service at rate μ. Utilization ρ = λ/μ. Response time is exponential with rate μ − λ, so mean = 1/(μ−λ) and p99 = ln(100)/(μ−λ) ≈ 4.6/(μ−λ).'
			},
			{
				type: 'table',
				head: ['Utilization', 'Mean response', 'p99 response'],
				numeric: [1, 2],
				caption: 'Service time 10 ms (μ = 100/s).',
				rows: [
					['50%', '20 ms', '92 ms'],
					['80%', '50 ms', '230 ms'],
					['90%', '100 ms', '461 ms'],
					['95%', '200 ms', '921 ms']
				]
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'For a p99 SLO of 100 ms here you need μ − λ ≥ 46.05/s, i.e. utilization ≤ **54%**. Multi-server queues (M/M/c, a pool of workers) behave much better at the same utilization, which is one reason a few big pools beat many tiny ones.'
			}
		]
	},
	{
		id: 'fsync',
		term: 'fsync',
		aliases: ['durable write', 'O_DSYNC'],
		category: 'databases',
		short:
			'A system call that blocks until written data is on stable storage, not just in the OS [[page-cache]]. It takes from ~50 µs (enterprise NVMe with power-loss protection) to several ms (consumer SSDs, network disks). One fsync per event caps a single writer at a few hundred writes per second; [[group-commit]] batches many events per fsync.',
		related: ['group-commit', 'write-ahead-log', 'page-cache']
	},
	{
		id: 'group-commit',
		term: 'Group commit',
		category: 'databases',
		short:
			'Collect the writes that arrive during one [[fsync]] and make them durable together with the next one. Throughput then scales with batch size instead of being capped at 1/fsync-latency, at the cost of a little added latency. Databases do it automatically for their WAL; custom logs and queues often forget.',
		related: ['fsync', 'write-ahead-log']
	},
	{
		id: 'write-amplification',
		term: 'Write amplification',
		aliases: ['full_page_writes', 'full-page images'],
		category: 'databases',
		short:
			'Bytes physically written divided by bytes the application meant to write. Postgres writes a full 8 KB page image to the WAL the first time a page changes after each checkpoint, so a 100-byte update can cost 8 KB; LSM stores rewrite data during compaction; SSDs amplify again internally. It shows up as disk throughput far above your data rate.',
		related: ['write-ahead-log', 'fsync']
	},
	{
		id: 'page-cache',
		term: 'Page cache',
		category: 'cloud & infra',
		short:
			'Linux keeps recently read and written file data in otherwise unused RAM. Reads that hit it never touch the disk, which is why a second benchmark run is far faster and why `free` shows little "free" memory on a healthy box (cache is reclaimable). In containers, page cache counts toward the memory cgroup.',
		related: ['fsync', 'iops']
	},
	{
		id: 'iops',
		term: 'IOPS vs throughput',
		aliases: ['IOPS'],
		category: 'cloud & infra',
		short:
			'Disks have two separate limits: operations per second (IOPS) and bytes per second (throughput). Small random I/O hits the IOPS limit long before the throughput limit: 3,000 IOPS × 8 KB is only 24.6 MB/s, while a dashboard may say the volume allows 125 MB/s. Check both, plus queue depth.',
		related: ['ebs', 'burst-balance']
	},
	{
		id: 'tcp-slow-start',
		term: 'TCP slow start',
		aliases: ['initial congestion window', 'initcwnd'],
		category: 'frontend & network',
		short:
			'A new TCP connection may only send about 10 packets (~14.6 KB) before waiting for acknowledgements, then doubles each round trip. A 100 KB response on a fresh connection needs 3 round trips of data on top of the TCP and TLS handshakes, so on a 150 ms link it takes ~750 ms regardless of bandwidth. Reused connections skip it.',
		related: ['tcp', 'rtt', 'http2-connection-reuse', 'tls-handshake']
	},
	{
		id: 'nagle-algorithm',
		term: "Nagle's algorithm + delayed ACK",
		aliases: ['TCP_NODELAY', '40 ms stall'],
		category: 'frontend & network',
		short:
			'Nagle holds back a small packet while earlier data is unacknowledged; the receiver\'s *delayed ACK* holds the acknowledgement up to ~40 ms (Linux) hoping to piggyback it. If a client writes a request in two small pieces, the second piece waits for an ACK that waits for more data: a ~40 ms stall. Fix: one write per message, or `TCP_NODELAY`.',
		related: ['tcp']
	},
	{
		id: 'head-of-line-blocking',
		term: 'Head-of-line blocking',
		aliases: ['HOL blocking', 'HTTP/3', 'QUIC'],
		category: 'frontend & network',
		short:
			'When one stalled item blocks everything behind it. HTTP/2 multiplexes many requests over one TCP connection, but TCP delivers bytes in order, so one lost packet stalls *every* stream until it is retransmitted. On lossy mobile networks that can be worse than HTTP/1.1\'s six connections. HTTP/3 (QUIC) fixes it with independent streams over UDP.',
		related: ['tcp', 'http2-connection-reuse']
	},
	{
		id: 'compression-break-even',
		term: 'Compression break-even',
		category: 'frontend & network',
		short:
			'Compression trades CPU time for fewer bytes. It pays off only when the transfer time saved exceeds the compress + decompress time: saved bytes ÷ bandwidth > CPU cost. On a 10 Gbps internal link, gzip-9 on 2 MB loses; on mobile it wins by seconds. Fast codecs (zstd, gzip level 1–3) move the break-even a lot.',
		related: ['serialization-cost']
	},
	{
		id: 'serialization-cost',
		term: 'Serialization cost',
		aliases: ['JSON vs protobuf'],
		category: 'latency & capacity',
		short:
			'Turning objects into bytes and back. Text formats like JSON spend CPU formatting and parsing numbers and strings and produce larger payloads; reflection-based encoders also allocate heavily. In services that move large responses it often shows up as the widest box in a [[flame-graph]] together with the GC it causes.',
		related: ['compression-break-even', 'allocation-rate']
	},
	{
		id: 'dead-code-elimination',
		term: 'Dead-code elimination (benchmarks)',
		aliases: ['microbenchmark pitfalls', 'JMH', 'Blackhole'],
		category: 'latency & capacity',
		short:
			'Optimizing compilers delete computations whose results are never used, and fold constants they can compute ahead of time. A microbenchmark that calls `hash(x)` and ignores the result may be measuring an empty loop. Consume results (JMH `Blackhole`, Go `b.N` with a package-level sink) and vary inputs.',
		related: ['jit-warmup', 'method-inlining']
	},
	{
		id: 'hdr-histogram',
		term: 'HDR histogram',
		aliases: ['log-linear histogram', 'HdrHistogram'],
		category: 'observability',
		short:
			'A latency histogram with buckets that are linear within each power of two, so every value is stored with bounded *relative* error (e.g. 1%) across a huge range (1 µs to an hour) in a few thousand counters. Histograms merge by adding bucket counts, so you can combine hosts correctly, unlike averaging their p99s.',
		related: ['percentiles', 'percentile-averaging', 'histogram-metric', 'coordinated-omission']
	}
];

export default terms;
