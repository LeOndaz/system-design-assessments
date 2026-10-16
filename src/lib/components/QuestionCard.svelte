<script lang="ts">
	import type { Question } from '$lib/content/types';
	import { progress } from '$lib/state/progress.svelte';
	import { timer } from '$lib/state/timer.svelte';
	import Blocks from './Blocks.svelte';
	import Rich from './Rich.svelte';

	let {
		question,
		assessmentId,
		number,
		revealAll = 0
	}: { question: Question; assessmentId: string; number: string; revealAll?: number } = $props();

	let open = $state(false);
	let hintsShown = $state(0);
	const done = $derived(progress.is(assessmentId, question.id));

	// Parent bumps `revealAll` (+n to open, −n to close) to toggle every answer in a part.
	let lastReveal = 0;
	$effect(() => {
		if (revealAll !== lastReveal) {
			open = revealAll > 0;
			lastReveal = revealAll;
		}
	});

	const tagLabel: Record<Question['tag'], string> = {
		core: 'core',
		tricky: 'tricky',
		variant: 'variant',
		template: 'template',
		teaser: 'teaser',
		design: 'design',
		coding: 'coding'
	};
	const tagClass = (t: Question['tag']) => (t === 'tricky' ? 'warn' : t === 'teaser' ? 'muted' : t === 'design' || t === 'coding' ? 'info' : '');
</script>

<article class="q" class:is-done={done} id="q-{question.id}">
	<div class="top">
		<span class="num">{number}</span>
		<h3><Rich text={question.title} /></h3>
		<div class="chips">
			<span class="chip {tagClass(question.tag)}">{tagLabel[question.tag]}</span>
			{#if question.minutes}
				<button type="button" class="chip muted timebtn" title="Start a {question.minutes}-minute timer" onclick={() => timer.start(question.minutes!)}
					>⏱ {question.minutes}m</button
				>
			{/if}
		</div>
		<label class="done" class:on={done} title={done ? 'Marked done: click to undo' : 'Mark this question as done'}>
			<input type="checkbox" checked={done} onchange={(e) => progress.set(assessmentId, question.id, e.currentTarget.checked)} />
			{done ? '✓ done' : 'done'}
		</label>
	</div>

	{#if question.prompt.length}
		<div class="prompt"><Blocks blocks={question.prompt} /></div>
	{/if}

	{#if question.hints?.length}
		<div class="hints">
			{#each question.hints.slice(0, hintsShown) as h, i (i)}
				<p class="hint"><span class="lbl">Hint {i + 1}</span> <Rich text={h} /></p>
			{/each}
			{#if hintsShown < question.hints.length}
				<button type="button" class="linkbtn" onclick={() => hintsShown++}>
					+ {hintsShown === 0 ? 'Need a hint?' : 'Another hint'} ({question.hints.length - hintsShown} left)
				</button>
			{/if}
		</div>
	{/if}

	<div class="reveal">
		<button type="button" class="linkbtn toggle" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="sign" aria-hidden="true">{open ? '−' : '+'}</span>
			{open ? 'Hide' : question.answerLabel ?? 'Show answer'}
		</button>
		{#if open}
			<div class="ans"><Blocks blocks={question.answer} /></div>
		{/if}
	</div>
</article>

<style>
	.q {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 18px 20px;
		display: grid;
		gap: 14px;
		min-width: 0;
		transition: opacity 0.2s;
		scroll-margin-top: 120px;
	}
	/* Done stays visibly done even under the cursor: green edge + label, softer content. */
	.q.is-done {
		border-left: 4px solid var(--ok);
		background: color-mix(in srgb, var(--ok) 5%, var(--surface));
	}
	.q.is-done .prompt,
	.q.is-done h3 {
		opacity: 0.7;
	}
	.done.on {
		color: var(--ok);
		font-weight: 600;
	}
	.top {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 10px;
		align-items: start;
	}
	.num {
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		padding-top: 4px;
	}
	h3 {
		min-width: 0;
	}
	.chips {
		display: flex;
		gap: 6px;
		align-items: center;
		padding-top: 2px;
	}
	.timebtn {
		border: 0;
		cursor: pointer;
	}
	.timebtn:hover {
		color: var(--accent);
	}
	.done {
		display: flex;
		gap: 6px;
		align-items: center;
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		cursor: pointer;
		white-space: nowrap;
		padding-top: 2px;
	}
	.done input {
		accent-color: var(--accent);
		width: 16px;
		height: 16px;
		margin: 0;
	}
	.prompt,
	.ans {
		display: grid;
		gap: 12px;
		font-size: 15.5px;
		min-width: 0;
	}
	.hints {
		display: grid;
		gap: 8px;
		justify-items: start;
	}
	.hint {
		font-size: 15px;
		background: var(--info-soft);
		border-radius: 8px;
		padding: 8px 12px;
	}
	.hint .lbl {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--info);
	}
	.reveal {
		border-top: 1px dashed var(--line);
		padding-top: 10px;
		display: grid;
		gap: 12px;
	}
	.linkbtn {
		border: 0;
		background: none;
		padding: 2px 0;
		cursor: pointer;
		font-family: var(--f-mono);
		font-size: 13px;
		color: var(--accent);
		font-weight: 500;
		justify-self: start;
	}
	.toggle {
		display: inline-flex;
		gap: 6px;
	}
	.sign {
		width: 1ch;
	}
	.ans {
		animation: fade 0.18s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
	}
	@media (max-width: 560px) {
		.q {
			padding: 14px;
		}
		.top {
			grid-template-columns: auto 1fr;
		}
		.chips,
		.done {
			grid-column: 2;
		}
		.chips {
			flex-wrap: wrap;
		}
	}
</style>
