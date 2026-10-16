<!--
  Time-series and bar chart in one component. Pure SVG, responsive width, hover crosshair + tooltip,
  click a legend entry to isolate a series. Colours come from the parent dashboard skin (--s0…--s5).
-->
<script lang="ts">
	import type { Marker, Series, Threshold } from '$lib/content/types';
	import { areaPath, fmt, linePath, linearScale, logScale, tickIndices } from './scale';

	let {
		kind,
		x,
		series,
		unit = '',
		yMin,
		yMax,
		stacked = false,
		area = false,
		markers = [],
		thresholds = [],
		log = false,
		height = 180
	}: {
		kind: 'line' | 'bars';
		x: string[];
		series: Series[];
		unit?: string;
		yMin?: number;
		yMax?: number;
		stacked?: boolean;
		area?: boolean;
		markers?: Marker[];
		thresholds?: Threshold[];
		log?: boolean;
		height?: number;
	} = $props();

	let width = $state(600);
	let hover = $state<number | null>(null);
	let isolated = $state<number | null>(null);

	const M = { r: 10, t: 10, b: 22 };
	const n = $derived(x.length);
	const visible = $derived(series.map((_, i) => isolated === null || isolated === i));

	/** Stacked bases per series (bottom of each band). */
	const stacks = $derived.by(() => {
		const bases: number[][] = [];
		const run = new Array(n).fill(0);
		series.forEach((s, si) => {
			bases.push([...run]);
			if (stacked && visible[si]) s.points.forEach((v, i) => (run[i] += v ?? 0));
		});
		return { bases, top: run };
	});

	const dataMax = $derived.by(() => {
		let m = 0;
		if (stacked) m = Math.max(...stacks.top);
		else series.forEach((s, si) => visible[si] && s.points.forEach((v) => v != null && (m = Math.max(m, v))));
		for (const t of thresholds) m = Math.max(m, t.value);
		return m || 1;
	});
	const dataMin = $derived.by(() => {
		if (yMin !== undefined) return yMin;
		if (log) {
			let m = Infinity;
			series.forEach((s) => s.points.forEach((v) => v != null && v > 0 && (m = Math.min(m, v))));
			return Number.isFinite(m) ? m : 1;
		}
		return 0;
	});

	const innerH = $derived(height - M.t - M.b);
	const y = $derived(
		log ? logScale(dataMin, yMax ?? dataMax, M.t + innerH, M.t) : linearScale(dataMin, yMax ?? dataMax * 1.05, M.t + innerH, M.t)
	);
	// Left margin fits the widest y label (≈6.3px per mono char at 10.5px).
	const ml = $derived(Math.max(28, ...y.ticks.map((t) => fmt(t, unit).length * 6.3 + 10)));
	const innerW = $derived(Math.max(50, width - ml - M.r));
	const band = $derived(innerW / Math.max(1, n));
	const xAt = (i: number) => (kind === 'bars' ? ml + band * i + band / 2 : ml + (n <= 1 ? 0 : (innerW * i) / (n - 1)));
	const xs = $derived(Array.from({ length: n }, (_, i) => xAt(i)));
	const ticks = $derived(tickIndices(n, Math.max(3, Math.floor(innerW / 90))));
	const clampY = (v: number) => Math.min(M.t + innerH, Math.max(M.t, y(v)));

	function onmove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const r = svg.getBoundingClientRect();
		const px = ((e.clientX - r.left) / r.width) * width;
		const i = kind === 'bars' ? Math.floor((px - ml) / band) : Math.round(((px - ml) / innerW) * (n - 1));
		hover = i >= 0 && i < n ? i : null;
	}

	const tipLeft = $derived(hover === null ? 0 : xs[hover] > width * 0.6 ? null : xs[hover] + 12);
	const tipRight = $derived(hover === null ? 0 : xs[hover] > width * 0.6 ? width - xs[hover] + 12 : null);
</script>

