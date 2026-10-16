/**
 * Content schema. Every assessment, question and glossary entry is plain data
 * typed against these interfaces; the UI never hard-codes content.
 *
 * `Rich` strings support a small inline markup (see src/lib/content/inline.ts):
 *   **bold**   *emphasis*   `code`   [[term-id]]   [[term-id|shown text]]   [link text](https://…)
 */
export type Rich = string;

export type Tone = 'info' | 'warn' | 'crit' | 'ok';

// ───────────────────────── blocks ─────────────────────────

export type Block =
	| { type: 'p'; text: Rich }
	| { type: 'heading'; text: Rich }
	| { type: 'list'; items: Rich[]; ordered?: boolean }
	/** Numbered, ranked hypotheses. `title` is the claim, `body` the reasoning, `confirm` how to prove/kill it. */
	| { type: 'ranked'; items: RankedItem[] }
	| { type: 'code'; code: string; lang?: string; caption?: Rich }
	| { type: 'callout'; text: Rich; title?: Rich; tone?: Tone }
	| { type: 'table'; head: Rich[]; rows: Rich[][]; numeric?: number[]; caption?: Rich }
	/** Grid of small cards, each with a heading and bullet list. */
	| { type: 'cards'; items: { title: Rich; items: Rich[] }[] }
	/** Horizontal time-budget bars. */
	| { type: 'budget'; items: { label: Rich; minutes: number }[] }
	/** A message from a human: email, Slack, support ticket… */
	| { type: 'ticket'; ticket: Ticket }
	/** A monitoring dashboard made of panels (rendered as SVG charts). */
	| { type: 'dashboard'; dashboard: Dashboard }
	/** Log lines as they'd appear in a log explorer. */
	| { type: 'logs'; logs: LogView }
	/** Distributed trace waterfall. */
	| { type: 'trace'; trace: Trace }
	/** Left-to-right pipeline / request path, e.g. ["Browser", "CDN", "API", "Postgres"]. */
	| { type: 'flow'; steps: FlowStep[]; caption?: Rich }
	/** Side-by-side columns of blocks (e.g. "before" / "after"). */
	| { type: 'columns'; columns: { title?: Rich; blocks: Block[] }[] };

export interface RankedItem {
	title: Rich;
	body?: Rich;
	/** "How I'd confirm or kill it." */
	confirm?: Rich;
}

export interface FlowStep {
	label: Rich;
	note?: Rich;
	tone?: Tone;
}

// ───────────────────────── human reports ─────────────────────────

export interface Ticket {
	channel: 'email' | 'slack' | 'support' | 'jira' | 'meeting';
	from: string;
	/** e.g. "Finance · Revenue Ops" */
	role: string;
	subject?: string;
	/** Free text, e.g. "Mon 09:12" */
	time?: string;
	/** Plain text. Blank lines separate paragraphs. No markup. */
	body: string;
	/** Optional replies in the same thread. */
	thread?: { from: string; role?: string; time?: string; body: string }[];
	attachments?: string[];
}

// ───────────────────────── dashboards ─────────────────────────

/** Visual skin. Each mimics the look of a familiar tool without its branding. */
export type DashboardStyle = 'grafana' | 'cloudwatch' | 'kibana' | 'datadog';

export interface Dashboard {
	style: DashboardStyle;
	title: string;
	/** e.g. "Last 6 hours" or "Oct 14 08:00 – 14:00 UTC" */
	range?: string;
	/** Small chips shown in the header: env, region, filters. */
	filters?: string[];
	panels: Panel[];
}

/** Colour slot in the dashboard skin's palette (0–5). */
export type SeriesColor = 0 | 1 | 2 | 3 | 4 | 5;

export interface Series {
	name: string;
	/** One y-value per x label. Use `null` for gaps (no data). */
	points: (number | null)[];
	color?: SeriesColor;
	/** Dashed line, e.g. a limit or last-week comparison. */
	dashed?: boolean;
}

export interface Marker {
	/** Index into the x labels. */
	at: number;
	label: string;
}

export interface Threshold {
	value: number;
	label?: string;
	tone?: Tone;
}

interface PanelBase {
	title: string;
	/** Column span in a 6-column grid. Default: timeseries 3, stat 1, others 3. */
	span?: 1 | 2 | 3 | 4 | 5 | 6;
	/** Small grey text under the title, e.g. the query. */
	subtitle?: string;
}

