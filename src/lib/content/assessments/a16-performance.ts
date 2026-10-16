import type { Assessment, Panel, Question, Series, SeriesColor } from '../types';
import { ramp, shape, step, timeAxis, periodic, window_ } from '../series';
import lockContention from '../labs/a16-lock-contention';
import gcThrash from '../labs/a16-gc-thrash';

const S = (name: string, points: (number | null)[], color?: SeriesColor, dashed?: boolean): Series => ({ name, points, color, dashed });
type TS = Extract<Panel, { kind: 'timeseries' }>;
const ts = (title: string, x: string[], series: Series[], o: Partial<TS> = {}): Panel => ({ kind: 'timeseries', title, x, series, ...o });

// ───────────────────────── Part 1 · Profiling ─────────────────────────

const pX = timeAxis('13:30', 60);
const pr1: Question = {
	id: 'pr1',
	title: 'The fastest JSON library will not save you',
	tag: 'tricky',
	minutes: 7,
	prompt: [
		{
			type: 'p',
			text: '`search-api` (Go) has p99 ≈ 900 ms against a 250 ms SLO. A teammate captured a one-minute CPU profile and wants to swap in a faster JSON encoder because `json.Marshal` is the widest frame. You also have the dashboard and a second, wall-clock profile they skipped.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'search-api · prod',
				range: '13:30 – 14:30',
				filters: ['pods=12', 'GOMAXPROCS=4'],
				panels: [
					ts('p99 latency', pX, [S('p99', shape(60, { base: 880, noise: 0.08, seed: 11 }))], { unit: ' ms', thresholds: [{ value: 250, label: 'SLO', tone: 'warn' }] }),
					ts('CPU / pod (of 4 cores)', pX, [S('cpu', shape(60, { base: 31, noise: 0.06, seed: 12 }))], { unit: '%', yMax: 100 }),
					ts('Goroutines blocked on sync.Mutex', pX, [S('blocked', shape(60, { base: 140, noise: 0.15, seed: 13 }), 4)]),
					{ kind: 'stat', title: 'Requests / s', value: '2,350', span: 1 },
					{ kind: 'stat', title: 'GC pause p99', value: '1.8 ms', tone: 'ok', span: 1 }
				]
			}
		},
		{
			type: 'code',
			lang: 'text',
			caption: 'On-CPU profile (`pprof -seconds 60`, folded, 10,000 samples).',
			code: `main;http.serve;handler.Search;search.Run;json.Marshal;reflect.Value.Field 2100
main;http.serve;handler.Search;search.Run;json.Marshal;strconv.AppendFloat 1700
main;http.serve;handler.Search;search.Run;index.Lookup 2600
main;http.serve;handler.Search;search.Rank 900
main;http.serve;middleware.Log 400
runtime.gcBgMarkWorker;runtime.scanobject 2300`
		},
		{
			type: 'code',
			lang: 'text',
			caption: 'Wall-clock profile of request goroutines (same minute, 50,000 samples).',
			code: `handler.Search;search.Run;cache.(*Store).Get;sync.(*Mutex).Lock;runtime.semacquire 30500
handler.Search;search.Run;json.Marshal 6200
handler.Search;search.Run;index.Lookup 4100
handler.Search;search.Rank 1400
handler.Search;db.Query;net.(*conn).Read 7800`
		}
	],
	hints: ['At 31% CPU, what fraction of a 900 ms request can CPU work possibly explain?', 'Which profile type can see a goroutine that is waiting?'],
	answer: [
		{
			type: 'p',
			text: 'The on-CPU profile is accurate but answers the wrong question. Pods run at ~31% of 4 cores, so requests are mostly **not on a CPU**. An on-CPU [[flame-graph]] cannot show waiting. The wall-clock profile can: **61%** of request time (30,500 / 50,000) is in `sync.(*Mutex).Lock` inside `cache.(*Store).Get`, and the "blocked on mutex" panel agrees (~140 goroutines).'
		},
		{
			type: 'ranked',
			items: [
				{
					title: '[[lock-contention|Lock contention]] on the cache store (the cause).',
					body: 'Every search takes one global mutex. Wall time in `Lock` is 61%; JSON is 12% (6,200 / 50,000).',
					confirm: '`go tool pprof` mutex and block profiles (`runtime.SetMutexProfileFraction`), then shard the lock or use a concurrent map; expect p99 to drop toward the ~350 ms of remaining work (39% of 900 ms).'
				},
				{
					title: 'JSON encoding (real CPU cost, wrong target for p99).',
					body: 'Even a 2× faster encoder saves about 6% of wall time (half of 12%). It would cut CPU and some GC (the separate `gcBgMarkWorker` tower is mostly allocation from reflection), which is worth doing later for cost, not latency.'
				},
				{ title: 'Database reads (16% of wall time).', body: 'Worth a look after the lock, not before.' }
			]
		},
		{
			type: 'callout',
			tone: 'warn',
			text: '**Rule:** low CPU + high latency → off-CPU problem (locks, I/O, queues). Reach for [[off-cpu-analysis|wall-clock / off-CPU profiles]] before optimizing code.'
		}
	]
};

const pr2: Question = {
	id: 'pr2',
	title: 'Optimizing the function the profile blamed',
	tag: 'core',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A Python exporter is slow. In the profiler UI, `serialize_rows` shows **45%**. An engineer rewrites its loop with list comprehensions and gets almost nothing. Folded stacks from a [[sampling-profiler]] (py-spy, 8,000 samples):'
		},
		{
			type: 'code',
			lang: 'text',
			code: `main;export;serialize_rows 160
main;export;serialize_rows;format_decimal;decimal.Decimal.__format__ 2240
main;export;serialize_rows;format_date;datetime.strftime 1200
main;export;fetch_rows;psycopg.cursor.fetchmany 3600
main;export;write_csv;csv.writer.writerow 800`
		},
		{ type: 'p', text: 'What did they misread, and where would you spend the effort?' }
	],
	answer: [
		{
			type: 'p',
			text: '45% is `serialize_rows`\'s **total** time (160 + 2,240 + 1,200 = 3,600 of 8,000 samples), but its [[self-time|self time]] is only 160 samples = **2%**. Rewriting its own loop could never save more than 2%. The cost is in what it calls:'
		},
		{
			type: 'table',
			head: ['Frame', 'Samples', 'Share'],
			numeric: [1, 2],
			rows: [
				['`fetch_rows` (waiting on Postgres)', '3,600', '45%'],
				['`Decimal.__format__`', '2,240', '28%'],
				['`strftime`', '1,200', '15%'],
				['`csv.writerow`', '800', '10%'],
				['`serialize_rows` self', '160', '2%']
			]
		},
		{
			type: 'list',
			items: [
				'**Formatting (43%)**: format decimals by integer math on [[minor-units]] instead of `Decimal.__format__`, and dates with `isoformat()` instead of `strftime` (often 5–10× faster), or let Postgres produce the text with `COPY ... TO STDOUT (FORMAT csv)` and skip Python formatting entirely.',
				'**Fetch (45%)** is time waiting on the database: larger `fetchmany` batches or server-side `COPY` help; making Python faster doesn\'t.',
				'Note: py-spy\'s default mode only samples *active* threads in some setups; check you\'re using `--idle` if you want waiting time too, or you\'ll undercount `fetch_rows`.'
			]
		}
	]
};

const pr3: Question = {
	id: 'pr3',
	title: 'Two profiles, one regression?',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A PR claims a 0.2-point regression: `crc32c` went from **0.5%** of CPU samples on `main` to **0.7%** on the branch. Each profile ran 60 s at 99 Hz on a 4-core box that was about 25% busy. A second engineer re-ran the PR\'s micro-path under `cProfile` and found `crc32c` at **31%** of time. Who is right?'
		}
	],
	hints: ['How many on-CPU samples does each profile contain? What is the sampling error of a share that small?'],
	answer: [
		{
			type: 'p',
			text: '**Neither measurement shows a regression.**'
		},
		{
			type: 'list',
			items: [
				'**Sample count:** 60 s × 99 Hz × 4 cores = 23,760 opportunities; at ~25% utilization ≈ **5,940** on-CPU samples. 0.5% of that is ~30 samples. Binomial standard error √(5,940 × 0.005 × 0.995) ≈ **5.4 samples**, i.e. ±18% relative. 0.5% vs 0.7% is about 30 vs 42 samples: well within the noise of two runs. To compare small functions, profile longer, merge many profiles, or use a benchmark.',
				'**cProfile:** an [[instrumenting-profiler]] adds a fixed cost (~1 µs) to every Python call. A function called 2M times whose real cost is 0.1 µs per call (0.2 s) gets ~2 s of profiler overhead added, so it looks 10× more expensive than it is. Use a [[sampling-profiler]] (py-spy, Scalene) for "where does time go"; use instrumenting profilers for call counts.',
				'Why 99 Hz and not 100? To avoid sampling in lock-step with timers that fire every 10 ms, which would bias the samples.'
			]
		}
	]
};

