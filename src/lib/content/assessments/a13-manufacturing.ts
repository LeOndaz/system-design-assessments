import type { Assessment } from '../types';
import { bump, ramp, shape, step, timeAxis, window_ } from '../series';
import printFarm from '../labs/a13-print-farm';
import mqttOverload from '../labs/a13-mqtt-overload';

// ───────────────────────── chart data ─────────────────────────

// Q1: planner buffer underrun on curved surfaces (from 14:25).
const q1x = timeAxis('14:00', 60, 1);
const q1Buffer = shape(60, { base: 15, noise: 0.04, seed: 11 }, window_(25, 52, 2));
const q1Tx = shape(60, { base: 140, noise: 0.08, seed: 12 }, window_(25, 52, 358));
const q1Need = shape(60, { base: 140, noise: 0.06, seed: 13 }, window_(25, 52, 410));
const q1Temp = shape(60, { base: 215, noise: 0.002, seed: 14, round: 1 });
const q1Cpu = shape(60, { base: 31, noise: 0.12, seed: 15 }, window_(25, 52, 36));

// Q8: volumetric flow past the hotend's melt limit.
const q8x = timeAxis('09:00', 40, 1);
const q8Flow = shape(40, { base: 11, noise: 0.05, seed: 21, round: 1 }, step(15, 29));
const q8Temp = shape(40, { base: 240, noise: 0.003, seed: 22, round: 1 }, ramp(15, 19, 240, 231));
const q8Skips = shape(40, { base: 0, noise: 0, seed: 23 }, window_(16, 40, 6), bump(22, 24, 5), bump(30, 31, 4));
const q8Humidity = shape(40, { base: 21, noise: 0.03, seed: 24 });

// Q16: averaged rollup hides 2-second pressure spikes.
const q16x = timeAxis('14:00', 60, 1);
const q16Avg = shape(60, { base: 118, noise: 0.015, seed: 31 }, bump(31, 32, 2), bump(44, 45, 2));
const q16Zx = Array.from({ length: 40 }, (_, i) => `14:31:${String(10 + Math.floor(i / 2)).padStart(2, '0')}.${i % 2 ? 5 : 0}`);
const q16Raw = shape(40, { base: 118, noise: 0.02, seed: 32 }, window_(17, 21, 181));

// Q17: WAN outage, backfill, late recompute.
const q17x = timeAxis('22:00', 48, 10);
const q17Ingest = shape(48, { base: 1200, noise: 0.05, seed: 41 }, window_(24, 42, 0), window_(43, 46, 9800));
const q17Lag = shape(48, { base: 2, noise: 0.2, seed: 42 }, window_(24, 42, 0), window_(43, 46, 11800));

// Q19: SPC drift (subgroup means, n = 5).
const q19x = timeAxis('06:00', 24, 30);
const q19Mean = [
	10.002, 9.997, 10.004, 9.999, 10.001, 9.996, 10.003, 10.0, 10.004, 10.006, 10.007, 10.009, 10.008, 10.011, 10.013, 10.012, 10.015, 10.016, 10.018,
	10.017, 10.019, 10.021, 10.02, 10.022
];
const q19Range = shape(24, { base: 0.023, noise: 0.12, seed: 51, round: 3 });

// Q20: 120 Hz vibration sampled at 100 Hz aliases to 20 Hz.
const q20x = Array.from({ length: 50 }, (_, i) => `${(i * 10).toString()} ms`);
const q20Samples = Array.from({ length: 50 }, (_, i) => Math.round(Math.sin(2 * Math.PI * 120 * (i / 100)) * 0.8 * 1000) / 1000);
const q20Fx = Array.from({ length: 11 }, (_, i) => `${i * 5} Hz`);
const q20Fft = [0.02, 0.03, 0.02, 0.05, 0.79, 0.04, 0.02, 0.01, 0.02, 0.01, 0.01];

// Q5: firmware rollout by hardware revision.
const q5x = timeAxis('10:00', 36, 10);
const q5Online = shape(36, { base: 1180, noise: 0.002, seed: 61 }, step(18, 1040));
const q5Bootloop = shape(36, { base: 0, noise: 0, seed: 62 }, step(18, 140));

// ───────────────────────── assessment ─────────────────────────

