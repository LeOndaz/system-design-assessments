<script lang="ts">
	import { assessments, glossary, questionCount } from '$lib/content';
	import { assessmentHref, href } from '$lib/paths';
	import { progress } from '$lib/state/progress.svelte';
	import Rich from '$lib/components/Rich.svelte';

	const totalQ = assessments.reduce((n, a) => n + questionCount(a), 0);
	const pages = glossary.filter((t) => t.page).length;
	const ids = (a: (typeof assessments)[number]) => a.parts.flatMap((p) => p.questions.map((q) => q.id));
	const kinds = (a: (typeof assessments)[number]) => {
		const blocks = a.parts.flatMap((p) => p.questions.flatMap((q) => [...q.prompt, ...q.answer]));
		return {
			charts: blocks.filter((b) => b.type === 'dashboard' || b.type === 'trace' || b.type === 'logs').length,
			tickets: blocks.filter((b) => b.type === 'ticket').length
		};
	};
	const featured = ['multi-tenancy', 'query-plan-flip', 'littles-law', 'idempotency', 'cache-stampede', 'saga'].filter((id) =>
		glossary.some((t) => t.id === id)
	);
</script>

<svelte:head>
	<title>Drillbook · debugging & incident assessment prep</title>
	<meta name="description" content="Timed incident, debugging and coding drills with model answers, readable dashboards and a hover glossary." />
</svelte:head>

<div class="wrap">
	<section class="hero">
		<span class="eyebrow">Technical assessment prep · self-paced</span>
		<h1>Practice the incident,<br />not the trivia.</h1>
		<p class="lede">
			Timed scenarios with ranked model answers: performance debugging, microservice failures, dashboards to read, vague reports
			from finance and support, and coding tasks with tests. Every <Rich text="[[percentiles|underlined term]]" /> explains itself
			on hover.
		</p>
		<dl class="stats">
			<div><dt>assessments</dt><dd>{assessments.length}</dd></div>
			<div><dt>questions</dt><dd>{totalQ}</dd></div>
			<div><dt>glossary terms</dt><dd>{glossary.length}</dd></div>
			<div><dt>explainer pages</dt><dd>{pages}</dd></div>
		</dl>
	</section>

	<section class="list" aria-label="Assessments">
		{#each assessments as a (a.id)}
			{@const qids = ids(a)}
			{@const done = progress.count(a.id, qids)}
			{@const k = kinds(a)}
			<a class="card" href={assessmentHref(a.id)}>
				<div class="num">{String(a.number).padStart(2, '0')}</div>
				<div class="body">
					<div class="row">
						<h2>{a.title}</h2>
						<span class="chip {a.difficulty === 'advanced' ? 'warn' : a.difficulty === 'foundation' ? 'muted' : ''}">{a.difficulty}</span>
					</div>
					<p class="tag">{a.tagline}</p>
					<div class="meta">
						<span>{a.minutes} min</span>
						<span>{a.parts.filter((p) => p.questions.length).length} parts</span>
						<span>{qids.length} questions</span>
						{#if k.charts}<span>{k.charts} {k.charts === 1 ? 'chart' : 'charts'}, logs & traces</span>{/if}
						{#if k.tickets}<span>{k.tickets} human {k.tickets === 1 ? 'report' : 'reports'}</span>{/if}
					</div>
					<div class="topics">{#each a.topics as t (t)}<span>{t}</span>{/each}</div>
					<div class="progress" aria-label="{done} of {qids.length} done">
						<div class="track"><div class="fill" style:width="{(done / Math.max(1, qids.length)) * 100}%"></div></div>
						<span>{done}/{qids.length}</span>
					</div>
				</div>
			</a>
		{/each}
	</section>

	<section class="how">
		<h2>How to use it</h2>
		<ol>
			<li><strong>Start the timer</strong> from the top bar (or a question's ⏱ chip) and write your answer somewhere first.</li>
			<li><strong>Hover underlined terms</strong> whenever a word is fuzzy. Terms with a full explainer link to a page with worked examples.</li>
			<li><strong>Open the model answer</strong> and compare structure, not just conclusions: ranked hypotheses, evidence, the check that confirms each.</li>
			<li><strong>Tick it off.</strong> Progress stays in this browser. Press <kbd>⌘K</kbd> or <kbd>/</kbd> to search everything.</li>
		</ol>
	</section>

	{#if featured.length}
		<section class="feat">
			<div class="feat-head">
				<h2>Start with these explainers</h2>
				<a class="btn" href={href('/glossary')}>Full glossary →</a>
			</div>
			<div class="feat-grid">
				{#each featured as id (id)}
					{@const t = glossary.find((g) => g.id === id)!}
					<a class="term" href={href(`/glossary/${t.id}`)}>
						<span class="cat">{t.category}</span>
						<strong>{t.term}</strong>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.hero {
		padding-block: 56px 28px;
		display: grid;
		gap: 16px;
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 32px;
		margin: 8px 0 0;
	}
	.stats div {
		display: grid;
	}
	.stats dt {
		font-family: var(--f-mono);
		font-size: 11.5px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		order: 2;
	}
	.stats dd {
		margin: 0;
		font-family: var(--f-display);
		font-weight: 800;
		font-size: 2rem;
		line-height: 1;
	}
	.list {
		display: grid;
		gap: 14px;
		padding-block: 12px 24px;
	}
	.card {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 18px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 20px 22px;
		color: var(--ink);
		text-decoration: none;
		transition:
			border-color 0.15s,
			transform 0.15s,
			box-shadow 0.15s;
	}
	.card:hover {
		border-color: var(--accent);
		box-shadow: var(--shadow);
		transform: translateY(-1px);
	}
	.num {
		min-width: 2.6ch;
		font-family: var(--f-display);
		font-weight: 800;
		font-size: 2.2rem;
		line-height: 1;
		color: var(--accent);
	}
	.body {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.row h2 {
		font-size: 1.4rem;
	}
	.tag {
		color: var(--muted);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-family: var(--f-mono);
		font-size: 12.5px;
		color: var(--muted);
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
	.progress {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 10px;
		align-items: center;
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
	}
	.track {
		height: 6px;
		background: var(--code-bg);
		border-radius: 3px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
	}
	.how {
		padding-block: 28px;
		display: grid;
		gap: 12px;
		border-top: 3px solid var(--ink);
		margin-top: 20px;
	}
	.how ol {
		margin: 0;
		padding-left: 1.3em;
		display: grid;
		gap: 6px;
	}
	kbd {
		font-family: var(--f-mono);
		font-size: 12px;
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 5px;
		background: var(--surface);
	}
	.feat {
		display: grid;
		gap: 14px;
		padding-block: 12px;
	}
	.feat-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.feat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}
	.feat-grid .term {
		display: grid;
		gap: 2px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}
	.feat-grid .term:hover {
		border-color: var(--accent);
	}
	.cat {
		font-family: var(--f-mono);
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	@media (max-width: 560px) {
		.card {
			grid-template-columns: 1fr;
			gap: 6px;
			padding: 16px;
		}
	}
</style>
