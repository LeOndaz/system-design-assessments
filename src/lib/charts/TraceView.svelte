<!-- Distributed trace waterfall. Spans are ordered depth-first by parent; bars are positioned on a shared time axis. -->
<script lang="ts">
	import type { Span, Trace } from '$lib/content/types';
	import { fmt, niceStep } from './scale';

	let { trace }: { trace: Trace } = $props();

	const ordered = $derived.by(() => {
		const kids = new Map<string | undefined, Span[]>();
		for (const s of trace.spans) {
			const k = kids.get(s.parent) ?? [];
			k.push(s);
			kids.set(s.parent, k);
		}
		const out: { s: Span; depth: number }[] = [];
		const walk = (parent: string | undefined, depth: number) => {
			for (const s of (kids.get(parent) ?? []).sort((a, b) => a.start - b.start)) {
				out.push({ s, depth });
				walk(s.id, depth + 1);
			}
		};
		walk(undefined, 0);
		return out;
	});

	const total = $derived(Math.max(...trace.spans.map((s) => s.start + s.duration), 1));
	const step = $derived(niceStep(total, 5));
	const ticks = $derived(Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step));
	const services = $derived([...new Set(trace.spans.map((s) => s.service))]);
	const color = (svc: string) => `var(--s${services.indexOf(svc) % 6})`;
	const ms = (v: number) => (v >= 1000 ? `${fmt(v / 1000)} s` : `${fmt(v)} ms`);
	let selected = $state<string | null>(null);
</script>

<figure class="dash datadog trace">
	<header>
		<span class="tool">trace</span>
		{#if trace.title}<strong>{trace.title}</strong>{/if}
		<span class="meta">{#if trace.traceId}<code>{trace.traceId}</code> · {/if}{ms(total)} · {trace.spans.length} spans</span>
	</header>
	<div class="legend">
		{#each services as svc (svc)}<span><i style:background={color(svc)}></i>{svc}</span>{/each}
	</div>
	<div class="rows">
		<div class="axis">
			<div class="name-col"></div>
			<div class="track">
				{#each ticks as t (t)}<span style:left="{(t / total) * 100}%">{ms(t)}</span>{/each}
			</div>
		</div>
		{#each ordered as { s, depth } (s.id)}
			<button type="button" class="row" class:err={s.error} class:sel={selected === s.id} onclick={() => (selected = selected === s.id ? null : s.id)}>
				<div class="name-col" style:padding-left="{depth * 12 + 4}px">
					<span class="svc" style:color={color(s.service)}>{s.service}</span>
					<span class="op">{s.name}</span>
				</div>
				<div class="track">
					{#each ticks as t (t)}<span class="gridline" style:left="{(t / total) * 100}%"></span>{/each}
					<span
						class="bar"
						style:left="{(s.start / total) * 100}%"
						style:width="max(2px, {(s.duration / total) * 100}%)"
						style:background={color(s.service)}
					></span>
					<span class="dur" style:left="min(calc({((s.start + s.duration) / total) * 100}% + 4px), calc(100% - 7ch))">{ms(s.duration)}</span>
				</div>
			</button>
			{#if selected === s.id && s.note}
				<div class="note">{s.note}</div>
			{/if}
		{/each}
	</div>
	{#if trace.spans.some((s) => s.note)}<div class="hint">Click a span for details.</div>{/if}
</figure>

<style>
	.dash {
		--d-bg: #f8f8fa;
		--d-panel: #fff;
		--d-border: #e1e1e8;
		--d-text: #1c2b34;
		--d-muted: #6b7682;
		--d-grid: #efeff4;
		--s0: #632ca6;
		--s1: #3c8ae0;
		--s2: #e5a21c;
		--s3: #2bb07f;
		--s4: #d36086;
		--s5: #8a8a99;
		margin: 0;
		border: 1px solid var(--d-border);
		border-radius: var(--radius);
		background: var(--d-bg);
		color: var(--d-text);
		padding: 10px;
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	:global(:root[data-theme='dark']) .dash {
		--d-bg: #161b22;
		--d-panel: #1c222b;
		--d-border: #2d3540;
		--d-text: #dfe4ea;
		--d-muted: #8d98a5;
		--d-grid: #262d36;
		--s0: #a173e0;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .dash {
			--d-bg: #161b22;
			--d-panel: #1c222b;
			--d-border: #2d3540;
			--d-text: #dfe4ea;
			--d-muted: #8d98a5;
			--d-grid: #262d36;
			--s0: #a173e0;
		}
	}
	header {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
		font-size: 14px;
		padding: 0 4px;
	}
	.tool {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--d-muted);
	}
	.meta {
		margin-left: auto;
		font-family: var(--f-mono);
		font-size: 11.5px;
		color: var(--d-muted);
	}
	.meta code {
		background: none;
		padding: 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-family: var(--f-mono);
		font-size: 11px;
		padding: 0 4px;
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 5px;
		vertical-align: -1px;
	}
	.rows {
		background: var(--d-panel);
		border: 1px solid var(--d-border);
		border-radius: 4px;
		overflow-x: auto;
	}
	.axis,
	.row {
		display: grid;
		grid-template-columns: minmax(150px, 34%) 1fr;
		min-width: 520px;
	}
	.axis {
		font-family: var(--f-mono);
		font-size: 10px;
		color: var(--d-muted);
		border-bottom: 1px solid var(--d-border);
		height: 20px;
	}
	.axis .track span {
		position: absolute;
		top: 3px;
		transform: translateX(-50%);
		white-space: nowrap;
	}
	.axis .track span:first-child {
		transform: none;
	}
	.row {
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--d-grid);
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		padding: 0;
		cursor: pointer;
	}
	.row:hover,
	.row.sel {
		background: color-mix(in srgb, var(--d-muted) 9%, transparent);
	}
	.row.err .op::after {
		content: ' ⚠';
		color: #e5484d;
	}
	.row.err .bar {
		background-image: repeating-linear-gradient(45deg, transparent 0 4px, rgb(255 255 255 / 0.35) 4px 7px) !important;
		outline: 1.5px solid #e5484d;
	}
	.name-col {
		display: flex;
		gap: 6px;
		align-items: baseline;
		padding: 5px 6px;
		font-size: 12px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.svc {
		font-family: var(--f-mono);
		font-size: 10.5px;
		font-weight: 500;
	}
	.op {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.track {
		position: relative;
		margin-right: 56px;
	}
	.gridline {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--d-grid);
	}
	.bar {
		position: absolute;
		top: 6px;
		height: 14px;
		border-radius: 2px;
		opacity: 0.9;
	}
	.dur {
		position: absolute;
		top: 5px;
		font-family: var(--f-mono);
		font-size: 10.5px;
		color: var(--d-muted);
		white-space: nowrap;
	}
	.note {
		padding: 6px 12px 8px;
		font-size: 13px;
		background: color-mix(in srgb, var(--s1) 8%, transparent);
		border-bottom: 1px solid var(--d-grid);
		min-width: 520px;
	}
	.hint {
		font-family: var(--f-mono);
		font-size: 10.5px;
		color: var(--d-muted);
		padding: 0 4px;
	}
</style>