const pr4: Question = {
	id: 'pr4',
	title: 'All the time is in a method that does nothing',
	tag: 'tricky',
	minutes: 3,
	prompt: [
		{
			type: 'p',
			text: 'A JVM profile from an old JMX-based sampler shows 40% self time in `OrderService.process`, whose body is a loop calling `pricing.compute(line)` and summing the results. `pricing.compute` doesn\'t appear in the profile at all. A colleague says "the loop overhead must be huge".'
		}
	],
	answer: [
		{
			type: 'ranked',
			items: [
				{
					title: '[[method-inlining|Inlining]]: the JIT copied `compute` into `process`.',
					body: 'After [[jit-warmup|warm-up]], small hot methods are inlined into their callers, so there is no separate `compute` frame to sample and its cost is charged to `process`.'
				},
				{
					title: '[[safepoint-bias|Safepoint bias]] makes it worse.',
					body: 'JMX/`getStackTrace`-based samplers only see threads at safepoints (loop back-edges, returns), so samples pile up at the loop back-edge in `process` no matter where time is really spent.'
				}
			]
		},
		{
			type: 'p',
			text: '**Fix the measurement:** async-profiler (signal-based, no safepoint bias) with `-XX:+UnlockDiagnosticVMOptions -XX:+DebugNonSafepoints` so inlined frames are attributed correctly, or JFR. Then optimize `compute`, not the loop.'
		}
	]
};

// ───────────────────────── Part 2 · CPU & memory ─────────────────────────

const cm1: Question = {
	id: 'cm1',
	title: 'Lock-free counters that got slower with every core',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'To avoid locks, a metrics library gives each worker its own counter slot. Benchmarks: 1 thread 0.21 s, 2 threads 0.96 s, 8 threads 1.9 s for the same per-thread work. CPU is at 100% on every core. No locks, no atomics.'
		},
		{
			type: 'code',
			lang: 'go',
			code: `type Stats struct {
    counts [8]int64
}

func (s *Stats) Inc(worker int) { s.counts[worker]++ }`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**[[false-sharing|False sharing]].** `[8]int64` is 64 bytes, exactly one [[cache-line]]. Every increment by one core invalidates that line in every other core\'s cache, so the line ping-pongs between cores. The threads share no data logically, but the hardware treats the line as shared.'
		},
		{
			type: 'list',
			items: [
				'**Fix:** pad each slot to its own line (or 128 B, since some CPUs prefetch adjacent lines), e.g. `type slot struct{ n int64; _ [56]byte }`. Java: `@Contended` / `LongAdder`.',
				'**Better:** count in a local variable and publish occasionally.',
				'**Prove it:** `perf c2c record` shows HITM (hit-modified) events on that address; throughput becomes flat per thread after padding.',
				'**Why CPU looks busy:** cores stall on memory while counted as busy, so "100% CPU" here does not mean useful work.'
			]
		}
	]
};

const cm2: Question = {
	id: 'cm2',
	title: 'Sorting to go faster',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A hot path sums the values above a threshold in a 32,768-element array. Someone noticed the loop is ~5× faster on sorted data and added `values.sort()` before the loop on **every request**. Latency went up. Explain both observations with numbers (assume 3 GHz, ~15 cycles per mispredicted branch).'
		},
		{
			type: 'code',
			lang: 'python',
			caption: 'Shown in Python for readability; the real code is a C++ extension.',
			code: `total = 0
for v in values:          # 32,768 random bytes (0..255)
    if v >= 128:
        total += v`
		}
	],
	answer: [
		{
			type: 'list',
			items: [
				'**Why sorted is faster:** on random bytes the `if` is unpredictable, so the [[branch-prediction|branch predictor]] is wrong ~50% of the time: 32,768 × 0.5 × 15 cycles ≈ **245,760 cycles ≈ 82 µs** of wasted pipeline per pass. Sorted data makes the branch "always no, then always yes", which is nearly free.',
				'**Why sorting per request is slower:** sorting costs ~n log₂ n = 32,768 × 15 ≈ **491,520 comparisons**, each itself a hard-to-predict branch plus data movement: hundreds of µs to milliseconds, to save ~82 µs. Net loss.',
				'**Fix:** make the loop branch-free (`total += v & -(v >= 128)`, or `std::max`/SIMD; compilers often emit `cmov` for this form), or keep the data sorted at write time if it\'s read many times.'
			]
		}
	]
};

const cm3: Question = {
	id: 'cm3',
	title: 'Same Big-O, 225× slower',
	tag: 'core',
	minutes: 4,
	prompt: [
		{
			type: 'p',
			text: 'Both functions sum 8,388,608 int64 values (64 MiB). The array version takes ~3 ms, the linked-list version ~0.75 s, on the same machine. Both are O(n). Estimate both from first principles: memory bandwidth ~20 GB/s, random memory access ~90 ns.'
		}
	],
	answer: [
		{
			type: 'table',
			head: ['Version', 'Bound by', 'Estimate'],
			rows: [
				['Array', 'Bandwidth: 67,108,864 B ÷ 20 GB/s', '**3.4 ms**'],
				['Linked list (nodes scattered)', 'Latency: 8,388,608 hops × 90 ns', '**755 ms**']
			]
		},
		{
			type: 'p',
			text: 'Ratio ≈ **225×**. An array streams whole [[cache-line|cache lines]] and the hardware prefetcher fetches ahead; each list node is a dependent load the CPU can\'t start until the previous one returns. That is the gap between [[memory-bandwidth-vs-latency|bandwidth and latency]], and Big-O hides it.'
		},
		{
			type: 'p',
			text: 'Variant: on a two-socket server, if one thread allocated and initialized that array, every page lives on its [[numa|NUMA]] node; threads on the other socket read it ~1.5–2× slower. Check with `numastat -p`; fix with per-thread first-touch or `numactl --interleave=all`.'
		}
	]
};

const cm4: Question = {
	id: 'cm4',
	title: 'Heap is 2 GB, the pod dies at 6 GiB',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A Java service with `-Xmx2g` runs on a 32-core node. Heap dashboards look calm (1.2–1.8 GB used), yet [[rss-memory|RSS]] climbs over a day to ~5.8 GiB and the pod is [[oomkilled|OOMKilled]] at its 6 GiB limit. Heap dumps show no leak. Native memory tracking (`-XX:NativeMemoryTracking=summary`) accounts for only ~2.6 GB in total.'
		}
	],
	answer: [
		{
			type: 'ranked',
			items: [
				{
					title: 'glibc malloc arena [[memory-fragmentation|fragmentation]] (most likely).',
					body: 'Native allocations (Netty direct buffers released via `free`, compression libraries, JNI) come from per-thread malloc arenas: up to 8 × cores = **256 arenas** on 32 cores. Freed memory scattered across arenas is rarely returned to the OS, so RSS grows above what the JVM thinks it uses. NMT can\'t see it: the JVM is not the one leaking.',
					confirm: '`pmap -x` shows many ~64 MB anonymous regions; setting `MALLOC_ARENA_MAX=2`, or switching to jemalloc, flattens RSS.'
				},
				{
					title: 'Direct buffers / metaspace / thread stacks outside the heap.',
					body: 'Visible in NMT; cap with `-XX:MaxDirectMemorySize`, check thread count (each thread reserves a stack).'
				}
			]
		},
		{
			type: 'callout',
			tone: 'info',
			text: 'Rule of thumb for container limits: heap is often only 50–70% of RSS. Size limits from measured RSS, not `-Xmx`.'
		}
	]
};

const cm5: Question = {
	id: 'cm5',
	title: 'A pool that mixed two customers\' responses',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'To cut GC, a team pooled response buffers. A week later, two customers report seeing fragments of other customers\' invoices in PDFs. It only happens under load.'
		},
		{
			type: 'code',
			lang: 'go',
			code: `var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func render(w http.ResponseWriter, inv Invoice) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    pdf.Render(buf, inv)
    go audit.Upload(inv.ID, buf.Bytes()) // async archive copy
    w.Write(buf.Bytes())
}`
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The buffer goes back to the pool while the goroutine still holds its bytes.** `defer bufPool.Put(buf)` runs when `render` returns, but `audit.Upload` is still reading `buf.Bytes()`, a slice that aliases the pooled buffer\'s memory. The next request `Reset()`s and overwrites it, so the archive (and anything else reading those bytes later) gets another customer\'s data. This is a [[personal-data-breach|data-exposure]] incident, not a performance bug.'
		},
		{
			type: 'list',
			items: [
				'**Mitigate:** stop pooling here now (allocate per request), and identify affected archives by checksum mismatch against regenerated PDFs.',
				'**Fix:** copy before handing off (`data := bytes.Clone(buf.Bytes())`) or make ownership explicit: whoever finishes last returns the buffer.',
				'**Lesson:** [[object-pooling]] trades GC time for ownership bugs. In generational GCs, short-lived small allocations are cheap; pool only big, expensive objects, and only with clear ownership. The race detector (`go test -race`) catches this pattern.'
			]
		}
	]
};

