<script lang="ts">
	import { onMount } from 'svelte';
	import { assessments, glossary } from '$lib/content';
	import { termUsage } from '$lib/content/walk';
	import type { GlossaryTerm } from '$lib/content/types';
	import { deck, preview, type Grade } from '$lib/state/srs.svelte';
	import { storage } from '$lib/state/storage';
	import { termHref } from '$lib/paths';
	import Rich from '$lib/components/Rich.svelte';

	const usage = termUsage(assessments);
	const categories = [...new Set(glossary.map((t) => t.category))].sort();

	let source = $state<string>('all'); // 'all' | 'cat:<category>' | 'a:<assessmentId>'
	let newPerSession = $state(20);
	let now = $state(Date.now());
	let flipped = $state(false);
	let current = $state<GlossaryTerm | null>(null);
	let reviewedThisSession = $state(0);

	onMount(() => {
		deck.load();
		const s = storage.get('drills:srs:source');
		if (s) source = s;
		next();
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	const inSource = $derived.by(() => {
		if (source.startsWith('cat:')) return glossary.filter((t) => t.category === source.slice(4));
		if (source.startsWith('a:')) {
			const id = source.slice(2);
			return glossary.filter((t) => usage.get(t.id)?.some((u) => u.assessment.id === id));
		}
		return glossary;
	});
	const due = $derived(inSource.filter((t) => deck.cards[t.id] && deck.cards[t.id].due <= now));
	const fresh = $derived(inSource.filter((t) => !deck.cards[t.id]));
	const learned = $derived(inSource.filter((t) => deck.cards[t.id] && deck.cards[t.id].due > now).length);
	let reviewedNew = $state(0);
	const newLeft = $derived(Math.max(0, newPerSession - reviewedNew));

	function next() {
		now = Date.now();
		flipped = false;
		// Due reviews first (most overdue first), then new cards in a stable shuffled order.
		const d = [...due].sort((a, b) => deck.cards[a.id].due - deck.cards[b.id].due);
		if (d.length) current = d[0];
		else if (newLeft > 0 && fresh.length) current = fresh[(reviewedThisSession * 7919) % fresh.length];
		else current = null;
	}

	function answer(g: Grade) {
		if (!current) return;
		if (!deck.cards[current.id]) reviewedNew++;
		deck.answer(current.id, g);
		reviewedThisSession++;
		next();
	}

	function setSource(s: string) {
		source = s;
		storage.set('drills:srs:source', s);
		reviewedNew = 0;
		next();
	}

	function onkey(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input, select, textarea')) return;
		if (!current) return;
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			if (!flipped) flipped = true;
			else answer(4);
		} else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
			answer(([0, 3, 4, 5] as Grade[])[Number(e.key) - 1]);
		}
	}

	const grades: { g: Grade; label: string; key: string; cls: string }[] = [
		{ g: 0, label: 'Again', key: '1', cls: 'again' },
		{ g: 3, label: 'Hard', key: '2', cls: 'hard' },
		{ g: 4, label: 'Good', key: '3', cls: 'good' },
		{ g: 5, label: 'Easy', key: '4', cls: 'easy' }
	];
</script>

<svelte:window onkeydown={onkey} />

<svelte:head>
	<title>Flashcards · Drillbook</title>
	<meta name="description" content="Spaced-repetition flashcards for every glossary term." />
</svelte:head>

