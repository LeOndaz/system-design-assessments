<script lang="ts">
	import Rich from '../Rich.svelte';
	import { highlight } from './highlight';

	let { code, lang = 'text', caption }: { code: string; lang?: string; caption?: string } = $props();

	const html = $derived(highlight(code, lang));
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			/* clipboard blocked */
		}
	}
</script>

<figure>
	<div class="frame">
		<div class="bar">
			<span class="lang">{lang}</span>
			<button type="button" class="copy" onclick={copy}>{copied ? 'copied' : 'copy'}</button>
		</div>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlight() escapes all input -->
		<pre><code>{@html html}</code></pre>
	</div>
	{#if caption}<figcaption><Rich text={caption} /></figcaption>{/if}
</figure>

<style>
	figure {
		margin: 0;
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.frame {
		background: var(--code-bg);
		border-radius: 8px;
		overflow: hidden;
		min-width: 0;
	}
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 5px 10px 0 16px;
		font-family: var(--f-mono);
		font-size: 11px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.copy {
		border: 0;
		background: none;
		cursor: pointer;
		font-family: var(--f-mono);
		font-size: 11px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 4px 6px;
		border-radius: 4px;
	}
	.copy:hover {
		color: var(--accent);
	}
	pre {
		font-family: var(--f-mono);
		font-size: 13px;
		line-height: 1.55;
		padding: 6px 16px 14px;
		overflow-x: auto;
		margin: 0;
		tab-size: 4;
	}
	pre code {
		background: none;
		padding: 0;
		font-size: inherit;
		overflow-wrap: normal;
	}
	pre :global(.hl-c) {
		color: var(--muted);
		font-style: italic;
	}
	pre :global(.hl-s) {
		color: var(--ok);
	}
	pre :global(.hl-k) {
		color: var(--accent);
		font-weight: 500;
	}
	pre :global(.hl-n) {
		color: var(--warn);
	}
	pre :global(.hl-d) {
		color: var(--info);
	}
	figcaption {
		font-size: 14px;
		color: var(--muted);
	}
</style>
