<!-- One live metric tile: current value, threshold colouring, rolling sparkline. -->
<script lang="ts">
	import type { LabMetric } from '$lib/content/types';
	import { fmt, linePath } from '$lib/charts/scale';

	let { metric, value, history, frame }: { metric: LabMetric; value: number; history: number[]; frame: number } = $props();

	const W = 160;
	const H = 38;
	const pts = $derived.by(() => {
		void frame;
		return [...history];
	});
	const max = $derived(metric.max ?? Math.max(1, ...pts, ...(metric.thresholds ?? []).map((t) => t.value)) * 1.1);
	const xs = $derived(pts.map((_, i) => W - (pts.length - 1 - i) * (W / 119)));
	const ys = $derived(pts.map((v) => H - 2 - (Math.min(v, max) / max) * (H - 4)));
	const tone = $derived.by(() => {
		let t: string = 'ok';
		for (const th of [...(metric.thresholds ?? [])].sort((a, b) => a.value - b.value)) if (value >= th.value) t = th.tone ?? 'crit';
		if (metric.alarm !== undefined && value > metric.alarm) t = 'crit';
		return t;
	});
</script>

<div class="tile {tone}">
	<div class="lbl">{metric.label}</div>
	<div class="val">{fmt(Math.abs(value) >= 10 ? Math.round(value) : value, metric.unit ?? '')}</div>
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
		{#each metric.thresholds ?? [] as th, i (i)}
			<line x1="0" x2={W} y1={H - 2 - (th.value / max) * (H - 4)} y2={H - 2 - (th.value / max) * (H - 4)} class="th" />
		{/each}
		{#if metric.alarm !== undefined}
			<line x1="0" x2={W} y1={H - 2 - (metric.alarm / max) * (H - 4)} y2={H - 2 - (metric.alarm / max) * (H - 4)} class="th" />
		{/if}
		<path d={linePath(xs, ys)} class="ln" vector-effect="non-scaling-stroke" />
	</svg>
</div>

<style>
	.tile {
		background: var(--c-panel);
		border: 1px solid var(--c-line);
		border-left: 3px solid var(--c-ok);
		border-radius: 4px;
		padding: 6px 10px 4px;
		display: grid;
		min-width: 0;
	}
	.tile.warn {
		border-left-color: var(--c-warn);
	}
	.tile.crit {
		border-left-color: var(--c-crit);
	}
	.lbl {
		font-size: 11.5px;
		color: var(--c-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.val {
		font-size: 20px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}
	.warn .val {
		color: var(--c-warn);
	}
	.crit .val {
		color: var(--c-crit);
	}
	svg {
		width: 100%;
		height: 38px;
		display: block;
	}
	.ln {
		fill: none;
		stroke: var(--c-link);
		stroke-width: 1.5;
	}
	.crit .ln {
		stroke: var(--c-crit);
	}
	.th {
		stroke: var(--c-crit);
		stroke-dasharray: 3 3;
		stroke-width: 1;
		opacity: 0.6;
		vector-effect: non-scaling-stroke;
	}
</style>
