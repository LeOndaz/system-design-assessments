<!--
  Renders a `Rich` string (see content/inline.ts).
  `plainTerms` renders glossary refs as simple links (used inside popovers to avoid nesting).
-->
<script lang="ts">
	import { parseInline, type Inline } from '$lib/content/inline';
	import { getTerm } from '$lib/content';
	import { termHref } from '$lib/paths';
	import Term from './Term.svelte';

	let { text, plainTerms = false }: { text: string; plainTerms?: boolean } = $props();

	const nodes = $derived(parseInline(text));
</script>

{#snippet render(list: Inline[])}
	{#each list as n, i (i)}
		{#if n.t === 'text'}{n.v}{:else if n.t === 'code'}<code>{n.v}</code>{:else if n.t === 'strong'}<strong
				>{@render render(n.c)}</strong
			>{:else if n.t === 'em'}<em>{@render render(n.c)}</em>{:else if n.t === 'link'}<a
				href={n.href}
				target={n.href.startsWith('http') ? '_blank' : undefined}
				rel={n.href.startsWith('http') ? 'noreferrer' : undefined}>{@render render(n.c)}</a
			>{:else if n.t === 'term'}{@const term = getTerm(n.id)}{#if !term}<span class="missing" title="Unknown term: {n.id}"
					>{n.label ?? n.id}</span
				>{:else if plainTerms}<a class="plain-term" href={termHref(term.id)}>{n.label ?? term.term}</a>{:else}<Term
					{term}
					label={n.label}
				/>{/if}{/if}
	{/each}
{/snippet}

{@render render(nodes)}

<style>
	.missing {
		text-decoration: underline wavy var(--crit);
	}
	.plain-term {
		color: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
	}
</style>
