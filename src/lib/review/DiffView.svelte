<!--
  Pull-request diff. In `review` mode the reader clicks lines to leave a flag, then checks
  their picks against planted notes (issues with severity, and decoys that look wrong but aren't).
-->
<script lang="ts">
	import type { CodeDiff, DiffNote } from '$lib/content/types';
	import Rich from '$lib/components/Rich.svelte';
	import { highlight } from '$lib/components/blocks/highlight';
	import { parsePatch, type DiffRow } from './patch';

	let { diff }: { diff: CodeDiff } = $props();

	const review = $derived(diff.mode !== 'view');
	const files = $derived(diff.files.map((f) => ({ file: f, rows: parsePatch(f) })));
	const notes = $derived(
		files.flatMap(({ file, rows }) =>
			(file.notes ?? []).map((n) => ({ n, key: `${file.path}:${rows.findIndex((r) => r.text.includes(n.match))}` }))
		)
	);
	const issues = $derived(notes.filter((x) => x.n.issue));
	const decoys = $derived(notes.filter((x) => x.n.decoy));
	const noteAt = $derived(new Map(notes.map((x) => [x.key, x.n])));

	let flagged = $state<Record<string, boolean>>({});
	let checked = $state(false);
	let collapsed = $state<Record<string, boolean>>({});
	const flagCount = $derived(Object.values(flagged).filter(Boolean).length);
	const hits = $derived(issues.filter((x) => flagged[x.key]).length);
	const falseFlags = $derived(Object.entries(flagged).filter(([k, v]) => v && !noteAt.get(k)?.issue).length);
	const blockers = $derived(issues.filter((x) => x.n.severity === 'blocker'));
	const blockersHit = $derived(blockers.filter((x) => flagged[x.key]).length);

	function toggle(key: string, row: DiffRow) {
		if (!review || checked || row.kind === 'hunk') return;
		flagged = { ...flagged, [key]: !flagged[key] };
	}

	const sevLabel = (n: DiffNote) => n.severity ?? 'major';
	const numberOf = (key: string) => issues.findIndex((x) => x.key === key) + 1;
</script>

<figure class="pr">
	<header>
		<div class="ptitle">
			<span class="badge">Open</span>
			<strong>{diff.title}</strong>
		</div>
		{#if diff.author}<div class="by">{diff.author} wants to merge into <code>main</code></div>{/if}
		{#if diff.description}<div class="desc"><Rich text={diff.description} /></div>{/if}
	</header>

	{#each files as { file, rows } (file.path)}
		<section class="file">
			<button type="button" class="fhead" onclick={() => (collapsed[file.path] = !collapsed[file.path])} aria-expanded={!collapsed[file.path]}>
				<span class="caret">{collapsed[file.path] ? '▸' : '▾'}</span>
				<span class="path">{file.path}</span>
				<span class="stat"
					><span class="add">+{rows.filter((r) => r.kind === 'add').length}</span>
					<span class="del">−{rows.filter((r) => r.kind === 'del').length}</span></span
				>
			</button>
			{#if !collapsed[file.path]}
				<div class="code">
					<table>
						<tbody>
							{#each rows as row, i (i)}
								{@const key = `${file.path}:${i}`}
								{@const note = noteAt.get(key)}
								{@const state = checked ? (note?.issue ? (flagged[key] ? 'hit' : 'miss') : note?.decoy ? (flagged[key] ? 'fooled' : 'decoy') : flagged[key] ? 'wrong' : '') : flagged[key] ? 'flag' : ''}
								{#if row.kind === 'hunk'}
									<tr class="hunk"><td class="ln"></td><td class="ln"></td><td class="txt">{row.text}</td></tr>
								{:else}
									<tr
										class="{row.kind} {state}"
										class:clickable={review && !checked}
										onclick={() => toggle(key, row)}
									>
										<td class="ln">{row.old ?? ''}</td>
										<td class="ln">{row.new ?? ''}</td>
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlight() escapes input -->
										<td class="txt"><span class="sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>{@html highlight(row.text, file.lang ?? 'text')}{#if review && !checked}<button type="button" class="flagbtn" aria-label="Flag line {row.new ?? row.old}" onclick={(e) => (e.stopPropagation(), toggle(key, row))}>{flagged[key] ? '⚑' : '+'}</button>{/if}</td>
									</tr>
									{#if checked && note}
										<tr class="note-row {note.issue ? 'n-issue' : 'n-decoy'}">
											<td colspan="3">
												<div class="note">
													{#if note.issue}
														<span class="sev {sevLabel(note)}">{numberOf(key)} · {sevLabel(note)}</span>
														<span class="res">{flagged[key] ? 'found' : 'missed'}</span>
														<Rich text={note.issue} />
													{:else}
														<span class="sev decoy">decoy</span>
														<span class="res">{flagged[key] ? 'flagged, but fine' : 'correctly left alone'}</span>
														<Rich text={note.decoy ?? ''} />
													{/if}
												</div>
											</td>
										</tr>
									{/if}
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/each}

	{#if review}
		<div class="bar">
			{#if !checked}
				<span>Click the lines you'd leave a review comment on. <b>{flagCount}</b> flagged.</span>
				<button type="button" class="go" disabled={!flagCount} onclick={() => (checked = true)}>Submit review</button>
			{:else}
				<span>
					<b>{hits}/{issues.length}</b> issues found{#if blockers.length} · blockers {blockersHit}/{blockers.length}{/if}{#if falseFlags} · {falseFlags} noise comment{falseFlags === 1 ? '' : 's'}{/if}
					{#if decoys.length} · decoys avoided {decoys.filter((d) => !flagged[d.key]).length}/{decoys.length}{/if}
				</span>
				<button type="button" onclick={() => ((flagged = {}), (checked = false))}>Review again</button>
			{/if}
		</div>
	{/if}
</figure>

<style>
	.pr {
		margin: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
		min-width: 0;
		--add-bg: #e6ffec;
		--add-ln: #ccffd8;
		--del-bg: #ffebe9;
		--del-ln: #ffd7d5;
		--hunk-bg: #ddf4ff;
	}
	:global(:root[data-theme='dark']) .pr {
		--add-bg: #12261e;
		--add-ln: #1a3a2a;
		--del-bg: #2a1517;
		--del-ln: #3d1d20;
		--hunk-bg: #121d2f;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .pr {
			--add-bg: #12261e;
			--add-ln: #1a3a2a;
			--del-bg: #2a1517;
			--del-ln: #3d1d20;
			--hunk-bg: #121d2f;
		}
	}
	header {
		padding: 12px 14px;
		border-bottom: 1px solid var(--line);
		display: grid;
		gap: 6px;
	}
	.ptitle {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.badge {
		background: #1f883d;
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		padding: 2px 10px;
		border-radius: 999px;
	}
	.by {
		font-size: 13px;
		color: var(--muted);
	}
	.desc {
		font-size: 14.5px;
	}
	.file + .file,
	header + .file {
		border-top: 1px solid var(--line);
	}
	.fhead {
		display: flex;
		gap: 8px;
		align-items: center;
		width: 100%;
		border: 0;
		background: var(--surface-2);
		padding: 7px 12px;
		cursor: pointer;
		font-family: var(--f-mono);
		font-size: 12.5px;
		text-align: left;
		border-bottom: 1px solid var(--line);
	}
	.path {
		flex: 1;
		font-weight: 500;
	}
	.add {
		color: #1a7f37;
	}
	.del {
		color: #cf222e;
		margin-left: 4px;
	}
	.code {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-family: var(--f-mono);
		font-size: 12.5px;
		line-height: 1.55;
	}
	td {
		padding: 0 8px;
		vertical-align: top;
	}
	.ln {
		width: 1%;
		min-width: 38px;
		text-align: right;
		color: var(--muted);
		user-select: none;
		font-size: 11.5px;
	}
	.txt {
		white-space: pre;
		position: relative;
		padding-right: 36px;
	}
	.sign {
		display: inline-block;
		width: 1.4ch;
		user-select: none;
		color: var(--muted);
	}
	tr.add {
		background: var(--add-bg);
	}
	tr.add .ln {
		background: var(--add-ln);
	}
	tr.del {
		background: var(--del-bg);
	}
	tr.del .ln {
		background: var(--del-ln);
	}
	tr.hunk {
		background: var(--hunk-bg);
		color: var(--muted);
	}
	tr.clickable {
		cursor: pointer;
	}
	tr.clickable:hover .txt {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.flagbtn {
		position: absolute;
		right: 6px;
		top: 1px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--accent);
		border-radius: 4px;
		width: 22px;
		height: 18px;
		line-height: 1;
		font-size: 12px;
		cursor: pointer;
		opacity: 0;
	}
	tr.clickable:hover .flagbtn,
	tr.flag .flagbtn,
	.flagbtn:focus-visible {
		opacity: 1;
	}
	tr.flag .txt {
		box-shadow: inset 4px 0 0 #e5a21c;
	}
	tr.hit .txt {
		box-shadow: inset 4px 0 0 #1f883d;
	}
	tr.miss .txt {
		box-shadow: inset 4px 0 0 #cf222e;
	}
	tr.decoy .txt,
	tr.fooled .txt {
		box-shadow: inset 4px 0 0 #8250df;
	}
	tr.wrong .txt {
		box-shadow: inset 4px 0 0 #8c959f;
	}
	.note-row td {
		padding: 6px 12px 8px 90px;
		background: var(--surface);
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.note {
		font-family: var(--f-body);
		font-size: 14px;
		white-space: normal;
		line-height: 1.5;
	}
	.sev {
		font-family: var(--f-mono);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		padding: 1px 7px;
		border-radius: 4px;
		margin-right: 6px;
		color: #fff;
		background: #9a6700;
	}
	.sev.blocker {
		background: #cf222e;
	}
	.sev.major {
		background: #bc4c00;
	}
	.sev.minor {
		background: #9a6700;
	}
	.sev.nit {
		background: #6e7781;
	}
	.sev.decoy {
		background: #8250df;
	}
	.res {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		color: var(--muted);
		margin-right: 4px;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-top: 1px solid var(--line);
		font-size: 14px;
	}
	.bar button {
		font-family: var(--f-mono);
		font-size: 12.5px;
		padding: 6px 12px;
		border: 1px solid var(--line);
		border-radius: 7px;
		background: var(--surface);
		cursor: pointer;
	}
	.bar .go {
		background: #1f883d;
		border-color: #1f883d;
		color: #fff;
	}
	.bar .go:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
