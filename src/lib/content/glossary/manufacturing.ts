import type { GlossaryTerm } from '../types';
import { timeAxis } from '../series';

const spcX = timeAxis('06:00', 30, 20);
const spcMean = [
	10.012, 10.019, 10.008, 10.015, 10.021, 10.011, 10.017, 10.014, 10.009, 10.018, 10.022, 10.025, 10.027, 10.026, 10.029, 10.031,
	10.03, 10.033, 10.034, 10.032, 10.036, 10.035, 10.038, 10.037, 10.039, 10.04, 10.041, 10.04, 10.043, 10.042
];

const terms: GlossaryTerm[] = [
	{
		id: 'g-code',
		term: 'G-code',
		aliases: ['gcode', 'RS-274'],
		category: 'manufacturing',
		short:
			'The line-by-line instruction language machine tools and 3D printers execute: `G1 X10 Y5 E0.4 F1800` means "move in a straight line to X10 Y5, pushing 0.4 mm of filament, at 1800 mm/min". Most commands are **modal**: units (`G20`/`G21`), absolute vs relative positioning (`G90`/`G91`) and the feedrate stick until changed, so a single line means nothing without the state before it.',
		analogy: 'Turn-by-turn driving directions where "keep going at the same speed" is implied unless a line says otherwise.',
		related: ['slicer', 'extrusion-math', 'serial-line-checksum']
	},
	{
		id: 'slicer',
		term: 'Slicer',
		category: 'manufacturing',
		short:
			'Software that turns a 3D model (STL/3MF) into G-code: it cuts the mesh into layers, plans perimeters and infill, and computes how much filament each move needs. Slicing is CPU- and memory-heavy (seconds to many minutes per job), so in a print farm it is often the real bottleneck, not the printers.',
		related: ['g-code', 'stl-mesh', 'extrusion-math']
	},
	{
		id: 'extrusion-math',
		term: 'Extrusion math',
		aliases: ['E value', 'extrusion multiplier', 'flow rate'],
		category: 'manufacturing',
		short:
			'Converting a printed line into filament length: **E = line volume ÷ filament cross-section**. A 100 mm line, 0.45 mm wide, 0.2 mm tall is ~8.1–9.0 mm³; 1.75 mm filament has a 2.405 mm² cross-section, so E ≈ 3.4–3.7 mm. The range comes from whether you model the line as a rectangle or as a rounded "stadium", and that 10% choice shows up as over- or under-extrusion.',
		related: ['volumetric-flow', 'g-code', 'slicer'],
		page: [
			{ type: 'heading', text: 'The formula' },
			{
				type: 'code',
				lang: 'text',
				code: `filament area   A_f = π · (d/2)²            1.75 mm → 2.4053 mm²
line volume     V   = A_line · length
E (mm filament) E   = V / A_f

rectangle model  A_line = w · h                 0.45 × 0.20 = 0.0900 mm²
stadium model    A_line = (w − h)·h + π·(h/2)²  0.25·0.20 + π·0.01 = 0.0814 mm²`
			},
			{
				type: 'table',
				head: ['100 mm line, w 0.45, h 0.20', 'Volume', 'E (1.75 mm)'],
				numeric: [1, 2],
				rows: [
					['Rectangle', '9.000 mm³', '3.742 mm'],
					['Stadium (rounded sides)', '8.142 mm³', '3.385 mm']
				],
				caption: 'Same line, two models, 10.5% apart. Mixing a slicer that uses one with a calibration guide that assumes the other gives "mysterious" over-extrusion.'
			},
			{ type: 'heading', text: 'How to spot errors' },
			{
				type: 'list',
				items: [
					'**Every part is ~2.3% too much material on 2.85 mm printers:** someone hard-coded 1.75 mm in a cost estimator. Area scales with d², so (2.85/1.75)² = 2.65× per mm of filament.',
					'**Grams from length:** `mass = A_f × E × density`. 1 m of 1.75 mm PLA (1.24 g/cm³) ≈ 2.98 g. Off by 1000? Someone mixed mm³ and cm³.',
					'**Relative vs absolute E** (`M83` / `M82`): the same E number means "push 0.4 mm more" or "be at 0.4 mm total". Read it wrong and you either double-extrude or barely extrude.'
				]
			}
		]
	},
	{
		id: 'volumetric-flow',
		term: 'Volumetric flow limit',
		aliases: ['max volumetric speed', 'mm³/s'],
		category: 'manufacturing',
		short:
			'A hotend can only melt so much plastic per second (typically 10–25 mm³/s). Speed × line width × layer height must stay under it. At 15 mm³/s a 0.45 × 0.2 mm line maxes out at 167 mm/s; a 0.65 × 0.3 mm line at 77 mm/s. Ask for more and the printer silently under-extrudes: the motion is fast but the plastic is not there.',
		analogy: 'A kettle that boils 1 litre a minute: pouring faster just gives you cold water.',
		related: ['extrusion-math', 'trapezoidal-motion-profile', 'throughput']
	},
	{
		id: 'trapezoidal-motion-profile',
		term: 'Trapezoidal motion profile',
		aliases: ['acceleration planning', 'jerk', 'junction deviation'],
		category: 'manufacturing',
		short:
			'Real axes can\'t jump to full speed: they accelerate, cruise, then decelerate, so a speed-vs-time plot is a trapezoid (or a triangle if the move is too short to reach cruise speed). Print-time estimates that just divide distance by feedrate ignore this and are badly wrong on short moves: 10 mm at 200 mm/s with 2000 mm/s² takes 0.141 s, not 0.05 s.',
		related: ['g-code', 'volumetric-flow'],
		page: [
			{ type: 'heading', text: 'The three phases' },
			{
				type: 'code',
				lang: 'text',
				code: `accel distance  d_a = v² / (2a)
if 2·d_a < L:   t = 2·v/a + (L − 2·d_a)/v        (trapezoid)
else:           v_peak = √(a·L);  t = 2·v_peak/a  (triangle, never reaches v)`
			},
			{
				type: 'table',
				head: ['Move', 'Naive L/v', 'Trapezoid', 'Error'],
				numeric: [1, 2, 3],
				rows: [
					['200 mm @ 200 mm/s, a = 2000', '1.000 s', '1.100 s', '+10%'],
					['10 mm @ 200 mm/s, a = 2000', '0.050 s', '0.141 s', '+183%'],
					['0.5 mm curve segment @ 200 mm/s', '0.0025 s', '0.032 s', '+1165%']
				],
				caption: 'Curved surfaces are thousands of tiny segments, so naive estimates are worst exactly on organic parts.'
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'Why real firmware is faster than this model',
				text: 'Firmware does not stop at every corner: a **look-ahead planner** carries speed through gentle junctions (jerk / junction deviation). So the honest estimate sits between "naive" and "stop at every segment". Production estimators simulate the firmware planner; anything simpler should state its assumption.'
			}
		]
	},
	{
		id: 'microstepping',
		term: 'Microstepping & Z quantization',
		category: 'manufacturing',
		short:
			'Stepper motors move in fixed steps (usually 200 per revolution). Drivers subdivide them into microsteps for smoothness, but only full steps are positionally reliable under load. With an 8 mm-lead screw, one full step is 0.04 mm, so layer heights that are not multiples of 0.04 (like 0.1 mm) alternate between 0.08 and 0.12 mm, which shows up as regular banding.',
		related: ['g-code']
	},
	{
		id: 'stl-mesh',
		term: 'STL mesh',
		category: 'manufacturing',
		short:
			'The most common 3D-print file format: just a soup of triangles, each with three corners and an outward-facing normal. There are no units (a 10 could be mm or inches), no curves (a circle is a polygon), and nothing guarantees the triangles form a closed solid.',
		related: ['manifold-mesh', 'slicer', 'tolerance-stack-up']
	},
	{
		id: 'manifold-mesh',
		term: 'Manifold (watertight) mesh',
		category: 'manufacturing',
		short:
			'A mesh where every edge is shared by exactly two triangles, so it encloses a real volume with a clear inside and outside. Holes, flipped normals or self-intersections make it non-manifold, and the slicer has to guess what is solid: missing walls, filled holes, or layers that vanish.',
		related: ['stl-mesh', 'slicer']
	},
	{
		id: 'tolerance-stack-up',
		term: 'Tolerance stack-up',
		aliases: ['RSS tolerance', 'worst-case tolerance'],
		category: 'manufacturing',
		short:
			'When parts are assembled, their size errors add up. **Worst case** adds the tolerances directly: five parts at ±0.1 mm give ±0.5 mm. **Root-sum-square (RSS)** assumes independent random errors and gives √(5 × 0.1²) = ±0.22 mm. RSS is realistic for many parts, but it under-protects when errors share a cause (same printer, same thermal drift).',
		related: ['thermal-shrinkage', 'process-capability']
	},
	{
		id: 'thermal-shrinkage',
		term: 'Thermal shrinkage',
		category: 'manufacturing',
		short:
			'Plastic shrinks as it cools (PLA ~0.3%, ABS ~0.7%, nylon >1%), so parts come out slightly small. Compensation scales the model up by 1/(1 − s). Holes shrink *more* than outer walls, because the inner perimeter is pulled inward and the STL already approximates the circle with an inscribed polygon.',
		related: ['tolerance-stack-up', 'stl-mesh']
	},
	{
		id: 'serial-line-checksum',
		term: 'G-code line numbers & checksums',
		aliases: ['N-line', 'M110', 'Resend'],
		category: 'manufacturing',
		short:
			'When a host streams G-code over serial/USB, each line carries a number and an XOR checksum (`N124 G1 X12 E0.84*61`). If the printer sees a corrupted or skipped line, it replies `Resend: 124` and the host must resend from exactly that line. `M110 N0` resets the counter. Getting resend wrong duplicates or drops moves, which matters a lot with relative coordinates.',
		related: ['g-code', 'at-least-once', 'idempotency']
	},
	{
		id: 'planner-buffer-underrun',
		term: 'Planner buffer underrun',
		category: 'manufacturing',
		short:
			'The printer\'s firmware keeps a short queue of upcoming moves. If the host cannot feed lines fast enough (115200 baud ≈ 11.5 kB/s ≈ 380 lines/s of 30 bytes), the queue drains, the head stops mid-surface and oozes plastic: blobs and zits on curved parts made of many tiny segments.',
		related: ['serial-line-checksum', 'throughput', 'backpressure']
	},
	{
		id: 'bin-packing',
		term: 'Bin packing',
		category: 'manufacturing',
		short:
			'Fitting items of different sizes into as few fixed-size containers as possible (here: parts onto build plates). It is NP-hard, so schedulers use heuristics like first-fit-decreasing. The trap is optimising plate *area* when the real constraint is something else: build height, a shared material, or the fact that one failed part ruins the whole plate.',
		related: ['throughput']
	},
	{
		id: 'opc-ua',
		term: 'OPC UA',
		category: 'manufacturing',
		short:
			'The standard industrial protocol for reading machine data from PLCs and controllers: a typed, browsable tree of nodes (temperatures, counters, states) with subscriptions that push changes. Subscriptions sample and publish at configured intervals, so a fast spike between samples is simply never seen.',
		related: ['plc', 'mqtt-qos', 'nyquist-rate']
	},
	{
		id: 'plc',
		term: 'PLC (programmable logic controller)',
		category: 'manufacturing',
		short:
			'A rugged industrial computer that runs a machine\'s real-time control loop (read sensors, decide, drive actuators) in a fixed millisecond cycle. Business software reads from it and sends setpoints to it; it never sits inside its loop. Safety functions run on dedicated safety PLCs or hard-wired circuits.',
		related: ['safety-interlock', 'opc-ua']
	},
	{
		id: 'mqtt-qos',
		term: 'MQTT QoS levels',
		aliases: ['QoS 0', 'QoS 1', 'QoS 2'],
		category: 'manufacturing',
		short:
			'MQTT offers three delivery guarantees. **QoS 0**: fire and forget. **QoS 1**: at least once (PUBLISH + PUBACK, duplicates possible). **QoS 2**: exactly once between a client and the broker, via a four-message handshake. Each level up roughly doubles broker work per message, and "exactly once" covers one hop, not your whole pipeline.',
		related: ['retained-message', 'last-will-message', 'at-least-once', 'exactly-once'],
		page: [
			{
				type: 'table',
				head: ['QoS', 'Packets per message', 'Guarantee', 'Duplicates?', 'Use for'],
				rows: [
					['0', 'PUBLISH', 'At most once', 'No (but can lose)', 'High-rate telemetry where the next sample replaces this one'],
					['1', 'PUBLISH, PUBACK', 'At least once', 'Yes', 'Events and alarms, with an idempotent consumer'],
					['2', 'PUBLISH, PUBREC, PUBREL, PUBCOMP', 'Exactly once per hop', 'No (per hop)', 'Rarely worth it; dedupe downstream instead']
				]
			},
			{ type: 'heading', text: 'Three traps' },
			{
				type: 'list',
				items: [
					'**QoS is per hop.** Publisher→broker and broker→subscriber are negotiated separately; a QoS 2 publish delivered to a QoS 0 subscriber is QoS 0.',
					'**QoS ≥1 needs persistent sessions to survive disconnects.** With `cleanSession=true` (or sessions not replicated across a broker failover), queued messages are gone.',
					'**Raising QoS under overload makes it worse.** More packets per message means the broker falls further behind, buffers fill, and you drop *more*. Fix load first (batching, rate), then pick the guarantee.'
				]
			}
		]
	},
	{
		id: 'retained-message',
		term: 'Retained message',
		category: 'manufacturing',
		short:
			'An MQTT message the broker keeps per topic and hands to any new subscriber immediately. Great for "current state", dangerous when the publisher dies: the last retained "RUNNING" stays there forever, so a dashboard that just connected shows a dead machine as running.',
		related: ['last-will-message', 'mqtt-qos']
	},
	{
		id: 'last-will-message',
		term: 'Last will (LWT)',
		category: 'manufacturing',
		short:
			'A message a client registers with the broker at connect time, which the broker publishes on its behalf if the client disappears without a clean disconnect (keep-alive timeout). Publishing "OFFLINE" as a retained last will is how a dashboard learns a machine went dark.',
		related: ['retained-message', 'mqtt-qos']
	},
	{
		id: 'edge-gateway',
		term: 'Edge gateway (store-and-forward)',
		category: 'manufacturing',
		short:
			'A box on the factory floor that collects machine data and forwards it to the cloud, buffering locally when the WAN drops. When the link returns it backfills hours of data at once, out of order and timestamped by its own clock. If that clock drifted, every buffered point lands in the wrong time bucket.',
		related: ['late-arriving-data', 'clock-skew', 'watermark']
	},
	{
		id: 'downsampling',
		term: 'Downsampling (rollups)',
		category: 'manufacturing',
		short:
			'Storing or plotting fewer points by summarising windows, e.g. one value per minute instead of per 100 ms. The summary function matters: an **average** of a 2-second pressure spike in a 1-minute window barely moves the line, while **max** keeps it. Long-range dashboards are almost always averaged, which is why spikes "disappear" when you zoom out.',
		related: ['nyquist-rate', 'percentile-averaging']
	},
	{
		id: 'nyquist-rate',
		term: 'Nyquist rate',
		aliases: ['sampling theorem'],
		category: 'manufacturing',
		short:
			'To capture a signal that varies at frequency f, you must sample faster than 2f. Sample slower and a fast oscillation shows up as a fake slow one (aliasing): a 120 Hz motor vibration sampled at 100 Hz appears as a convincing 20 Hz wobble that does not physically exist.',
		related: ['aliasing', 'downsampling', 'opc-ua']
	},
	{
		id: 'aliasing',
		term: 'Aliasing',
		category: 'manufacturing',
		short:
			'A sampled signal pretending to be a different frequency because it was sampled too slowly. The alias frequency is |f − k·fs| for the nearest multiple k of the sampling rate. The classic tell is a clean, steady low-frequency oscillation that no physical part of the machine could produce.',
		related: ['nyquist-rate']
	},
	{
		id: 'mes',
		term: 'MES (manufacturing execution system)',
		category: 'manufacturing',
		short:
			'The system that runs the shop floor: which work order runs on which machine, which material lots were consumed, who did which step, which serial numbers came out. It sits between the ERP (planning, money) and the machines (PLCs). Most traceability questions are really MES data-quality questions.',
		related: ['erp', 'genealogy-traceability', 'plc']
	},
	{
		id: 'erp',
		term: 'ERP',
		category: 'manufacturing',
		short:
			'Enterprise resource planning: orders, purchasing, inventory valuation, finance. It thinks in planned quantities and accounting periods, while the MES thinks in physical events. Sync bugs between the two (double-consumed lots, merged batches, units mismatches) are where recall data gets lost.',
		related: ['mes', 'reconciliation']
	},
	{
		id: 'genealogy-traceability',
		term: 'Genealogy & traceability',
		aliases: ['lot traceability', 'forward/backward trace'],
		category: 'manufacturing',
		short:
			'The record of which input lots went into which output serials, and the reverse. In a recall you need "which finished units contain resin lot R-1182?" in minutes. It is a graph problem: any step that merges or splits lots without keeping the edges (a "blend" recorded as a new lot with no parents) breaks the trace for everything downstream.',
		related: ['mes', 'erp']
	},
	{
		id: 'oee',
		term: 'OEE (overall equipment effectiveness)',
		category: 'manufacturing',
		short:
			'The standard factory productivity number: **OEE = Availability × Performance × Quality**. Availability is run time ÷ planned time; Performance is (ideal cycle time × total count) ÷ run time; Quality is good count ÷ total count. Because it multiplies three ratios, a misdefined input (micro-stops counted as running, a "standard" cycle time slower than the ideal one) can make it look world-class while output is flat.',
		related: ['spc', 'throughput'],
		page: [
			{ type: 'heading', text: 'Worked example: one 8-hour shift' },
			{
				type: 'table',
				head: ['Input', 'Value'],
				numeric: [1],
				rows: [
					['Planned production time', '480 min'],
					['Unplanned downtime (≥ 5 min stops)', '60 min'],
					['Ideal cycle time', '1.0 min/part'],
					['Total parts', '380'],
					['Good parts', '361']
				]
			},
			{
				type: 'code',
				lang: 'text',
				code: `Availability = (480 − 60) / 480        = 0.875
Performance  = (1.0 × 380) / 420         = 0.905
Quality      = 361 / 380                 = 0.950
OEE          = 0.875 × 0.905 × 0.950     = 0.752   (75.2%)

Sanity check: OEE = good parts × ideal cycle / planned time
             = 361 × 1.0 / 480           = 0.752 ✓`
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'The one-line audit',
				text: 'OEE must equal **good count × ideal cycle time ÷ planned time**. If a dashboard\'s three factors multiply to something different from that, one of them is misdefined. The usual culprits: micro-stops hidden inside "run time" (inflates availability, deflates performance), a padded "standard" cycle time (inflates performance), or rework counted as good (inflates quality).'
			}
		]
	},
	{
		id: 'spc',
		term: 'SPC (statistical process control)',
		category: 'manufacturing',
		short:
			'Monitoring a process with statistics so you react to real changes and ignore noise. Control limits come from the process\'s own variation (±3σ around its mean), **not** from the customer\'s spec. A process can be entirely within spec and still out of control (drifting), which is the early warning SPC exists to give.',
		related: ['control-chart', 'western-electric-rules', 'process-capability'],
		page: [
			{ type: 'heading', text: 'In spec ≠ in control' },
			{
				type: 'p',
				text: 'Spec: 10.00 ± 0.05 mm. Control limits from the first 10 subgroups: mean 10.015, σ of subgroup means ≈ 0.005 → UCL ≈ 10.030. Every point below is inside the spec. From 09:00 every point sits above the centre line (the 8-in-a-row rule fires at 11:20), and from 11:00 points cross the UCL. That is a tool wearing or a heater drifting, hours before the first part fails inspection.'
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'Bore diameter · X-bar chart',
					range: '06:00 – 15:40',
					panels: [
						{
							kind: 'timeseries',
							title: 'Subgroup mean (n = 5)',
							span: 6,
							unit: ' mm',
							x: spcX,
							yMin: 9.95,
							yMax: 10.06,
							series: [{ name: 'x̄', points: spcMean }],
							thresholds: [
								{ value: 10.05, label: 'USL 10.05', tone: 'crit' },
								{ value: 10.03, label: 'UCL 10.030', tone: 'warn' },
								{ value: 10.015, label: 'CL 10.015', tone: 'info' },
								{ value: 9.95, label: 'LSL 9.95', tone: 'crit' }
							]
						}
					]
				}
			},
			{
				type: 'list',
				items: [
					'**Control limits** = what this process does when nothing has changed. **Spec limits** = what the customer accepts. They answer different questions.',
					'Use [[western-electric-rules]] to catch drift before any single point crosses a limit.',
					'Recompute control limits only after a deliberate process change, never "because the chart is noisy".'
				]
			}
		]
	},
	{
		id: 'control-chart',
		term: 'Control chart',
		aliases: ['X-bar R chart', 'Shewhart chart'],
		category: 'manufacturing',
		short:
			'A time plot of a process measurement (often the mean and range of small subgroups) with a centre line and upper/lower control limits at about ±3σ. Points inside the limits with no pattern mean "common-cause noise, leave it alone"; patterns or points outside mean "something changed, go find it".',
		related: ['spc', 'western-electric-rules']
	},
	{
		id: 'western-electric-rules',
		term: 'Western Electric rules',
		category: 'manufacturing',
		short:
			'Pattern rules that flag an out-of-control process before a point crosses ±3σ: one point beyond 3σ; 2 of 3 consecutive beyond 2σ on the same side; 4 of 5 beyond 1σ on the same side; 8 in a row on one side of the centre line. Each is unlikely under pure noise, so they catch drift and shifts early.',
		related: ['control-chart', 'spc']
	},
	{
		id: 'process-capability',
		term: 'Process capability (Cp, Cpk)',
		category: 'manufacturing',
		short:
			'How well a process fits its spec. **Cp** = spec width ÷ 6σ (could it fit if centred?). **Cpk** = distance from the mean to the *nearer* spec limit ÷ 3σ (does it fit where it actually sits?). Spec 10.00 ± 0.05, σ 0.01, mean 10.02 gives Cp = 1.67 but Cpk = 1.00: a capable process running off-centre.',
		related: ['spc', 'tolerance-stack-up']
	},
	{
		id: 'safety-interlock',
		term: 'Safety interlock',
		category: 'manufacturing',
		short:
			'A hard guarantee that a machine cannot do something dangerous (door open → spindle off). It is implemented in hardware or a certified safety controller with a defined response time. Software and dashboards may *request* a stop or show state; they must never be the thing that makes the machine safe, because networks, brokers and UIs fail.',
		related: ['plc']
	},
	{
		id: 'digital-twin',
		term: 'Digital twin',
		category: 'manufacturing',
		short:
			'A software model of a physical asset kept in sync with its live data, used for monitoring, simulation and "what if" planning. It is only as true as its sync: stale retained messages, drifting clocks or averaged telemetry turn it into a confident picture of a machine that no longer exists.',
		related: ['edge-gateway', 'retained-message']
	}
];

export default terms;
