<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { assessments } from '$lib/content';
	import { formatMinutes } from '$lib/content/estimate';
	import { plainText } from '$lib/content/inline';
	import type { QuestionTag } from '$lib/content/types';
	import { ALL_TAGS, DEFAULT_TAGS, fromQuery, generate, pool, toQuery, type ExamConfig, type ExamItem } from '$lib/exam/generate';
	import { storage } from '$lib/state/storage';
	import { timer } from '$lib/state/timer.svelte';
	import { assessmentHref, href } from '$lib/paths';
	import QuestionCard from '$lib/components/QuestionCard.svelte';

	type Grade = 'nailed' | 'partial' | 'missed';

	// ── setup form ──
	let count = $state(10);
	let from = $state<string[]>(assessments.filter((a) => a.track !== 'specialist').map((a) => a.id));
	let tags = $state<QuestionTag[]>([...DEFAULT_TAGS]);
	let interactive = $state(true);

	// ── running exam ──
	let cfg = $state<ExamConfig | null>(null);
	let items = $state<ExamItem[]>([]);
	let grades = $state<Record<number, Grade>>({});
	let finished = $state(false);

	const available = $derived(pool({ from, tags, interactive }).length);
	const totalMinutes = $derived(items.reduce((n, i) => n + i.minutes, 0));
	const gradeKey = $derived(cfg ? `drills:exam:${toQuery(cfg)}` : '');

	function load(c: ExamConfig) {
		cfg = c;
		items = generate(c);
		finished = false;
		try {
			grades = JSON.parse(storage.get(`drills:exam:${toQuery(c)}`) ?? '{}');
		} catch {
			grades = {};
		}
	}

	onMount(() => {
		const c = fromQuery(page.url.searchParams);
		if (c) {
			count = c.count;
			tags = c.tags;
			interactive = c.interactive;
			if (c.from.length) from = c.from;
			load(c);
		}
	});

	function start() {
		const c: ExamConfig = { seed: Math.floor(Math.random() * 1e9), count, from, tags, interactive };
		goto(`${href('/exam')}?${toQuery(c)}`, { replaceState: false, noScroll: true });
		load(c);
		timer.start(items.reduce((n, i) => n + i.minutes, 0));
		scrollTo({ top: 0 });
	}

	function grade(i: number, g: Grade) {
		grades = { ...grades, [i]: grades[i] === g ? (undefined as unknown as Grade) : g };
		storage.set(gradeKey, JSON.stringify(grades));
	}

	function toggle<T>(list: T[], v: T): T[] {
		return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
	}

	const score = $derived.by(() => {
		const vals = Object.values(grades).filter(Boolean);
		const pts = vals.reduce((s, g) => s + (g === 'nailed' ? 1 : g === 'partial' ? 0.5 : 0), 0);
		return { graded: vals.length, pct: items.length ? Math.round((pts / items.length) * 100) : 0 };
	});

	const breakdown = $derived.by(() => {
		const m = new Map<string, { title: string; id: string; n: number; pts: number }>();
		items.forEach((it, i) => {
			const row = m.get(it.assessment.id) ?? { title: it.assessment.title, id: it.assessment.id, n: 0, pts: 0 };
			row.n++;
			row.pts += grades[i] === 'nailed' ? 1 : grades[i] === 'partial' ? 0.5 : 0;
			m.set(it.assessment.id, row);
		});
		return [...m.values()].sort((a, b) => a.pts / a.n - b.pts / b.n);
	});

	function newExam() {
		cfg = null;
		items = [];
		grades = {};
		timer.stop();
		goto(href('/exam'), { noScroll: true });
	}
</script>

<svelte:head>
	<title>Mock exam · Drillbook</title>
	<meta name="description" content="A random mock exam drawn from every assessment, timed, with self-grading." />
</svelte:head>

