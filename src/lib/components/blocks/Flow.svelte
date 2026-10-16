<script lang="ts">
	import type { FlowStep } from '$lib/content/types';
	import Rich from '../Rich.svelte';

	let { steps, caption }: { steps: FlowStep[]; caption?: string } = $props();
</script>

<figure>
	<ol class="flow">
		{#each steps as s, i (i)}
			<li class="step {s.tone ?? ''}">
				<span class="label"><Rich text={s.label} /></span>
				{#if s.note}<span class="note"><Rich text={s.note} /></span>{/if}
			</li>
		{/each}
	</ol>
	{#if caption}<figcaption><Rich text={caption} /></figcaption>{/if}
</figure>

<style>
	figure {
		margin: 0;
		display: grid;
		gap: 6px;
	}
	.flow {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 22px 26px;
		align-items: stretch;
	}
	.step {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 12px;
		display: grid;
		gap: 2px;
		min-width: 0;
		max-width: 100%;
	}
	.step:not(:last-child)::after {
		content: '→';
		position: absolute;
		right: -20px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--muted);
		font-family: var(--f-mono);
	}
	.label {
		font-weight: 600;
		font-size: 14px;
	}
	.note {
		font-size: 12.5px;
		color: var(--muted);
	}
	.warn {
		border-color: var(--warn);
		background: var(--warn-soft);
	}
	.crit {
		border-color: var(--crit);
		background: var(--crit-soft);
	}
	.ok {
		border-color: var(--ok);
		background: var(--ok-soft);
	}
	.info {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	figcaption {
		font-size: 13px;
		color: var(--muted);
	}
</style>