<div class="xy" bind:clientWidth={width}>
	<svg
		viewBox="0 0 {width} {height}"
		{height}
		role="img"
		aria-label="{kind === 'bars' ? 'Bar' : 'Line'} chart: {series.map((s) => s.name).join(', ')}"
		onpointermove={onmove}
		onpointerleave={() => (hover = null)}
	>
		<!-- grid + y axis -->
		{#each y.ticks as t (t)}
			<line class="grid" x1={ml} x2={width - M.r} y1={y(t)} y2={y(t)} />
			<text class="axis" x={ml - 6} y={y(t)} dy="0.32em" text-anchor="end">{fmt(t, unit)}</text>
		{/each}
		{#each ticks as i (i)}
			<text class="axis" x={xAt(i)} y={height - 6} text-anchor="middle">{x[i]}</text>
		{/each}

		<!-- thresholds -->
		{#each thresholds as t, i (i)}
			<line class="threshold {t.tone ?? 'crit'}" x1={ml} x2={width - M.r} y1={clampY(t.value)} y2={clampY(t.value)} />
			{#if t.label}<text class="tlabel {t.tone ?? 'crit'}" x={width - M.r - 4} y={clampY(t.value) - 4} text-anchor="end"
					>{t.label}</text
				>{/if}
		{/each}

		<!-- data -->
		{#if kind === 'line'}
			{#each series as s, si (si)}
				{#if visible[si]}
					{@const top = s.points.map((v, i) => (v == null ? null : y(stacked ? stacks.bases[si][i] + v : v)))}
					{#if area || stacked}
						<path
							class="area"
							style:fill="var(--s{s.color ?? si % 6})"
							d={areaPath(xs, top, stacked ? stacks.bases[si].map((b) => y(b)) : M.t + innerH)}
						/>
					{/if}
					<path class="line" class:dashed={s.dashed} style:stroke="var(--s{s.color ?? si % 6})" d={linePath(xs, top)} />
				{/if}
			{/each}
		{:else}
			{#each series as s, si (si)}
				{#if visible[si]}
					{@const visCount = stacked ? 1 : visible.filter(Boolean).length}
					{@const slot = stacked ? 0 : visible.slice(0, si).filter(Boolean).length}
					{@const bw = Math.max(1, (band * 0.78) / visCount)}
					{#each s.points as v, i (i)}
						{#if v != null && v > 0}
							{@const base = stacked ? stacks.bases[si][i] : 0}
							<rect
								class="bar"
								style:fill="var(--s{s.color ?? si % 6})"
								x={ml + band * i + band * 0.11 + slot * bw}
								width={bw}
								y={y(base + v)}
								height={Math.max(0.5, y(base) - y(base + v))}
							/>
						{/if}
					{/each}
				{/if}
			{/each}
		{/if}

		<!-- annotations -->
		{#each markers as m, i (i)}
			<line class="marker" x1={xAt(m.at)} x2={xAt(m.at)} y1={M.t} y2={M.t + innerH} />
			<text class="mlabel" x={xAt(m.at) + 4} y={M.t + 10 + (i % 2) * 12}>{m.label}</text>
		{/each}

		<!-- hover -->
		{#if hover !== null}
			<line class="cross" x1={xs[hover]} x2={xs[hover]} y1={M.t} y2={M.t + innerH} />
			{#if kind === 'line'}
				{#each series as s, si (si)}
					{@const v = s.points[hover]}
					{#if visible[si] && v != null}
						<circle class="dot" cx={xs[hover]} cy={y(stacked ? stacks.bases[si][hover] + v : v)} r="3" style:fill="var(--s{s.color ?? si % 6})" />
					{/if}
				{/each}
			{/if}
		{/if}
	</svg>

	{#if hover !== null}
		<div class="tip" style:left={tipLeft === null ? null : `${tipLeft}px`} style:right={tipRight === null ? null : `${tipRight}px`}>
			<div class="tx">{x[hover]}</div>
			{#each series as s, si (si)}
				{#if visible[si]}
					<div class="row"><i style:background="var(--s{s.color ?? si % 6})"></i><span>{s.name}</span><b>{fmt(s.points[hover], unit)}</b></div>
				{/if}
			{/each}
		</div>
	{/if}

	{#if series.length > 1 || series[0]?.name}
		<div class="legend">
			{#each series as s, si (si)}
				<button
					type="button"
					class:off={!visible[si]}
					onclick={() => (isolated = isolated === si ? null : si)}
					title="Click to isolate"
					><i class:dashed={s.dashed} style:background="var(--s{s.color ?? si % 6})"></i>{s.name}</button
				>
			{/each}
		</div>
	{/if}
</div>

<style>
	.xy {
		position: relative;
		min-width: 0;
	}
	svg {
		display: block;
		width: 100%;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--d-grid);
		stroke-width: 1;
	}
	.axis {
		fill: var(--d-muted);
		font-size: 10.5px;
		font-family: var(--f-mono);
	}
	.line {
		fill: none;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.line.dashed {
		stroke-dasharray: 5 4;
		opacity: 0.8;
	}
	.area {
		opacity: 0.18;
	}
	.bar {
		opacity: 0.9;
	}
	.threshold {
		stroke-dasharray: 4 3;
		stroke-width: 1.2;
	}
	.threshold.crit,
	.tlabel.crit {
		stroke: var(--d-crit);
		fill: var(--d-crit);
	}
	.threshold.warn,
	.tlabel.warn {
		stroke: var(--d-warn);
		fill: var(--d-warn);
	}
	.threshold.ok,
	.tlabel.ok,
	.threshold.info,
	.tlabel.info {
		stroke: var(--d-muted);
		fill: var(--d-muted);
	}
	.tlabel {
		font-size: 10px;
		font-family: var(--f-mono);
		stroke: none !important;
	}
	.marker {
		stroke: var(--d-marker);
		stroke-dasharray: 2 3;
		stroke-width: 1.3;
	}
	.mlabel {
		fill: var(--d-marker);
		font-size: 10px;
		font-family: var(--f-mono);
	}
	.cross {
		stroke: var(--d-muted);
		stroke-width: 1;
		opacity: 0.6;
	}
	.dot {
		stroke: var(--d-panel);
		stroke-width: 1.5;
	}
	.tip {
		position: absolute;
		top: 6px;
		pointer-events: none;
		background: var(--d-tip);
		color: var(--d-text);
		border: 1px solid var(--d-border);
		border-radius: 6px;
		padding: 6px 9px;
		font-family: var(--f-mono);
		font-size: 11.5px;
		box-shadow: 0 6px 18px -6px rgb(0 0 0 / 0.35);
		z-index: 2;
		max-width: 70%;
		display: grid;
		gap: 2px;
	}
	.tx {
		color: var(--d-muted);
	}
	.row {
		display: grid;
		grid-template-columns: 10px 1fr auto;
		gap: 6px;
		align-items: center;
	}
	.row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	i {
		display: inline-block;
		width: 10px;
		height: 3px;
		border-radius: 2px;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
		padding: 2px 0 0 40px;
	}
	.legend button {
		border: 0;
		background: none;
		color: var(--d-text);
		font-family: var(--f-mono);
		font-size: 11px;
		display: inline-flex;
		gap: 6px;
		align-items: center;
		padding: 2px 0;
		cursor: pointer;
	}
	.legend button.off {
		opacity: 0.4;
	}
	.legend i {
		width: 12px;
	}
	.legend i.dashed {
		background-image: linear-gradient(90deg, transparent 50%, var(--d-panel) 50%) !important;
		background-size: 6px 3px;
	}
</style>