const a13: Assessment = {
	id: 'manufacturing',
	number: 13,
	title: 'Manufacturing pipelines & 3D printing',
	tagline: 'Print farms, G-code over flaky serial, slicing math, MQTT on the factory floor, OEE and SPC that lie politely.',
	description:
		'Software for things that physically exist: a retry can waste eight hours of plastic, a dashboard can say a dead press is running, and a "world-class" OEE can sit on flat output. Expect real arithmetic: extrusion, motion profiles, tolerances, capability indices, sampling rates. Work the numbers before you open the answers.',
	minutes: 170,
	difficulty: 'advanced',
	track: 'core',
	topics: ['3D printing', 'G-code', 'MQTT / OPC UA', 'OEE', 'SPC', 'traceability', 'math'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Print farm', minutes: 25 },
				{ label: '2 · Slicing math', minutes: 25 },
				{ label: '3 · Factory data', minutes: 30 },
				{ label: '4 · Labs', minutes: 20 },
				{ label: '5 · G-code analyzer', minutes: 55 },
				{ label: 'Teasers', minutes: 15 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'What changes when the output is physical',
			text: '**Side effects are irreversible.** A duplicated HTTP request is a refund; a duplicated print job is eight hours of machine time and a kilo of material. Design for *at most once* on physical actions and *at least once* on messages, and make the boundary explicit. **Sensors lie in specific ways:** sampling rates, averaging and clocks decide what you can see. **Safety never lives in your software loop.**'
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Show the arithmetic',
			text: 'Graders reward the worked number more than the conclusion: "the hotend melts 15 mm³/s; your profile asks for 29.3" beats "it\'s probably under-extruding". Keep units on every line; most bugs in this domain are unit bugs.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Print farm',
			eyebrow: 'Part 1 · 25 minutes · pipelines',
			title: 'Print farm & job pipelines',
			meta: 'upload → [[slicer]] → dispatcher → printer agent → [[g-code]] stream',
			minutes: 25,
			intro: [
				{
					type: 'flow',
					steps: [
						{ label: 'Upload', note: 'STL / 3MF + profile' },
						{ label: 'Slicer', note: 'CPU + RAM heavy' },
						{ label: 'Scheduler', note: 'plates, material' },
						{ label: 'Printer agent', note: 'on a Pi next to the printer' },
						{ label: 'Firmware', note: 'serial, 16-move planner' }
					],
					caption: 'Each arrow is a place where retries, ordering and units can go wrong. The last arrow is a 115200-baud serial cable.'
				}
			],
			questions: [
				{
					id: 'p1q1',
					title: 'Blobs only on the curved parts',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Dani Okafor',
								role: 'Print farm lead',
								time: 'Tue 14:58',
								body: 'P-14 is making zits all over the vases again. Boxes off the same printer are perfect. I think the hotend temp is unstable, can someone look before I swap the heater cartridge?'
							}
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'printer P-14 · host + firmware',
								range: '14:00 – 14:59',
								filters: ['host=pi-p14', 'baud=115200'],
								panels: [
									{
										kind: 'timeseries',
										title: 'Firmware planner queue (moves buffered, max 16)',
										x: q1x,
										series: [{ name: 'queued moves', points: q1Buffer }],
										yMax: 16,
										markers: [
											{ at: 25, label: 'vase wall starts' },
											{ at: 52, label: 'top cap (flat)' }
										]
									},
									{
										kind: 'timeseries',
										title: 'G-code lines/s',
										x: q1x,
										series: [
											{ name: 'sent by host', points: q1Tx },
											{ name: 'needed (from slicer metadata)', points: q1Need, dashed: true }
										]
									},
									{ kind: 'timeseries', title: 'Hotend temperature', unit: '°C', x: q1x, yMin: 205, yMax: 225, series: [{ name: 'T0', points: q1Temp }], span: 3 },
									{ kind: 'timeseries', title: 'Host CPU', unit: '%', x: q1x, yMax: 100, series: [{ name: 'pi-p14', points: q1Cpu }], span: 3 }
								]
							}
						},
						{
							type: 'p',
							text: 'The vase wall is a smooth spline exported as 0.2 mm segments, printed at 80 mm/s. Average [[g-code]] line length is 32 bytes. Where do the blobs come from, and what would you change?'
						}
					],
					hints: [
						'How many bytes per second does 115200 baud carry ([[serial-8n1|8N1]] means 10 bits per byte)?',
						'How many segments per second does 80 mm/s over 0.2 mm segments ask for?'
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[planner-buffer-underrun|Planner buffer underrun]]: the serial link can\'t keep up with tiny segments.',
									body: '115200 baud ÷ 10 bits ≈ 11,520 B/s ÷ 32 B ≈ **360 lines/s** maximum, and the host is pinned at ~358. The vase wall needs 80 mm/s ÷ 0.2 mm = **400 segments/s**. The planner queue drops from 15 to ~2 exactly when the wall starts (14:25) and recovers at the flat cap (14:52). With an empty queue the firmware decelerates to a stop between segments, and the nozzle oozes while it waits: a zit.',
									confirm: 'Print the same file from local storage (SD / firmware-side file), or halve the speed: blobs vanish without touching the heater.'
								},
								{
									title: 'Not the heater (red herring).',
									body: 'Hotend temperature is flat at 215 ± 0.5 °C across the whole hour, including the bad section. Swapping the cartridge would cost an hour and change nothing.'
								},
								{
									title: 'Not host CPU.',
									body: 'The Pi is at ~35%. The ceiling is the wire, not the computer: 358 lines/s is the baud rate, not a busy process.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix, cheapest first:** arc fitting (convert runs of tiny segments into `G2`/`G3` arcs, often 5–10× fewer lines), export splines at a coarser resolution (0.2 mm segments on a 0.4 mm nozzle are below what the plastic can show), print from local storage, or raise the baud rate (250000) where the firmware supports it. Longer-term: a binary/compressed G-code format, or a host that streams ahead of need.'
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'The general shape: **a fixed-rate pipe in front of a small buffer**. When demand in lines/s exceeds the pipe, the buffer drains and the consumer stalls. Same family as [[backpressure]] and [[littles-law]], just with a serial cable.'
						}
					]
				},
				{
					id: 'p1q2',
					title: 'The resend that printed a ghost layer',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'host serial log · P-09',
								lines: [
									{ ts: '03:12:07.101', source: 'send', msg: 'N2040 G1 X112.4 Y80.2 E0.0381*87' },
									{ ts: '03:12:07.109', source: 'recv', msg: 'ok' },
									{ ts: '03:12:07.113', source: 'send', msg: 'N2041 G1 X112.9 Y80.6 E0.0412*93' },
									{ ts: '03:12:07.118', source: 'send', msg: 'N2042 G1 X113.3 Y81.1 E0.0398*80' },
									{ ts: '03:12:07.126', level: 'WARN', source: 'recv', msg: 'Error:checksum mismatch, Last Line: 2040' },
									{ ts: '03:12:07.126', source: 'recv', msg: 'Resend: 2041' },
									{ ts: '03:12:07.131', source: 'send', msg: 'N2041 G1 X112.9 Y80.6 E0.0412*93' },
									{ ts: '03:12:07.140', source: 'send', msg: 'N2042 G1 X113.3 Y81.1 E0.0398*80' },
									{ ts: '03:12:07.142', source: 'recv', msg: 'ok' },
									{ ts: '03:12:07.147', source: 'send', msg: 'N2042 G1 X113.3 Y81.1 E0.0398*80' },
									{ ts: '03:12:07.150', source: 'recv', msg: 'ok' },
									{ ts: '03:12:07.156', source: 'recv', msg: 'ok' }
								]
							}
						},
						{
							type: 'code',
							lang: 'python',
							caption: 'The host\'s resend handler (simplified). The file uses `M83` (relative extrusion) and `G90` (absolute XY).',
							code: `def on_line(self, text):
    if text.startswith("Resend:"):
        n = int(text.split(":")[1])
        self.send(self.history[n])          # resend the requested line
        self.cursor = n + 1                 # ...and continue from there
    elif text == "ok":
        self.inflight -= 1
        self.pump()                         # send next lines from self.cursor

def pump(self):
    while self.inflight < 2 and self.cursor <= self.last:
        self.send(self.history[self.cursor]); self.inflight += 1; self.cursor += 1`
						},
						{
							type: 'p',
							text: 'The finished part has one visibly over-extruded spot on layer 212, nothing else wrong. Explain exactly what happened, and why the same bug on a different file would have shifted the whole layer instead.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Line 2042 was executed twice.** It was already in flight when the printer asked for 2041 again. The handler resends 2041 and moves the cursor to 2042, then `pump()` sends 2042 again while the earlier 2042 is still queued or was accepted after the resend. The firmware accepts line numbers ≥ the expected one, so the duplicate is executed. You can see two `send N2042` lines after the resend, and three `ok`s.'
						},
						{
							type: 'p',
							text: '**Why only a blob:** `G90` positions are absolute, so moving to X113.3 Y81.1 twice is harmless: the second move has zero length. But `M83` makes extrusion **relative**: the duplicate line pushes another 0.0398 mm of filament while standing still. That is the zit. With `G91` (relative XY) the same duplicate would move the head 0.4 mm further than intended, and **every subsequent move on the layer would be offset**: a shifted layer, not a blob.'
						},
						{
							type: 'list',
							items: [
								'**Fix the protocol:** on `Resend: n`, discard everything in flight, reset `inflight`, and resend from *n* in order. Never send a line number the firmware has already acknowledged.',
								'**Checksums:** [[serial-line-checksum|XOR of every byte before `*`]]. `N123 G1 X10.5 E0.42` → `*55`. The checksum caught the corruption; the host\'s retry logic created the damage.',
								'**Design lesson:** absolute coordinates make duplicates [[idempotency|idempotent]]; relative ones don\'t. If your transport is [[at-least-once]], prefer absolute positioning, or make the transport [[exactly-once|exactly-once]] per line number (which is what N-lines are for).'
							]
						}
					]
				},
				{
					id: 'p1q3',
					title: 'The retry that printed the order twice',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `@retry(times=3, on=(Timeout, ConnectionError), backoff=2.0)
def dispatch(job, printer):
    r = http.post(f"http://{printer.agent}/jobs",
                  json={"gcode_url": job.gcode_url, "copies": job.copies},
                  timeout=5)
    r.raise_for_status()
    db.mark_dispatched(job.id, printer.id)`
						},
						{
							type: 'p',
							text: 'Weekly review: 11 jobs were printed twice on the same printer, back to back. All 11 were on printers attached to the warehouse Wi-Fi. Explain, then fix it so it holds for any network.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**A [[timeout]] is "unknown", not "failed".** The agent received the POST, started heating the bed (which takes ~30 s on that model, so its response was slow) and replied after 5 s; on flaky Wi-Fi the reply was lost or late. The decorator re-POSTed, the agent saw a *new* job and queued it behind the first. The Wi-Fi printers show it because they have the most lost responses, not because Wi-Fi is the cause.'
						},
						{
							type: 'list',
							items: [
								'**[[idempotency-key|Idempotency key]] on the agent:** send `job_id` and have the agent store accepted ids durably; a repeat POST returns the existing job\'s status instead of queuing a copy.',
								'**Reply before slow work:** the agent should persist the job and return `202 Accepted` immediately, then heat the bed. Long synchronous handlers create timeouts.',
								'**Reconcile instead of blind retry:** after a timeout, `GET /jobs/{job_id}` on the agent before deciding to re-send.',
								'**Physical side effects are [[at-least-once|at-most-once]] by design:** a duplicate costs material and hours and can\'t be refunded. Make the expensive step (the physical start) the deduplicated one, and keep retries for the cheap messages around it.'
							]
						}
					]
				},
				{
					id: 'p1q4',
					title: 'Two jobs, one spool, 3 a.m. runout',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def reserve_material(spool_id, grams):
    spool = db.get(Spool, spool_id)
    if spool.remaining_g - spool.reserved_g < grams:
        raise NotEnoughMaterial(spool_id)
    spool.reserved_g += grams
    db.save(spool)`
						},
						{
							type: 'p',
							text: 'Two schedulers run on separate nodes. Spool S-31 had 300 g free; two 200 g jobs were both assigned to it, and the second ran out at 03:10 with 6 hours already printed. Explain both failures hiding in this incident, not just the obvious one.'
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[lost-update|Lost update]] / check-then-act [[race-condition|race]].',
									body: 'Both schedulers read 300 g free, both pass the check, both write `reserved_g = 200`. The second write overwrites the first, so the database even *looks* consistent afterwards.',
									confirm: 'Two reservations with timestamps milliseconds apart and a final `reserved_g` of 200, not 400.'
								},
								{
									title: 'The "remaining" number was never true to the gram.',
									body: 'Remaining weight is an estimate: the spool\'s starting weight ± ~15 g, minus slicer estimates that ignore [[purge-line|purge line]]s, failed first layers and [[retraction|retraction]] losses. Even serialised, reserving 200 g out of an *estimated* 300 g left a margin of 100 g on a number with tens of grams of error.'
								}
							]
						},
						{
							type: 'code',
							lang: 'sql',
							caption: 'Atomic [[conditional-update|conditional update]]: the check and the write are one statement.',
							code: `UPDATE spools
SET reserved_g = reserved_g + :grams
WHERE id = :spool_id
  AND remaining_g - reserved_g >= :grams * 1.10   -- 10% safety margin
RETURNING reserved_g;                              -- 0 rows → not enough material`
						},
						{
							type: 'p',
							text: 'Also: measure instead of estimate (a load cell under the spool holder or a filament-runout sensor that pauses rather than ruins), and reconcile reservations against actual consumption after each job so the estimate error does not accumulate.'
						}
					]
				},
				{
					id: 'p1q5',
					title: 'Firmware rollout: the canary was green, 140 printers are boot-looping',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'fleet · firmware 2.4.0 rollout',
								range: '10:00 – 15:50',
								panels: [
									{
										kind: 'timeseries',
										title: 'Printers online',
										x: q5x,
										series: [{ name: 'online', points: q5Online }],
										yMin: 900,
										markers: [
											{ at: 6, label: 'canary 5%' },
											{ at: 18, label: 'stage 2: 50%' }
										]
									},
									{ kind: 'timeseries', title: 'Boot loops reported', x: q5x, series: [{ name: 'boot loop', points: q5Bootloop }] },
									{
										kind: 'table',
										title: 'Fleet by board revision',
										span: 6,
										head: ['Board', 'Printers', 'MCU flash', 'In canary (5%)', 'In stage 2 (50%)', 'Boot-looping'],
										numeric: [1, 3, 4, 5],
										highlight: [1],
										rows: [
											['rev C', '1,038', '512 KB', '59', '450', '0'],
											['rev B', '142', '256 KB', '0', '140', '140']
										]
									}
								]
							}
						},
						{
							type: 'code',
							lang: 'python',
							caption: 'How the [[canary-analysis|canary]] set was chosen.',
							code: `canary = (Printer.query
          .order_by(Printer.registered_at.desc())   # newest first: "they get support fastest"
          .limit(int(fleet_size * 0.05)))`
						},
						{ type: 'p', text: 'The 2.4.0 image is 251 KB. What went wrong in the rollout design, and what does the recovery plan look like?' }
					],
					answer: [
						{
							type: 'p',
							text: '**The canary was not representative.** "Newest 5%" selected only rev C boards (registered recently), so the 0% failure rate in the canary said nothing about rev B. The 251 KB image does not fit rev B\'s 256 KB flash once the [[bootloader|bootloader]] (~8 KB) is counted, so every rev B in stage 2 bricked itself. The canary didn\'t fail; it measured a different population.'
						},
						{
							type: 'list',
							items: [
								'**Stratify canaries** across every hardware revision, firmware version, printer model and site, with a minimum count per stratum (at least a few of each, including the rare ones).',
								'**Gate per target in CI:** build per board, fail the build if the image plus bootloader exceeds that board\'s flash. This failure was knowable before anything shipped.',
								'**A/B firmware slots or a bootloader fallback** so a failed boot reverts to the previous image instead of looping. Without it, recovery is physical.',
								'**Halt on the first stratum failure:** stage 2 should have been blocked automatically by "0 of 142 rev B boards observed".',
								'**Recovery now:** stop the rollout, mark rev B ineligible, then plan a technician visit (USB/SWD reflash) for 140 printers and reschedule their jobs onto rev C capacity.'
							]
						}
					]
				},
				{
					id: 'p1q6',
					title: 'The plate packer is "optimal". Throughput went down.',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'A new scheduler packs up to 9 brackets per build plate using [[bin-packing|first-fit-decreasing]] on plate area; it used to print 3 per plate. Facts: each plate costs 20 min of setup (clear, level, heat), each bracket adds 50 min, each bracket independently fails 4% of the time ([[spaghetti-failure|spaghetti]]), and an operator aborts the whole plate on any failure because spaghetti wrecks the others.'
						},
						{ type: 'p', text: 'Compute good parts per hour for 1, 3, 5 and 9 per plate. What objective should the packer optimise?' }
					],
					answer: [
						{
							type: 'table',
							head: ['Per plate', 'P(plate ok) = 0.96ᵏ', 'Good parts per plate', 'Plate time', 'Good parts / hour'],
							numeric: [1, 2, 3, 4],
							rows: [
								['1', '0.960', '0.96', '70 min', '0.823'],
								['3', '0.885', '2.65', '170 min', '**0.937**'],
								['5', '0.815', '4.08', '270 min', '0.906'],
								['9', '0.693', '6.23', '470 min', '0.796']
							]
						},
						{
							type: 'p',
							text: '**Expected good parts per machine-hour**, not plate utilisation. Packing amortises setup (good) but multiplies the blast radius of one failure (bad); the optimum here is 3. Real failures are also *correlated* (bed adhesion, a bad spool), which pushes the optimum down further.'
						},
						{
							type: 'p',
							text: 'Better still: change the abort policy (cancel only the failed object, which most firmware supports), and then the optimum moves up again. **Optimising the wrong objective perfectly is worse than a rough heuristic on the right one.**'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Slicing math',
			eyebrow: 'Part 2 · 25 minutes · geometry & numbers',
			title: 'Geometry, slicing & motion math',
			meta: '[[extrusion-math|extrusion]] · [[volumetric-flow|flow]] · [[trapezoidal-motion-profile|motion]] · [[tolerance-stack-up|tolerances]] · units',
			minutes: 25,
			intro: [
				{
					type: 'code',
					lang: 'text',
					caption: 'Constants used in this part.',
					code: `1.75 mm filament cross-section   π·0.875² = 2.4053 mm²
2.85 mm filament cross-section   π·1.425² = 6.3794 mm²
PLA density                      1.24 g/cm³   (1 cm³ = 1000 mm³)
1 inch                           25.4 mm
F in G-code                      mm/min (or in/min after G20)`
				}
			],
			questions: [
				{
					id: 'p2q1',
					title: 'Cost estimator says 9.0 g. The scale says 10.1 g.',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'The quoting service computes grams as `sum(line_length × line_width × layer_height) × density`, for 1.75 mm filament. The slicer\'s own G-code reports 8.4 g of filament for the same part. Weighing the spool before and after, the job consumed 10.1 g. A batch of the "1.75 mm" filament measures 1.80 mm with calipers. Three numbers, three answers: reconcile them.'
						}
					],
					hints: ['The slicer and the quoting service model a printed line\'s cross-section differently.', 'Area scales with diameter squared.']
					,
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Quote (9.0 g) vs slicer (8.4 g): rectangle vs stadium cross-section.',
									body: 'The quote models each line as w × h (0.45 × 0.2 = 0.0900 mm²). The slicer models it as a stadium, (w − h)·h + π(h/2)² = 0.0814 mm². The ratio 0.0814/0.0900 = 0.905, and 9.0 × 0.905 ≈ 8.15 g, close to the slicer\'s 8.4 g once you include its extra perimeter overlap. See [[extrusion-math]].'
								},
								{
									title: 'Slicer (8.4 g) vs scale (10.1 g): the filament is fatter than nominal.',
									body: 'The printer pushes a *length* of filament computed for 1.75 mm. At 1.80 mm each millimetre carries (1.80/1.75)² = **1.058×** the plastic. 8.4 × 1.058 = 8.9 g.'
								},
								{
									title: 'The remaining ~1.2 g: purge line, skirt and wipe.',
									body: 'The spool also feeds the purge line, the skirt and the nozzle wipe, which the per-part estimate leaves out. For quoting you want material *consumed* (what the spool lost), not the weight of the finished part.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** quote from the slicer\'s actual extrusion total (E sum × filament area × density), multiply by a measured per-material factor (diameter tolerance plus purge), and recalibrate the factor from scale data monthly. Two models of "how much plastic" in one company will always disagree.'
						}
					]
				},
				{
					id: 'p2q2',
					title: '"Faster" profile, weaker parts',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'Someone shipped a "draft fast" profile: 0.6 mm nozzle, 0.30 mm layers, 0.65 mm line width, 150 mm/s. Parts snap along layer lines. The [[hotend|hotend]] is rated for 15 mm³/s. A teammate blames humid filament.'
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'P-22 · extrusion',
								range: '09:00 – 09:39',
								panels: [
									{
										kind: 'timeseries',
										title: 'Requested volumetric flow',
										unit: ' mm³/s',
										x: q8x,
										series: [{ name: 'flow', points: q8Flow }],
										thresholds: [{ value: 15, label: 'hotend limit 15', tone: 'crit' }],
										markers: [{ at: 15, label: 'infill starts' }]
									},
									{ kind: 'timeseries', title: 'Nozzle temperature', unit: '°C', x: q8x, yMin: 225, yMax: 245, series: [{ name: 'T0', points: q8Temp }] },
									{ kind: 'bars', title: 'Extruder skips (clicks) per minute', x: q8x, series: [{ name: 'skips', points: q8Skips }] },
									{ kind: 'timeseries', title: 'Dry box humidity', unit: '%', x: q8x, yMin: 0, yMax: 60, series: [{ name: 'RH', points: q8Humidity }] }
								]
							}
						},
						{ type: 'p', text: 'What is the maximum speed this profile can run at, and what is actually happening to the plastic?' }
					],
					answer: [
						{
							type: 'p',
							text: '**Requested flow = 0.65 × 0.30 × 150 = 29.25 mm³/s**, nearly double the hotend\'s 15 mm³/s. At the limit, speed must be ≤ 15 ÷ (0.65 × 0.30) = **76.9 mm/s** for infill. Above it, the plastic can\'t absorb enough heat: the nozzle temperature sags (240 → 231 °C once infill starts), the extruder gear skips (clicks), and what does come out is cooler and under-extruded. Cold, thin layers don\'t fuse: parts snap along layer lines.'
						},
						{
							type: 'p',
							text: '**Humidity is the red herring:** the dry box sits flat at ~21% RH. Wet filament causes popping and stringing, not a step change exactly when infill starts.'
						},
						{
							type: 'p',
							text: '**Fix:** set a max volumetric speed in the profile (the slicer then caps per-feature speed automatically), or use a high-flow hotend. Validation rule for profile review: compute w × h × v for every feature and reject anything over the hardware\'s [[volumetric-flow]] limit. "Fast" profiles should be fast where the physics allows (travel, thin features), not everywhere.'
						}
					]
				},
				{
					id: 'p2q3',
					title: 'Print-time estimates are 20% low, only on organic parts',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'table',
							head: ['Part type', 'Estimated', 'Actual', 'Error'],
							numeric: [1, 2, 3],
							rows: [
								['Enclosure box (long straight walls)', '4 h 10 m', '4 h 22 m', '+5%'],
								['Bracket (mixed)', '2 h 05 m', '2 h 21 m', '+13%'],
								['Figurine (organic mesh)', '6 h 00 m', '7 h 25 m', '+24%']
							]
						},
						{
							type: 'p',
							text: 'The estimator computes `Σ distance / feedrate`. Machine: acceleration 2000 mm/s², feedrate 200 mm/s. Explain the pattern with numbers, and say what a good estimator does.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Distance ÷ feedrate assumes instant top speed.** Real axes follow a [[trapezoidal-motion-profile|trapezoidal profile]]: accelerate over v²/2a = 200²/4000 = **10 mm**, cruise, decelerate over 10 mm. A 200 mm wall takes 1.1 s instead of 1.0 s (+10%). A 10 mm move never reaches 200 mm/s (peak √(a·L) = 141 mm/s) and takes 0.141 s instead of 0.05 s (+183%). Organic meshes are thousands of short segments, so their error is largest.'
						},
						{
							type: 'p',
							text: 'It isn\'t +183% on the figurine because firmware [[trapezoidal-motion-profile|look-ahead]] carries speed through gentle corners. The true time sits between naive and "stop at every segment", which is why the error depends on geometry class.'
						},
						{
							type: 'list',
							items: [
								'**Good estimator:** simulate the firmware\'s planner (acceleration, junction deviation, buffer size), not geometry alone. That is how slicers get within a few percent.',
								'**Calibrate with actuals:** record estimated vs actual per printer model and part class; fit a correction; alert when error drifts (a firmware update changing acceleration shows up here first).',
								'**Customer promise dates** should use a [[percentiles|percentile]] of actual/estimate ratios, not the raw estimate.'
							]
						}
					]
				},
				{
					id: 'p2q4',
					title: 'Two kinds of banding, one ticket',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Mara Lindqvist',
								role: 'Quality engineer',
								subject: 'Horizontal lines on tall parts (P-30 series)',
								body: 'Under magnification there are fine ridges every 0.2 mm on all parts printed at 0.1 mm layers. Separately, tall parts have a wider wave that repeats every 8 mm. Both look like "banding" to the customer. Z axis: T8 lead screw (8 mm per revolution), 200-step motor, 16× microstepping.'
							}
						},
						{ type: 'p', text: 'Attribute each pattern to a cause using arithmetic only, and give the fix for each.' }
					],
					answer: [
						{
							type: 'table',
							head: ['Pattern', 'Period', 'Cause', 'Fix'],
							rows: [
								[
									'Fine ridges',
									'0.2 mm (every 2 layers)',
									'[[microstepping|Z quantization]]: one full step = 8 mm ÷ 200 = **0.04 mm**. 0.1 mm is 2.5 full steps, so alternate layers land on a half-step microstep position, which is less accurate under load. The error pattern repeats every 5 full steps = 0.2 mm = 2 layers.',
									'Use layer heights that are multiples of 0.04 mm (0.08, 0.12, 0.16, 0.20). Most slicers have a "magic numbers" setting.'
								],
								[
									'Wide wave',
									'8 mm',
									'Exactly one lead-screw revolution: a bent screw or misaligned coupler wobbles the gantry once per turn (Z-wobble).',
									'Mechanical: straighten or replace the screw, decouple it with an Oldham coupler, check the gantry is square.'
								]
							]
						},
						{
							type: 'p',
							text: '**The method is the point:** match a defect\'s period to every periodic thing in the machine (step size, screw pitch, pulley teeth × belt pitch, fan PWM). A period that matches nothing is usually software (slicer seams, firmware).'
						}
					]
				},
				{
					id: 'p2q5',
					title: 'The 10 mm pin does not fit the 10 mm hole',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'A customer designed a 10.00 mm pin and a 10.00 mm hole "because the printer is accurate to 0.05 mm". The CAD tool exported the STL with 16 segments per circle. The pin won\'t go in, even after sanding the pin to 9.95 mm. Explain with numbers.'
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The STL hole is a 16-sided polygon *inscribed* in the circle.',
									body: 'Its flat sides sit at r·cos(π/16) = 5 × 0.9808 = 4.904 mm from the centre: the narrowest opening is **9.81 mm** across flats. A 9.95 mm pin can\'t pass a 9.81 mm gap. [[stl-mesh|STL]] has no circles.'
								},
								{
									title: 'Holes print smaller than modelled.',
									body: 'The inner perimeter is pulled inward as the plastic [[thermal-shrinkage|shrinks]], and the nozzle\'s rounded line squeezes into the hole. Typical FDM holes come out 0.1–0.3 mm undersized.'
								},
								{
									title: 'Zero design clearance.',
									body: 'A press fit needs negative clearance, a slip fit needs positive. "Accurate to 0.05" is a per-axis positioning claim, not a statement about the size of a finished feature.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** export with a chord tolerance (≤ 0.01 mm) or use 3MF/STEP; design 0.2–0.3 mm clearance for FDM slip fits; enable the slicer\'s hole compensation; print a test coupon with holes in 0.05 mm steps for each material and printer.'
						}
					]
				},
				{
					id: 'p2q6',
					title: 'Five spacers, a 50.6 mm slot, and a confident RSS calculation',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Five printed spacers, each 10.00 ± 0.10 mm, must stack into a 50.60 mm slot. The engineer computed the [[tolerance-stack-up|RSS stack]]: ±√(5 × 0.1²) = ±0.22 mm, so the worst stack is 50.22 mm with a comfortable margin. In production, 30% of assemblies jam. All five spacers in an assembly come from the same plate.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**RSS assumes independent errors.** Five spacers from one plate share the same printer, material lot, temperature and calibration, so most of their error is *common-mode*. Suppose measurements show a shared bias of +0.08 mm per spacer from one printer (over-extrusion), plus ±0.04 mm of independent noise:'
						},
						{
							type: 'code',
							lang: 'text',
							code: `correlated part   5 × 0.08          = +0.40 mm   (adds linearly)
independent part  √(5 × 0.04²)      = ±0.09 mm   (adds in quadrature)
stack             50.00 + 0.40 ± 0.09 → up to 50.49 mm

plus spacers swell slightly in humid storage, and the slot itself is printed
on another machine that runs 0.1 mm small → 50.50 slot vs 50.49 stack: jams`
						},
						{
							type: 'p',
							text: '**Rule:** add correlated errors linearly, independent ones in quadrature, and look for the shared cause before trusting RSS. Fixes: calibrate per printer (remove the bias), mix spacers across printers, or redesign so the stack has adjustable slack (a single shim, a slot with a spring). The worst-case sum (±0.5 → 50.50) was the honest answer here.'
						}
					]
				},
				{
					id: 'p2q7',
					title: 'Everything from one customer is 25.4× wrong. Which direction?',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'p',
							text: 'Two incidents in one week. (a) A customer\'s phone stand arrives the size of a postage stamp. (b) On the [[cnc]] side, a router crashed into its fixture: the program before it ended with `G20`, and the crashing program has no units line in its header.'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**(a) Too small → modelled in inches, interpreted as mm.** An STL has no units: a 4-inch stand exported as "4" became 4 mm. (Too big by 25.4× is the reverse: mm interpreted as inches.) Fix: detect suspicious bounding boxes at upload ("this part is 4 × 3 × 2 mm, did you mean inches?"), prefer 3MF which carries units.',
								'**(b) [[g-code|Modal state]] leaked between programs.** `G20` stayed active, so the next program\'s "X50" meant 50 inches, not 50 mm. Fix: every program starts with a **safety block** that sets every modal group explicitly (`G21 G90 G17 G40 G49 G80`), and the post-processor refuses to emit a program without one. Never rely on the machine\'s previous state.'
							]
						}
					]
				},
				{
					id: 'p2q8',
					title: 'Fine details fade out after hour six',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'A 9-hour print with absolute extrusion (`M82`) and no `G92 E0` resets: the first layers have crisp, thin text embossing; by the top, the same thin features are patchy. Total filament for the print is 14,000 mm. The firmware stores positions as 32-bit floats. A colleague says "switch to relative extrusion, absolute accumulates error".'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**It\'s float32 precision, and your colleague has the mechanism backwards.** A float32 has 24 bits of mantissa. Between 8,192 and 16,384 the gap between representable numbers is 2⁻¹⁰ ≈ **0.00098 mm**. Late in the print, E is ~12,000, and a thin feature asks for E to grow by 0.002 mm per move: that rounds to 0.00195 or 0.00098, an error of up to ±50% per move. Early in the print, at E ≈ 50, the step is ~0.000004 mm and nothing is lost. It\'s about the size of the *absolute* number the firmware holds.'
						},
						{
							type: 'list',
							items: [
								'**Fix:** reset with `G92 E0` every layer (most slicers have the option) so E stays small, or use relative extrusion (`M83`), where each move\'s small E is represented accurately.',
								'**Why the "relative accumulates error" myth exists:** a *host* summing many rounded E values (5 decimals each) for an estimate does drift, but by micrometres over a whole print. Physically, relative extrusion is the precise option. Check claims against the [[floating-point]] arithmetic, not folklore.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Factory data',
			eyebrow: 'Part 3 · 30 minutes · telemetry, MES, quality',
			title: 'Factory data, quality & control',
			meta: '[[plc|PLC]] → [[opc-ua|OPC UA]] → [[edge-gateway|edge gateway]] → MQTT → historian / [[mes|MES]] / [[erp|ERP]]',
			minutes: 30,
			questions: [
				{
					id: 'p3q1',
					title: '"Press 7 has been running for three hours." It is dark.',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Tomasz Wrona',
								role: 'Plant manager',
								subject: 'Dashboard is lying to me',
								time: 'Thu 12:14',
								body: 'Walked past Press 7 at noon: lights off, nobody there, the PLC cabinet breaker had tripped at about 9:15. The andon dashboard in my office says RUNNING, green, since 09:14. How can I trust any of these screens?'
							}
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'broker log · mqtt-prod',
								lines: [
									{ ts: '09:12:03', source: 'broker', msg: 'New client connected from 10.4.7.21 as press-07 (c0, k30, will: none)' },
									{ ts: '09:14:40', source: 'broker', msg: 'Received PUBLISH from press-07 (d0, q1, r1, m412, \'plant/press-07/state\', ... (7 bytes))' },
									{ ts: '09:15:22', level: 'WARN', source: 'broker', msg: 'Client press-07 has exceeded timeout, disconnecting.' },
									{ ts: '11:58:09', source: 'broker', msg: 'New client connected from 10.4.1.5 as andon-office-3 (c1, k60)' },
									{ ts: '11:58:09', source: 'broker', msg: 'Sending PUBLISH to andon-office-3 (d0, q0, r1, m0, \'plant/press-07/state\', ... (7 bytes))' }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**A [[retained-message|retained]] "RUNNING" with no [[last-will-message|last will]].** At 09:14 the press published its state to the [[mqtt|MQTT]] broker with `r1` (retained). At 09:15 the broker noticed the press had vanished (keep-alive timeout) but had nothing to publish on its behalf: `will: none`. Every dashboard that connects later is handed the last retained value. The dashboard shows the last thing the machine said, with no staleness.'
						},
						{
							type: 'list',
							items: [
								'**Register a retained last will** at connect: `will topic = plant/press-07/state, payload = OFFLINE, retain = true`. The broker publishes it on timeout.',
								'**Publish the timestamp with the state** and have dashboards grey out anything older than 2× the expected interval. Staleness should be visible, not inferred.',
								'**Separate "connected" from "running":** a heartbeat topic per machine plus the PLC\'s own run signal. A dark cabinet can\'t say anything, so absence of heartbeat must render as UNKNOWN, never as the last good state.',
								'**Reply to the plant manager:** what happened, which screens could have shown the same (every retained-state tile), and when the fix lands. Trust in the [[andon|andon]] is a safety and productivity issue, not cosmetic.'
							]
						}
					]
				},
				{
					id: 'p3q2',
					title: 'The pressure spike that disappears when you zoom out',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Mara Lindqvist',
								role: 'Quality engineer',
								time: 'Fri 15:40',
								body: 'Third hydraulic hose burst on line 2 this month. Maintenance says pressure never goes above 125 bar on the dashboard, rated is 150. Either the hoses are bad or the dashboard is wrong.'
							}
						},
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'line 2 · hydraulics',
								panels: [
									{
										kind: 'timeseries',
										title: 'Pressure, 1 h view (1-minute rollup)',
										subtitle: 'avg_over_time(pressure_bar[1m])',
										span: 6,
										unit: ' bar',
										x: q16x,
										yMin: 0,
										yMax: 200,
										series: [{ name: 'avg', points: q16Avg }],
										thresholds: [{ value: 150, label: 'hose rating 150', tone: 'crit' }]
									},
									{
										kind: 'timeseries',
										title: 'Same signal, raw 500 ms samples, 14:31:10–14:31:29',
										span: 6,
										unit: ' bar',
										x: q16Zx,
										yMin: 0,
										yMax: 200,
										series: [{ name: 'raw', points: q16Raw }],
										thresholds: [{ value: 150, label: 'hose rating 150', tone: 'crit' }]
									}
								]
							}
						},
						{ type: 'p', text: 'The [[opc-ua]] subscription samples pressure every 500 ms. The valve that causes the spike closes in about 40 ms. What can and can\'t you conclude, and what would you change?' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: '[[downsampling|Averaging]] hides the spikes.',
									body: 'Four samples (2 s) at ~181 bar in a 1-minute window of 120 samples raise the average by only ~2 bar (the faint bumps at 14:31 and 14:44). The hour view will never show a 2-second event. Rollups for safety-relevant limits must keep **max** (and min) alongside the average.'
								},
								{
									title: 'Even the raw data under-states the peak.',
									body: 'A pressure transient from a 40 ms valve closure (water hammer) lasts tens of milliseconds. Sampling every 500 ms is far below the [[nyquist-rate]] for that event: you catch it only when a sample happens to land on it, and almost never at its true peak. 181 bar is a lower bound.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Measure at the edge:** have the PLC or edge device compute the peak per second at a high internal rate (kHz) and publish `max_1s`. Don\'t try to ship kHz telemetry to the cloud.',
								'**Fix the cause:** a slower valve closing ramp or an accumulator to absorb the transient. The hoses are probably fine; they\'re being asked to survive >180 bar repeatedly.',
								'**Dashboard hygiene:** label rollups (avg/max) in panel titles and default to max for anything with a physical limit.'
							]
						}
					]
				},
				{
					id: 'p3q3',
					title: 'Night shift had perfect availability (and nobody believes it)',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'ingest · plant-ostrava → cloud',
								range: '22:00 – 05:50',
								panels: [
									{
										kind: 'timeseries',
										title: 'Records ingested per 10 min',
										x: q17x,
										series: [{ name: 'records', points: q17Ingest }],
										markers: [
											{ at: 24, label: 'WAN down' },
											{ at: 42, label: 'WAN up' },
											{ at: 44, label: 'OEE job 05:20' }
										]
									},
									{
										kind: 'timeseries',
										title: 'Ingest lag (ingest_time − event_time)',
										unit: ' s',
										x: q17x,
										series: [{ name: 'p50 lag', points: q17Lag }]
									}
								]
							}
						},
						{
							type: 'list',
							items: [
								'Shift report (night, 22:00–06:00): Availability **99.1%**, Performance 81%, Quality 97%.',
								'Availability = 1 − (sum of downtime events in the shift ÷ planned time). Part counts come from the PLC\'s cumulative counter, read once at shift end.',
								'The edge gateway buffered during the [[wan]] outage (02:00–05:00) and stamps events with its own clock, which an [[ntp|NTP]] check later showed was **7 minutes fast**.'
							]
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The [[oee|OEE]] job ran before the backfill finished.',
									body: 'The gateway [[edge-gateway|stored and forwarded]] three hours of events; they were still arriving between 05:10 and 05:40 (the ingest burst and the ~3-hour lag). The job at 05:20 saw almost no downtime events for 02:00–05:00, so availability looked perfect. The part count comes from a counter read, which *was* complete, so performance absorbed the loss and fell to 81%. A shift report computed before its data closed is a [[late-arriving-data]] bug.',
									confirm: 'Re-run the job now: availability drops sharply, performance rises, OEE barely moves, exactly the signature of downtime misattributed.'
								},
								{
									title: 'Clock drift moves events across the shift boundary.',
									body: 'Events stamped 7 minutes fast push anything in the last 7 minutes of the night shift (05:53–06:00 real time) into the day shift. Small, but systematic, and every shift boundary is affected.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Compute on event time with a [[watermark]]:** finalise a shift only after the gateway reports it has flushed past the shift end (or a lateness bound has passed), and re-compute and *restate* if late data arrives later.',
								'**Store both timestamps** (event_time from the device, ingest_time from the cloud) and alert when lag exceeds minutes.',
								'**Time-sync the gateways** (NTP at minimum, PTP for sub-millisecond needs) and reject or flag events whose clock offset exceeds a bound.',
								'**Sanity rule:** availability and performance moving in opposite directions by similar amounts usually means downtime was missed or misclassified, not that the line got better.'
							]
						}
					]
				},
				{
					id: 'p3q4',
					title: 'OEE says 90%. Output has been flat for a year.',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'Line 4 · shift A · OEE (as reported)',
								panels: [
									{ kind: 'stat', title: 'OEE', value: '90.3%', tone: 'ok' },
									{ kind: 'stat', title: 'Availability', value: '96.9%' },
									{ kind: 'stat', title: 'Performance', value: '98.1%' },
									{ kind: 'stat', title: 'Quality', value: '95.0%' },
									{
										kind: 'table',
										title: 'Shift data',
										span: 6,
										head: ['Field', 'Value', 'Source'],
										rows: [
											['Planned production time', '480 min', 'schedule'],
											['Downtime (stops ≥ 5 min)', '15 min', 'MES downtime log'],
											['Micro-stops (< 5 min, not logged as downtime)', '45 min total', 'PLC idle bit'],
											['Cycle time used for Performance', '1.2 min/part', 'MES "standard"'],
											['Ideal cycle time (machine nameplate, validated)', '1.0 min/part', 'engineering'],
											['Total parts', '380', 'PLC counter'],
											['Good parts', '361', 'QC']
										]
									}
								]
							}
						},
						{ type: 'p', text: 'Recompute [[oee|OEE]] properly. Then say which definitional choice is responsible for the gap, and which one looks guilty but changes nothing in the headline number.' }
					],
					hints: ['There is a one-line audit: OEE = good count × ideal cycle time ÷ planned time.']
					,
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `As reported
  A = (480 − 15) / 480           = 0.969
  P = (1.2 × 380) / 465          = 0.981
  Q = 361 / 380                  = 0.950
  OEE                            = 0.903

Correct (all stops count, ideal cycle time)
  A = (480 − 15 − 45) / 480      = 0.875
  P = (1.0 × 380) / 420          = 0.905
  Q = 361 / 380                  = 0.950
  OEE                            = 0.752

Audit: 361 × 1.0 / 480           = 0.752 ✓`
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'The padded cycle time is the entire gap.',
									body: 'Using a "standard" of 1.2 min instead of the ideal 1.0 inflates Performance by exactly 1.2×, and 0.752 × 1.2 = 0.903. The standard was probably set years ago to make the line "hit 100%"; it hides 17% of real capacity loss.'
								},
								{
									title: 'Micro-stops look guilty, but only move loss between A and P.',
									body: 'Excluding 45 min of micro-stops raises Availability (0.875 → 0.969) and, because run time is now larger, lowers Performance (0.905 → 0.817 with the ideal cycle). A × P = ideal × count ÷ planned in both cases. They hide *where* the loss is, which matters for fixing it, but not *how much*.'
								}
							]
						},
						{
							type: 'p',
							text: 'Report the audit identity next to every OEE tile; if the three factors don\'t multiply to good × ideal ÷ planned, a definition is wrong. And show micro-stops explicitly (the [[mes|MES]] downtime log only records stops ≥ 5 min): 45 minutes a shift is the biggest single improvement target on this line.'
						}
					]
				},
				{
					id: 'p3q5',
					title: 'Every part is in spec. Quality wants to stop the line.',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'bore Ø · X̄–R chart (n = 5, every 30 min)',
								range: '06:00 – 17:30',
								panels: [
									{
										kind: 'timeseries',
										title: 'X̄ (subgroup mean)',
										span: 6,
										unit: ' mm',
										x: q19x,
										yMin: 9.94,
										yMax: 10.06,
										series: [{ name: 'x̄', points: q19Mean }],
										thresholds: [
											{ value: 10.05, label: 'USL 10.05', tone: 'crit' },
											{ value: 10.0087, label: 'UCL 10.0087', tone: 'warn' },
											{ value: 9.9918, label: 'LCL 9.9918', tone: 'warn' },
											{ value: 9.95, label: 'LSL 9.95', tone: 'crit' }
										]
									},
									{ kind: 'timeseries', title: 'R (subgroup range)', span: 6, unit: ' mm', x: q19x, yMin: 0, yMax: 0.05, series: [{ name: 'R', points: q19Range }] }
								]
							}
						},
						{
							type: 'p',
							text: 'Spec 10.00 ± 0.05 mm. Control limits were computed from the first 8 subgroups (mean 10.0003, σ of means 0.0028). Within-subgroup σ is about 0.010 mm. The production manager: "nothing is out of spec, so nothing is wrong". Who\'s right? Compute Cp and Cpk for the last 4 hours (mean ≈ 10.0185).'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Quality is right: in spec ≠ in control.** [[spc|SPC]] limits describe what this process does when nothing has changed; spec limits describe what the customer accepts. The [[western-electric-rules]] fire early:'
						},
						{
							type: 'list',
							items: [
								'**11:00** (subgroup 11): 2 of 3 consecutive points beyond 2σ (10.006, 10.007 > 10.0059).',
								'**11:30**: first point beyond the UCL (10.009 > 10.0087).',
								'**13:30**: 8 points in a row above the centre line.',
								'The R chart is flat: spread is unchanged, the **mean is moving**. That\'s a drift (tool wear, thermal growth, an offset), not more noise.'
							]
						},
						{
							type: 'code',
							lang: 'text',
							code: `Cp  = (USL − LSL) / 6σ        = 0.10 / 0.060     = 1.67   (would be fine if centred)
Cpk = (USL − mean) / 3σ       = 0.0315 / 0.030   = 1.05   (now marginal)

Cpk 1.05 → ~0.08% of parts beyond the upper limit. At this drift rate (~0.003 mm/hour,
10.000 at 10:00 → 10.022 at 17:30) the mean reaches the USL overnight.`
						},
						{
							type: 'p',
							text: '**Action:** don\'t stop blindly; find the assignable cause now (compensate the tool offset, check coolant temperature), because a cheap correction today prevents scrap tomorrow. [[process-capability|Cpk]] tells you how much room you have; the [[control-chart|control chart]] tells you you\'re using it up.'
						}
					]
				},
				{
					id: 'p3q6',
					title: 'A 20 Hz vibration that no part of the machine makes',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'spindle 3 · vibration (accelerometer, sampled at 100 Hz)',
								panels: [
									{ kind: 'timeseries', title: 'Acceleration, 500 ms window', unit: ' g', x: q20x, series: [{ name: 'accel', points: q20Samples }], span: 4 },
									{ kind: 'stat', title: 'Spindle motor', value: '7,200 rpm', span: 2 },
									{ kind: 'bars', title: 'Spectrum from these samples', x: q20Fx, series: [{ name: 'amplitude', points: q20Fft }], span: 6 }
								]
							}
						},
						{
							type: 'p',
							text: 'The predictive-maintenance model flags a strong 20 Hz component. Maintenance plans to replace the conveyor roller next to the spindle, which turns at about 19.5 Hz. Should they?'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Probably not: it\'s [[aliasing]].** 7,200 rpm = **120 Hz**. Sampling at 100 Hz is below the [[nyquist-rate]] (240 Hz) for that signal, and a 120 Hz vibration sampled at 100 Hz appears at |120 − 100| = **20 Hz**. The clean, perfectly regular waveform with a 5-sample period is the giveaway: the samples land 1.2 cycles apart, which looks like 0.2 cycles.'
						},
						{
							type: 'list',
							items: [
								'**Confirm:** change the sample rate (e.g. 90 Hz). An alias moves (to |120 − 90| = 30 Hz); a real 20 Hz source stays put. Or run the spindle at 6,000 rpm and watch the "20 Hz" peak move to 0 Hz.',
								'**Fix:** sample at ≥ 2.5× the highest frequency of interest (here ≥ 300 Hz, typically 1–5 kHz for bearings) with an analogue anti-aliasing filter before the [[adc|ADC]]; compute the spectrum at the edge and ship features (peak frequencies, [[rms|RMS]]), not raw samples.',
								'**The roller is the red herring:** its 19.5 Hz is a coincidence that makes the wrong diagnosis feel confirmed. Replacing it would "fix" nothing and teach the team that the model works.'
							]
						}
					]
				},
				{
					id: 'p3q7',
					title: 'The predictive-maintenance model is "95% accurate". Nobody answers its alarms.',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: '1,000 machines. About 1% develop a bearing fault in a given month. The model catches 95% of faulty machines and correctly clears 95% of healthy ones. Each alarm triggers a 2-hour inspection. Technicians have stopped responding. Quantify why, and propose something better than "make the model more accurate".'
						}
					],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `faulty:   10 machines × 0.95 caught          =  9.5 true alarms
healthy:  990 machines × 0.05 false alarms   = 49.5 false alarms
precision = 9.5 / (9.5 + 49.5)               = 16%
inspection load = 59 alarms × 2 h            = 118 h/month for ~9.5 real faults`
						},
						{
							type: 'p',
							text: 'Five of six alarms are false: the [[base-rate-fallacy]]. "95% accurate" sounds great until you remember faults are rare.'
						},
						{
							type: 'list',
							items: [
								'**Set the threshold by cost, not accuracy:** a missed bearing costs maybe 30 h of downtime, an inspection 2 h. Pick the operating point that minimises total cost; that may mean fewer, higher-confidence alarms.',
								'**Two-stage triage:** an alarm first triggers a cheap check (a 5-minute handheld vibration reading or an automatic high-rate capture), and only confirmed cases get the 2-hour inspection.',
								'**Report [[recall-precision|precision]] to technicians** and feed their findings back as labels. [[alarm-fatigue]] is a trust problem, and trust is rebuilt with numbers they can see.'
							]
						}
					]
				},
				{
					id: 'p3q8',
					title: 'Recall: which units contain resin lot R-1182?',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Mara Lindqvist',
								role: 'Quality engineer',
								subject: 'URGENT: supplier notice for resin lot R-1182',
								body: 'Supplier says lot R-1182 may be contaminated. I need every finished serial number that contains it by end of day for the regulator. The MES query returns 212 serials, but I know we blended R-1182 with two other lots in the dryer on the 3rd. Can I trust 212?'
							}
						},
						{
							type: 'table',
							head: ['lot_id', 'type', 'parent_lots', 'created_by'],
							rows: [
								['R-1182', 'resin', '—', 'receiving'],
								['R-1190', 'resin', '—', 'receiving'],
								['R-1195', 'resin', '—', 'receiving'],
								['B-0303', 'blend', '— (empty)', 'dryer station (manual entry)'],
								['M-5521', 'molded batch', 'R-1182', 'press-03'],
								['M-5530', 'molded batch', 'B-0303', 'press-05']
							],
							caption: 'MES lots table (excerpt). Serials link to molded batches.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**No: 212 is a lower bound.** The blend B-0303 was recorded with no parents, so the [[genealogy-traceability|genealogy graph]] has a broken edge: everything downstream of the blend (M-5530 and its serials) is invisible to a query that walks from R-1182. The query is fine; the data model allowed a lot to be created without its inputs.'
						},
						{
							type: 'code',
							lang: 'sql',
							caption: 'Forward trace, once the missing edges are restored from dryer logs.',
							code: `WITH RECURSIVE downstream AS (
  SELECT child_lot FROM lot_edges WHERE parent_lot = 'R-1182'
  UNION
  SELECT e.child_lot
  FROM lot_edges e JOIN downstream d ON e.parent_lot = d.child_lot
)
SELECT s.serial
FROM serials s JOIN downstream d ON s.batch_lot = d.child_lot;`
						},
						{
							type: 'list',
							items: [
								'**Today:** reconstruct B-0303\'s inputs from the dryer\'s load records and operator logs, re-run the trace, and report both numbers to the regulator with the method. If the blend\'s inputs can\'t be proven, include its whole downstream (conservative recall).',
								'**Data model:** lots are immutable nodes; every transformation (blend, split, rework) is an edge **with quantities**. Reject creating a derived lot without parents. Manual entry at a station is exactly where edges go missing.',
								'**Test the trace regularly:** pick a random lot each month and run a mock recall end to end, timing it. Regulators expect hours, not days.'
							]
						}
					]
				},
				{
					id: 'p3q9',
					title: 'Product wants a big red STOP button on the web dashboard',
					tag: 'design',
					minutes: 5,
					prompt: [
						{
							type: 'p',
							text: 'Request: "Supervisors should be able to stop any machine from the browser, and restart it once the issue is fixed." The dashboard talks to machines via the cloud → MQTT → [[edge-gateway|edge gateway]] → PLC. Design what you would build, and what you would refuse to build.'
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Refuse: the web button as a safety function.** An emergency stop is a [[safety-interlock]]: hard-wired, local, certified, with a guaranteed response time. A path through a browser, the internet, a broker and a gateway has none of those properties. Write that down so it doesn\'t come back as "just for emergencies".',
								'**Build: a "request controlled stop".** The PLC exposes a command the logic is designed to accept (finish the cycle, park the axes, then stop). The cloud only sends a request; the PLC decides. Requests carry an id, an expiry (a stop that arrives 10 minutes late must be discarded) and are acknowledged with the resulting machine state.',
								'**Restart is the dangerous one.** A remote start can move a machine while someone is inside it. Require local confirmation at the machine (a physical reset button), never remote-only.',
								'**Security:** strong auth and authorisation per machine, audit log of every command, network segmentation ([[iec-62443]] zones), and the gateway only accepts commands from an allow-listed service, never directly from browsers.',
								'**Failure modes:** if the network is down, the button must show "unavailable", not silently queue. And a supervisor seeing "STOP sent" must be able to tell it from "machine stopped".'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Labs',
			eyebrow: 'Part 4 · 20 minutes · interactive',
			title: 'Labs: run the floor',
			meta: 'simulated consoles · changes take time to roll out · the obvious lever is a trap',
			minutes: 20,
			questions: [
				{
					id: 'p4q1',
					title: 'Lab: 300 parts before the truck leaves',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'lab', lab: printFarm }],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Evidence: the printers are starved, not saturated.',
									body: 'Printer pool status says **Starved**; utilisation never reaches 100% because idle printers wait for G-code; the slicer queue holds ~270 jobs and slicer output is 0.5 jobs/min. The printers could do 40 ÷ 60 = 0.67 jobs/min. The slicer is the bottleneck: projected finish ~660 min against a 420 min deadline.'
								},
								{
									title: 'Trap 1: turn on hall B (80 printers).',
									body: 'Doubles printer cost, changes nothing: [[throughput|throughput]] is still capped by the slicer at 0.5 jobs/min, so the projected finish stays ~660 min. Utilisation halves.'
								},
								{
									title: 'Trap 2: scale the slicer to 6 workers.',
									body: '6 × 2.5 GB = 15 GB on an 8 GB node: [[oomkilled]], crash loop, slicer output drops to **zero**. The details pane says so ("worker exceeded node memory").'
								},
								{
									title: 'Fix: content-addressed slice cache, then add printers.',
									body: '60% of the queue is the same STL + profile, so caching lifts slicer output to 0.5 ÷ 0.4 = 1.25 jobs/min. Now the **printers** are the bottleneck: 40 printers finish 300 jobs in ~450 min, past the 420 min deadline. Turn on 20 more (60 ÷ 60 = 1 job/min) and the projected finish drops to ~340 min (about 5 h 40 m). Alternatively 3 slicer workers (7.5 GB fits) plus 60 printers also works; the cache is cheaper and helps every future order.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'This is the [[theory-of-constraints|theory of constraints]] in one screen: improve the bottleneck, then **look again**, because the bottleneck moves. Adding capacity anywhere else only adds cost.'
						}
					]
				},
				{
					id: 'p4q2',
					title: 'Lab: the broker is at 100% and alarms are at risk',
					tag: 'tricky',
					minutes: 10,
					prompt: [{ type: 'lab', lab: mqttOverload }],
					answerLabel: 'Show debrief',
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Evidence: message *count* doubled, not data volume.',
									body: '2,000 machines at a 0.5 s interval = 4,000 publishes/s; at [[mqtt-qos|QoS 1]] each costs a PUBLISH + PUBACK, so 8,000 work units/s against a 6,000-unit broker. Gateway buffers climb; once full, readings and over-temperature alarms are dropped.'
								},
								{
									title: 'Trap: raise QoS to 2 "so nothing gets lost".',
									body: 'QoS 2 is a four-packet handshake: 16,000 work units/s. The broker falls further behind, buffers fill faster, and alarms are lost sooner. Guarantees don\'t create capacity.'
								},
								{
									title: 'Trap: resize the broker.',
									body: 'The broker is a single instance with non-replicated sessions: resizing reboots it for ~90 s, during which every gateway buffers with nowhere to send, and then 40 gateways reconnect at once (a [[connection-storm|reconnect storm]] at 3× load). The buffers overflow during the window.'
								},
								{
									title: 'Trap: QoS 0.',
									body: 'Halves broker work, but with no acknowledgement, alarms published during routine WAN blips vanish silently. Fine for telemetry, wrong for alarms.'
								},
								{
									title: 'Fix: batch 20 readings per message.',
									body: '4,000 ÷ 20 = 200 publishes/s × 2 = 400 units: broker at ~7%, buffers drain, and you keep the 0.5 s resolution the data scientist asked for, because each reading keeps its own timestamp. Restoring the 1 s interval also works but gives up the resolution.'
								}
							]
						},
						{
							type: 'p',
							text: '**Afterwards:** split topics so alarms use QoS 1 on their own low-rate topic and telemetry uses QoS 0 batches; replicate the broker (a cluster or HA pair) so maintenance isn\'t an outage; and put a capacity check (machines × rate × QoS cost) in the gateway config review.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · G-code analyzer',
			eyebrow: 'Part 5 · 55 minutes · coding',
			title: 'G-code analyzer: filament, time, bounding box',
			meta: 'modal state · units · absolute/relative · trapezoidal timing',
			minutes: 55,
			intro: [
				{
					type: 'code',
					lang: 'python',
					caption: '**Task:** implement `analyze`. Return net filament length (mm), estimated time (s), and the bounding box of *extruding* moves.',
					code: `def analyze(gcode: str, accel: float = 1000.0) -> Result: ...

Result = (filament_mm: float, time_s: float,
          bbox: (min_x, min_y, min_z, max_x, max_y, max_z) | None)

Commands to support (everything else is ignored; ';' starts a comment):
  G0 / G1 X Y Z E F   linear move; F is feedrate in units/MINUTE and is modal
  G20 / G21           inches / millimetres (applies to X Y Z E F)
  G90 / G91           absolute / relative positioning (also switches E mode)
  M82 / M83           absolute / relative extrusion only
  G92 X Y Z E         set current position without moving`
				},
				{
					type: 'callout',
					tone: 'warn',
					title: 'Assumptions to state in a comment before coding',
					text: 'Each move starts and ends at rest (no look-ahead between moves: a conservative upper bound). E-only moves (retract/unretract) take time at the current feedrate over |ΔE|. Filament is **net** (a retract followed by an unretract cancels). The bounding box only includes moves that extrude (ΔE > 0 and the head moves), so travel moves don\'t inflate it. Machine starts at X0 Y0 Z0 E0 in mm, absolute mode, feedrate 0 until set.'
				}
			],
			questions: [
				{
					id: 'p5q1',
					title: 'Warm-up: compute by hand',
					tag: 'core',
					minutes: 8,
					prompt: [
						{ type: 'p', text: 'Acceleration 1000 mm/s². For each snippet, compute filament (mm), time (s) and bounding box.' },
						{
							type: 'code',
							lang: 'text',
							code: `(a) G21 / G90 / M82 / G1 F6000 / G1 X100 E5
(b) G1 F6000 / G1 X4
(c) M82 / G1 F1800 / G1 X10 E5 / G1 E3 / G1 E5 / G1 X20 E7
(d) G91 / M83 / G1 F600 / G1 X10 E1 (×3)
(e) G20 / G1 F60 / G1 X1 E0.1
(f) M82 / G1 F600 X10 E10 / G92 E0 / G1 X20 E4
(g) M82 / G90 / G1 F6000 X50 / G1 X60 Y0 E2 / G1 X60 Y10 E4`
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Case', 'Filament', 'Time', 'BBox (x, y)', 'Why'],
							numeric: [1, 2],
							rows: [
								['a', '5.00', '1.100', '0–100, 0', '100 mm/s, accel over 5 mm each end: 0.2 s + 90 mm cruise 0.9 s'],
								['b', '0.00', '0.126', 'none', 'Travel only; triangle profile: peak √(1000·4) = 63 mm/s'],
								['c', '**7.00**', '0.920', '0–20, 0', 'Retract 2 + unretract 2 cancel; summing only positive ΔE gives 9'],
								['d', '3.00', '3.030', '0–30, 0', 'Relative XYZ and E: each line adds'],
								['e', '2.54', '1.025', '0–25.4, 0', 'Inches: X1 = 25.4 mm, E0.1 = 2.54 mm, F60 in/min = 25.4 mm/s'],
								['f', '**14.00**', '2.020', '0–20, 0', '`G92 E0` resets the origin: 10 + 4, not 4'],
								['g', '4.00', '1.000', '**50–60, 0–10**', 'The travel to X50 is excluded from the box']
							]
						},
						{
							type: 'p',
							text: 'Check (b) by hand: d_accel = 100²/2000 = 5 mm, but the move is only 4 mm, so it never cruises. Peak = √(a·L) = √4000 = 63.2 mm/s; time = 2 × 63.2 / 1000 = 0.126 s, vs naive 4/100 = 0.04 s.'
						}
					]
				},
				{
					id: 'p5q2',
					title: 'Reference solution (Python)',
					tag: 'coding',
					answerLabel: 'Show solution',
					prompt: [{ type: 'p', text: 'Write yours against the timer first. This version reproduces every row of the warm-up table.' }],
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `import math
from dataclasses import dataclass

MM_PER_INCH = 25.4

@dataclass
class Result:
    filament_mm: float
    time_s: float
    bbox: tuple | None   # (min_x, min_y, min_z, max_x, max_y, max_z), extruding moves only


def move_time(distance: float, feed_mm_s: float, accel: float) -> float:
    """Trapezoidal profile, starting and ending at rest."""
    if distance <= 0 or feed_mm_s <= 0:
        return 0.0
    d_accel = feed_mm_s ** 2 / (2 * accel)
    if 2 * d_accel >= distance:                 # never reaches feed: triangle
        return 2 * math.sqrt(accel * distance) / accel
    return 2 * feed_mm_s / accel + (distance - 2 * d_accel) / feed_mm_s


def parse_words(line: str) -> dict[str, float]:
    code = line.split(";", 1)[0].strip()
    return {tok[0].upper(): float(tok[1:] or 0) for tok in code.split()} if code else {}


def analyze(gcode: str, accel: float = 1000.0) -> Result:
    pos = {"X": 0.0, "Y": 0.0, "Z": 0.0, "E": 0.0}
    abs_xyz, abs_e = True, True
    scale = 1.0          # 25.4 after G20
    feed = 0.0           # mm/s, modal
    filament = time_s = 0.0
    lo, hi = [math.inf] * 3, [-math.inf] * 3

    for raw in gcode.splitlines():
        w = parse_words(raw)
        if "G" in w:
            g = int(w["G"])
            if g == 20:   scale = MM_PER_INCH
            elif g == 21: scale = 1.0
            elif g == 90: abs_xyz = abs_e = True
            elif g == 91: abs_xyz = abs_e = False
            elif g == 92:
                for a in "XYZE":
                    if a in w:
                        pos[a] = w[a] * scale
            elif g in (0, 1):
                if "F" in w:
                    feed = w["F"] * scale / 60.0          # per minute → per second
                new = dict(pos)
                for a in "XYZ":
                    if a in w:
                        v = w[a] * scale
                        new[a] = v if abs_xyz else pos[a] + v
                if "E" in w:
                    v = w["E"] * scale
                    new["E"] = v if abs_e else pos["E"] + v
                de = new["E"] - pos["E"]
                dist = math.dist([pos[a] for a in "XYZ"], [new[a] for a in "XYZ"])
                time_s += move_time(dist if dist > 0 else abs(de), feed, accel)
                filament += de                            # net: retracts cancel
                if de > 0 and dist > 0:
                    for i, a in enumerate("XYZ"):
                        lo[i] = min(lo[i], pos[a], new[a])
                        hi[i] = max(hi[i], pos[a], new[a])
                pos = new
        elif "M" in w:
            m = int(w["M"])
            if m == 82:   abs_e = True
            elif m == 83: abs_e = False

    bbox = None if lo[0] == math.inf else (*lo, *hi)
    return Result(filament, time_s, bbox)`
						},
						{
							type: 'p',
							text: '**Design notes worth saying out loud:** modal state lives in a few variables and every command updates them explicitly; unit scaling happens once at parse time so the rest of the code is in mm; `move_time` is a pure function you can test in isolation. O(lines) time, O(1) memory, so it streams 500 MB files.'
						}
					]
				},
				{
					id: 'p5q3',
					title: 'Reference solution (TypeScript)',
					tag: 'coding',
					answerLabel: 'Show solution',
					prompt: [],
					answer: [
						{
							type: 'code',
							lang: 'typescript',
							code: `const MM_PER_INCH = 25.4;

export interface Result {
  filamentMm: number;
  timeS: number;
  bbox: [number, number, number, number, number, number] | null; // extruding moves only
}

export function moveTime(distance: number, feedMmS: number, accel: number): number {
  if (distance <= 0 || feedMmS <= 0) return 0;
  const dAccel = (feedMmS * feedMmS) / (2 * accel);
  if (2 * dAccel >= distance) return (2 * Math.sqrt(accel * distance)) / accel; // triangle
  return (2 * feedMmS) / accel + (distance - 2 * dAccel) / feedMmS;
}

function parseWords(line: string): Map<string, number> {
  const words = new Map<string, number>();
  const code = line.split(";", 1)[0].trim();
  if (!code) return words;
  for (const tok of code.split(/\\s+/)) words.set(tok[0].toUpperCase(), tok.length > 1 ? Number(tok.slice(1)) : 0);
  return words;
}

export function analyze(gcode: string, accel = 1000): Result {
  let pos = { X: 0, Y: 0, Z: 0, E: 0 };
  let absXyz = true, absE = true, scale = 1, feed = 0, filament = 0, time = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const axes = ["X", "Y", "Z"] as const;

  for (const raw of gcode.split("\\n")) {
    const w = parseWords(raw);
    if (w.has("G")) {
      const g = Math.trunc(w.get("G")!);
      if (g === 20) scale = MM_PER_INCH;
      else if (g === 21) scale = 1;
      else if (g === 90) { absXyz = true; absE = true; }
      else if (g === 91) { absXyz = false; absE = false; }
      else if (g === 92) { for (const a of ["X", "Y", "Z", "E"] as const) if (w.has(a)) pos[a] = w.get(a)! * scale; }
      else if (g === 0 || g === 1) {
        if (w.has("F")) feed = (w.get("F")! * scale) / 60; // F is per minute
        const next = { ...pos };
        for (const a of axes) if (w.has(a)) { const v = w.get(a)! * scale; next[a] = absXyz ? v : pos[a] + v; }
        if (w.has("E")) { const v = w.get("E")! * scale; next.E = absE ? v : pos.E + v; }
        const de = next.E - pos.E;
        const dist = Math.hypot(next.X - pos.X, next.Y - pos.Y, next.Z - pos.Z);
        time += moveTime(dist === 0 ? Math.abs(de) : dist, feed, accel);
        filament += de; // net: retract (−) and unretract (+) cancel
        if (de > 0 && dist > 0)
          axes.forEach((a, i) => { lo[i] = Math.min(lo[i], pos[a], next[a]); hi[i] = Math.max(hi[i], pos[a], next[a]); });
        pos = next;
      }
    } else if (w.has("M")) {
      const m = Math.trunc(w.get("M")!);
      if (m === 82) absE = true;
      else if (m === 83) absE = false;
    }
  }
  return { filamentMm: filament, timeS: time, bbox: lo[0] === Infinity ? null : [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]] };
}`
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'JS traps: `Number("")` is 0 but `Number("X")` is NaN, so validate tokens in production; `split("\\n")` leaves `\\r` on Windows files (trim each line); float equality on positions is fine here because we only compare to sentinels.'
						}
					]
				},
				{
					id: 'p5q4',
					title: 'Write the extra test cases',
					tag: 'coding',
					answerLabel: 'Show test list',
					prompt: [{ type: 'p', text: 'List at least ten edge cases before peeking. Think modal state, units and the things a real slicer emits.' }],
					answer: [
						{
							type: 'code',
							lang: 'python',
							code: `import math