const cm6: Question = {
	id: 'cm6',
	title: 'Redis snapshot doubled memory',
	tag: 'core',
	minutes: 4,
	prompt: [
		{
			type: 'p',
			text: 'A Redis node with an 8 GB dataset and steady writes (~10,000 random keys/s) gets OOM-killed every night during `BGSAVE`, which takes ~30 s. The box has 14 GB. The log says `WARNING you have Transparent Huge Pages (THP) support enabled`. Explain why THP matters here, with rough numbers.'
		}
	],
	answer: [
		{
			type: 'p',
			text: '`BGSAVE` forks; parent and child share pages until the parent writes ([[copy-on-write]]). Each write copies the whole page that contains the key.'
		},
		{
			type: 'table',
			head: ['', '4 KB pages', '2 MB huge pages'],
			rows: [
				['Pages in 8 GB', '~2.1 M', '4,096'],
				['Writes during snapshot', '~300,000', '~300,000'],
				['Pages copied (upper bound)', '≤ 300,000 × 4 KB ≈ 1.2 GB', 'all 4,096 touched within seconds → **≈ 8 GB**'],
				['Peak memory', '~9.2 GB (fits)', '~16 GB (OOM)']
			]
		},
		{
			type: 'p',
			text: 'With [[transparent-huge-pages|THP]], random writes touch every 2 MB page almost immediately, so the fork effectively duplicates the dataset. Fix: `echo never > /sys/kernel/mm/transparent_hugepage/enabled` (Redis docs recommend it), keep `maxmemory` with headroom for COW, or snapshot from a replica.'
		}
	]
};

// ───────────────────────── Part 3 · Concurrency ─────────────────────────

const cc1: Question = {
	id: 'cc1',
	title: '64 cores, budget approved, 8× at best',
	tag: 'core',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'A batch scorer spends 10% of its time inside one global lock and 90% in parallel work. Leadership approved moving from 16 to 64 cores "for 4× the throughput". A load test of the API version also measured requests/s by thread count:'
		},
		{
			type: 'table',
			head: ['Threads', '1', '4', '8', '16', '32', '64'],
			numeric: [1, 2, 3, 4, 5, 6],
			rows: [['req/s', '1,000', '3,407', '5,472', '7,175', '7,058', '5,240']]
		},
		{ type: 'p', text: 'Predict the batch speedups, and explain why the API gets *slower* past ~22 threads.' }
	],
	answer: [
		{
			type: 'list',
			items: [
				'**[[amdahls-law|Amdahl]] (batch):** speedup = 1 ÷ (0.1 + 0.9/N). 16 cores → **6.4×**, 64 cores → **8.77×**. Going 16 → 64 cores buys 8.77 / 6.4 ≈ **1.37×**, not 4×. The ceiling is 10× at any core count.',
				'**[[universal-scalability-law|USL]] (API):** the table fits σ = 0.05 (contention) and κ = 0.002 (coherency). Peak at N* = √((1 − σ)/κ) = √(0.95/0.002) ≈ **22 threads** (~7,400 req/s). Beyond it, every added thread adds pairwise coordination cost (cache-line transfers, lock hand-offs), so throughput falls: 64 threads give 5,240 req/s, 29% below the peak.',
				'**Spend the money on the serial part:** shrink or shard the lock. Cutting the serial share from 10% to 2% gives 1 ÷ (0.02 + 0.98/64) ≈ 28× on 64 cores.'
			]
		}
	]
};

const cc2: Question = {
	id: 'cc2',
	title: 'How many threads?',
	tag: 'core',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'A JVM service on 8 cores spends **5 ms on CPU** and **20 ms waiting for Postgres** per request. Its DB [[connection-pool]] has 20 connections. The team sized the worker pool to 200 "because waiting threads are cheap". At peak, p99 is terrible and the pool shows ~180 threads waiting for a DB connection.'
		},
		{ type: 'p', text: 'What pool size does the textbook formula give, what is the real throughput ceiling, and what should change?' }
	],
	answer: [
		{
			type: 'list',
			items: [
				'**[[thread-pool-sizing|Formula]]:** threads ≈ cores × (1 + wait/compute) = 8 × (1 + 20/5) = **40**.',
				'**CPU ceiling:** 8 cores ÷ 5 ms = **1,600 req/s**.',
				'**DB ceiling ([[littles-law]]):** 20 connections ÷ 20 ms = **1,000 req/s**. The connection pool, not the threads, is the bottleneck. The extra 160 threads only queue for a connection, adding latency and memory.',
				'**Changes:** cap workers near 40 and make the pool queue bounded (fail fast / shed load); right-size the DB pool against what Postgres can actually take (more connections can make Postgres slower; see [[pgbouncer]]), and reduce DB time per request first (that\'s the lever that raises the ceiling).'
			]
		}
	]
};

const elX = timeAxis('10:00', 60);
const imports = shape(60, { base: 0, noise: 0, seed: 1 }, periodic(12, 2, 5, 3));
const cc3: Question = {
	id: 'cc3',
	title: 'One customer\'s import slows everyone',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A Node.js API (single process per pod, 6 pods). p99 of *all* routes, including `GET /health`, spikes in bursts. CPU looks moderate. A colleague suspects the database.'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'api-node · prod',
				range: '10:00 – 11:00',
				panels: [
					ts('p99 by route', elX, [
						S('GET /orders', shape(60, { base: 60, noise: 0.1, seed: 2 }, periodic(12, 2, 700, 3))),
						S('GET /health', shape(60, { base: 3, noise: 0.1, seed: 3 }, periodic(12, 2, 640, 3)), 2)
					], { unit: ' ms' }),
					ts('Event loop delay p99', elX, [S('lag', shape(60, { base: 4, noise: 0.2, seed: 4 }, periodic(12, 2, 610, 3)), 4)], { unit: ' ms' }),
					{ kind: 'bars', title: 'POST /import (40 MB JSON) per min', x: elX, series: [S('imports', imports, 3)] },
					ts('Postgres query p99', elX, [S('db', shape(60, { base: 9, noise: 0.1, seed: 5 }))], { unit: ' ms' }),
					ts('CPU / pod', elX, [S('cpu', shape(60, { base: 35, noise: 0.08, seed: 6 }, periodic(12, 2, 45, 3)))], { unit: '%', yMax: 100 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: '**The event loop is blocked.** Every spike lines up with `POST /import`: parsing a 40 MB body with `JSON.parse` is synchronous, ~120 ms or more of pure CPU on one thread, and several imports land together. While it runs, *no* other callback in that process can run, so even `/health` (3 ms of work) waits 600+ ms. [[event-loop-lag|Event loop delay]] p99 tracks the latency spikes exactly; Postgres p99 is flat at ~9 ms (red herring).'
		},
		{
			type: 'p',
			text: 'Arithmetic: 5 imports/s at 120 ms each would block the loop for 600 ms of every second (60%), and every other request queues behind it.'
		},
		{
			type: 'list',
			items: [
				'**Mitigate:** route `/import` to a separate deployment so it can\'t starve the API; lower the body size limit.',
				'**Fix:** stream-parse (e.g. a streaming JSON parser) and process in chunks, or move parsing to `worker_threads`. Better: accept NDJSON / file upload to object storage and process asynchronously.',
				'**Detect:** alert on `perf_hooks.monitorEventLoopDelay()` p99, not just CPU.'
			]
		}
	]
};

const cc4: Question = {
	id: 'cc4',
	title: 'asyncio with a semaphore of 100, throughput of 4',
	tag: 'core',
	minutes: 4,
	prompt: [
		{
			type: 'p',
			text: 'A FastAPI login endpoint handles ~4 logins/s per process no matter how many concurrent requests arrive. Raising the semaphore from 10 to 100 changed nothing.'
		},
		{
			type: 'code',
			lang: 'python',
			code: `sem = asyncio.Semaphore(100)

@app.post("/login")
async def login(body: Login):
    async with sem:
        user = await users.get(body.email)
        ok = bcrypt.checkpw(body.password.encode(), user.hash)   # cost 12 ≈ 250 ms
        if not ok:
            raise HTTPException(401)
        return issue_token(user)`
		}
	],
	answer: [
		{
			type: 'p',
			text: '`bcrypt.checkpw` is CPU-bound and synchronous: it runs **on the event loop** for ~250 ms and nothing else in the process can run meanwhile. One check at a time ⇒ 1 ÷ 0.25 s = **4 logins/s** per process, regardless of the semaphore (which only limits how many coroutines wait). Every other endpoint in that process also stalls during each check.'
		},
		{
			type: 'list',
			items: [
				'**Fix:** `ok = await asyncio.to_thread(bcrypt.checkpw, ...)` (the bcrypt C extension releases the GIL, so threads run in parallel), or a `ProcessPoolExecutor`. Then throughput ≈ cores × 4/s.',
				'**Capacity math:** 8 cores → ~32 logins/s per pod. If you need more, that\'s the price of [[bcrypt]] cost 12; plan pods accordingly and rate-limit login attempts.',
				'Same pattern to look for: `requests.get`, `time.sleep`, or file I/O inside `async def`. Enable asyncio debug mode (`slow_callback_duration`) to log callbacks that block over 100 ms.'
			]
		}
	]
};

const gmX = timeAxis('15:00', 60);
const cc5: Question = {
	id: 'cc5',
	title: 'Half the CPU limit used, still throttled',
	tag: 'tricky',
	minutes: 4,
	prompt: [
		{
			type: 'p',
			text: 'A Go 1.22 service with a 2-CPU limit runs on 64-core nodes. Average CPU usage is 1.1 cores, but p99 has periodic 80–100 ms spikes. Someone proposes raising the limit to 4 CPUs "even though we only use half".'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'grafana',
				title: 'ledger-api · pod metrics',
				range: '15:00 – 16:00',
				panels: [
					ts('CPU usage (cores)', gmX, [S('usage', shape(60, { base: 1.1, noise: 0.08, seed: 7, round: 2 })), S('limit', shape(60, { base: 2, noise: 0, round: 0 }), 4, true)]),
					ts('Throttled periods %', gmX, [S('throttled', shape(60, { base: 62, noise: 0.12, seed: 8 }), 4)], { unit: '%', yMax: 100 }),
					ts('p99 latency', gmX, [S('p99', shape(60, { base: 95, noise: 0.15, seed: 9 }))], { unit: ' ms' }),
					{ kind: 'stat', title: 'GOMAXPROCS', value: '64', tone: 'warn', span: 1 },
					{ kind: 'stat', title: 'Node cores', value: '64', span: 1 }
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'Before Go 1.25, [[gomaxprocs|GOMAXPROCS]] defaults to the **host\'s** 64 cores, not the container\'s 2-CPU limit. The [[cfs-quota|CFS quota]] is 200 ms of CPU per 100 ms period. When a burst (or the parallel GC) runs on up to 64 threads at once, the quota is gone in 200 ms ÷ 64 ≈ **3.1 ms**, and the whole container is frozen for the remaining ~97 ms of the period. The average (1.1 cores) looks fine; the throttled-periods panel (~62%) and the 80–100 ms spikes are the giveaway.'
		},
		{
			type: 'list',
			items: [
				'**Fix:** set `GOMAXPROCS` to the limit (`go.uber.org/automaxprocs`, or upgrade to Go 1.25+, which reads the cgroup limit), or remove CPU limits and rely on requests.',
				'Raising the limit to 4 helps only partially (6.25 ms of burst at 64 threads) and costs capacity.',
				'Same bug class: old JVMs before container support (`-XX:ActiveProcessorCount`), Node `UV_THREADPOOL_SIZE`, and any thread pool sized from `nproc` inside a container.'
			]
		}
	]
};

const cc6: Question = {
	id: 'cc6',
	title: 'The load test says p99 is 5 ms',
	tag: 'tricky',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'A load test with 10 virtual users, each sending a request every 100 ms (100 req/s intended), ran 60 s. Normal latency is 5 ms. Once in that minute the server froze for 2 s (a compaction pause). The tool reports **p99 = 5 ms**, p99.9 = 2,000 ms. The team signs off on a "p99 < 50 ms" SLO. Each user waits for its response before sending the next request.'
		},
		{ type: 'p', text: 'What would real users (arriving independently at 100 req/s) have seen? Compute p99.' }
	],
	answer: [
		{
			type: 'p',
			text: 'This is [[coordinated-omission]]. During the freeze each of the 10 users had one request in flight, so the tool recorded **10** slow samples and simply *didn\'t send* the other ~190. Recorded: 5,800 samples at 5 ms + 10 at ~2 s → p99 = 5 ms.'
		},
		{
			type: 'table',
			head: ['', 'Tool (closed loop)', 'Real traffic (open)'],
			rows: [
				['Requests in the minute', '5,810', '6,000'],
				['Requests hit by the freeze', '10', '200'],
				['p99', '**5 ms**', '**≈ 1,405 ms**'],
				['Mean', '≈ 8.4 ms', '≈ 38.5 ms']
			]
		},
		{
			type: 'p',
			text: 'Real p99: the 200 requests arriving during the 2 s freeze wait between 2 s and ~0 s. The worst 1% of 6,000 is 60 requests, all of which arrived in the first 0.6 s of the freeze, so p99 ≈ 2,000 − 600 + 5 = **1,405 ms**: 280× what was reported. The SLO would be violated every minute this happens.'
		},
		{
			type: 'list',
			items: [
				'Use an [[open-vs-closed-workload|open-model]] generator (k6 `constant-arrival-rate`, wrk2, Gatling arrival rates) or correct for coordinated omission ([[hdr-histogram|HdrHistogram]] `recordValueWithExpectedInterval`).',
				'Always look at max and p99.9 next to p99: here p99.9 = 2 s was the clue.'
			]
		}
	]
};