export type Panel =
	| (PanelBase & {
			kind: 'timeseries';
			/** x-axis labels, same length as every series' points. */
			x: string[];
			series: Series[];
			/** Appended to values: "ms", "%", " req/s"… */
			unit?: string;
			yMin?: number;
			yMax?: number;
			stacked?: boolean;
			/** Fill area under lines. */
			area?: boolean;
			markers?: Marker[];
			thresholds?: Threshold[];
			/** Log-scale y axis. */
			log?: boolean;
	  })
	| (PanelBase & {
			kind: 'bars';
			x: string[];
			series: Series[];
			unit?: string;
			stacked?: boolean;
			markers?: Marker[];
	  })
	| (PanelBase & {
			kind: 'stat';
			value: string;
			/** e.g. "+340% vs 1h ago" */
			delta?: string;
			tone?: Tone;
			spark?: number[];
	  })
	| (PanelBase & {
			kind: 'heatmap';
			/** columns (time) */
			x: string[];
			/** rows (buckets), listed bottom → top, e.g. ["<10ms","10-50ms",…] */
			y: string[];
			/** values[row][col], row index matches `y`. */
			values: number[][];
			unit?: string;
	  })
	| (PanelBase & {
			kind: 'table';
			head: string[];
			rows: string[][];
			/** Column indices that are numeric (right aligned). */
			numeric?: number[];
			/** Highlight these row indices. */
			highlight?: number[];
	  })
	| (PanelBase & {
			kind: 'gauge';
			value: number;
			max: number;
			unit?: string;
			thresholds?: Threshold[];
	  });

// ───────────────────────── logs & traces ─────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogLine {
	ts: string;
	level?: LogLevel;
	/** Service / pod / log group. */
	source?: string;
	msg: string;
	/** Structured fields shown as key=value chips. */
	fields?: Record<string, string | number | boolean | null>;
}

export interface LogView {
	style?: 'kibana' | 'cloudwatch' | 'terminal';
	title?: string;
	/** Search box contents, e.g. `service:checkout AND level:ERROR` */
	query?: string;
	/** Optional hit histogram above the lines. */
	histogram?: { x: string[]; counts: number[]; errors?: number[] };
	total?: string;
	lines: LogLine[];
}

export interface Span {
	/** Unique within the trace. */
	id: string;
	parent?: string;
	service: string;
	name: string;
	/** ms from trace start */
	start: number;
	/** ms */
	duration: number;
	error?: boolean;
	note?: string;
}

export interface Trace {
	title?: string;
	traceId?: string;
	spans: Span[];
}

// ───────────────────────── structure ─────────────────────────

export type QuestionTag = 'core' | 'tricky' | 'variant' | 'template' | 'teaser' | 'design' | 'coding';

export interface Question {
	/** Unique within its assessment; used for progress tracking and anchors. */
	id: string;
	title: Rich;
	tag: QuestionTag;
	/** Questions sharing a `group` render under one sub-heading, in order. */
	group?: string;
	/** Suggested minutes, shown as a chip. */
	minutes?: number;
	/** The scenario: symptoms, code, dashboards, tickets. */
	prompt: Block[];
	/** Optional progressive hints revealed one at a time. */
	hints?: Rich[];
	/** Label for the reveal button. Default "Show answer". */
	answerLabel?: string;
	answer: Block[];
}

export interface Part {
	/** Unique within the assessment, e.g. "p1". */
	id: string;
	/** Short label for the tab bar, e.g. "1 · Perf". */
	nav: string;
	eyebrow: string;
	title: Rich;
	/** One line under the title. */
	meta?: Rich;
	minutes?: number;
	intro?: Block[];
	questions: Question[];
	outro?: Block[];
}

export interface Assessment {
	/** URL slug. */
	id: string;
	number: number;
	title: string;
	/** One line, shown on cards. */
	tagline: string;
	description: Rich;
	/** Total suggested minutes. */
	minutes: number;
	difficulty: 'foundation' | 'intermediate' | 'advanced';
	topics: string[];
	/** Optional top-of-page blocks (time plan, grading notes). */
	overview?: Block[];
	parts: Part[];
}

// ───────────────────────── glossary ─────────────────────────

export interface GlossaryTerm {
	/** kebab-case id referenced as [[id]]. */
	id: string;
	/** Display name, e.g. "Little's law". */
	term: string;
	/** Other spellings that should also find this entry in search. */
	aliases?: string[];
	category: GlossaryCategory;
	/**
	 * The hover explanation. 2–4 sentences written to build understanding,
	 * not to recite: say what it is, why it happens / why it matters.
	 */
	short: Rich;
	/** Optional everyday analogy shown under the short text. */
	analogy?: Rich;
	/** If present, the term gets a dedicated page with these blocks. */
	page?: Block[];
	/** Related term ids. */
	related?: string[];
}

export type GlossaryCategory =
	| 'latency & capacity'
	| 'caching'
	| 'databases'
	| 'distributed systems'
	| 'messaging'
	| 'observability'
	| 'cloud & infra'
	| 'frontend & network'
	| 'ai & retrieval'
	| 'money & time'
	| 'reliability practice'
	| 'security & compliance'
	| 'business';
