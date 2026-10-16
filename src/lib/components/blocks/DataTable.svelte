<script lang="ts">
	import Rich from '../Rich.svelte';

	let {
		head,
		rows,
		numeric = [],
		caption
	}: { head: string[]; rows: string[][]; numeric?: number[]; caption?: string } = $props();
</script>

<figure>
	<div class="tablewrap">
		<table>
			<thead>
				<tr>{#each head as h, i (i)}<th class:num={numeric.includes(i)}><Rich text={h} /></th>{/each}</tr>
			</thead>
			<tbody>
				{#each rows as r, i (i)}
					<tr>{#each r as c, j (j)}<td class:num={numeric.includes(j)}><Rich text={c} /></td>{/each}</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if caption}<figcaption><Rich text={caption} /></figcaption>{/if}
</figure>

<style>
	figure {
		margin: 0;
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.tablewrap {
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 14px;
	}
	th,
	td {
		text-align: left;
		padding: 9px 12px;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
		min-width: 90px;
	}
	th {
		font-family: var(--f-mono);
		font-size: 12px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 500;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-family: var(--f-mono);
	}
	figcaption {
		font-size: 13px;
		color: var(--muted);
	}
</style>
