<script lang="ts">
	import { assessments, getAssessment } from '$lib/content';
	import { plainText } from '$lib/content/inline';
	import { assessmentHref } from '$lib/paths';
	import { progress } from '$lib/state/progress.svelte';
	import Blocks from '$lib/components/Blocks.svelte';
	import PartSection from '$lib/components/PartSection.svelte';
	import Rich from '$lib/components/Rich.svelte';

	let { data } = $props();
	const a = $derived(getAssessment(data.id)!);
	const idx = $derived(assessments.indexOf(a));
	const prev = $derived(assessments[idx - 1]);
	const next = $derived(assessments[idx + 1]);
	const qids = $derived(a.parts.flatMap((p) => p.questions.map((q) => q.id)));
	const done = $derived(progress.count(a.id, qids));

	// Scroll-spy: highlight the part currently in view.
	let current = $state('');
	$effect(() => {
		void a.id;
		const els = a.parts.map((p) => document.getElementById(p.id)).filter(Boolean) as HTMLElement[];
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) if (e.isIntersecting) current = e.target.id;
			},
			{ rootMargin: '-120px 0px -65% 0px' }
		);
		els.forEach((el) => io.observe(el));
		return () => io.disconnect();
	});

	function resetProgress() {
		for (const id of qids) progress.set(a.id, id, false);
	}
</script>

<svelte:head>
	<title>{a.number}. {a.title} · Drillbook</title>
	<meta name="description" content={plainText(a.description)} />
</svelte:head>

<nav class="tabs" aria-label="Parts">
	<div class="inner">
		{#if a.overview}<a href="#overview" class:active={current === ''}>Plan</a>{/if}
		{#each a.parts as p (p.id)}
			<a href="#{p.id}" class:active={current === p.id}>{p.nav}</a>
		{/each}
		<span class="count" title="Questions done">{done}/{qids.length}</span>
	</div>
</nav>

<div class="wrap">
	<header class="hero">
		<span class="eyebrow">Assessment {a.number} · {a.minutes} minutes · {a.difficulty}</span>
		<h1>{a.title}</h1>
		<p class="lede"><Rich text={a.description} /></p>
		<div class="topics">{#each a.topics as t (t)}<span>{t}</span>{/each}</div>
	</header>

	{#if a.overview}
		<section class="overview" id="overview">
			<div class="head">
				<span class="eyebrow">Overview</span>
				<h2>How the time splits</h2>
			</div>
			<Blocks blocks={a.overview} />
		</section>
	{/if}

	{#each a.parts as part, pi (part.id)}
		<PartSection {part} assessmentId={a.id} index={pi} />
	{/each}

	<div class="end">
		<button type="button" class="btn" onclick={resetProgress}>Reset progress for this assessment</button>
		<div class="pn">
			{#if prev}<a class="btn" href={assessmentHref(prev.id)}>← {prev.number}. {prev.title}</a>{/if}
			{#if next}<a class="btn primary" href={assessmentHref(next.id)}>{next.number}. {next.title} →</a>{/if}
		</div>
	</div>
</div>

<style>
	.tabs {
		position: sticky;
		top: calc(45px + env(safe-area-inset-top, 0px));
		z-index: 10;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	.tabs .inner {
		max-width: var(--max);
		margin: 0 auto;
		padding: 7px 16px;
		display: flex;
		gap: 4px;
		overflow-x: auto;
		align-items: center;
		scrollbar-width: none;
	}
	.tabs a {
		font-family: var(--f-mono);
		font-size: 13px;
		text-decoration: none;
		color: var(--muted);
		padding: 5px 10px;
		border-radius: 6px;
		white-space: nowrap;
		border: 1px solid transparent;
	}
	.tabs a:hover {
		color: var(--ink);
	}
	.tabs a.active {
		color: var(--ink);
		border-color: var(--line);
		background: var(--surface);
	}
	.count {
		margin-left: auto;
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		padding-left: 10px;
	}
	.hero {
		padding-block: 40px 16px;
		display: grid;
		gap: 12px;
	}
	.topics {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.topics span {
		font-size: 12.5px;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--muted);
	}
	.overview {
		padding-block: 32px 8px;
		display: grid;
		gap: 16px;
		scroll-margin-top: 110px;
	}
	.head {
		display: grid;
		gap: 8px;
		border-top: 3px solid var(--ink);
		padding-top: 14px;
	}
	.end {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		justify-content: space-between;
		padding-block: 48px 0;
	}
	.pn {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
