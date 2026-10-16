<script lang="ts">
	import type { Threshold } from '$lib/content/types';
	import { fmt } from './scale';

	let { value, max, unit = '', thresholds = [] }: { value: number; max: number; unit?: string; thresholds?: Threshold[] } = $props();

	const frac = $derived(Math.max(0, Math.min(1, value / max)));
	const tone = $derived.by(() => {
		let t: string = 'ok';
		for (const th of [...thresholds].sort((a, b) => a.value - b.value)) if (value >= th.value) t = th.tone ?? 'crit';
		return t;
	});
	// semicircle from 180° to 0°
	const R = 52;
	const arc = (f: number) => {
		const a = Math.PI * (1 - f);
		return `${60 + R * Math.cos(a)},${62 - R * Math.sin(a)}`;
	};
</script>

<div class="gauge">
	<svg viewBox="0 0 120 70" role="img" aria-label="{fmt(value, unit)} of {fmt(max, unit)}">
		<path d="M{arc(0)} A{R},{R} 0 0 1 {arc(1)}" class="track" />
		{#if frac > 0}<path d="M{arc(0)} A{R},{R} 0 0 1 {arc(frac)}" class="val {tone}" />{/if}
		<text x="60" y="58" text-anchor="middle" class="num">{fmt(value, unit)}</text>
	</svg>
	<div class="range"><span>0</span><span>{fmt(max, unit)}</span></div>
</div>

<style>
	.gauge {
		max-width: 220px;
		margin: 0 auto;
		width: 100%;
	}
	svg {
		width: 100%;
		display: block;
	}
	path {
		fill: none;
		stroke-width: 10;
		stroke-linecap: round;
	}
	.track {
		stroke: var(--d-grid);
	}
	.val.ok {
		stroke: var(--d-ok);
	}
	.val.warn {
		stroke: var(--d-warn);
	}
	.val.crit {
		stroke: var(--d-crit);
	}
	.val.info {
		stroke: var(--s1);
	}
	.num {
		fill: var(--d-text);
		font-size: 17px;
		font-weight: 600;
		font-family: var(--f-mono);
	}
	.range {
		display: flex;
		justify-content: space-between;
		font-family: var(--f-mono);
		font-size: 10.5px;
		color: var(--d-muted);
		padding: 0 6px;
	}
</style>
