<!-- Latency-style heatmap: columns are time buckets, rows are value buckets (bottom → top). -->
<script lang="ts">
	import { fmt, tickIndices } from './scale';

	let { x, y, values, unit = '' }: { x: string[]; y: string[]; values: number[][]; unit?: string } = $props();

	let width = $state(600);
	let hover = $state<{ r: number; c: number } | null>(null);
	const M = { l: 70, r: 8, t: 6, b: 22 };
	const rowH = $derived(Math.max(14, Math.min(26, 170 / Math.max(1, y.length))));
	const height = $derived(M.t + M.b + rowH * y.length);
	const cellW = $derived((width - M.l - M.r) / Math.max(1, x.length));
	const max = $derived(Math.max(1, ...values.flat()));
	const ticks = $derived(tickIndices(x.length, Math.max(3, Math.floor((width - M.l) / 90))));
	// sqrt scale so small-but-nonzero buckets stay visible
	const level = (v: number) => (v <= 0 ? 0 : 0.12 + 0.88 * Math.sqrt(v / max));
</script>

<div class="hm" bind:clientWidth={width}>
	<svg viewBox="0 0 {width} {height}" {height} role="img" aria-label="Heatmap" onpointerleave={() => (hover = null)}>
		{#each y as label, r (r)}
			{@const top = M.t + (y.length - 1 - r) * rowH}
			<text class="axis" x={M.l - 6} y={top + rowH / 2} dy="0.32em" text-anchor="end">{label}</text>
			{#each values[r] as v, c (c)}
				<rect
					x={M.l + c * cellW}
					y={top}
					width={Math.max(0.5, cellW - 1)}
					height={rowH - 1}
					class="cell"
					style:fill-opacity={level(v)}
					onpointerenter={() => (hover = { r, c })}
					role="presentation"
				/>
			{/each}
		{/each}
		{#each ticks as i (i)}
			<text class="axis" x={M.l + i * cellW + cellW / 2} y={height - 6} text-anchor="middle">{x[i]}</text>
		{/each}
	</svg>
	{#if hover}
		<div class="tip">{x[hover.c]} · {y[hover.r]} · <b>{fmt(values[hover.r][hover.c], unit)}</b></div>
	{/if}
</div>

<style>
	.hm {
		position: relative;
		min-width: 0;
	}
	svg {
		display: block;
		width: 100%;
	}
	.cell {
		fill: var(--d-heat);
	}
	.cell:hover {
		stroke: var(--d-text);
		stroke-width: 1;
	}
	.axis {
		fill: var(--d-muted);
		font-size: 10.5px;
		font-family: var(--f-mono);
	}
	.tip {
		position: absolute;
		right: 8px;
		top: 0;
		font-family: var(--f-mono);
		font-size: 11.5px;
		background: var(--d-tip);
		color: var(--d-text);
		border: 1px solid var(--d-border);
		border-radius: 6px;
		padding: 3px 8px;
		pointer-events: none;
	}
</style>
