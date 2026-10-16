<script lang="ts">
	import { areaPath, linePath } from './scale';

	let { points, color = 'var(--s0)' }: { points: number[]; color?: string } = $props();
	const W = 120;
	const H = 30;
	const xs = $derived(points.map((_, i) => (i / Math.max(1, points.length - 1)) * W));
	const max = $derived(Math.max(...points, 1));
	const min = $derived(Math.min(...points, 0));
	const ys = $derived(points.map((v) => H - 2 - ((v - min) / (max - min || 1)) * (H - 4)));
</script>

<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
	<path d={areaPath(xs, ys, H)} style:fill={color} opacity="0.18" />
	<path d={linePath(xs, ys)} style:stroke={color} fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke" />
</svg>

<style>
	svg {
		width: 100%;
		height: 30px;
		display: block;
	}
</style>