import pytest

approx = lambda x: pytest.approx(x, abs=1e-4)

@pytest.mark.parametrize("src, filament, time_s", [
    ("G21\\nG90\\nM82\\nG1 F6000\\nG1 X100 E5", 5.0, 1.1),              # trapezoid
    ("G1 F6000\\nG1 X4", 0.0, 0.1265),                                  # triangle, travel
    ("M82\\nG1 F1800\\nG1 X10 E5\\nG1 E3\\nG1 E5\\nG1 X20 E7", 7.0, 0.92),  # net retract
    ("G91\\nM83\\nG1 F600\\nG1 X10 E1\\nG1 X10 E1\\nG1 X10 E1", 3.0, 3.03),# relative
    ("G20\\nG1 F60\\nG1 X1 E0.1", 2.54, 1.0254),                        # inches incl. E and F
    ("M82\\nG1 F600 X10 E10\\nG92 E0\\nG1 X20 E4", 14.0, 2.02),          # G92 reset
])
def test_table(src, filament, time_s):
    r = analyze(src)
    assert r.filament_mm == approx(filament)
    assert r.time_s == approx(time_s)

def test_bbox_ignores_travel():
    r = analyze("M82\\nG90\\nG1 F6000 X50\\nG1 X60 Y0 E2\\nG1 X60 Y10 E4")
    assert r.bbox == (50, 0, 0, 60, 10, 0)

