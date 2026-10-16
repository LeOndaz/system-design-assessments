<script lang="ts">
	import type { Part, Question } from '$lib/content/types';
	import Blocks from './Blocks.svelte';
	import QuestionCard from './QuestionCard.svelte';
	import Rich from './Rich.svelte';

	let { part, assessmentId, index }: { part: Part; assessmentId: string; index: number } = $props();

	let reveal = $state(0);
	const allOpen = $derived(reveal > 0);

	/** Consecutive questions with the same `group` render under one sub-heading. */
	const groups = $derived.by(() => {
		const out: { title?: string; items: { q: Question; n: number }[] }[] = [];
		part.questions.forEach((q, i) => {
			const last = out[out.length - 1];
			if (last && last.title === q.group) last.items.push({ q, n: i + 1 });
			else out.push({ title: q.group, items: [{ q, n: i + 1 }] });
		});
		return out;
	});
</script>

<section class="part" id={part.id}>
	<div class="head">
		<span class="eyebrow">{part.eyebrow}</span>
		<h2><Rich text={part.title} /></h2>
		{#if part.meta || part.questions.some((q) => q.answer.length)}
			<div class="meta">
				{#if part.meta}<span><Rich text={part.meta} /></span>{/if}
				{#if part.questions.length}
					<button type="button" class="btn" onclick={() => (reveal = allOpen ? -Math.abs(reveal) - 1 : Math.abs(reveal) + 1)}>
						{allOpen ? 'Hide all answers' : 'Reveal all answers'}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if part.intro}<div class="intro"><Blocks blocks={part.intro} /></div>{/if}

	{#each groups as g, gi (gi)}
		{#if g.title}<h3 class="group">{g.title}</h3>{/if}
		{#each g.items as { q, n } (q.id)}
			<QuestionCard question={q} {assessmentId} number="{index + 1}.{n}" revealAll={reveal} />
		{/each}
	{/each}

	{#if part.outro}<div class="intro"><Blocks blocks={part.outro} /></div>{/if}
</section>

<style>
	.part {
		padding-block: 44px 8px;
		display: grid;
		gap: 18px;
		scroll-margin-top: 110px;
		/* Skip layout/paint for parts far off-screen: pages carry dozens of SVG dashboards. */
		content-visibility: auto;
		contain-intrinsic-size: auto 2400px;
	}
	.head {
		display: grid;
		gap: 8px;
		border-top: 3px solid var(--ink);
		padding-top: 14px;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: center;
		font-family: var(--f-mono);
		font-size: 13px;
		color: var(--muted);
	}
	.intro {
		display: grid;
		gap: 14px;
	}
	.group {
		font-family: var(--f-mono);
		font-weight: 500;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
		margin-top: 10px;
	}
</style>