<div class="wrap">
	{#if !cfg}
		<header class="hero">
			<span class="eyebrow">Random mock exam</span>
			<h1>Mock exam</h1>
			<p class="lede">
				A seeded random draw across assessments, spread so no single set dominates. The timer starts with the exam. Answer each
				question in your own notes, open the model answer, and grade yourself honestly. The URL is shareable: same link, same exam.
			</p>
		</header>

		<section class="setup">
			<div class="row">
				<span class="lbl">Questions</span>
				<div class="pills">
					{#each [5, 10, 15, 20, 30] as n (n)}<button type="button" class:on={count === n} onclick={() => (count = n)}>{n}</button>{/each}
				</div>
			</div>
			<div class="row">
				<span class="lbl">Question types</span>
				<div class="pills">
					{#each ALL_TAGS as t (t)}<button type="button" class:on={tags.includes(t)} onclick={() => (tags = toggle(tags, t))}>{t}</button>{/each}
				</div>
			</div>
			<div class="row">
				<span class="lbl">Interactive</span>
				<label class="check"><input type="checkbox" bind:checked={interactive} /> include labs, terminals, code reviews and UI mocks</label>
			</div>
			<div class="row col">
				<span class="lbl">Draw from <button type="button" class="link" onclick={() => (from = assessments.map((a) => a.id))}>all</button> · <button type="button" class="link" onclick={() => (from = [])}>none</button></span>
				<div class="grid">
					{#each assessments as a (a.id)}
						<label class="check"><input type="checkbox" checked={from.includes(a.id)} onchange={() => (from = toggle(from, a.id))} /> {a.title}</label>
					{/each}
				</div>
			</div>
			<div class="go">
				<span class="muted">{available} questions match</span>
				<button type="button" class="btn primary" disabled={!available || !from.length || !tags.length} onclick={start}>Start exam →</button>
			</div>
		</section>
	{:else}
		<header class="hero">
			<span class="eyebrow">Mock exam · seed {cfg.seed}</span>
			<h1>{items.length} questions · ≈ {formatMinutes(totalMinutes)}</h1>
			<p class="lede">Grade each answer after you open it. Your grades for this exam are saved in this browser.</p>
			<div class="actions">
				<button type="button" class="btn" onclick={() => timer.start(totalMinutes)}>⏱ Restart timer ({totalMinutes} min)</button>
				<button type="button" class="btn" onclick={() => navigator.clipboard?.writeText(location.href)}>Copy exam link</button>
				<button type="button" class="btn" onclick={newExam}>New exam</button>
			</div>
		</header>

		{#each items as it, i (i)}
			<div class="item">
				<div class="from">
					<a href={assessmentHref(it.assessment.id, `q-${it.question.id}`)}>{it.assessment.title} · {it.partNav}</a>
				</div>
				<QuestionCard question={{ ...it.question, minutes: it.minutes }} assessmentId={it.assessment.id} number={`Q${i + 1}`} />
				<div class="grade" role="group" aria-label="Grade your answer to question {i + 1}">
					<span class="lbl">How did you do?</span>
					<button type="button" class="g nailed" class:on={grades[i] === 'nailed'} onclick={() => grade(i, 'nailed')}>Nailed it</button>
					<button type="button" class="g partial" class:on={grades[i] === 'partial'} onclick={() => grade(i, 'partial')}>Partly</button>
					<button type="button" class="g missed" class:on={grades[i] === 'missed'} onclick={() => grade(i, 'missed')}>Missed it</button>
				</div>
			</div>
		{/each}

		<section class="results">
			<h2>Results</h2>
			<p class="score"><b>{score.pct}%</b> <span class="muted">· {score.graded}/{items.length} graded · nailed = 1, partly = ½</span></p>
			{#if !finished}<button type="button" class="btn primary" onclick={() => ((finished = true), timer.stop())}>Finish exam</button>{/if}
			{#if finished || score.graded === items.length}
				<table>
					<thead><tr><th>Assessment</th><th class="num">Questions</th><th class="num">Score</th></tr></thead>
					<tbody>
						{#each breakdown as b (b.id)}
							<tr>
								<td><a href={assessmentHref(b.id)}>{b.title}</a></td>
								<td class="num">{b.n}</td>
								<td class="num" class:weak={b.pts / b.n < 0.5}>{Math.round((b.pts / b.n) * 100)}%</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if breakdown.some((b) => b.pts / b.n < 0.5)}
					<p class="muted">Weakest first. Open the red ones and work through their remaining questions.</p>
				{/if}
				<p class="muted">Missed questions: {items.filter((_, i) => grades[i] === 'missed').map((it) => plainText(it.question.title)).join(' · ') || 'none'}</p>
			{/if}
		</section>
	{/if}
</div>

<style>
	.hero {
		padding-block: 40px 20px;
		display: grid;
		gap: 12px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.setup {
		display: grid;
		gap: 18px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 20px;
	}
	.row {
		display: grid;
		grid-template-columns: 9.5rem 1fr;
		gap: 10px;
		align-items: center;
	}
	.row.col {
		grid-template-columns: 1fr;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.pills button {
		font-family: var(--f-mono);
		font-size: 12.5px;
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--surface);
		cursor: pointer;
	}
	.pills button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--surface);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 6px 16px;
	}
	.check {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 14.5px;
	}
	.check input {
		accent-color: var(--accent);
	}
	.link {
		border: 0;
		background: none;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		padding: 0;
		text-transform: none;
	}
	.go {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		border-top: 1px solid var(--line);
		padding-top: 14px;
	}
	.muted {
		color: var(--muted);
		font-size: 14px;
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.item {
		display: grid;
		gap: 6px;
		margin-top: 22px;
	}
	.from {
		font-family: var(--f-mono);
		font-size: 12px;
	}
	.from a {
		color: var(--muted);
	}
	.grade {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		padding: 0 4px;
	}
	.g {
		font-family: var(--f-mono);
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--surface);
		cursor: pointer;
	}
	.g.nailed.on {
		background: var(--ok);
		border-color: var(--ok);
		color: var(--surface);
	}
	.g.partial.on {
		background: var(--warn);
		border-color: var(--warn);
		color: var(--surface);
	}
	.g.missed.on {
		background: var(--crit);
		border-color: var(--crit);
		color: var(--surface);
	}
	.results {
		margin-top: 40px;
		padding-top: 16px;
		border-top: 3px solid var(--ink);
		display: grid;
		gap: 12px;
		justify-items: start;
	}
	.score b {
		font-family: var(--f-display);
		font-size: 2.2rem;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 14.5px;
	}
	th,
	td {
		text-align: left;
		padding: 7px 10px;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-family: var(--f-mono);
		font-size: 11.5px;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 500;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.weak {
		color: var(--crit);
		font-weight: 600;
	}
	@media (max-width: 560px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