// ───────────────────────── Part 4 · Storage & network ─────────────────────────

const sn1: Question = {
	id: 'sn1',
	title: 'An event log capped at 500 writes per second',
	tag: 'core',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A custom append-only event log (one writer thread) handles 480 events/s and no more, on a disk rated for 50,000 IOPS. Each `append` does `write()` + `fsync()`. `fsync` p50 is 2 ms. Traffic will grow to 20,000 events/s. One engineer proposes removing the `fsync`.'
		}
	],
	answer: [
		{
			type: 'list',
			items: [
				'**Why 480/s:** each [[fsync]] waits for the device to confirm durability. At 2 ms each, one writer can do at most 1 ÷ 0.002 = **500/s**. The 50,000 IOPS rating assumes many I/Os in parallel (deep queues), not one synchronous flush at a time.',
				'**Removing fsync** turns "acknowledged" into "probably on disk": a power loss or kernel panic loses the last seconds of acknowledged events. Not acceptable for an event log.',
				'**[[group-commit|Group commit]]:** collect events that arrive while an fsync is in flight and flush them together. At 20,000 events/s and 2 ms per flush, each batch holds ~40 events, so one flusher keeps up with ≤ ~4 ms added latency (wait for the current flush + own flush).',
				'**Also:** a device with power-loss protection (enterprise NVMe) brings fsync to ~50 µs; that changes the math by 40×.'
			]
		}
	]
};

const sn2: Question = {
	id: 'sn2',
	title: 'Faster recovery, slower everything',
	tag: 'tricky',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'To speed up crash recovery, a DBA lowered Postgres `checkpoint_timeout` from 5 min to 1 min. Afterwards WAL volume rose sharply, replicas lag, and disk write throughput is ~70 MB/s even though the app does only ~10,000 small row updates/s (≈1 MB/s of row data). The hot table spans ~2,000,000 pages of 8 KB, and updates hit pages uniformly at random.'
		},
		{ type: 'p', text: 'Explain the WAL volume and estimate it for both settings.' }
	],
	answer: [
		{
			type: 'p',
			text: 'With `full_page_writes` on (the default), the **first** change to a page after each checkpoint writes the whole 8 KB page image into the WAL (to protect against torn pages). Shorter checkpoints mean more "first changes", so [[write-amplification]] goes up.'
		},
		{
			type: 'p',
			text: 'Distinct pages touched by k random updates over N pages ≈ N · (1 − e^(−k/N)).'
		},
		{
			type: 'table',
			head: ['checkpoint_timeout', 'Updates per interval', 'Distinct pages', 'Full-page images', 'WAL from FPIs'],
			numeric: [1, 2, 3, 4],
			rows: [
				['5 min', '3,000,000', '≈ 1,553,740', '≈ 12.7 GB / 5 min', '**≈ 42 MB/s**'],
				['1 min', '600,000', '≈ 518,364', '≈ 4.25 GB / min', '**≈ 71 MB/s**']
			]
		},
		{
			type: 'p',
			text: 'Either way, full-page images dwarf the ~1 MB/s of row data (40–70× amplification); the change made it ~1.7× worse. Fixes: restore a longer `checkpoint_timeout` (with `max_wal_size` sized to match) and get faster recovery from replicas/failover instead; enable `wal_compression` (page images compress well); reduce random write spread (fillfactor/HOT updates, batching).'
		}
	]
};

const ioX = timeAxis('09:00', 60);
const sn3: Question = {
	id: 'sn3',
	title: 'The disk is only 20% busy',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'Since a nightly report started at 09:20, Postgres queries on an `gp3` volume (3,000 IOPS, 125 MB/s baseline) slowed down 6×. The on-call engineer says the disk is fine: "24 MB/s out of 125 MB/s is under 20%".'
		},
		{
			type: 'dashboard',
			dashboard: {
				style: 'cloudwatch',
				title: 'orders-db · EBS vol-0a1b',
				range: '09:00 – 10:00',
				panels: [
					ts('VolumeReadOps / s', ioX, [S('read ops', shape(60, { base: 900, noise: 0.08, seed: 21 }, step(20, 2995))), S('provisioned', shape(60, { base: 3000, noise: 0 }), 3, true)]),
					ts('VolumeReadBytes (MB/s)', ioX, [S('MB/s', shape(60, { base: 7.4, noise: 0.08, seed: 22, round: 1 }, step(20, 24.5))), S('throughput limit', shape(60, { base: 125, noise: 0 }), 3, true)]),
					ts('VolumeQueueLength', ioX, [S('queue', shape(60, { base: 1.2, noise: 0.15, seed: 23, round: 1 }, step(20, 31)))]),
					ts('Avg read latency (ms)', ioX, [S('latency', shape(60, { base: 1.4, noise: 0.1, seed: 24, round: 1 }, step(20, 10.5)))]),
					ts('DB instance CPU %', ioX, [S('cpu', shape(60, { base: 28, noise: 0.08, seed: 25 }, step(20, 34)))], { yMax: 100 })
				]
			}
		}
	],
	answer: [
		{
			type: 'p',
			text: 'The volume is pinned at its **[[iops|IOPS]] limit**, not its throughput limit. Postgres reads 8 KB pages: 3,000 IOPS × 8 KB ≈ **24.6 MB/s**, exactly where the bytes panel flattened. Queue length jumped from ~1 to ~31 and average read latency from 1.4 to 10.5 ms (consistent with [[littles-law]]: 31 queued ÷ 3,000/s ≈ 10 ms). CPU at 34% is a red herring.'
		},
		{
			type: 'list',
			items: [
				'**Mitigate:** move the report to a [[read-replica]]; or raise provisioned IOPS on gp3 (independent of size, applies online).',
				'**Fix:** an index or summary table so the report stops random-reading the table; more RAM so the working set stays in the buffer cache / [[page-cache]].',
				'**Lesson:** for small random I/O, ops/s is the limit; for scans, bytes/s is. Always check both against provisioned values.'
			]
		}
	]
};

