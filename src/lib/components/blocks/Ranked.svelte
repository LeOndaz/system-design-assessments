<script lang="ts">
	import type { RankedItem } from '$lib/content/types';
	import Rich from '../Rich.svelte';

	let { items }: { items: RankedItem[] } = $props();
</script>

<ol class="rank">
	{#each items as it, i (i)}
		<li>
			<span class="n" aria-hidden="true">{i + 1}</span>
			<div class="body">
				<p class="title"><Rich text={it.title} /></p>
				{#if it.body}<p><Rich text={it.body} /></p>{/if}
				{#if it.confirm}<p class="confirm"><span class="lbl">Confirm</span> <Rich text={it.confirm} /></p>{/if}
			</div>
		</li>
	{/each}
</ol>

<style>
	.rank {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	li {
		display: grid;
		grid-template-columns: 2.1em 1fr;
		gap: 10px;
		min-width: 0;
	}
	.n {
		font-family: var(--f-mono);
		font-weight: 500;
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: 4px;
		text-align: center;
		height: 1.6em;
		line-height: 1.6em;
		margin-top: 0.05em;
	}
	.body {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.title {
		font-weight: 600;
	}
	.confirm {
		color: var(--muted);
		font-size: 0.95em;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 6px;
		border-radius: 3px;
		margin-right: 2px;
	}
</style>
