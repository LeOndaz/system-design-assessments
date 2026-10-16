<!--
  A mock UI screen built from a spec. In `spot` mode every element is clickable: the reader
  flags what looks wrong, then "Check" reveals planted issues (hit / missed) and decoys.
-->
<script lang="ts">
	import type { MockEl, MockScreen } from '$lib/content/types';
	import Rich from '$lib/components/Rich.svelte';

	let { mock }: { mock: MockScreen } = $props();

	const spot = $derived(mock.mode === 'spot');

	// Flatten with stable path ids so flags survive re-render.
	type Node = { el: MockEl; id: string };
	const all = $derived.by(() => {
		const out: Node[] = [];
		const walk = (els: MockEl[], prefix: string) =>
			els.forEach((el, i) => {
				const id = `${prefix}${i}`;
				out.push({ el, id });
				if (el.children) walk(el.children, `${id}.`);
			});
		walk(mock.elements, '');
		return out;
	});
	const issues = $derived(all.filter((n) => n.el.issue));
	const decoys = $derived(all.filter((n) => n.el.decoy));

	let flagged = $state<Record<string, boolean>>({});
	let checked = $state(false);
	const flagCount = $derived(Object.values(flagged).filter(Boolean).length);
	const hits = $derived(issues.filter((n) => flagged[n.id]).length);
	const falseFlags = $derived(all.filter((n) => flagged[n.id] && !n.el.issue).length);
	const numberOf = (id: string) => issues.findIndex((n) => n.id === id) + 1;
	const decoyNumber = (id: string) => decoys.findIndex((n) => n.id === id) + 1;

	/** Layout containers are not targets unless content planted something on them. */
	const flaggable = (el: MockEl) => !el.children || !!el.issue || !!el.decoy;

	function toggle(id: string, el: MockEl, e: Event) {
		if (!spot || checked || !flaggable(el)) return;
		e.stopPropagation();
		e.preventDefault();
		flagged = { ...flagged, [id]: !flagged[id] };
	}
	function reset() {
		flagged = {};
		checked = false;
	}
</script>

