<script lang="ts">
	import { assessments, getTerm, glossary } from '$lib/content';
	import { plainText } from '$lib/content/inline';
	import { termUsage } from '$lib/content/walk';
	import { assessmentHref, href, termHref } from '$lib/paths';
	import Blocks from '$lib/components/Blocks.svelte';
	import Rich from '$lib/components/Rich.svelte';

	let { data } = $props();
	const usage = termUsage(assessments);

	const t = $derived(getTerm(data.id)!);
	const related = $derived((t.related ?? []).map(getTerm).filter((x) => x !== undefined));
	// Terms that list this one as related, for a two-way "see also".
	const backlinks = $derived(glossary.filter((g) => g.related?.includes(t.id) && !t.related?.includes(g.id)));
	const uses = $derived(usage.get(t.id) ?? []);
</script>

<svelte:head>
	<title>{t.term} · Glossary · Drillbook</title>
	<meta name="description" content={plainText(t.short, (id) => getTerm(id)?.term ?? id)} />
</svelte:head>

<div class="wrap">
	<nav class="crumbs" aria-label="Breadcrumb"><a href={href('/glossary')}>Glossary</a> / <span>{t.category}</span></nav>

	<header class="hero">
		<h1>{t.term}</h1>
		{#if t.aliases?.length}<p class="aliases">also: {t.aliases.join(' · ')}</p>{/if}
		{#if t.wiki}<p class="aliases"><a href={t.wiki} target="_blank" rel="noreferrer">Read more on Wikipedia ↗</a></p>{/if}
		<p class="short"><Rich text={t.short} /></p>
		{#if t.analogy}
			<aside class="analogy"><span class="lbl">Think of it as</span> <Rich text={t.analogy} /></aside>
		{/if}
	</header>

	{#if t.page}
		<article class="page"><Blocks blocks={t.page} /></article>
	{/if}

	{#if related.length || backlinks.length}
		<section class="side">
			<h2>Related</h2>
			<div class="rel">
				{#each [...related, ...backlinks] as r (r.id)}
					<a href={termHref(r.id)}><strong>{r.term}</strong><span><Rich text={r.short} plainTerms /></span></a>
				{/each}
			</div>
		</section>
	{/if}

	{#if uses.length}
		<section class="side">
			<h2>Where it shows up</h2>
			<ul class="uses">
				{#each uses as u (u.assessment.id + u.question.id)}
					<li>
						<a href={assessmentHref(u.assessment.id, `q-${u.question.id}`)}>{plainText(u.question.title, (id) => getTerm(id)?.term ?? id)}</a>
						<span>{u.assessment.title}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.crumbs {
		padding-top: 28px;
		font-family: var(--f-mono);
		font-size: 12.5px;
		color: var(--muted);
	}
	.crumbs a {
		color: var(--muted);
	}
	.hero {
		padding-block: 14px 24px;
		display: grid;
		gap: 14px;
	}
	.aliases {
		font-family: var(--f-mono);
		font-size: 13px;
		color: var(--muted);
	}
	.short {
		font-size: 1.15rem;
		line-height: 1.6;
		max-width: 68ch;
	}
	.analogy {
		border-left: 3px solid var(--accent);
		padding: 4px 0 4px 14px;
		color: var(--muted);
		max-width: 68ch;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.page {
		display: grid;
		gap: 14px;
		padding: 24px 0 8px;
		border-top: 3px solid var(--ink);
	}
	.page :global(> p),
	.page :global(> ul),
	.page :global(> ol) {
		max-width: 72ch;
	}
	.side {
		padding-top: 32px;
		display: grid;
		gap: 12px;
	}
	.side h2 {
		font-size: 1.3rem;
	}
	.rel {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 10px;
	}
	.rel a {
		display: grid;
		gap: 4px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
		font-size: 14px;
	}
	.rel a:hover {
		border-color: var(--accent);
	}
	.rel span {
		color: var(--muted);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.uses {
		margin: 0;
		padding-left: 1.2em;
		display: grid;
		gap: 6px;
	}
	.uses span {
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		margin-left: 6px;
	}
</style>
