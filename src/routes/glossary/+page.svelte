<script lang="ts">
	import { glossary } from '$lib/content';
	import { plainText } from '$lib/content/inline';
	import type { GlossaryCategory } from '$lib/content/types';
	import { termHref } from '$lib/paths';
	import Rich from '$lib/components/Rich.svelte';

	let query = $state('');
	let category = $state<GlossaryCategory | null>(null);
	let onlyPages = $state(false);

	const categories = [...new Set(glossary.map((t) => t.category))].sort();
	const haystack = new Map(glossary.map((t) => [t.id, `${t.term} ${(t.aliases ?? []).join(' ')} ${plainText(t.short)}`.toLowerCase()]));

	const filtered = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return glossary.filter(
			(t) =>
				(!category || t.category === category) &&
				(!onlyPages || t.page) &&
				words.every((w) => haystack.get(t.id)!.includes(w))
		);
	});

	const byLetter = $derived.by(() => {
		const groups = new Map<string, typeof glossary>();
		for (const t of filtered) {
			const ch = /[a-z]/i.test(t.term[0]) ? t.term[0].toUpperCase() : '#';
			groups.set(ch, [...(groups.get(ch) ?? []), t]);
		}
		return [...groups];
	});
</script>

<svelte:head>
	<title>Glossary · Drillbook</title>
	<meta name="description" content="Plain-language definitions of every term used in the drills, with worked-example pages." />
</svelte:head>

<div class="wrap">
	<header class="hero">
		<span class="eyebrow">Glossary · {glossary.length} terms · {glossary.filter((t) => t.page).length} with full explainers</span>
		<h1>Glossary</h1>
		<p class="lede">
			Definitions written to build understanding, not just recognition. Terms marked <span class="chip">explainer</span> have a full
			page with worked examples.
		</p>
	</header>

	<div class="controls">
		<input type="search" bind:value={query} placeholder="Filter terms…" aria-label="Filter terms" />
		<label class="toggle"><input type="checkbox" bind:checked={onlyPages} /> explainers only</label>
	</div>
	<div class="cats" role="group" aria-label="Category">
		<button type="button" class:on={!category} onclick={() => (category = null)}>all</button>
		{#each categories as c (c)}
			<button type="button" class:on={category === c} onclick={() => (category = category === c ? null : c)}>{c}</button>
		{/each}
	</div>

	<p class="count">{filtered.length} {filtered.length === 1 ? 'term' : 'terms'}</p>

	{#each byLetter as [letter, terms] (letter)}
		<section class="letter">
			<h2>{letter}</h2>
			<ul>
				{#each terms as t (t.id)}
					<li>
						<a href={termHref(t.id)} class="name">{t.term}</a>
						{#if t.page}<span class="chip">explainer</span>{/if}
						<span class="cat">{t.category}</span>
						<p><Rich text={t.short} plainTerms /></p>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="empty">No terms match.</p>
	{/each}
</div>

<style>
	.hero {
		padding-block: 40px 20px;
		display: grid;
		gap: 12px;
	}
	.controls {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}
	.controls input[type='search'] {
		flex: 1;
		min-width: 200px;
		font: inherit;
		padding: 9px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
	}
	.toggle {
		font-family: var(--f-mono);
		font-size: 12.5px;
		color: var(--muted);
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.toggle input {
		accent-color: var(--accent);
	}
	.cats {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}
	.cats button {
		font-family: var(--f-mono);
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--surface);
		cursor: pointer;
		color: var(--muted);
	}
	.cats button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--surface);
	}
	.count {
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		margin: 16px 0 0;
	}
	.letter {
		display: grid;
		grid-template-columns: 2.4rem 1fr;
		gap: 12px;
		padding-block: 18px;
		border-bottom: 1px solid var(--line);
	}
	.letter h2 {
		color: var(--accent);
		font-size: 1.6rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 16px;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: baseline;
	}
	.name {
		font-family: var(--f-display);
		font-weight: 600;
		font-size: 1.1rem;
		color: var(--ink);
		text-decoration: none;
	}
	.name:hover {
		color: var(--accent);
	}
	.cat {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
	}
	li p {
		flex-basis: 100%;
		color: var(--muted);
		font-size: 15px;
	}
	.empty {
		padding: 30px 0;
		color: var(--muted);
	}
	@media (max-width: 520px) {
		.letter {
			grid-template-columns: 1fr;
		}
	}
</style>