const sn4: Question = {
	id: 'sn4',
	title: '100 KB on gigabit fiber takes 770 ms',
	tag: 'core',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'Users in Sydney fetching a 100,000-byte JSON response from a us-east API see ~770 ms, even on 1 Gbps fiber. Server processing is 20 ms. RTT is 150 ms. Every call opens a new HTTPS connection (TLS 1.3). Explain the 770 ms and what fixes it.'
		}
	],
	answer: [
		{
			type: 'p',
			text: 'Bandwidth is irrelevant here; round trips dominate. [[tcp-slow-start|TCP slow start]] lets a new connection send ~10 packets (≈14.6 KB) in the first flight, then doubles: 14.6 KB → 29.2 KB → 58.4 KB. Cumulative after three flights: 14.6 + 29.2 + 58.4 = 102.2 KB ≥ 100 KB.'
		},
		{
			type: 'table',
			head: ['Round trip', 'What happens'],
			rows: [
				['1', '[[tcp-handshake|TCP handshake]]'],
				['2', '[[tls-handshake|TLS 1.3 handshake]]'],
				['3', 'Request sent + first 14.6 KB back (+20 ms server time)'],
				['4', 'Next 29.2 KB'],
				['5', 'Last 58.4 KB'],
				['Total', '5 × 150 ms + 20 ms ≈ **770 ms**']
			]
		},
		{
			type: 'list',
			items: [
				'**Reuse connections** (keep-alive / HTTP/2): warm connections skip both handshakes and have a grown congestion window → ~1 RTT ≈ 170 ms.',
				'**Terminate TLS near the user** (CDN / edge in Sydney) so handshakes cost ~10 ms RTTs.',
				'**Make the response smaller** (compression, pagination): under ~14 KB fits in the first flight.'
			]
		}
	]
};

const sn5: Question = {
	id: 'sn5',
	title: 'Exactly 40 ms slower after a client upgrade',
	tag: 'tricky',
	minutes: 4,
	prompt: [
		{
			type: 'p',
			text: 'After upgrading an internal RPC client library, p50 latency between two services in the same AZ went from ~2 ms to ~42 ms. Server-side timing is unchanged. A packet capture shows the request header and the small body leaving in **two separate TCP segments**, with ~40 ms between the server receiving the first and the client sending the second.'
		}
	],
	answer: [
		{
			type: 'p',
			text: '**[[nagle-algorithm|Nagle + delayed ACK]].** The new client writes the header and body in two `write()` calls. Nagle holds the second small segment until the first is acknowledged; the server, having received an incomplete request, delays its ACK (Linux ~40 ms) hoping to piggyback it on a response that can\'t be produced yet. They wait for each other until the delayed-ACK timer fires.'
		},
		{
			type: 'list',
			items: [
				'**Fix:** write each message in one call (buffered writer / `writev`), or set `TCP_NODELAY` on the client (most HTTP/gRPC stacks do; this library\'s new transport didn\'t).',
				'**Tell-tale:** a latency increase of almost exactly 40 ms (or 200 ms on some OSes) that appears only on small, multi-write messages.'
			]
		}
	]
};

const sn6: Question = {
	id: 'sn6',
	title: 'gzip everywhere made the internal API slower',
	tag: 'core',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A service returns 2 MB JSON responses. Enabling gzip level 9 shrinks them to 200 KB but costs 40 ms to compress and 8 ms to decompress. Mobile clients (5 Mbps) got much faster; internal service-to-service calls (10 Gbps) got slower. Compute the break-even bandwidth and propose a policy.'
		}
	],
	answer: [
		{
			type: 'table',
			head: ['Link', 'Uncompressed transfer', 'Compressed transfer + CPU', 'Winner'],
			rows: [
				['5 Mbps mobile', '16 Mbit ÷ 5 Mbps = **3.2 s**', '0.32 s + 48 ms ≈ 0.37 s', 'gzip by ~2.8 s'],
				['10 Gbps internal', '16 Mbit ÷ 10 Gbps = **1.6 ms**', '0.16 ms + 48 ms ≈ 48 ms', 'no compression by ~46 ms']
			]
		},
		{
			type: 'p',
			text: '**[[compression-break-even|Break-even]]:** compression saves 1.8 MB = 14.4 Mbit and costs 48 ms, so it pays off when bandwidth < 14.4 Mbit ÷ 0.048 s = **300 Mbps**.'
		},
		{
			type: 'list',
			items: [
				'Policy: compress for external clients; skip (or use zstd/gzip level 1, ~5–10× cheaper CPU) for internal calls. Honour `Accept-Encoding` per client.',
				'Better: send less. Binary encodings (protobuf) are smaller and cheaper to parse than JSON ([[serialization-cost]]), and pagination avoids 2 MB responses.',
				'Related: on lossy mobile links HTTP/2 suffers [[head-of-line-blocking]] (one lost packet stalls all streams on the connection); HTTP/3 avoids it.'
			]
		}
	]
};

// ───────────────────────── Part 5 · Load & capacity ─────────────────────────

const lc1: Question = {
	id: 'lc1',
	title: '"We\'re only at 80% CPU"',
	tag: 'core',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A single-threaded worker takes 10 ms per job (exponential), jobs arrive randomly. At 80 jobs/s (80% busy) p99 is ~230 ms and the team is confused: "a job only takes 10 ms". The SLO is p99 < 100 ms. What arrival rate can it take, and what does 95% look like?'
		}
	],
	answer: [
		{
			type: 'p',
			text: 'For an M/M/1 queue ([[queueing-theory]]), response time is exponential with rate μ − λ, so mean = 1/(μ − λ) and p99 = ln(100)/(μ − λ) ≈ 4.605/(μ − λ). Here μ = 100/s.'
		},
		{
			type: 'table',
			head: ['Arrivals', 'Utilization', 'Mean', 'p99'],
			numeric: [0, 1, 2, 3],
			rows: [
				['50/s', '50%', '20 ms', '92 ms'],
				['80/s', '80%', '50 ms', '230 ms'],
				['95/s', '95%', '200 ms', '921 ms']
			]
		},
		{
			type: 'p',
			text: 'SLO: 4.605/(100 − λ) ≤ 0.1 s ⇒ λ ≤ **54 jobs/s (54% utilization)**. Above that, waiting dominates the 10 ms of work.'
		},
		{
			type: 'list',
			items: [
				'Several workers sharing one queue (M/M/c) do far better at the same utilization than separate queues per worker.',
				'Variance matters as much as the mean: cutting the slow tail of service time (timeouts, smaller jobs) lowers queueing delay for everyone.'
			]
		}
	]
};

const lc2: Question = {
	id: 'lc2',
	title: 'The load test that could never fail',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A pre-launch test used 50 virtual users looping with no think time. At the baseline build, it measured 5,000 req/s at 10 ms. With a new build it measured 500 req/s at 100 ms, and the report says "latency 100 ms, within SLO, no errors". Launch traffic is expected at 3,000 req/s from the public internet. Ship it?'
		}
	],
	answer: [
		{
			type: 'p',
			text: '**No.** This is a [[open-vs-closed-workload|closed-loop]] test: with N = 50 users and no think time, throughput X = N ÷ R ([[littles-law]]). When the build slowed to R = 100 ms, the tool automatically sent less: 50 ÷ 0.1 = 500 req/s. It never offered the 3,000 req/s that real users will send regardless of how fast you respond.'
		},
		{
			type: 'p',
			text: 'Under an open 3,000 req/s load, a system that serves at most ~500 req/s builds a queue that grows by ~2,500 requests every second: latency grows without bound until timeouts and errors. The test was structurally unable to show it.'
		},
		{
			type: 'list',
			items: [
				'Test with an arrival-rate generator at the target rate (and 1.5–2× for headroom), and report achieved vs offered rate.',
				'Also check the [[coordinated-omission]] problem and warm-up: discard the first minutes after deploy for [[jit-warmup|JIT warm-up]] in measurements, but don\'t forget real users hit cold pods (slow-start the LB, warm before readiness).'
			]
		}
	]
};

