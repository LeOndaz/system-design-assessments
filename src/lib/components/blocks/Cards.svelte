<script lang="ts">
	import Rich from '../Rich.svelte';

	let { items }: { items: { title: string; items: string[] }[] } = $props();
</script>

<div class="grid">
	{#each items as c, i (i)}
		<div class="mini">
			<h4><Rich text={c.title} /></h4>
			<ul>{#each c.items as it, j (j)}<li><Rich text={it} /></li>{/each}</ul>
		</div>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 12px;
	}
	.mini {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 14px 16px;
		display: grid;
		gap: 6px;
		align-content: start;
		font-size: 14.5px;
		min-width: 0;
	}
	h4 {
		font-family: var(--f-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	ul {
		margin: 0;
		padding-left: 1.1em;
		display: grid;
		gap: 3px;
	}
</style>
