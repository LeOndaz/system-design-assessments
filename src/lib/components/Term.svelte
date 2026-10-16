<!--
  A glossary reference: dotted underline, definition card on hover / focus / tap.
  The card is position:fixed and placed against the viewport so it never clips inside scroll containers.
-->
<script lang="ts">
	import type { GlossaryTerm } from '$lib/content/types';
	import { termHref } from '$lib/paths';
	import Rich from './Rich.svelte';

	let { term, label }: { term: GlossaryTerm; label?: string } = $props();

	let open = $state(false);
	let anchor: HTMLElement | undefined = $state();
	let card: HTMLElement | undefined = $state();
	let pos = $state({ top: 0, left: 0, above: false });
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	const cardId = `term-${Math.random().toString(36).slice(2, 9)}`;

	/** Render the card under <body> so contained/clipped ancestors can't trap the fixed position. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	function place() {
		if (!anchor) return;
		const r = anchor.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - 24);
		const left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), window.innerWidth - width - 12);
		const above = r.bottom + 260 > window.innerHeight && r.top > 260;
		pos = { top: above ? r.top - 8 : r.bottom + 8, left, above };
	}

	function show(delay = 120) {
		clearTimeout(hideTimer);
		clearTimeout(showTimer);
		showTimer = setTimeout(() => {
			place();
			open = true;
		}, delay);
	}

	function hide(delay = 160) {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (open = false), delay);
	}

	function onclick(e: MouseEvent) {
		// Touch devices have no hover: first tap opens the card, the "Open page" link navigates.
		e.preventDefault();
		if (open) hide(0);
		else show(0);
	}

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide(0);
		const onDoc = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!anchor?.contains(t) && !card?.contains(t)) hide(0);
		};
		const onScroll = () => place();
		window.addEventListener('keydown', onKey);
		document.addEventListener('pointerdown', onDoc);
		window.addEventListener('scroll', onScroll, { passive: true, capture: true });
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onDoc);
			window.removeEventListener('scroll', onScroll, { capture: true });
			window.removeEventListener('resize', onScroll);
		};
	});
</script>

<a
	bind:this={anchor}
	class="term"
	href={termHref(term.id)}
	aria-describedby={open ? cardId : undefined}
	aria-expanded={open}
	onmouseenter={() => show()}
	onmouseleave={() => hide()}
	onfocus={() => show(0)}
	onblur={() => hide(200)}
	{onclick}>{label ?? term.term}</a
>{#if open}<span
		bind:this={card}
		use:portal
		id={cardId}
		role="tooltip"
		class="card"
		class:above={pos.above}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		onmouseenter={() => clearTimeout(hideTimer)}
		onmouseleave={() => hide()}
	>
		<span class="head"><span class="name">{term.term}</span><span class="cat">{term.category}</span></span>
		<span class="short"><Rich text={term.short} plainTerms /></span>
		{#if term.analogy}<span class="analogy"><span class="lbl">Think of it as</span> <Rich text={term.analogy} plainTerms /></span>{/if}
		<a class="more" href={termHref(term.id)}>{term.page ? 'Full explainer with examples →' : 'Open in glossary →'}</a>
	</span>{/if}

<style>
	.term {
		color: inherit;
		text-decoration: underline dotted;
		text-decoration-color: var(--accent);
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
		cursor: help;
		border-radius: 2px;
	}
	.term:hover,
	.term[aria-expanded='true'] {
		background: var(--accent-soft);
	}
	.card {
		position: fixed;
		z-index: 50;
		width: min(360px, calc(100vw - 24px));
		display: grid;
		gap: 8px;
		padding: 14px 16px;
		background: var(--surface);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow), 0 12px 32px -8px rgb(0 0 0 / 0.25);
		font-family: var(--f-body);
		font-size: 14px;
		font-weight: 400;
		font-style: normal;
		line-height: 1.55;
		text-align: left;
		text-transform: none;
		letter-spacing: normal;
		white-space: normal;
		animation: pop 0.12s ease-out;
	}
	.card.above {
		transform: translateY(-100%);
	}
	@keyframes pop {
		from {
			opacity: 0;
		}
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: baseline;
	}
	.name {
		font-family: var(--f-display);
		font-weight: 600;
		font-size: 1.05rem;
	}
	.cat {
		font-family: var(--f-mono);
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		white-space: nowrap;
	}
	.short,
	.analogy {
		display: block;
	}
	.analogy {
		color: var(--muted);
		border-left: 2px solid var(--accent);
		padding-left: 10px;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--accent);
	}
	.more {
		font-family: var(--f-mono);
		font-size: 12px;
		text-decoration: none;
	}
</style>
