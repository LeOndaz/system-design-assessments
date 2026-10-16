<script lang="ts">
	import type { Tone } from '$lib/content/types';
	import Rich from '../Rich.svelte';

	let { tone = 'info', title, text }: { tone?: Tone; title?: string; text: string } = $props();
</script>

<aside class="callout {tone}">
	{#if title}<h4><Rich text={title} /></h4>{/if}
	<p><Rich {text} /></p>
</aside>

<style>
	.callout {
		border-radius: var(--radius);
		padding: 14px 18px;
		display: grid;
		gap: 6px;
		border-left: 3px solid;
	}
	.info {
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.info h4 {
		color: var(--accent);
	}
	.warn {
		background: var(--warn-soft);
		border-color: var(--warn);
	}
	.warn h4 {
		color: var(--warn);
	}
	.crit {
		background: var(--crit-soft);
		border-color: var(--crit);
	}
	.crit h4 {
		color: var(--crit);
	}
	.ok {
		background: var(--ok-soft);
		border-color: var(--ok);
	}
	.ok h4 {
		color: var(--ok);
	}
</style>