def test_no_extrusion_no_bbox():
    assert analyze("G1 F3000 X10 Y10").bbox is None

def test_comments_and_blank_lines():
    assert analyze("; header\\n\\nG1 F600 X10 E1 ; first line\\n").filament_mm == approx(1)

def test_feedrate_is_modal():
    assert analyze("G1 F6000 X100\\nG1 X200").time_s == approx(2.2)

def test_feedrate_zero_means_no_time_not_crash():
    assert analyze("G1 X10").time_s == 0

def test_m83_after_g90_keeps_relative_e():
    r = analyze("G90\\nM83\\nG1 F600 X10 E1\\nG1 X20 E1")
    assert r.filament_mm == approx(2)

def test_g91_switches_e_to_relative_too():
    assert analyze("G91\\nG1 F600 X10 E1\\nG1 X10 E1").filament_mm == approx(2)

def test_units_switch_mid_file():
    r = analyze("G21\\nG1 F600 X10 E1\\nG20\\nG1 X1 E0.1")   # absolute: X1 in = 25.4 mm
    assert r.bbox[3] == approx(25.4)
    assert r.filament_mm == approx(2.54)

def test_z_moves_count_in_distance():
    assert analyze("G1 F600 Z10").time_s == approx(1.01)

def test_lowercase_and_extra_spaces():
    assert analyze("g1  f600   x10   e1").filament_mm == approx(1)`
						},
						{
							type: 'p',
							text: 'Also mention, even if not implemented: arcs (`G2`/`G3`) are common in modern files; firmware retraction (`G10`/`G11`) hides filament from E; `M220`/`M221` speed and flow overrides; tool changes (`T0`/`T1`) with separate E counters; checksummed lines (`N12 G1 … *34`) should be stripped before parsing.'
						}
					]
				},
				{
					id: 'p5q5',
					title: 'Why does this naive version get three warm-up rows wrong?',
					tag: 'tricky',
					prompt: [
						{
							type: 'code',
							lang: 'python',
							code: `def naive(gcode):
    filament = time = 0
    x = e = 0
    for line in gcode.splitlines():
        w = parse_words(line)
        if w.get("G") == 1:
            if "E" in w and w["E"] > e:
                filament += w["E"] - e
            if "X" in w:
                time += abs(w["X"] - x) / w.get("F", 1)
                x = w["X"]
            e = w.get("E", e)
    return filament, time`
						}
					],
					answer: [
						{
							type: 'list',
							items: [
								'**(c) Only positive ΔE counted:** the unretract after a retract is counted again → 9 instead of 7. Retracts are free filament round-trips.',
								'**(f) `G92` ignored:** after `G92 E0` the next E4 looks like a *decrease* from 10, so it\'s dropped → 10 instead of 14.',
								'**Time is wrong everywhere:** F is in mm/**minute** (divide by 60), it is modal (missing F here falls back to 1), there\'s no acceleration, and only X counts as distance. (e) fails three ways: inches, per-minute F, and E scaled by 25.4.',
								'Lesson: G-code is a **state machine**, not a list of independent lines. Most bugs come from forgetting a piece of modal state.'
							]
						}
					]
				},
				{
					id: 'p5q6',
					title: 'Variant: report grams and cost per material',
					tag: 'variant',
					prompt: [
						{
							type: 'p',
							text: 'Finance wants grams and cost per job. The analyzer gets a material table: PLA 1.75 mm, 1.24 g/cm³, $22/kg; PETG 1.75 mm, 1.27 g/cm³, $25/kg; PA-CF 2.85 mm, 1.15 g/cm³, $90/kg. What do you add, and what is 10 m of each?'
						}
					],
					answer: [
						{
							type: 'table',
							head: ['10 m of', 'Volume', 'Grams', 'Cost'],
							numeric: [1, 2, 3],
							rows: [
								['PLA 1.75', '24.05 cm³', '29.8 g', '$0.66'],
								['PETG 1.75', '24.05 cm³', '30.5 g', '$0.76'],
								['PA-CF 2.85', '63.79 cm³', '73.4 g', '$6.60']
							]
						},
						{
							type: 'p',
							text: '`grams = π(d/2)² × filament_mm ÷ 1000 × density`. Keep it out of `analyze` (which stays geometry-only) in a separate `cost(result, material)` function; carry the diameter from the material, never a global 1.75; and compute money in integer cents with one rounding at the end, the same discipline as any billing code.'
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'teasers',
			nav: 'Teasers',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Numeric traps',
			meta: 'do the arithmetic before you open',
			questions: [
				{
					id: 't1',
					title: 'Grams per metre',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'How many grams in 1 m of 1.75 mm PLA? Of 2.85 mm PLA? (density 1.24 g/cm³)' }],
					answer: [
						{
							type: 'p',
							text: '1.75: 2.405 mm² × 1000 mm = 2405 mm³ = 2.405 cm³ → **2.98 g**. 2.85: 6.379 cm³ → **7.91 g**, 2.65× more per metre because area goes with d². A cost model that stores "grams per metre" globally is wrong for half the printers.'
						}
					]
				},
				{
					id: 't2',
					title: 'Rolled throughput yield',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A part passes 30 process steps, each 99% good. What fraction comes out right first time?' }],
					answer: [{ type: 'p', text: '0.99³⁰ = **74%**. "99% everywhere" loses a quarter of parts. Yield multiplies, which is why one bad step dominates and why OEE multiplies three ratios.' }]
				},
				{
					id: 't3',
					title: 'Cpk to defects',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Roughly how many parts per million fall outside the nearer limit at Cpk 1.00? At 1.33?' }],
					answer: [
						{
							type: 'p',
							text: 'Cpk 1.00 = 3σ to the limit → **~1,350 ppm** (0.135%). Cpk 1.33 = 4σ → **~32 ppm**. A 33% better index is a 40× difference in defects, which is why automotive asks for 1.33 and not "about 1".'
						}
					]
				},
				{
					id: 't4',
					title: 'Mains hum, sampled',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A sensor picks up 50 Hz mains interference and is sampled at 60 Hz. What frequency do you see?' }],
					answer: [{ type: 'p', text: '|50 − 60| = **10 Hz**. Same sensor in a 60 Hz country sampled at 60 Hz shows 0 Hz: a constant offset you\'d never suspect. [[aliasing]] can hide signals, not just invent them.' }]
				},
				{
					id: 't5',
					title: 'Fleet MTBF',
					tag: 'teaser',
					prompt: [{ type: 'p', text: '200 printers, each with a mean time between failures of 2,000 hours. How often does *some* printer fail?' }],
					answer: [
						{
							type: 'p',
							text: '2,000 ÷ 200 = **every 10 hours**, about twice per day shift. Fleet operations need a failure process (spares, triage, auto-rescheduling), not heroics. Same arithmetic as [[fan-out]] tail latency.'
						}
					]
				},
				{
					id: 't6',
					title: 'Layers that don\'t divide',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A 120 mm part at 0.28 mm layers. How many layers, and how tall is the print?' }],
					answer: [
						{
							type: 'p',
							text: '120 ÷ 0.28 = 428.57. The slicer prints **429** layers (120.12 mm) or 428 (119.84 mm) depending on its rounding, and the first layer is often different (0.2 mm) anyway. For tight Z dimensions, pick a layer height that divides the feature heights, or use variable layer height.'
						}
					]
				},
				{
					id: 't7',
					title: 'Little\'s law on the factory floor',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A cell holds 120 parts in progress and ships 20 parts/hour. A customer asks how long an order takes. Without timing any part, answer.' }],
					answer: [
						{
							type: 'p',
							text: 'Lead time = [[wip|WIP]] ÷ throughput = 120 ÷ 20 = **6 hours** ([[littles-law]]). Want 2-hour lead times at the same throughput? Cut WIP to 40. Adding machines doesn\'t shorten lead time if WIP grows to fill them.'
						}
					]
				},
				{
					id: 't8',
					title: 'The checksum',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'What is the [[serial-line-checksum|checksum]] for the line `N1 G28`, and why is XOR a weak choice?' }],
					answer: [
						{
							type: 'p',
							text: 'XOR of the bytes of `N1 G28` = **18**, so the wire line is `N1 G28*18`. XOR is order-blind and misses any two flips of the same bit position: swapped characters (`G1 X12` vs `G1 X21`) give the same checksum. It catches line noise, not systematic corruption; that\'s why line numbers + resend exist alongside it, and why binary protocols use CRCs.'
						}
					]
				}
			]
		}
	]
};

export default a13;
