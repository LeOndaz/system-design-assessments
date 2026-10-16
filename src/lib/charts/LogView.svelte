<!-- Log explorer: optional query bar + hit histogram, then expandable log lines. -->
<script lang="ts">
	import type { LogView } from '$lib/content/types';
	import XYChart from './XYChart.svelte';

	let { logs }: { logs: LogView } = $props();

	const style = $derived(logs.style ?? 'kibana');
	let expanded = $state<Record<number, boolean>>({});
	let levelFilter = $state<string | null>(null);

	const levels = $derived([...new Set(logs.lines.map((l) => l.level).filter(Boolean))] as string[]);
	const shown = $derived(logs.lines.map((l, i) => ({ l, i })).filter(({ l }) => !levelFilter || l.level === levelFilter));
	const histSeries = $derived(
		logs.histogram
			? [
					{ name: 'hits', points: logs.histogram.counts.map((c, i) => c - (logs.histogram!.errors?.[i] ?? 0)), color: 0 as const },
					...(logs.histogram.errors ? [{ name: 'errors', points: logs.histogram.errors, color: 5 as const }] : [])
				]
			: []
	);
	const fieldStr = (v: unknown) => (v === null ? 'null' : String(v));
</script>

<figure class="dash logs {style === 'terminal' ? 'grafana' : style === 'cloudwatch' ? 'cloudwatch' : 'kibana'} {style}">
	<header>
		<span class="tool">{style === 'cloudwatch' ? 'log insights' : style === 'terminal' ? 'shell' : 'discover'}</span>
		{#if logs.title}<strong>{logs.title}</strong>{/if}
		{#if logs.total}<span class="total">{logs.total}</span>{/if}
	</header>
	{#if logs.query}<div class="query"><span aria-hidden="true">⌕</span> <code>{logs.query}</code></div>{/if}
	{#if logs.histogram}
		<div class="hist"><XYChart kind="bars" x={logs.histogram.x} series={histSeries} stacked height={110} /></div>
	{/if}
	{#if levels.length > 1}
		<div class="levels" role="group" aria-label="Filter by level">
			<button type="button" class:on={!levelFilter} onclick={() => (levelFilter = null)}>all</button>
			{#each levels as lv (lv)}
				<button type="button" class="lv-{lv}" class:on={levelFilter === lv} onclick={() => (levelFilter = levelFilter === lv ? null : lv)}>{lv}</button>
			{/each}
		</div>
	{/if}
	<ol class="lines">
		{#each shown as { l, i } (i)}
			<li class="lv-{l.level ?? 'NONE'}">
				<button type="button" class="line" onclick={() => (expanded[i] = !expanded[i])} aria-expanded={!!expanded[i]} disabled={!l.fields}>
					<span class="ts">{l.ts}</span>
					{#if l.level}<span class="level">{l.level}</span>{/if}
					{#if l.source}<span class="src">{l.source}</span>{/if}
					<span class="msg">{l.msg}</span>
				</button>
				{#if l.fields}
					<div class="fields" class:open={expanded[i]}>
						{#each Object.entries(l.fields) as [k, v] (k)}<span class="f"><span class="k">{k}</span>=<span class="v">{fieldStr(v)}</span></span>{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
</figure>

<style>
	/* inherits skin variables from Dashboard's palette classes via .dash */
	.dash {
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
	.kibana {
		--d-bg: #f7f8fc;
		--d-panel: #fff;
		--d-border: #d3dae6;
		--d-text: #343741;
		--d-muted: #69707d;
		--d-grid: #eef0f4;
		--d-tip: #fff;
		--d-marker: #9170b8;
		--s0: #54b399;
		--s5: #bd271e;
	}
	.cloudwatch {
		--d-bg: #f2f3f3;
		--d-panel: #fff;
		--d-border: #d5dbdb;
		--d-text: #16191f;
		--d-muted: #687078;
		--d-grid: #eaeded;
		--d-tip: #fff;
		--d-marker: #8d6e00;
		--s0: #0073bb;
		--s5: #d13212;
	}
	.grafana {
		--d-bg: #0d1117;
		--d-panel: #0d1117;
		--d-border: #30363d;
		--d-text: #c9d1d9;
		--d-muted: #8b949e;
		--d-grid: #21262d;
		--d-tip: #161b22;
		--d-marker: #e0b400;
		--s0: #3fb950;
		--s5: #f85149;
	}
	:global(:root[data-theme='dark']) .dash:not(.grafana) {
		--d-bg: #161b22;
		--d-panel: #1c222b;
		--d-border: #2d3540;
		--d-text: #dfe4ea;
		--d-muted: #8d98a5;
		--d-grid: #262d36;
		--d-tip: #232a34;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .dash:not(.grafana) {
			--d-bg: #161b22;
			--d-panel: #1c222b;
			--d-border: #2d3540;
			--d-text: #dfe4ea;
			--d-muted: #8d98a5;
			--d-grid: #262d36;
			--d-tip: #232a34;
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
	.total {
		margin-left: auto;
		font-family: var(--f-mono);
		font-size: 11.5px;
		color: var(--d-muted);
	}
	.query {
		background: var(--d-panel);
		border: 1px solid var(--d-border);
		border-radius: 4px;
		padding: 5px 10px;
		font-size: 12.5px;
		color: var(--d-muted);
		overflow-x: auto;
		white-space: nowrap;
	}
	.query code {
		background: none;
		color: var(--d-text);
		padding: 0;
		overflow-wrap: normal;
	}
	.hist {
		background: var(--d-panel);
		border: 1px solid var(--d-border);
		border-radius: 4px;
		padding: 4px 8px 2px;
	}
	.levels {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.levels button {
		font-family: var(--f-mono);
		font-size: 10.5px;
		border: 1px solid var(--d-border);
		background: var(--d-panel);
		color: var(--d-muted);
		border-radius: 4px;
		padding: 1px 7px;
		cursor: pointer;
	}
	.levels button.on {
		color: var(--d-text);
		border-color: var(--d-text);
	}
	.lines {
		list-style: none;
		margin: 0;
		padding: 0;
		background: var(--d-panel);
		border: 1px solid var(--d-border);
		border-radius: 4px;
		font-family: var(--f-mono);
		font-size: 12px;
		max-height: 440px;
		overflow: auto;
	}
	li {
		border-bottom: 1px solid var(--d-grid);
		border-left: 3px solid transparent;
	}
	li:last-child {
		border-bottom: 0;
	}
	li.lv-ERROR,
	li.lv-FATAL {
		border-left-color: #e5484d;
	}
	li.lv-WARN {
		border-left-color: #e5a21c;
	}
	.line {
		display: flex;
		gap: 10px;
		width: 100%;
		text-align: left;
		border: 0;
		background: none;
		color: var(--d-text);
		font: inherit;
		padding: 4px 8px;
		cursor: pointer;
		align-items: baseline;
	}
	.line:disabled {
		cursor: default;
	}
	.line:not(:disabled):hover {
		background: color-mix(in srgb, var(--d-muted) 10%, transparent);
	}
	.ts {
		color: var(--d-muted);
		white-space: nowrap;
	}
	.level {
		font-weight: 500;
		min-width: 5ch;
	}
	.lv-ERROR .level,
	.lv-FATAL .level {
		color: #e5484d;
	}
	.lv-WARN .level {
		color: #c98a0b;
	}
	.lv-DEBUG .level {
		color: var(--d-muted);
	}
	.src {
		color: var(--s1, #6092c0);
		white-space: nowrap;
	}
	.kibana .src {
		color: #6092c0;
	}
	.msg {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.fields {
		display: none;
		flex-wrap: wrap;
		gap: 4px 12px;
		padding: 2px 12px 8px 22px;
		color: var(--d-muted);
		font-size: 11.5px;
	}
	.fields.open {
		display: flex;
	}
	.k {
		color: var(--d-muted);
	}
	.v {
		color: var(--d-text);
	}
	@media (max-width: 600px) {
		.line {
			flex-wrap: wrap;
			gap: 2px 8px;
		}
		.msg {
			flex-basis: 100%;
		}
	}
</style>