{#snippet node(el: MockEl, id: string)}
	{@const st = checked ? (el.issue ? (flagged[id] ? 'hit' : 'miss') : el.decoy ? (flagged[id] ? 'fooled' : 'decoy') : flagged[id] ? 'wrong' : '') : flagged[id] ? 'flag' : ''}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (role is "button" whenever tabindex is set) -->
	<div
		class="el k-{el.kind} {st} {el.look?.size ?? ''} {el.look?.align ?? ''}"
		class:faint={el.look?.faint}
		class:tiny={el.look?.tiny}
		class:full={el.look?.width === 'full'}
		class:half={el.look?.width === 'half'}
		class:spot={spot && !checked && flaggable(el)}
		data-color={el.look?.color}
		role={spot && !checked && flaggable(el) ? 'button' : undefined}
		tabindex={spot && !checked && flaggable(el) ? 0 : undefined}
		onclick={(e) => toggle(id, el, e)}
		onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(id, el, e)}
	>
		{#if checked && el.issue}<span class="marker">{numberOf(id)}</span>{/if}
		{#if checked && el.decoy}<span class="marker decoy-m">D{decoyNumber(id)}</span>{/if}
		{#if el.kind === 'nav'}
			<span class="brand">{el.text ?? 'App'}</span>
			<span class="navitems">{#each el.items ?? [] as it, i (i)}<span>{it}</span>{/each}</span>
		{:else if el.kind === 'heading'}
			<div class="h">{el.text}</div>
		{:else if el.kind === 'text'}
			<p>{el.text}</p>
		{:else if el.kind === 'input' || el.kind === 'textarea' || el.kind === 'select'}
			{#if el.label}<span class="lbl">{el.label}{#if el.required}<span class="req">*</span>{/if}</span>{/if}
			<span class="box" class:err={!!el.error} class:area={el.kind === 'textarea'} class:dis={el.disabled}>
				{#if el.value}<span>{el.value}</span>{:else}<span class="ph">{el.placeholder ?? ''}</span>{/if}
				{#if el.kind === 'select'}<span class="caret">▾</span>{/if}
			</span>
			{#if el.error}<span class="errtxt">{el.error}</span>{:else if el.hint}<span class="hint">{el.hint}</span>{/if}
		{:else if el.kind === 'checkbox' || el.kind === 'radio'}
			<span class="check"><span class="cb {el.kind}" class:on={el.checked}></span><span>{el.label ?? el.text}</span></span>
		{:else if el.kind === 'button'}
			<span class="mbtn {el.variant ?? 'secondary'}" class:dis={el.disabled}>{el.text}</span>
		{:else if el.kind === 'link'}
			<span class="lnk">{el.text}</span>
		{:else if el.kind === 'toast' || el.kind === 'banner'}
			<span class="note {el.tone ?? 'info'}">{el.text}</span>
		{:else if el.kind === 'badge'}
			<span class="badge {el.tone ?? 'info'}">{el.text}</span>
		{:else if el.kind === 'image'}
			<span class="img">{el.text ?? 'image'}</span>
		{:else if el.kind === 'skeleton'}
			<span class="skel"></span><span class="skel short"></span>
		{:else if el.kind === 'divider'}
			<hr />
		{:else if el.kind === 'progress'}
			{#if el.label}<span class="lbl">{el.label}</span>{/if}
			<span class="prog"><span style:width="{el.percent ?? 0}%"></span></span>
		{:else if el.kind === 'tabs' || el.kind === 'stepper'}
			<span class="tabs {el.kind}">{#each el.items ?? [] as it, i (i)}<span class:act={i === (el.active ?? 0)}>{el.kind === 'stepper' ? `${i + 1}. ` : ''}{it}</span>{/each}</span>
		{:else if el.kind === 'list'}
			<ul>{#each el.items ?? [] as it, i (i)}<li>{it}</li>{/each}</ul>
		{:else if el.kind === 'table'}
			<table>
				<thead><tr>{#each el.head ?? [] as h, i (i)}<th>{h}</th>{/each}</tr></thead>
				<tbody>{#each el.rows ?? [] as r, i (i)}<tr>{#each r as c, j (j)}<td>{c}</td>{/each}</tr>{/each}</tbody>
			</table>
		{/if}
		{#if el.children}
			{#if el.kind === 'modal'}
				<div class="modal">{#each el.children as c, i (i)}{@render node(c, `${id}.${i}`)}{/each}</div>
			{:else}
				<div class="kids">{#each el.children as c, i (i)}{@render node(c, `${id}.${i}`)}{/each}</div>
			{/if}
		{/if}
	</div>
{/snippet}

<figure class="mock {mock.device}">
	<div class="chrome">
		{#if mock.device === 'desktop'}<span class="dots"><i></i><i></i><i></i></span>{/if}
		<span class="url">{mock.url ?? mock.title ?? ''}</span>
	</div>
	<div class="screen" class:has-modal={mock.elements.some((e) => e.kind === 'modal')}>
		{#each mock.elements as el, i (i)}{@render node(el, `${i}`)}{/each}
	</div>
	{#if spot}
		<div class="spotbar">
			{#if !checked}
				<span>Click every element you think is a problem. <b>{flagCount}</b> flagged.</span>
				<button type="button" class="go" disabled={!flagCount} onclick={() => (checked = true)}>Check my picks</button>
			{:else}
				<span><b>{hits}/{issues.length}</b> issues found{#if falseFlags} · {falseFlags} false flag{falseFlags === 1 ? '' : 's'}{/if}</span>
				<button type="button" onclick={reset}>Try again</button>
			{/if}
		</div>
		{#if checked}
			<ol class="findings">
				{#each issues as n, i (n.id)}
					<li class:f-hit={flagged[n.id]}><span class="num">{i + 1}</span><span class="res">{flagged[n.id] ? 'found' : 'missed'}</span> <Rich text={n.el.issue!} /></li>
				{/each}
				{#each decoys as n, i (n.id)}
					<li class="f-decoy"><span class="num">D{i + 1}</span><span class="res">{flagged[n.id] ? 'fooled' : 'decoy'}</span> <Rich text={n.el.decoy!} /></li>
				{/each}
			</ol>
		{/if}
	{/if}
</figure>

<style>
	.mock {
		margin: 0;
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
		background: var(--surface-2);
		min-width: 0;
	}
	.mock.mobile {
		max-width: 380px;
		margin-inline: auto;
		border-radius: 28px;
		border-width: 6px;
		border-color: #1b1f24;
	}
	.chrome {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 7px 12px;
		background: var(--code-bg);
		border-bottom: 1px solid var(--line);
	}
	.dots {
		display: flex;
		gap: 5px;
	}
	.dots i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--line);
	}
	.url {
		flex: 1;
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--muted);
		background: var(--surface);
		border-radius: 6px;
		padding: 2px 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mobile .url {
		text-align: center;
	}
	/* The mocked app always uses a neutral light palette, independent of the site theme. */
	.screen {
		--m-ink: #1f2328;
		--m-muted: #656d76;
		--m-line: #d0d7de;
		--m-bg: #ffffff;
		--m-primary: #2f6feb;
		--m-danger: #cf222e;
		background: var(--m-bg);
		color: var(--m-ink);
		padding: 16px;
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: flex-start;
		font-size: 14px;
		position: relative;
		min-height: 120px;
	}
	.el {
		position: relative;
		flex: 1 1 100%;
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-radius: 6px;
		min-width: 0;
	}
	.el.half {
		flex: 1 1 calc(50% - 6px);
	}
	.k-button,
	.k-link,
	.k-badge,
	.k-checkbox,
	.k-radio {
		flex: 0 0 auto;
	}
	.k-row > .kids {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.k-row > .kids > .el {
		flex: 0 0 auto;
	}
	.k-row > .kids > .el.full {
		flex: 1 1 auto;
	}
	.k-card {
		border: 1px solid var(--m-line);
		border-radius: 8px;
		padding: 12px;
	}
	.kids {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.right > .kids,
	.el.right {
		justify-content: flex-end;
		align-items: flex-end;
	}
	.center {
		align-items: center;
		text-align: center;
	}
	.spot {
		cursor: pointer;
		outline: 1px dashed transparent;
		outline-offset: 3px;
	}
	.spot:hover {
		outline-color: #9aa4af;
	}
	.flag {
		outline: 2px solid #e5a21c !important;
		outline-offset: 3px;
		background: rgb(229 162 28 / 0.08);
	}
	.hit {
		outline: 2px solid #1f883d;
		outline-offset: 3px;
	}
	.miss {
		outline: 2px dashed #cf222e;
		outline-offset: 3px;
	}
	.decoy {
		outline: 2px dotted #8250df;
		outline-offset: 3px;
	}
	.fooled {
		outline: 2px solid #8250df;
		outline-offset: 3px;
	}
	.wrong {
		outline: 2px solid #9aa4af;
		outline-offset: 3px;
		opacity: 0.8;
	}
	.marker {
		position: absolute;
		top: -10px;
		left: -10px;
		z-index: 3;
		min-width: 20px;
		height: 20px;
		padding: 0 4px;
		border-radius: 10px;
		background: #cf222e;
		color: #fff;
		font: 600 11px/20px var(--f-mono);
		text-align: center;
	}
	.hit > .marker {
		background: #1f883d;
	}
	.decoy-m {
		background: #8250df;
	}
	.k-nav {
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--m-line);
		padding-bottom: 10px;
	}
	.brand {
		font-weight: 700;
	}
	.navitems {
		display: flex;
		gap: 14px;
		color: var(--m-muted);
		font-size: 13px;
	}
	.h {
		font-size: 20px;
		font-weight: 700;
	}
	.lg .h {
		font-size: 24px;
	}
	.sm .h {
		font-size: 16px;
	}
	.xs p,
	.xs .lbl {
		font-size: 11px;
	}
	.lbl {
		font-size: 13px;
		font-weight: 600;
	}
	.req {
		color: var(--m-danger);
		margin-left: 2px;
	}
	.box {
		display: flex;
		justify-content: space-between;
		border: 1px solid var(--m-line);
		border-radius: 6px;
		padding: 7px 10px;
		min-height: 36px;
		background: #fff;
	}
	.box.area {
		min-height: 70px;
	}
	.box.err {
		border-color: var(--m-danger);
	}
	.box.dis {
		background: #f6f8fa;
		color: var(--m-muted);
	}
	.ph {
		color: #8c959f;
	}
	.caret {
		color: var(--m-muted);
	}
	.errtxt {
		color: var(--m-danger);
		font-size: 12.5px;
	}
	.hint {
		color: var(--m-muted);
		font-size: 12.5px;
	}
	.check {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.cb {
		width: 16px;
		height: 16px;
		border: 1.5px solid #8c959f;
		border-radius: 4px;
		flex: none;
	}
	.cb.radio {
		border-radius: 50%;
	}
	.cb.on {
		background: var(--m-primary);
		border-color: var(--m-primary);
		box-shadow: inset 0 0 0 3px #fff;
	}
	.mbtn {
		display: inline-block;
		padding: 8px 16px;
		border-radius: 6px;
		font-weight: 600;
		border: 1px solid var(--m-line);
		background: #f6f8fa;
		text-align: center;
	}
	.mbtn.primary {
		background: var(--m-primary);
		border-color: var(--m-primary);
		color: #fff;
	}
	.mbtn.danger {
		background: var(--m-danger);
		border-color: var(--m-danger);
		color: #fff;
	}
	.mbtn.ghost {
		background: none;
		border-color: transparent;
		color: var(--m-primary);
	}
	.mbtn.dis {
		opacity: 0.5;
	}
	.tiny .mbtn,
	.tiny .cb {
		padding: 2px 6px;
		font-size: 11px;
	}
	.lnk {
		color: var(--m-primary);
		text-decoration: underline;
	}
	.note {
		display: block;
		padding: 9px 12px;
		border-radius: 6px;
		background: #ddf4ff;
		border: 1px solid #54aeff66;
	}
	.note.warn {
		background: #fff8c5;
		border-color: #d4a72c66;
	}
	.note.crit {
		background: #ffebe9;
		border-color: #ff818266;
	}
	.note.ok {
		background: #dafbe1;
		border-color: #4ac26b66;
	}
	.k-toast .note {
		background: #24292f;
		color: #fff;
		border: 0;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.2);
	}
	.badge {
		display: inline-block;
		font-size: 12px;
		font-weight: 600;
		padding: 1px 8px;
		border-radius: 999px;
		background: #ddf4ff;
		color: #0969da;
	}
	.badge.ok {
		background: #dafbe1;
		color: #1a7f37;
	}
	.badge.warn {
		background: #fff8c5;
		color: #9a6700;
	}
	.badge.crit {
		background: #ffebe9;
		color: #cf222e;
	}
	[data-color='red'] {
		color: #cf222e;
	}
	[data-color='green'] {
		color: #1a7f37;
	}
	[data-color='amber'] {
		color: #bf8700;
	}
	[data-color='grey'] {
		color: #8c959f;
	}
	.faint,
	.faint * {
		color: #b8bfc6 !important;
	}
	.img {
		display: grid;
		place-items: center;
		min-height: 110px;
		background: repeating-linear-gradient(45deg, #f0f2f4 0 10px, #e7eaee 10px 20px);
		border-radius: 6px;
		color: var(--m-muted);
		font-size: 12px;
	}
	.skel {
		display: block;
		height: 12px;
		border-radius: 4px;
		background: #eaeef2;
	}
	.skel.short {
		width: 60%;
	}
	hr {
		border: 0;
		border-top: 1px solid var(--m-line);
		width: 100%;
		margin: 0;
	}
	.prog {
		height: 8px;
		background: #eaeef2;
		border-radius: 4px;
		overflow: hidden;
	}
	.prog span {
		display: block;
		height: 100%;
		background: var(--m-primary);
	}
	.tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid var(--m-line);
		flex-wrap: wrap;
	}
	.tabs span {
		padding: 6px 12px;
		color: var(--m-muted);
	}
	.tabs .act {
		color: var(--m-ink);
		border-bottom: 2px solid var(--m-primary);
		font-weight: 600;
	}
	.stepper {
		border: 0;
		gap: 12px;
	}
	.stepper .act {
		border: 0;
		color: var(--m-primary);
	}
	ul {
		margin: 0;
		padding-left: 1.2em;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 13px;
	}
	th,
	td {
		text-align: left;
		padding: 6px 8px;
		border-bottom: 1px solid var(--m-line);
	}
	th {
		color: var(--m-muted);
		font-weight: 600;
	}
	.k-table {
		overflow-x: auto;
	}
	.has-modal::before {
		content: '';
		position: absolute;
		inset: 0;
		background: rgb(31 35 40 / 0.45);
		z-index: 1;
	}
	.k-modal {
		position: relative;
		z-index: 2;
	}
	.modal {
		background: #fff;
		border-radius: 10px;
		box-shadow: 0 16px 40px rgb(0 0 0 / 0.3);
		padding: 16px;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		max-width: 420px;
		margin: 10px auto;
		width: 100%;
	}
	.spotbar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-top: 1px solid var(--line);
		font-size: 14px;
	}
	.spotbar button {
		font-family: var(--f-mono);
		font-size: 12.5px;
		padding: 6px 12px;
		border: 1px solid var(--line);
		border-radius: 7px;
		background: var(--surface);
		cursor: pointer;
	}
	.spotbar .go {
		background: var(--accent);
		color: var(--surface);
		border-color: var(--accent);
	}
	.spotbar .go:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.findings {
		list-style: none;
		margin: 0;
		padding: 4px 14px 14px;
		display: grid;
		gap: 8px;
		font-size: 14.5px;
	}
	.findings li {
		display: block;
	}
	.num {
		display: inline-block;
		min-width: 24px;
		font-family: var(--f-mono);
		font-size: 11px;
		font-weight: 600;
		color: #fff;
		background: #cf222e;
		border-radius: 10px;
		text-align: center;
		margin-right: 6px;
	}
	.f-hit .num {
		background: #1f883d;
	}
	.f-decoy .num {
		background: #8250df;
	}
	.res {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		margin-right: 4px;
	}
</style>