const lc3: Question = {
	id: 'lc3',
	title: 'A hash function that runs in 0.3 ns',
	tag: 'core',
	minutes: 4,
	prompt: [
		{
			type: 'p',
			text: 'A PR claims a 40× faster hash, citing this benchmark: old 12 ns/op, new 0.3 ns/op. 0.3 ns is about one CPU cycle.'
		},
		{
			type: 'code',
			lang: 'java',
			code: `long start = System.nanoTime();
for (int i = 0; i < 100_000_000; i++) {
    fastHash("customer-42");     // result ignored
}
long ns = (System.nanoTime() - start) / 100_000_000;`
		}
	],
	answer: [
		{
			type: 'list',
			items: [
				'**[[dead-code-elimination|Dead-code elimination]]:** the result is unused and the input is a constant, so after [[method-inlining|inlining]] the JIT can fold the call to a constant or delete the loop body. 0.3 ns/op measures an empty loop.',
				'**No warm-up and one measurement:** the old version may have been measured partly in the interpreter, while the new one was JIT-compiled.',
				'**Fix:** use JMH: `@Benchmark` methods that return the result (or `Blackhole.consume`), `@State` with varied inputs, warm-up iterations, multiple forks. Then compare in context: a realistic end-to-end benchmark often shows hashing is 0.5% of request time anyway ([[amdahls-law]]).'
			]
		}
	]
};

const lc4: Question = {
	id: 'lc4',
	title: 'How many instances for launch day?',
	tag: 'core',
	minutes: 6,
	prompt: [
		{
			type: 'p',
			text: 'Peak forecast: **12,000 req/s**. A load test shows one instance saturates at **900 req/s**, but p99 stays within SLO only up to **70%** of that. The service runs across 3 AZs and must survive losing one AZ at peak. How many instances, and how are they placed?'
		}
	],
	answer: [
		{
			type: 'list',
			items: [
				'**Usable per instance:** 900 × 0.7 = **630 req/s** (the [[headroom]] that keeps queueing delay in check).',
				'**Needed at peak:** 12,000 ÷ 630 = 19.05 → **20 instances** must be *serving*.',
				'**Survive an AZ loss:** the remaining 2 AZs must hold 20 → 10 per AZ → **30 instances** across 3 AZs (each AZ 10).',
				'**Sanity checks:** downstream limits (DB connections: 30 instances × pool size), autoscaling lag (pre-scale before the event, don\'t rely on reacting to it), and [[jit-warmup|warm-up]] of new instances.'
			]
		},
		{
			type: 'callout',
			tone: 'info',
			text: 'Steady state is then ~400 req/s per instance (12,000 ÷ 30), about 44% utilization: that is what N+1 across zones costs. See [[capacity-planning]].'
		}
	]
};

// ───────────────────────── Part 6 · Labs ─────────────────────────

const lab1: Question = {
	id: 'lab1',
	title: 'Lab: more threads, less throughput',
	tag: 'tricky',
	minutes: 12,
	prompt: [{ type: 'lab', lab: lockContention }],
	hints: ['CPU per pod is under a third. What are the threads doing?', 'Look at the thread state in the deployment details. Does an LRU "get" only read?'],
	answer: [
		{
			type: 'p',
			text: '**Evidence:** CPU per pod ~30%, `jstack` shows ~68% of worker time BLOCKED on `PriceCache.lock`, pods can\'t scale (quota 6/6), DB is healthy. Throughput per pod follows the [[universal-scalability-law]] with a single global mutex (σ = 0.08, κ = 0.004): it peaks around 15 threads at ~3,040 req/s for 6 pods, below the 3,600 req/s of demand.'
		},
		{
			type: 'table',
			head: ['Move', 'Capacity', 'Outcome'],
			rows: [
				['Do nothing (16 threads)', '≈ 3,040 req/s', 'Timeouts accumulate → lose at ~T+7:40'],
				['32 threads (trap)', '≈ 2,580 req/s', 'Retrograde scaling → lose faster (~T+5:00)'],
				['Read-write lock', '≈ 2,820 req/s', 'Worse: an LRU `get` moves the entry to the front, so every access takes the *write* lock; RW locks just add overhead'],
				['Cache TTL 30 min', '≈ 3,160 req/s', 'Better hit rate, same lock → still short'],
				['Striped lock (64 shards)', '≈ 8,000 req/s (CPU-bound 9,600)', 'Win: lock wait collapses, p99 back under 100 ms']
			]
		},
		{
			type: 'p',
			text: '**After the incident:** load-test thread counts to find N* (fit σ and κ); replace the global LRU with a concurrent cache (striped, or approximate LRU like Caffeine/W-TinyLFU); alert on lock wait (JFR `jdk.JavaMonitorEnter`), not only CPU; and get the quota changed so scale-out is available next time.'
		}
	]
};

const lab2: Question = {
	id: 'lab2',
	title: 'Lab: the JVM that pauses for a second',
	tag: 'tricky',
	minutes: 13,
	prompt: [{ type: 'lab', lab: gcThrash }],
	hints: ['How often does a young collection happen, and how long do request buffers live?', 'What does the pod memory limit allow?'],
	answer: [
		{
			type: 'p',
			text: '**Evidence (gc.log):** young collections every 0.512 GB ÷ 1.5 GB/s ≈ **0.34 s**; ~320 MB/s promoted; a full GC every ~6 s pausing ~1.2 s (≈20% of time). Request buffers live ~1.2 s, so they survive three or four young collections and are promoted: [[premature-promotion]].'
		},
		{
			type: 'table',
			head: ['Move', 'Effect'],
			rows: [
				['`-Xmx16g` (trap)', '16 + ~1.5 GB native > 10 GiB limit → OOMKilled'],
				['`-Xmx8g`', 'Full GCs every ~19 s, but each pauses ~2.6 s → p99 ≈ 2.2 s, worse'],
				['Young gen 1 GB', 'Collections every 0.67 s: buffers still promoted (less), full GC every ~7.5 s, p99 ≈ 0.9 s'],
				['Young gen 3 GB (with 4 GB heap)', 'Old gen 1 GB < 1.5 GB live set → OutOfMemoryError'],
				['**Young gen 2 GB**', 'Collections every 1.33 s > 1.2 s lifetime → buffers die young, **no promotion, no full GCs**; young pauses ~70 ms → p99 ≈ 150 ms'],
				['ZGC with 8 GB heap (alternative)', 'Concurrent collection, sub-ms pauses, ~8% CPU for GC → p99 ≈ 95 ms']
			]
		},
		{
			type: 'p',
			text: 'Lesson: in [[generational-gc|generational collectors]], match young-collection frequency to object lifetimes before touching total heap size. A bigger heap spaces full GCs out and makes each one longer. Next: lower the [[allocation-rate]] (stream results instead of buffering whole responses) and alert on promotion rate.'
		}
	]
};

// ───────────────────────── Part 7 · Coding ─────────────────────────

const histSpec = `class LatencyHistogram:
    def record(self, value_us: int, n: int = 1) -> None: ...   # 1 µs .. 3,600,000,000 µs (1 hour)
    def percentile(self, q: float) -> int: ...                 # q in (0, 100]
    def merge(self, other: "LatencyHistogram") -> None: ...
    # Requirements:
    #  - every reported value within 1% (relative) of a value at that rank
    #  - never under-report (latency SLOs): report the bucket's upper bound
    #  - fixed memory (no storing samples), O(1) record, merge by addition`;

const co1: Question = {
	id: 'co1',
	title: 'Warm-up: bucket by hand',
	tag: 'coding',
	minutes: 10,
	prompt: [
		{
			type: 'p',
			text: 'Task (45 minutes overall): implement an [[hdr-histogram|HDR-style]] latency histogram. Design: values below 128 get exact buckets; above that, each power of two [2^e, 2^(e+1)) is split into 128 equal sub-buckets, so bucket width ÷ value < 1/128 < 1%.'
		},
		{ type: 'code', lang: 'python', code: histSpec },
		{
			type: 'p',
			text: 'Index formula for v ≥ 128: e = floor(log₂ v), shift = e − 7, sub = (v >> shift) − 128, index = 128 + shift·128 + sub. Fill in index and [lowest, highest] for: 127, 128, 256, 1,000, 1,000,000, and 3,600,000,000. How many counters does the array need?'
		}
	],
	answer: [
		{
			type: 'table',
			head: ['v', 'e', 'shift', 'sub', 'index', 'bucket range'],
			numeric: [1, 2, 3, 4],
			rows: [
				['127', '—', '—', '—', '127', '[127, 127] exact'],
				['128', '7', '0', '0', '128', '[128, 128]'],
				['256', '8', '1', '0', '256', '[256, 257]'],
				['1,000', '9', '2', '122', '506', '[1,000, 1,003]'],
				['1,000,000', '19', '12', '116', '1,780', '[999,424, 1,003,519]'],
				['3,600,000,000', '31', '24', '86', '3,286', '[3,590,324,224, 3,607,101,439]']
			]
		},
		{
			type: 'p',
			text: 'Array size: 3,287 counters (≈26 KB as int64) covers 1 µs to 1 hour with < 0.78% error. Check for 1,000,000: upper bound 1,003,519 is 0.35% above.'
		}
	]
};

