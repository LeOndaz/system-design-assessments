<!--
  Interactive incident lab: a simulated cloud / Kubernetes console.
  The simulation (engine.ts) is mutable and non-reactive; `frame` bumps on each tick to re-render.
-->
<script lang="ts">
	import type { Lab, LabField, LabState, LabValue } from '$lib/content/types';
	import Rich from '$lib/components/Rich.svelte';
	import { fmt } from '$lib/charts/scale';
	import { applyFields, createSim, runAction, tick, type Sim } from './engine';
	import LiveMetric from './LiveMetric.svelte';

	let { lab }: { lab: Lab } = $props();

	// A lab's definition is static content, so capturing its initial value is intended.
	// svelte-ignore state_referenced_locally
	let sim: Sim = $state.raw(createSim(lab));
	let frame = $state(0);
	let running = $state(false);
	// svelte-ignore state_referenced_locally
	let speed = $state(lab.speed ?? 5);
	// svelte-ignore state_referenced_locally
	let selected = $state(lab.resources[0]?.id);
	let drafts = $state<Record<string, LabValue>>({});
	let confirming = $state<string | null>(null);

	const view = $derived.by(() => {
		void frame;
		return {
			t: sim.t,
			state: { ...sim.state },
			metrics: { ...sim.metrics },
			log: sim.log.slice(-60).reverse(),
			pending: [...sim.pending],
			outcome: sim.outcome,
			cost: sim.cost,
			rate: lab.cost?.(sim.state) ?? 0,
			streak: sim.winStreak,
			actions: sim.actions
		};
	});

	const resource = $derived(lab.resources.find((r) => r.id === selected) ?? lab.resources[0]);
	const services = $derived([...new Set(lab.resources.map((r) => r.service))]);
	const limit = $derived(lab.timeLimit ?? 600);
	const hold = $derived(lab.win.hold ?? 30);
	const over = $derived(view.outcome.kind !== 'running');

	$effect(() => {
		if (!running || over) return;
		const id = setInterval(() => {
			tick(sim);
			frame++;
			if (sim.outcome.kind !== 'running') running = false;
		}, 1000 / speed);
		return () => clearInterval(id);
	});

	function reset() {
		running = false;
		sim = createSim(lab);
		drafts = {};
		confirming = null;
		frame++;
	}

	/** Draft value, else the value a pending rollout will set, else live state. */
	function fieldValue(f: LabField): LabValue {
		if (f.key in drafts) return drafts[f.key];
		const pending = [...view.pending].reverse().find((p) => f.key in p.set);
		return pending ? pending.set[f.key] : view.state[f.key];
	}

	function setDraft(f: LabField, raw: string | boolean) {
		const v: LabValue = f.kind === 'number' ? Number(raw) : raw;
		drafts = { ...drafts, [f.key]: v };
	}

	const dirty = $derived(
		(resource.fields ?? []).filter((f) => f.key in drafts && drafts[f.key] !== view.state[f.key])
	);

	function apply() {
		const set: LabState = Object.fromEntries(dirty.map((f) => [f.key, drafts[f.key]]));
		applyFields(sim, resource.id, set);
		const rest = { ...drafts };
		for (const f of resource.fields ?? []) delete rest[f.key];
		drafts = rest;
		if (!running && !over) running = true;
		frame++;
	}

	function act(id: string, needsConfirm: boolean) {
		if (needsConfirm && confirming !== id) {
			confirming = id;
			return;
		}
		confirming = null;
		runAction(sim, resource.id, id);
		if (!running && !over) running = true;
		frame++;
	}

	const clock = (t: number) => `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
	const statusOf = (r: (typeof lab.resources)[number]) => r.status?.(view.state, view.metrics);
	const pendingFor = (rid: string) => {
		const keys = new Set((lab.resources.find((r) => r.id === rid)?.fields ?? []).map((f) => f.key));
		return view.pending.filter((p) => Object.keys(p.set).some((k) => keys.has(k)));
	};
</script>

<div class="lab {lab.console}">
	<div class="bar">
		<span class="logo">{lab.console === 'kubernetes' ? '⎈' : '☁'}</span>
		<strong class="title">{lab.title}</strong>
		{#if lab.scope}<span class="scope">{lab.scope}</span>{/if}
		<span class="spacer"></span>
		<span class="clock" title="Simulated time">{clock(view.t)} <small>/ {clock(limit).slice(2)}</small></span>
		{#if lab.cost}<span class="cost" title="Current spend rate">${fmt(view.rate)}/h</span>{/if}
		<div class="ctl">
			{#if !over}
				<button type="button" onclick={() => (running = !running)}>{running ? '❚❚ Pause' : view.t ? '▶ Resume' : '▶ Start incident'}</button>
			{/if}
			<select bind:value={speed} aria-label="Simulation speed">
				<option value={2}>2×</option>
				<option value={5}>5×</option>
				<option value={10}>10×</option>
				<option value={20}>20×</option>
			</select>
			<button type="button" onclick={reset}>↺ Reset</button>
		</div>
	</div>

	<div class="brief"><Rich text={lab.brief} /> <span class="goal"><b>Goal:</b> <Rich text={lab.win.text} /></span></div>

	<div class="metrics">
		{#each lab.metrics as m (m.id)}
			<LiveMetric metric={m} value={view.metrics[m.id]} history={sim.history[m.id]} {frame} />
		{/each}
	</div>

	<div class="body">
		<nav class="side" aria-label="Resources">
			{#each services as svc (svc)}
				<div class="svc">{svc}</div>
				{#each lab.resources.filter((r) => r.service === svc) as r (r.id)}
					{@const st = statusOf(r)}
					<button type="button" class="res" class:on={r.id === resource.id} onclick={() => ((selected = r.id), (confirming = null))}>
						<i class="dot {st?.tone ?? 'ok'}"></i>
						<span>{r.name}</span>
						{#if pendingFor(r.id).length}<span class="spin" title="Change in progress">◌</span>{/if}
					</button>
				{/each}
			{/each}
		</nav>

		<section class="detail" aria-label="{resource.name} details">
			<div class="dhead">
				<div>
					<div class="rtype">{resource.service} › {resource.type}</div>
					<h4>{resource.name}</h4>
				</div>
				{#if statusOf(resource)}
					{@const st = statusOf(resource)!}
					<span class="pill {st.tone}">{st.label}</span>
				{/if}
			</div>

			{#if resource.details}
				<dl class="details">
					{#each resource.details(view.state) as [k, v] (k)}<div><dt>{k}</dt><dd>{v}</dd></div>{/each}
				</dl>
			{/if}

			{#if resource.fields?.length}
				<form class="fields" onsubmit={(e) => (e.preventDefault(), apply())}>
					<div class="ftitle">Configuration</div>
					{#each resource.fields as f (f.key)}
						{@const val = fieldValue(f)}
						<label class="field" class:changed={f.key in drafts && drafts[f.key] !== view.state[f.key]}>
							<span class="flabel">{f.label}{#if f.unit}<small> ({f.unit})</small>{/if}</span>
							{#if f.kind === 'number'}
								<input type="number" value={val} min={f.min} max={f.max} step={f.step ?? 1} disabled={over} oninput={(e) => setDraft(f, e.currentTarget.value)} />
							{:else if f.kind === 'select'}
								<select value={val} disabled={over} onchange={(e) => setDraft(f, e.currentTarget.value)}>
									{#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
								</select>
							{:else}
								<input type="checkbox" checked={!!val} disabled={over} onchange={(e) => setDraft(f, e.currentTarget.checked)} />
							{/if}
							{#if f.help}<span class="fhelp"><Rich text={f.help} /></span>{/if}
						</label>
					{/each}
					<div class="apply">
						<button type="submit" class="primary" disabled={!dirty.length || over}>Apply changes</button>
						{#if dirty.length}<button type="button" onclick={() => (drafts = {})}>Discard</button>{/if}
						<span class="note">Changes take ~{resource.applySeconds ?? 20}s to roll out.</span>
					</div>
					{#each pendingFor(resource.id) as p, i (i)}
						<div class="pending">◌ Rolling out: {p.log.replace(/^.*?: /, '')} · lands in {p.at - view.t}s</div>
					{/each}
				</form>
			{/if}

			{#if resource.actions?.length}
				<div class="actions">
					<div class="ftitle">Actions</div>
					<div class="abtns">
						{#each resource.actions as a (a.id)}
							<button type="button" class:danger={a.danger} class:confirming={confirming === a.id} disabled={over} onclick={() => act(a.id, !!a.confirm)}>
								{confirming === a.id ? `Confirm: ${a.label}` : a.label}
							</button>
						{/each}
					</div>
					{#if confirming}
						{@const a = resource.actions.find((x) => x.id === confirming)}
						{#if a?.confirm}<p class="warnline">⚠ {a.confirm}</p>{/if}
					{/if}
				</div>
			{/if}
		</section>
	</div>

	<div class="log" aria-live="polite">
		<div class="ftitle">Activity</div>
		<ol>
			{#each view.log as e, i (view.log.length - i)}
				<li class={e.tone}><span class="lt">{clock(e.t)}</span> {e.text}</li>
			{:else}
				<li class="info"><span class="lt">{clock(0)}</span> Press <b>Start incident</b>, or change something: the clock starts on your first move.</li>
			{/each}
		</ol>
	</div>

	{#if view.outcome.kind === 'running' && view.streak > 0}
		<div class="streak">Stable for {view.streak}s / {hold}s</div>
	{/if}

	{#if over}
		<div class="result {view.outcome.kind}">
			{#if view.outcome.kind === 'won'}
				<strong>Resolved at {clock(view.outcome.t)}</strong>
				<span>{view.actions} change{view.actions === 1 ? '' : 's'}{#if lab.cost} · incident cost ${fmt(view.cost)} · steady-state ${fmt(view.rate)}/h{/if}</span>
			{:else if view.outcome.kind === 'lost'}
				<strong>Failed at {clock(view.outcome.t)}</strong>
				<span><Rich text={view.outcome.reason} /></span>
			{:else}
				<strong>Out of time</strong>
				<span>The incident outlasted the window. Check the answer's debrief.</span>
			{/if}
			<button type="button" onclick={reset}>↺ Try again</button>
		</div>
	{/if}
</div>

<style>
	.lab {
		--c-bar: #232f3e;
		--c-bar-ink: #fff;
		--c-accent: #ec7211;
		--c-bg: #f2f3f3;
		--c-panel: #fff;
		--c-line: #d5dbdb;
		--c-ink: #16191f;
		--c-muted: #5f6b7a;
		--c-link: #0972d3;
		--c-ok: #037f0c;
		--c-warn: #8d6605;
		--c-crit: #d91515;
		--c-sel: #f2f8fd;
		border: 1px solid var(--c-line);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--c-bg);
		color: var(--c-ink);
		font-size: 14px;
		position: relative;
		min-width: 0;
	}
	.lab.kubernetes {
		--c-bar: #1d2433;
		--c-accent: #326ce5;
		--c-link: #326ce5;
		--c-sel: #eef3fd;
	}
	:global(:root[data-theme='dark']) .lab {
		--c-bg: #161b22;
		--c-panel: #1c222b;
		--c-line: #2d3540;
		--c-ink: #dfe4ea;
		--c-muted: #8d98a5;
		--c-link: #7ab5f5;
		--c-ok: #4cc46b;
		--c-warn: #e0b23c;
		--c-crit: #ff6b6b;
		--c-sel: #22303f;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .lab {
			--c-bg: #161b22;
			--c-panel: #1c222b;
			--c-line: #2d3540;
			--c-ink: #dfe4ea;
			--c-muted: #8d98a5;
			--c-link: #7ab5f5;
			--c-ok: #4cc46b;
			--c-warn: #e0b23c;
			--c-crit: #ff6b6b;
			--c-sel: #22303f;
		}
	}
	button,
	select,
	input {
		font: inherit;
		color: inherit;
	}
	.bar {
		background: var(--c-bar);
		color: var(--c-bar-ink);
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		align-items: center;
		padding: 8px 12px;
	}
	.logo {
		color: var(--c-accent);
		font-size: 18px;
		line-height: 1;
	}
	.title {
		font-size: 14px;
	}
	.scope {
		font-family: var(--f-mono);
		font-size: 11.5px;
		opacity: 0.75;
	}
	.spacer {
		flex: 1;
	}
	.clock,
	.cost {
		font-family: var(--f-mono);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.clock small {
		opacity: 0.6;
	}
	.cost {
		color: #ffb366;
	}
	.ctl {
		display: flex;
		gap: 6px;
	}
	.ctl button,
	.ctl select {
		background: rgb(255 255 255 / 0.1);
		border: 1px solid rgb(255 255 255 / 0.25);
		color: #fff;
		border-radius: 6px;
		padding: 3px 10px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.ctl select option {
		color: #000;
	}
	.brief {
		padding: 10px 14px;
		background: var(--c-panel);
		border-bottom: 1px solid var(--c-line);
		line-height: 1.55;
	}
	.goal {
		display: block;
		margin-top: 4px;
		color: var(--c-muted);
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 8px;
		padding: 10px;
	}
	.body {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: 0;
		border-top: 1px solid var(--c-line);
		border-bottom: 1px solid var(--c-line);
		background: var(--c-panel);
		min-height: 260px;
	}
	.side {
		border-right: 1px solid var(--c-line);
		padding: 8px 0;
		display: grid;
		align-content: start;
	}
	.svc {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--c-muted);
		padding: 8px 12px 2px;
		font-weight: 600;
	}
	.res {
		display: flex;
		gap: 8px;
		align-items: center;
		text-align: left;
		border: 0;
		background: none;
		padding: 5px 12px;
		cursor: pointer;
		color: var(--c-link);
		border-left: 3px solid transparent;
	}
	.res:hover {
		background: var(--c-sel);
	}
	.res.on {
		background: var(--c-sel);
		border-left-color: var(--c-accent);
		color: var(--c-ink);
		font-weight: 600;
	}
	.res span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.spin {
		flex: 0 !important;
		color: var(--c-accent);
		animation: spin 1.2s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
		background: var(--c-ok);
	}
	.dot.warn {
		background: var(--c-warn);
	}
	.dot.crit {
		background: var(--c-crit);
	}
	.dot.info {
		background: var(--c-link);
	}
	.detail {
		padding: 12px 16px 16px;
		display: grid;
		gap: 12px;
		align-content: start;
		min-width: 0;
	}
	.dhead {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 10px;
	}
	.rtype {
		font-size: 12px;
		color: var(--c-muted);
	}
	h4 {
		font-size: 17px;
	}
	.pill {
		font-size: 12px;
		font-weight: 600;
		padding: 2px 10px;
		border-radius: 999px;
		border: 1px solid;
		white-space: nowrap;
	}
	.pill.ok {
		color: var(--c-ok);
	}
	.pill.warn {
		color: var(--c-warn);
	}
	.pill.crit {
		color: var(--c-crit);
	}
	.pill.info {
		color: var(--c-link);
	}
	.details {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 6px 16px;
		margin: 0;
	}
	.details dt {
		font-size: 11.5px;
		color: var(--c-muted);
	}
	.details dd {
		margin: 0 0 4px;
		font-family: var(--f-mono);
		font-size: 12.5px;
		overflow-wrap: anywhere;
	}
	.ftitle {
		font-weight: 600;
		font-size: 13px;
		border-bottom: 1px solid var(--c-line);
		padding-bottom: 4px;
	}
	.fields {
		display: grid;
		gap: 8px;
	}
	.field {
		display: grid;
		grid-template-columns: minmax(140px, 220px) minmax(90px, 160px) 1fr;
		gap: 4px 12px;
		align-items: center;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.field.changed {
		background: color-mix(in srgb, var(--c-accent) 12%, transparent);
	}
	.flabel small {
		color: var(--c-muted);
	}
	.field input[type='number'],
	.field select {
		border: 1px solid var(--c-line);
		background: var(--c-panel);
		border-radius: 4px;
		padding: 4px 8px;
		width: 100%;
	}
	.field input[type='checkbox'] {
		width: 18px;
		height: 18px;
		accent-color: var(--c-accent);
	}
	.fhelp {
		font-size: 12px;
		color: var(--c-muted);
	}
	.apply {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 4px;
	}
	.apply button,
	.abtns button,
	.result button {
		border: 1px solid var(--c-line);
		background: var(--c-panel);
		border-radius: 18px;
		padding: 5px 16px;
		cursor: pointer;
		font-weight: 600;
		font-size: 13px;
	}
	.apply button.primary {
		background: var(--c-accent);
		border-color: var(--c-accent);
		color: #fff;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.note {
		font-size: 12px;
		color: var(--c-muted);
	}
	.pending {
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--c-accent);
	}
	.actions {
		display: grid;
		gap: 8px;
	}
	.abtns {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.abtns button.danger {
		color: var(--c-crit);
		border-color: var(--c-crit);
	}
	.abtns button.confirming {
		background: var(--c-crit);
		color: #fff;
	}
	.warnline {
		font-size: 13px;
		color: var(--c-crit);
	}
	.log {
		padding: 10px 14px;
		background: var(--c-panel);
	}
	.log ol {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		max-height: 170px;
		overflow-y: auto;
		font-family: var(--f-mono);
		font-size: 12px;
		display: grid;
		gap: 2px;
	}
	.lt {
		color: var(--c-muted);
		margin-right: 6px;
	}
	.log li.crit {
		color: var(--c-crit);
	}
	.log li.warn {
		color: var(--c-warn);
	}
	.log li.ok {
		color: var(--c-ok);
	}
	.log li.user {
		color: var(--c-link);
	}
	.streak {
		position: absolute;
		top: 48px;
		right: 12px;
		font-family: var(--f-mono);
		font-size: 12px;
		background: var(--c-ok);
		color: #fff;
		padding: 2px 8px;
		border-radius: 4px;
	}
	.result {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		align-items: center;
		padding: 12px 14px;
		border-top: 3px solid;
		background: var(--c-panel);
	}
	.result.won {
		border-color: var(--c-ok);
	}
	.result.won strong {
		color: var(--c-ok);
	}
	.result.lost,
	.result.timeout {
		border-color: var(--c-crit);
	}
	.result.lost strong,
	.result.timeout strong {
		color: var(--c-crit);
	}
	.result button {
		margin-left: auto;
	}
	@media (max-width: 680px) {
		.body {
			grid-template-columns: 1fr;
		}
		.side {
			border-right: 0;
			border-bottom: 1px solid var(--c-line);
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		}
		.svc {
			grid-column: 1 / -1;
		}
		.field {
			grid-template-columns: 1fr 1fr;
		}
		.fhelp {
			grid-column: 1 / -1;
		}
	}
</style>
