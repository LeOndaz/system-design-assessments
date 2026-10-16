<!--
  Shared interactive terminal. Any content block can embed one: { type: 'terminal', terminal: {...} }.
  Everything runs client-side against an in-memory filesystem (see shell.ts / builtins.ts).
-->
<script lang="ts">
	import type { TerminalScenario } from '$lib/content/types';
	import Rich from '$lib/components/Rich.svelte';
	import { Shell } from './shell';

	let { scenario }: { scenario: TerminalScenario } = $props();

	type Entry = { prompt?: string; cmd?: string; out: string };

	// The scenario is static content; capturing it once is intended.
	// svelte-ignore state_referenced_locally
	let shell = $state.raw(new Shell(scenario));
	let entries = $state<Entry[]>(initialEntries());
	let input = $state('');
	let histIdx = $state<number | null>(null);
	let solved = $state(false);
	let suggestions = $state<string[]>([]);
	let screen: HTMLDivElement | undefined = $state();
	let field: HTMLInputElement | undefined = $state();
	// svelte-ignore state_referenced_locally
	let prompt = $state(shell.prompt());

	function initialEntries(): Entry[] {
		const motd = scenario.motd ?? '';
		return [{ out: (motd ? motd.replace(/\n?$/, '\n') : '') + 'Type `help` for commands. Tab completes; ↑/↓ history.\n' }];
	}

	function submit(line: string) {
		const p = shell.prompt();
		const res = shell.run(line);
		if (res.clear) entries = [];
		else entries = [...entries, { prompt: p, cmd: line, out: res.text }];
		if (res.exit) entries = [...entries, { out: 'Connection closed. Press Reset to start a new session.\n' }];
		solved = shell.solved;
		prompt = shell.prompt();
		input = '';
		histIdx = null;
		suggestions = [];
		queueMicrotask(() => screen?.scrollTo({ top: screen.scrollHeight }));
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit(input);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			const r = shell.complete(input);
			input = r.line;
			suggestions = r.options.slice(0, 40);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const h = shell.history;
			if (!h.length) return;
			histIdx = histIdx === null ? h.length - 1 : Math.max(0, histIdx - 1);
			input = h[histIdx];
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			const h = shell.history;
			if (histIdx === null) return;
			histIdx = histIdx + 1 >= h.length ? null : histIdx + 1;
			input = histIdx === null ? '' : h[histIdx];
		} else if (e.key === 'l' && e.ctrlKey) {
			e.preventDefault();
			entries = [];
		} else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
			e.preventDefault();
			entries = [...entries, { prompt: shell.prompt(), cmd: input + '^C', out: '' }];
			input = '';
		} else if (e.key === 'u' && e.ctrlKey) {
			e.preventDefault();
			input = '';
		}
	}

	function reset() {
		shell = new Shell(scenario);
		entries = initialEntries();
		input = '';
		solved = false;
		prompt = shell.prompt();
		suggestions = [];
	}

	function useHint(cmd: string) {
		input = cmd;
		field?.focus();
	}

	function focusInput() {
		if (!window.getSelection()?.toString()) field?.focus({ preventScroll: true });
	}
</script>

<figure class="term">
	{#if scenario.task}<div class="task"><Rich text={scenario.task} /></div>{/if}
	<div class="window">
		<div class="titlebar">
			<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
			<span class="title">{scenario.title ?? `${shell.user}@${shell.host}`}</span>
			<button type="button" class="reset" onclick={reset} title="Reset the sandbox">↺ reset</button>
		</div>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (click only forwards focus to the input inside) -->
		<div class="screen" bind:this={screen} onclick={focusInput} role="log" aria-live="polite">
			{#each entries as e, i (i)}
				{#if e.cmd !== undefined}<div class="line"><span class="ps">{e.prompt}</span><span class="cmd">{e.cmd}</span></div>{/if}
				{#if e.out}<pre class="out">{e.out}</pre>{/if}
			{/each}
			<div class="line input">
				<label class="ps" for="term-input-{scenario.title ?? 'x'}">{prompt}</label>
				<input
					id="term-input-{scenario.title ?? 'x'}"
					bind:this={field}
					bind:value={input}
					{onkeydown}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					aria-label="Shell input"
				/>
			</div>
			{#if suggestions.length}<pre class="out sugg">{suggestions.join('  ')}</pre>{/if}
		</div>
	</div>
	{#if scenario.hints?.length || scenario.answer}
		<div class="foot">
			{#if scenario.hints?.length}
				<div class="hints">
					<span class="lbl">Try</span>
					{#each scenario.hints as h (h)}<button type="button" onclick={() => useHint(h)}><code>{h}</code></button>{/each}
				</div>
			{/if}
			{#if scenario.answer}
				<div class="goal" class:solved>
					{#if solved}✔ Solved{:else}Answer with <code>submit &lt;{scenario.answer.prompt}&gt;</code>{/if}
				</div>
			{/if}
		</div>
	{/if}
</figure>

<style>
	.term {
		margin: 0;
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.task {
		font-size: 15px;
	}
	.window {
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #2b313a;
		background: #0d1117;
		box-shadow: var(--shadow);
		min-width: 0;
	}
	.titlebar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		background: #161b22;
		border-bottom: 1px solid #2b313a;
		color: #8b949e;
		font-family: var(--f-mono);
		font-size: 12px;
	}
	.dots {
		display: flex;
		gap: 5px;
	}
	.dots i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #30363d;
	}
	.title {
		flex: 1;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.reset {
		border: 1px solid #30363d;
		background: none;
		color: #8b949e;
		border-radius: 5px;
		font-family: var(--f-mono);
		font-size: 11px;
		padding: 2px 8px;
		cursor: pointer;
	}
	.reset:hover {
		color: #c9d1d9;
	}
	.screen {
		height: 360px;
		overflow: auto;
		padding: 10px 12px;
		font-family: var(--f-mono);
		font-size: 12.5px;
		line-height: 1.5;
		color: #c9d1d9;
		cursor: text;
	}
	.line {
		display: flex;
		white-space: pre;
	}
	.ps {
		color: #3fb950;
		flex: none;
	}
	.cmd {
		color: #e6edf3;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.out {
		margin: 0;
		font: inherit;
		white-space: pre;
		color: #c9d1d9;
	}
	.sugg {
		color: #8b949e;
		white-space: pre-wrap;
	}
	.input input {
		flex: 1;
		min-width: 0;
		background: none;
		border: 0;
		outline: none;
		color: #e6edf3;
		font: inherit;
		caret-color: #3fb950;
		padding: 0;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		justify-content: space-between;
		align-items: center;
	}
	.hints {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.lbl {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.hints button {
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 6px;
		padding: 1px 4px;
		cursor: pointer;
	}
	.hints button:hover {
		border-color: var(--accent);
	}
	.hints code {
		background: none;
		font-size: 12px;
	}
	.goal {
		font-family: var(--f-mono);
		font-size: 12.5px;
		color: var(--muted);
	}
	.goal.solved {
		color: var(--ok);
		font-weight: 600;
	}
	@media (max-width: 600px) {
		.screen {
			height: 300px;
			font-size: 11.5px;
		}
	}
</style>