const co2: Question = {
	id: 'co2',
	title: 'Reference solution (Python + TypeScript)',
	tag: 'coding',
	minutes: 25,
	answerLabel: 'Show solution',
	prompt: [{ type: 'p', text: 'Write yours against the timer first. The reference passes the test list in the next question.' }],
	answer: [
		{
			type: 'code',
			lang: 'python',
			code: `import math

SUB_BITS = 7
SUB = 1 << SUB_BITS          # 128 sub-buckets per power of two -> < 1/128 relative error
MAX_VALUE = 3_600_000_000    # 1 hour in microseconds


def bucket_index(v: int) -> int:
    if v < SUB:
        return v                                  # exact below 128
    e = v.bit_length() - 1                        # 2^e <= v < 2^(e+1)
    shift = e - SUB_BITS
    sub = (v >> shift) - SUB                      # 0..127
    return SUB + shift * SUB + sub


def bucket_range(i: int) -> tuple[int, int]:
    """Inclusive [lowest, highest] value that maps to bucket i."""
    if i < SUB:
        return i, i
    shift, sub = divmod(i - SUB, SUB)
    lo = (SUB + sub) << shift
    return lo, lo + (1 << shift) - 1


class LatencyHistogram:
    def __init__(self) -> None:
        self.counts = [0] * (bucket_index(MAX_VALUE) + 1)
        self.total = 0
        self.min = None
        self.max = None

    def record(self, v: int, n: int = 1) -> None:
        if not 1 <= v <= MAX_VALUE:
            raise ValueError(f"value out of range: {v}")
        self.counts[bucket_index(v)] += n
        self.total += n
        self.min = v if self.min is None else min(self.min, v)
        self.max = v if self.max is None else max(self.max, v)

    def merge(self, other: "LatencyHistogram") -> None:
        for i, c in enumerate(other.counts):
            self.counts[i] += c
        self.total += other.total
        for attr, pick in (("min", min), ("max", max)):
            a, b = getattr(self, attr), getattr(other, attr)
            setattr(self, attr, b if a is None else a if b is None else pick(a, b))

    def percentile(self, q: float) -> int:
        """Upper bound of the bucket holding the rank-ceil(q% * n) sample (never under-reports)."""
        if self.total == 0:
            raise ValueError("empty histogram")
        if not 0 < q <= 100:
            raise ValueError("q must be in (0, 100]")
        rank = math.ceil(q / 100 * self.total)
        seen = 0
        for i, c in enumerate(self.counts):
            seen += c
            if seen >= rank:
                return min(bucket_range(i)[1], self.max)
        return self.max`
		},
		{
			type: 'code',
			lang: 'typescript',
			caption: 'TypeScript: 3.6e9 exceeds 2^31, so avoid 32-bit bitwise operators; use multiplication by powers of two.',
			code: `const SUB_BITS = 7;
const SUB = 1 << SUB_BITS;
export const MAX_VALUE = 3_600_000_000;

export function bucketIndex(v: number): number {
  if (v < SUB) return v;
  const e = Math.floor(Math.log2(v));
  // guard against float rounding exactly at powers of two
  const exp = 2 ** e > v ? e - 1 : 2 ** (e + 1) <= v ? e + 1 : e;
  const shift = exp - SUB_BITS;
  return SUB + shift * SUB + (Math.floor(v / 2 ** shift) - SUB);
}

export function bucketRange(i: number): [number, number] {
  if (i < SUB) return [i, i];
  const shift = Math.floor((i - SUB) / SUB);
  const lo = (SUB + ((i - SUB) % SUB)) * 2 ** shift;
  return [lo, lo + 2 ** shift - 1];
}

export class LatencyHistogram {
  counts = new Array<number>(bucketIndex(MAX_VALUE) + 1).fill(0);
  total = 0;
  min: number | null = null;
  max: number | null = null;

  record(v: number, n = 1): void {
    if (!Number.isInteger(v) || v < 1 || v > MAX_VALUE) throw new RangeError("value out of range");
    this.counts[bucketIndex(v)] += n;
    this.total += n;
    this.min = this.min === null ? v : Math.min(this.min, v);
    this.max = this.max === null ? v : Math.max(this.max, v);
  }

  merge(o: LatencyHistogram): void {
    o.counts.forEach((c, i) => (this.counts[i] += c));
    this.total += o.total;
    if (o.min !== null) this.min = this.min === null ? o.min : Math.min(this.min, o.min);
    if (o.max !== null) this.max = this.max === null ? o.max : Math.max(this.max, o.max);
  }

  percentile(q: number): number {
    if (this.total === 0) throw new Error("empty histogram");
    if (!(q > 0 && q <= 100)) throw new RangeError("q must be in (0, 100]");
    const rank = Math.ceil((q / 100) * this.total);
    let seen = 0;
    for (let i = 0; i < this.counts.length; i++) {
      seen += this.counts[i];
      if (seen >= rank) return Math.min(bucketRange(i)[1], this.max!);
    }
    return this.max!;
  }
}`
		},
		{
			type: 'p',
			text: '**Complexity:** `record` O(1); `percentile` O(B) with B = 3,287 buckets (fine; keep a running cumulative array if you query a lot); `merge` O(B). Memory is fixed regardless of sample count.'
		}
	]
};

const co3: Question = {
	id: 'co3',
	title: 'The test list',
	tag: 'coding',
	minutes: 5,
	answerLabel: 'Show tests',
	prompt: [{ type: 'p', text: 'List the cases you would test before peeking: bucket boundaries, the error bound, percentile semantics, merge, edge cases.' }],
	answer: [
		{
			type: 'code',
			lang: 'python',
			code: `import math, random
import pytest
from hist import LatencyHistogram, bucket_index, bucket_range, MAX_VALUE


@pytest.mark.parametrize("v, idx, rng", [
    (1, 1, (1, 1)),                      # exact region
    (127, 127, (127, 127)),
    (128, 128, (128, 128)),              # first log-linear bucket, still width 1
    (255, 255, (255, 255)),
    (256, 256, (256, 257)),              # width doubles at each power of two
    (1000, 506, (1000, 1003)),
    (1_000_000, 1780, (999_424, 1_003_519)),
    (MAX_VALUE, 3286, None),             # last bucket: array size 3287
])
def test_bucket_table(v, idx, rng):
    assert bucket_index(v) == idx
    lo, hi = bucket_range(idx)
    assert lo <= v <= hi
    if rng:
        assert (lo, hi) == rng


def test_relative_error_bound():
    rnd = random.Random(1)
    for v in list(range(1, 5000)) + [rnd.randint(1, MAX_VALUE) for _ in range(20_000)]:
        lo, hi = bucket_range(bucket_index(v))
        assert (hi - v) / v < 1 / 128


def test_percentiles_1_to_1000():
    h = LatencyHistogram()
    for v in range(1, 1001):
        h.record(v)
    assert h.percentile(50) == 501      # bucket [500, 501]
    assert h.percentile(99) == 991      # bucket [988, 991]
    assert h.percentile(100) == 1000    # clamped to exact max


def test_never_underreports():
    rnd = random.Random(2)
    vals = sorted(rnd.randint(1, 10**7) for _ in range(50_000))
    h = LatencyHistogram()
    for v in vals:
        h.record(v)
    for q in (50, 90, 99, 99.9):
        exact = vals[math.ceil(q / 100 * len(vals)) - 1]
        assert exact <= h.percentile(q) <= exact * (1 + 1 / 128)


def test_merge_equals_recording_everything_in_one():
    a, b, both = LatencyHistogram(), LatencyHistogram(), LatencyHistogram()
    for v in range(1, 5000):
        (a if v % 2 else b).record(v * 37)
        both.record(v * 37)
    a.merge(b)
    assert (a.counts, a.total, a.min, a.max) == (both.counts, both.total, both.min, both.max)


def test_merge_with_empty_both_ways():
    a, e = LatencyHistogram(), LatencyHistogram()
    a.record(42)
    a.merge(LatencyHistogram())
    e.merge(a)
    assert (e.min, e.max, e.total) == (42, 42, 1)


def test_bulk_record_and_tail():
    h = LatencyHistogram()
    h.record(5, n=99)
    h.record(10_000)
    assert h.percentile(99) == 5
    assert h.percentile(99.5) == 10_000  # rank 100 is the outlier


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        LatencyHistogram().record(0)
    with pytest.raises(ValueError):
        LatencyHistogram().record(MAX_VALUE + 1)
    with pytest.raises(ValueError):
        LatencyHistogram().percentile(50)`
		},
		{ type: 'p', text: 'Also mention: concurrent recording (per-thread histograms merged on read beat a shared locked one), and a time-windowed variant (rotate histograms per minute, merge for longer windows).' }
	]
};

