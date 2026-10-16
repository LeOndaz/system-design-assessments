<!-- Renders a list of content blocks. One switch, one component per non-trivial block type. -->
<script lang="ts">
	import type { Block } from '$lib/content/types';
	import Rich from './Rich.svelte';
	import Ranked from './blocks/Ranked.svelte';
	import CodeBlock from './blocks/CodeBlock.svelte';
	import Callout from './blocks/Callout.svelte';
	import DataTable from './blocks/DataTable.svelte';
	import Cards from './blocks/Cards.svelte';
	import Budget from './blocks/Budget.svelte';
	import TicketView from './blocks/TicketView.svelte';
	import Flow from './blocks/Flow.svelte';
	import Dashboard from '$lib/charts/Dashboard.svelte';
	import LogView from '$lib/charts/LogView.svelte';
	import TraceView from '$lib/charts/TraceView.svelte';
	import LabConsole from '$lib/labs/LabConsole.svelte';
	import MockScreenView from '$lib/mock/MockScreen.svelte';
	import Terminal from '$lib/terminal/Terminal.svelte';
	import DiffView from '$lib/review/DiffView.svelte';
	import Self from './Blocks.svelte';

	let { blocks }: { blocks: Block[] } = $props();
</script>

{#each blocks as b, i (i)}
	{#if b.type === 'p'}
		<p><Rich text={b.text} /></p>
	{:else if b.type === 'heading'}
		<h4 class="sub"><Rich text={b.text} /></h4>
	{:else if b.type === 'list'}
		{#if b.ordered}
			<ol class="list">{#each b.items as it, j (j)}<li><Rich text={it} /></li>{/each}</ol>
		{:else}
			<ul class="list">{#each b.items as it, j (j)}<li><Rich text={it} /></li>{/each}</ul>
		{/if}
	{:else if b.type === 'ranked'}
		<Ranked items={b.items} />
	{:else if b.type === 'code'}
		<CodeBlock code={b.code} lang={b.lang} caption={b.caption} />
	{:else if b.type === 'callout'}
		<Callout tone={b.tone} title={b.title} text={b.text} />
	{:else if b.type === 'table'}
		<DataTable head={b.head} rows={b.rows} numeric={b.numeric} caption={b.caption} />
	{:else if b.type === 'cards'}
		<Cards items={b.items} />
	{:else if b.type === 'budget'}
		<Budget items={b.items} />
	{:else if b.type === 'ticket'}
		<TicketView ticket={b.ticket} />
	{:else if b.type === 'dashboard'}
		<Dashboard dashboard={b.dashboard} />
	{:else if b.type === 'logs'}
		<LogView logs={b.logs} />
	{:else if b.type === 'trace'}
		<TraceView trace={b.trace} />
	{:else if b.type === 'flow'}
		<Flow steps={b.steps} caption={b.caption} />
	{:else if b.type === 'lab'}
		<LabConsole lab={b.lab} />
	{:else if b.type === 'mock'}
		<MockScreenView mock={b.mock} />
	{:else if b.type === 'terminal'}
		<Terminal scenario={b.terminal} />
	{:else if b.type === 'diff'}
		<DiffView diff={b.diff} />
	{:else if b.type === 'columns'}
		<div class="columns">
			{#each b.columns as col, j (j)}
				<div class="col">
					{#if col.title}<h4 class="sub"><Rich text={col.title} /></h4>{/if}
					<Self blocks={col.blocks} />
				</div>
			{/each}
		</div>
	{/if}
{/each}

<style>
	.list {
		margin: 0;
		padding-left: 1.25em;
		display: grid;
		gap: 4px;
	}
	.list :global(li::marker) {
		color: var(--accent);
	}
	.sub {
		font-family: var(--f-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		margin-top: 4px;
	}
	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 14px;
	}
	.col {
		display: grid;
		gap: 10px;
		align-content: start;
		min-width: 0;
	}
</style>
