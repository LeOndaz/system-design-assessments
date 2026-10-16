<script lang="ts">
	import { timer } from '$lib/state/timer.svelte';

	const presets = [15, 20, 25, 55];
	const display = $derived.by(() => {
		if (!timer.running) return '--:--';
		const s = timer.left;
		if (s === 0) return 'time';
		return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	});
</script>

<div class="timer" role="group" aria-label="Practice timer">
	{#each presets as m (m)}
		<button type="button" class="preset" class:keep={m === 25} onclick={() => timer.start(m)} title="Start {m}-minute timer">{m}</button>
	{/each}
	<span class="disp" class:idle={!timer.running} class:low={timer.running && timer.left <= 120} aria-live="polite">{display}</span>
	{#if timer.running}<button type="button" onclick={() => timer.stop()} aria-label="Stop timer">■</button>{/if}
</div>

<style>
	.timer {
		display: flex;
		gap: 4px;
		align-items: center;
		font-family: var(--f-mono);
		font-size: 12.5px;
	}
	button {
		padding: 4px 7px;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
		font-size: inherit;
	}
	button:hover {
		border-color: var(--muted);
	}
	.disp {
		min-width: 5ch;
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.low {
		color: var(--crit);
	}
	@media (max-width: 640px) {
		.preset:not(.keep),
		.disp.idle {
			display: none;
		}
	}
</style>