<div class="wrap">
	<header class="hero">
		<span class="eyebrow">Spaced repetition · SM-2</span>
		<h1>Flashcards</h1>
		<p class="lede">
			Every glossary term as a card. Say the definition out loud before you flip, then grade yourself honestly: cards you
			struggle with come back sooner, easy ones fade out for weeks. Progress is saved in this browser.
		</p>
	</header>

	<div class="controls">
		<label>
			<span class="lbl">Deck</span>
			<select value={source} onchange={(e) => setSource(e.currentTarget.value)}>
				<option value="all">All terms ({glossary.length})</option>
				<optgroup label="By assessment">
					{#each assessments as a (a.id)}<option value="a:{a.id}">{a.title}</option>{/each}
				</optgroup>
				<optgroup label="By category">
					{#each categories as c (c)}<option value="cat:{c}">{c}</option>{/each}
				</optgroup>
			</select>
		</label>
		<label>
			<span class="lbl">New cards per session</span>
			<select bind:value={newPerSession} onchange={next}>
				{#each [10, 20, 40, 80] as n (n)}<option value={n}>{n}</option>{/each}
			</select>
		</label>
		<dl class="stats">
			<div><dt>due</dt><dd>{due.length}</dd></div>
			<div><dt>new left</dt><dd>{Math.min(newLeft, fresh.length)}</dd></div>
			<div><dt>learned</dt><dd>{learned}</dd></div>
			<div><dt>this session</dt><dd>{reviewedThisSession}</dd></div>
		</dl>
	</div>

	{#if current}
		{@const card = deck.cards[current.id]}
		<section class="card" class:flipped>
			<div class="front">
				<span class="cat">{current.category}{card ? ` · review #${card.reps + 1}` : ' · new'}</span>
				<h2>{current.term}</h2>
				{#if current.aliases?.length}<p class="aliases">{current.aliases.join(' · ')}</p>{/if}
			</div>
			{#if flipped}
				<div class="back">
					<p><Rich text={current.short} plainTerms /></p>
					{#if current.analogy}<p class="analogy"><span class="albl">Think of it as</span> <Rich text={current.analogy} plainTerms /></p>{/if}
					<a class="more" href={termHref(current.id)} target="_blank" rel="noreferrer">{current.page ? 'Full explainer ↗' : 'Open in glossary ↗'}</a>
				</div>
				<div class="grades">
					{#each grades as g (g.g)}
						<button type="button" class={g.cls} onclick={() => answer(g.g)}>
							<span class="gl">{g.label}</span>
							<span class="gi">{preview(card, g.g, now)} · {g.key}</span>
						</button>
					{/each}
				</div>
			{:else}
				<button type="button" class="flip" onclick={() => (flipped = true)}>Show definition <kbd>space</kbd></button>
			{/if}
		</section>
	{:else}
		<section class="card done">
			<h2>All caught up</h2>
			<p class="lede">
				{#if fresh.length}No reviews due. Raise "new cards per session" or come back later.{:else}You've seen every card in this deck. Reviews will return as they fall due.{/if}
			</p>
			{#if reviewedThisSession}<p>{reviewedThisSession} cards reviewed this session.</p>{/if}
		</section>
	{/if}

	<p class="foot">
		Keys: <kbd>space</kbd> flip · <kbd>1</kbd> again · <kbd>2</kbd> hard · <kbd>3</kbd> good · <kbd>4</kbd> easy.
		<button type="button" class="reset" onclick={() => confirm('Reset all flashcard progress?') && (deck.reset(), (reviewedNew = 0), next())}>Reset progress</button>
	</p>
</div>

<style>
	.hero {
		padding-block: 40px 20px;
		display: grid;
		gap: 12px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 14px 24px;
		align-items: end;
	}
	label {
		display: grid;
		gap: 4px;
	}
	.lbl,
	dt {
		font-family: var(--f-mono);
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	select {
		font: inherit;
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		max-width: 320px;
	}
	.stats {
		display: flex;
		gap: 20px;
		margin: 0 0 0 auto;
	}
	.stats div {
		display: grid;
	}
	dd {
		margin: 0;
		font-family: var(--f-display);
		font-weight: 800;
		font-size: 1.6rem;
		line-height: 1;
	}
	.card {
		margin-top: 22px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 32px clamp(18px, 4vw, 40px);
		display: grid;
		gap: 22px;
		box-shadow: var(--shadow);
		min-height: 300px;
		align-content: center;
	}
	.front {
		display: grid;
		gap: 8px;
		justify-items: center;
		text-align: center;
	}
	.cat {
		font-family: var(--f-mono);
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.front h2 {
		font-size: clamp(1.8rem, 5vw, 2.6rem);
	}
	.aliases {
		color: var(--muted);
		font-family: var(--f-mono);
		font-size: 13px;
	}
	.back {
		display: grid;
		gap: 12px;
		font-size: 1.05rem;
		border-top: 1px dashed var(--line);
		padding-top: 18px;
		max-width: 68ch;
		justify-self: center;
	}
	.analogy {
		color: var(--muted);
		border-left: 3px solid var(--accent);
		padding-left: 12px;
	}
	.albl {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		color: var(--accent);
	}
	.more {
		font-family: var(--f-mono);
		font-size: 12.5px;
	}
	.flip {
		justify-self: center;
		font-family: var(--f-mono);
		font-size: 14px;
		padding: 10px 22px;
		border-radius: 10px;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--surface);
		cursor: pointer;
	}
	.grades {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}
	.grades button {
		display: grid;
		gap: 2px;
		padding: 10px 6px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--surface-2);
		cursor: pointer;
	}
	.gl {
		font-weight: 600;
	}
	.gi {
		font-family: var(--f-mono);
		font-size: 11px;
		color: var(--muted);
	}
	.again {
		border-color: var(--crit) !important;
		color: var(--crit);
	}
	.hard {
		border-color: var(--warn) !important;
		color: var(--warn);
	}
	.good {
		border-color: var(--ok) !important;
		color: var(--ok);
	}
	.easy {
		border-color: var(--info) !important;
		color: var(--info);
	}
	.done {
		text-align: center;
		justify-items: center;
	}
	.foot {
		margin-top: 16px;
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	kbd {
		font-family: var(--f-mono);
		font-size: 11px;
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 5px;
		background: var(--surface);
	}
	.reset {
		margin-left: auto;
		border: 0;
		background: none;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
	@media (max-width: 560px) {
		.stats {
			margin: 0;
		}
		.grades {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
