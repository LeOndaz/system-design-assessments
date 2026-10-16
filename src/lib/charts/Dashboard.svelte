<!--
  A monitoring dashboard. The `style` picks a skin that evokes a familiar tool
  (dark metrics board, cloud console, log analytics, APM). Panels flow in a 6-column grid.
-->
<script lang="ts">
	import type { Dashboard, Panel } from '$lib/content/types';
	import XYChart from './XYChart.svelte';
	import Sparkline from './Sparkline.svelte';
	import Heatmap from './Heatmap.svelte';
	import Gauge from './Gauge.svelte';

	let { dashboard }: { dashboard: Dashboard } = $props();

	const defaultSpan = (p: Panel) => p.span ?? (p.kind === 'stat' || p.kind === 'gauge' ? 1 : 3);
	const toolName = { grafana: 'metrics', cloudwatch: 'cloud console', kibana: 'log analytics', datadog: 'apm' } as const;
</script>

<figure class="dash {dashboard.style}" aria-label="Dashboard: {dashboard.title}">
	<header>
		<div class="title">
			<span class="tool">{toolName[dashboard.style]}</span>
			<span class="sep">/</span>
			<strong>{dashboard.title}</strong>
		</div>
		<div class="meta">
			{#each dashboard.filters ?? [] as f, i (i)}<span class="filter">{f}</span>{/each}
			{#if dashboard.range}<span class="range">⏱ {dashboard.range}</span>{/if}
		</div>
	</header>
	<div class="grid">
		{#each dashboard.panels as p, i (i)}
			<section class="panel kind-{p.kind}" style:--span={defaultSpan(p)}>
				<h5>{p.title}</h5>
				{#if p.subtitle}<div class="sub">{p.subtitle}</div>{/if}
				{#if p.kind === 'timeseries'}
					<XYChart
						kind="line"
						x={p.x}
						series={p.series}
						unit={p.unit}
						yMin={p.yMin}
						yMax={p.yMax}
						stacked={p.stacked}
						area={p.area}
						markers={p.markers}
						thresholds={p.thresholds}
						log={p.log}
					/>
				{:else if p.kind === 'bars'}
					<XYChart kind="bars" x={p.x} series={p.series} unit={p.unit} stacked={p.stacked} markers={p.markers} />
				{:else if p.kind === 'stat'}
					<div class="stat {p.tone ?? ''}">
						<div class="value">{p.value}</div>
						{#if p.delta}<div class="delta">{p.delta}</div>{/if}
						{#if p.spark}<Sparkline points={p.spark} color={p.tone ? `var(--d-${p.tone})` : 'var(--s0)'} />{/if}
					</div>
				{:else if p.kind === 'heatmap'}
					<Heatmap x={p.x} y={p.y} values={p.values} unit={p.unit} />
				{:else if p.kind === 'gauge'}
					<Gauge value={p.value} max={p.max} unit={p.unit} thresholds={p.thresholds} />
				{:else if p.kind === 'table'}
					<div class="tw">
						<table>
							<thead><tr>{#each p.head as h, j (j)}<th class:num={p.numeric?.includes(j)}>{h}</th>{/each}</tr></thead>
							<tbody>
								{#each p.rows as r, j (j)}
									<tr class:hl={p.highlight?.includes(j)}>
										{#each r as c, k (k)}<td class:num={p.numeric?.includes(k)}>{c}</td>{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/each}
	</div>
</figure>

<style>
	/* ── skins ── each defines panel colours and a six-slot series palette ── */
	.dash {
		--d-bg: #f2f3f3;
		--d-panel: #fff;
		--d-border: #d5dbdb;
		--d-text: #16191f;
		--d-muted: #687078;
		--d-grid: #eaeded;
		--d-tip: #fff;
		--d-marker: #8d6e00;
		--d-ok: #1d8102;
		--d-warn: #c77800;
		--d-crit: #d13212;
		--d-heat: #0073bb;
		--s0: #0073bb;
		--s1: #ec7211;
		--s2: #1d8102;
		--s3: #d13212;
		--s4: #8456ce;
		--s5: #687078;
	}
	.grafana {
		--d-bg: #111217;
		--d-panel: #181b1f;
		--d-border: #2c3235;
		--d-text: #ccccdc;
		--d-muted: #8e8e9f;
		--d-grid: #24272c;
		--d-tip: #22252b;
		--d-marker: #e0b400;
		--d-ok: #73bf69;
		--d-warn: #ff9830;
		--d-crit: #f2495c;
		--d-heat: #ff9830;
		--s0: #73bf69;
		--s1: #f2cc0c;
		--s2: #5794f2;
		--s3: #ff9830;
		--s4: #f2495c;
		--s5: #b877d9;
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
		--d-ok: #54b399;
		--d-warn: #d6bf57;
		--d-crit: #bd271e;
		--d-heat: #6092c0;
		--s0: #54b399;
		--s1: #6092c0;
		--s2: #d36086;
		--s3: #9170b8;
		--s4: #d6bf57;
		--s5: #bd271e;
	}
	.datadog {
		--d-bg: #f8f8fa;
		--d-panel: #fff;
		--d-border: #e1e1e8;
		--d-text: #1c2b34;
		--d-muted: #6b7682;
		--d-grid: #efeff4;
		--d-tip: #fff;
		--d-marker: #632ca6;
		--d-ok: #2bb07f;
		--d-warn: #e5a21c;
		--d-crit: #e5484d;
		--d-heat: #632ca6;
		--s0: #632ca6;
		--s1: #3c8ae0;
		--s2: #e5a21c;
		--s3: #e5484d;
		--s4: #2bb07f;
		--s5: #8a8a99;
	}
	/* light skins dim down when the site is dark */
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

	/* ── layout ── */
	.dash {
		margin: 0;
		background: var(--d-bg);
		color: var(--d-text);
		border: 1px solid var(--d-border);
		border-radius: var(--radius);
		padding: 10px;
		display: grid;
		gap: 10px;
		min-width: 0;
		font-family: var(--f-body);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 6px 12px;
		align-items: center;
		padding: 2px 4px;
	}
	.title {
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 14px;
		min-width: 0;
	}
	.tool {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--d-muted);
	}
	.sep {
		color: var(--d-muted);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.filter,
	.range {
		font-family: var(--f-mono);
		font-size: 11px;
		padding: 2px 8px;
		border: 1px solid var(--d-border);
		border-radius: 4px;
		background: var(--d-panel);
		color: var(--d-muted);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 8px;
	}
	.panel {
		grid-column: span var(--span);
		background: var(--d-panel);
		border: 1px solid var(--d-border);
		border-radius: 4px;
		padding: 8px 10px 8px;
		min-width: 0;
		display: grid;
		gap: 2px;
		align-content: start;
	}
	.grafana .panel {
		border-radius: 2px;
	}
	h5 {
		margin: 0;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--d-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-family: var(--f-mono);
		font-size: 10.5px;
		color: var(--d-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@media (max-width: 720px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.panel {
			grid-column: span 2;
		}
		.panel.kind-stat,
		.panel.kind-gauge {
			grid-column: span 1;
		}
	}

	/* stat */
	.stat {
		display: grid;
		gap: 2px;
		padding-top: 4px;
	}
	.value {
		font-size: 26px;
		font-weight: 600;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		color: var(--d-text);
	}
	.grafana .stat .value {
		color: var(--s0);
	}
	.stat.ok .value {
		color: var(--d-ok);
	}
	.stat.warn .value {
		color: var(--d-warn);
	}
	.stat.crit .value {
		color: var(--d-crit);
	}
	.delta {
		font-family: var(--f-mono);
		font-size: 11px;
		color: var(--d-muted);
	}

	/* table */
	.tw {
		overflow-x: auto;
		margin-top: 4px;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-family: var(--f-mono);
		font-size: 11.5px;
	}
	th,
	td {
		text-align: left;
		padding: 4px 8px;
		border-bottom: 1px solid var(--d-grid);
		white-space: nowrap;
	}
	th {
		color: var(--d-muted);
		font-weight: 500;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tr.hl td {
		background: color-mix(in srgb, var(--d-crit) 14%, transparent);
	}
</style>
