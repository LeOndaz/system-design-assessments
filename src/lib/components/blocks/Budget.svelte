<script lang="ts">
	import Rich from '../Rich.svelte';

	let { items }: { items: { label: string; minutes: number }[] } = $props();
	const max = $derived(Math.max(...items.map((i) => i.minutes)));
	const total = $derived(items.reduce((s, i) => s + i.minutes, 0));
</script>

<div class="budget" role="list" aria-label="Time budget, {total} minutes total">
	{#each items as it, i (i)}
		<div class="bar" role="listitem">
			<span class="label"><Rich text={it.label} /></span>
			<div class="track"><div class="fill" class:big={it.minutes === max} style:width="{(it.minutes / max) * 100}%"></div></div>
			<span class="mins">{it.minutes}m</span>
		</div>
	{/each}
	<div class="total">Total <strong>{total} min</strong></div>
</div>

<style>
	.budget {
		display: grid;
		gap: 8px;
	}
	.bar {
		display: grid;
		grid-template-columns: minmax(7.5em, 11em) 1fr 3.5em;
		gap: 10px;
		align-items: center;
		font-size: 14px;
	}
	.track {
		height: 12px;
		background: var(--code-bg);
		border-radius: 3px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
	}
	.fill.big {
		background: var(--warn);
	}
	.mins {
		font-family: var(--f-mono);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.total {
		font-family: var(--f-mono);
		font-size: 12.5px;
		color: var(--muted);
		text-align: right;
	}
</style>