const co4: Question = {
	id: 'co4',
	title: 'Why not just use the metrics library\'s buckets?',
	tag: 'tricky',
	minutes: 5,
	prompt: [
		{
			type: 'p',
			text: 'A reviewer says: "We already export a Prometheus histogram with buckets `5, 10, 25, 50, 100, 250, 500, 1000, 2500` ms and use `histogram_quantile(0.99, ...)`; why build this?" In one minute, 1,000 requests: 985 under 250 ms, 15 between 250 and 500 ms (all actually ~260–270 ms). What p99 does each approach report? And what is wrong with averaging each pod\'s p99 instead?'
		}
	],
	answer: [
		{
			type: 'list',
			items: [
				'**Prometheus:** rank 990 falls in the (250, 500] bucket as the 5th of 15 samples; `histogram_quantile` interpolates linearly: 250 + 250 × 5/15 ≈ **333 ms**. True p99 ≈ 262 ms, so it reports ~27% high, and could equally be ~50% off depending on where samples sit. Error is bounded by bucket width, which is huge in the tail where SLOs live.',
				'**Log-linear histogram:** reports within 0.78%, e.g. ≈ 263 ms.',
				'**Averaging per-pod p99s** ([[percentile-averaging]]) has no mathematical meaning: one hot pod\'s 2 s p99 averaged with nine calm pods\' 50 ms gives 245 ms, while the true fleet p99 might be ~1 s. Histograms merge correctly by adding bucket counts; percentiles don\'t.',
				'Prometheus native histograms (exponential buckets) close most of this gap; classic fixed buckets need boundaries placed tightly around the SLO.'
			]
		}
	]
};

// ───────────────────────── Part 8 · Rapid fire ─────────────────────────

const t1: Question = {
	id: 'pt1',
	title: 'Fan-out tail',
	tag: 'teaser',
	minutes: 2,
	prompt: [{ type: 'p', text: 'A page makes 50 backend calls in parallel. Each call exceeds its p99 1% of the time. How often is the page slow?' }],
	answer: [{ type: 'p', text: '1 − 0.99⁵⁰ ≈ **39.5%**. One call\'s p99 becomes the page\'s p60. See [[tail-latency]] and [[hedged-requests]].' }]
};
const t2: Question = {
	id: 'pt2',
	title: 'Twice as fast, 2.6% better',
	tag: 'teaser',
	minutes: 1,
	prompt: [{ type: 'p', text: 'You made a function that takes 5% of runtime twice as fast. Overall speedup?' }],
	answer: [{ type: 'p', text: '1 ÷ (0.95 + 0.05/2) = 1 ÷ 0.975 ≈ **1.026×**. [[amdahls-law]]: optimize what\'s wide in the profile.' }]
};
const t3: Question = {
	id: 'pt3',
	title: '90% → 99% busy',
	tag: 'teaser',
	minutes: 1,
	prompt: [{ type: 'p', text: 'An M/M/1 server goes from 90% to 99% utilization. By how much does mean waiting grow?' }],
	answer: [{ type: 'p', text: 'Mean response ∝ 1/(1 − ρ): 1/0.1 = 10 → 1/0.01 = 100, **10×** for a 10% increase in load. [[queueing-theory]]' }]
};
const t4: Question = {
	id: 'pt4',
	title: '"Our SSD does 500k IOPS"',
	tag: 'teaser',
	minutes: 1,
	prompt: [{ type: 'p', text: 'So fsync can\'t be our bottleneck, right?' }],
	answer: [
		{
			type: 'p',
			text: 'IOPS ratings assume queue depth 32+. A single thread doing write + [[fsync]] runs at queue depth 1, limited by flush latency (e.g. 2 ms → 500/s). Batch ([[group-commit]]) or parallelize.'
		}
	]
};
const t5: Question = {
	id: 'pt5',
	title: 'Free memory is 300 MB',
	tag: 'teaser',
	minutes: 1,
	prompt: [{ type: 'p', text: '`free -h` on a database host: 64 GB total, 300 MB free, 52 GB buff/cache. Add RAM?' }],
	answer: [
		{
			type: 'p',
			text: 'Not from this. The [[page-cache]] holds 52 GB of reclaimable file data; look at `available` (≈ free + reclaimable cache). Worry when `available` is low, major page faults rise, or swap/OOM appears.'
		}
	]
};
const t6: Question = {
	id: 'pt6',
	title: 'p99 over 30 s of samples',
	tag: 'teaser',
	minutes: 1,
	prompt: [{ type: 'p', text: 'An endpoint gets 2 req/s. The dashboard shows a 30-second p99. How many samples is that p99 based on?' }],
	answer: [{ type: 'p', text: '60 samples: p99 is just the maximum (rank ⌈0.99 × 60⌉ = 60). At low traffic, use longer windows or report max/p90 instead.' }]
};

// ───────────────────────── Assessment ─────────────────────────

const performance: Assessment = {
	id: 'performance',
	number: 16,
	title: 'Performance engineering',
	tagline: 'Flame graphs, caches, locks, GC, fsync, TCP and queueing math. Make it fast, and prove it.',
	description:
		'Systems performance for senior engineers: read profiles correctly, reason about CPU caches and memory, find where concurrency stops scaling, see storage and network limits for what they are, and test load honestly. Expect arithmetic: most answers are a number you can check.',
	minutes: 220,
	difficulty: 'advanced',
	track: 'core',
	topics: ['profiling', 'CPU & memory', 'GC', 'concurrency', 'storage & network', 'queueing', 'load testing', 'labs', 'coding'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Profiling', minutes: 20 },
				{ label: '2 · CPU & memory', minutes: 30 },
				{ label: '3 · Concurrency', minutes: 35 },
				{ label: '4 · Storage & network', minutes: 30 },
				{ label: '5 · Load & capacity', minutes: 20 },
				{ label: '6 · Labs', minutes: 25 },
				{ label: '7 · Coding', minutes: 50 },
				{ label: 'Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'cards',
			items: [
				{ title: '1 · Measure the right thing', items: ['CPU low + latency high → off-CPU problem', 'Total vs self time', 'Sample counts and error bars'] },
				{ title: '2 · Find the limit', items: ['Which resource is at a ceiling (IOPS, quota, lock, pool)?', 'Little\'s law to connect queue, rate, time', 'Utilization vs latency is non-linear'] },
				{ title: '3 · Predict before changing', items: ['Amdahl / USL before adding cores or threads', 'Break-even math before compressing or caching', 'Capacity with headroom and failure domains'] }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'What a reviewer looks for',
			text: 'A number for every claim, the measurement that would confirm it, and awareness of what the measurement *can\'t* see. "Optimize the hot function" without checking self time, CPU utilization, or whether the bottleneck is waiting, scores low.'
		}
	],
	parts: [
		{
			id: 'p1',
			nav: '1 · Profiling',
			eyebrow: 'Part 1 · 20 minutes',
			title: 'Reading profiles without fooling yourself',
			meta: 'flame graphs · on-CPU vs off-CPU · sampling error · inlining',
			minutes: 20,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					text: 'A [[flame-graph]] shows where CPU samples landed, by width. Before you trust one, ask: what kind of profile is it (on-CPU, wall-clock, allocation), how many samples does it have, and does the profiler see inlined code?'
				}
			],
			questions: [pr1, pr2, pr3, pr4]
		},
		{
			id: 'p2',
			nav: '2 · CPU & memory',
			eyebrow: 'Part 2 · 30 minutes',
			title: 'CPU caches, branches and memory you can\'t see',
			meta: 'false sharing · branch prediction · memory latency · RSS vs heap · pooling · huge pages',
			minutes: 30,
			questions: [cm1, cm2, cm3, cm4, cm5, cm6]
		},
		{
			id: 'p3',
			nav: '3 · Concurrency',
			eyebrow: 'Part 3 · 35 minutes',
			title: 'Where parallelism stops paying',
			meta: "Amdahl · USL · pool sizing · event loops · GOMAXPROCS · coordinated omission",
			minutes: 35,
			questions: [cc1, cc2, cc3, cc4, cc5, cc6]
		},
		{
			id: 'p4',
			nav: '4 · Storage & network',
			eyebrow: 'Part 4 · 30 minutes',
			title: 'Disks and wires',
			meta: 'fsync · write amplification · IOPS · slow start · Nagle · compression',
			minutes: 30,
			questions: [sn1, sn2, sn3, sn4, sn5, sn6]
		},
		{
			id: 'p5',
			nav: '5 · Load & capacity',
			eyebrow: 'Part 5 · 20 minutes',
			title: 'Load tests that tell the truth',
			meta: 'queueing · open vs closed · microbenchmarks · capacity',
			minutes: 20,
			questions: [lc1, lc2, lc3, lc4]
		},
		{
			id: 'p6',
			nav: '6 · Labs',
			eyebrow: 'Part 6 · 25 minutes · interactive',
			title: 'Fix it live',
			meta: 'lock contention under a pod quota · a GC that pauses for a second',
			minutes: 25,
			questions: [lab1, lab2]
		},
		{
			id: 'p7',
			nav: '7 · Coding',
			eyebrow: 'Part 7 · 50 minutes · coding',
			title: 'A latency histogram that merges',
			meta: 'log-linear buckets · bounded relative error · never under-report',
			minutes: 50,
			questions: [co1, co2, co3, co4]
		},
		{
			id: 'teasers',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Performance arithmetic',
			minutes: 10,
			questions: [t1, t2, t3, t4, t5, t6]
		}
	]
};

export default performance;
