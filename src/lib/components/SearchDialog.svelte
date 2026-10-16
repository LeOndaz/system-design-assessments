<!-- ⌘K / Ctrl-K search across assessments, questions and glossary terms. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { search, type SearchItem } from '$lib/search';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let query = $state('');
	let active = $state(0);
	let dialog: HTMLDialogElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	const results = $derived(search(query));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			query = '';
			active = 0;
			queueMicrotask(() => input?.focus());
		} else if (!open && dialog.open) dialog.close();
	});

	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				open = !open;
			} else if (e.key === '/' && !open && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
				e.preventDefault();
				open = true;
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function pick(item: SearchItem) {
		open = false;
		goto(item.href);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(results.length - 1, active + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(0, active - 1);
		} else if (e.key === 'Enter' && results[active]) {
			e.preventDefault();
			pick(results[active]);
		}
	}

	const kindLabel = { question: 'Q', term: 'Term', assessment: 'Set' } as const;
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && (open = false)}>
	<div class="box">
		<input
			bind:this={input}
			bind:value={query}
			oninput={() => (active = 0)}
			{onkeydown}
			type="search"
			placeholder="Search questions, scenarios, terms…"
			aria-label="Search"
			autocomplete="off"
			spellcheck="false"
		/>
		{#if query && results.length === 0}
			<p class="empty">Nothing matches “{query}”.</p>
		{:else if results.length}
			<ul role="listbox" aria-label="Results">
				{#each results as r, i (r.href + i)}
					<li role="option" aria-selected={i === active}>
						<a href={r.href} class:active={i === active} onmouseenter={() => (active = i)} onclick={(e) => { e.preventDefault(); pick(r); }}>
							<span class="kind {r.kind}">{kindLabel[r.kind]}</span>
							<span class="t">{r.title}</span>
							<span class="c">{r.context}</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">Try “idempotency”, “kafka”, “finance”, “heatmap”, “DST”…</p>
		{/if}
		<div class="foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close</div>
	</div>
</dialog>

<style>
	dialog {
		border: 0;
		padding: 0;
		background: none;
		width: min(640px, calc(100vw - 24px));
		margin: 10vh auto auto;
		max-height: 80vh;
	}
	dialog::backdrop {
		background: rgb(10 16 15 / 0.45);
		backdrop-filter: blur(2px);
	}
	.box {
		background: var(--surface);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
		display: grid;
		overflow: hidden;
	}
	input {
		font: inherit;
		font-size: 17px;
		padding: 14px 16px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: none;
		color: var(--ink);
		outline: none;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 6px;
		max-height: 55vh;
		overflow-y: auto;
	}
	a {
		display: grid;
		grid-template-columns: 3.4em 1fr;
		gap: 0 10px;
		padding: 8px 10px;
		border-radius: 8px;
		color: var(--ink);
		text-decoration: none;
	}
	a.active {
		background: var(--accent-soft);
	}
	.kind {
		grid-row: span 2;
		font-family: var(--f-mono);
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		padding-top: 3px;
	}
	.kind.term {
		color: var(--accent);
	}
	.kind.assessment {
		color: var(--warn);
	}
	.t {
		font-weight: 500;
	}
	.c {
		font-size: 12.5px;
		color: var(--muted);
	}
	.empty {
		padding: 18px 16px;
		color: var(--muted);
	}
	.foot {
		border-top: 1px solid var(--line);
		padding: 7px 14px;
		font-family: var(--f-mono);
		font-size: 11px;
		color: var(--muted);
	}
	kbd {
		font-family: var(--f-mono);
		font-size: 10.5px;
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 4px;
		margin-right: 2px;
	}
</style>
