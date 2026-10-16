<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { href } from '$lib/paths';
	import { progress } from '$lib/state/progress.svelte';
	import { theme } from '$lib/state/theme.svelte';
	import Timer from '$lib/components/Timer.svelte';
	import SearchDialog from '$lib/components/SearchDialog.svelte';

	let { children } = $props();
	let searchOpen = $state(false);

	onMount(() => {
		progress.load();
		theme.load();
	});

	const isActive = (prefix: string) => page.url.pathname.startsWith(href(prefix));
	const themeIcon = $derived(theme.value === 'dark' ? '☾' : theme.value === 'light' ? '☀' : '◐');
</script>

<a class="skip" href="#main">Skip to content</a>

<header class="top">
	<div class="inner">
		<a class="brand" href={href('/')}>
			<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"
				><rect width="32" height="32" rx="7" fill="var(--accent)" /><path
					d="M5 20h5l3-9 4 14 3-9h7"
					fill="none"
					stroke="var(--surface)"
					stroke-width="2.6"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg
			>
			<span>Drillbook</span>
		</a>
		<nav aria-label="Main">
			<a href={href('/')} class:active={page.url.pathname === href('/')}>Assessments</a>
			<a href={href('/glossary')} class:active={isActive('/glossary')}>Glossary</a>
		</nav>
		<div class="tools">
			<button type="button" class="search" onclick={() => (searchOpen = true)} aria-label="Search (Ctrl K)">
				<span aria-hidden="true">⌕</span><span class="lbl">Search</span><kbd>⌘K</kbd>
			</button>
			<Timer />
			<button type="button" class="icon" onclick={() => theme.cycle()} title="Theme: {theme.value}" aria-label="Toggle theme ({theme.value})"
				>{themeIcon}</button
			>
		</div>
	</div>
</header>

<main id="main">
	{@render children()}
</main>

<footer class="wrap foot">
	<p>
		Model answers reflect common versions of these tasks. Real prompts will differ: read them closely and state your assumptions.
		Progress is saved in this browser only.
	</p>
</footer>

<SearchDialog bind:open={searchOpen} />

<style>
	.skip {
		position: absolute;
		left: -999px;
		top: 8px;
		z-index: 100;
		background: var(--surface);
		padding: 6px 10px;
		border-radius: 6px;
	}
	.skip:focus {
		left: 8px;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		padding-top: env(safe-area-inset-top, 0px);
	}
	.inner {
		max-width: 1120px;
		margin: 0 auto;
		padding: 8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px));
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.brand {
		display: flex;
		gap: 8px;
		align-items: center;
		font-family: var(--f-display);
		font-weight: 800;
		font-size: 18px;
		color: var(--ink);
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	nav {
		display: flex;
		gap: 2px;
	}
	nav a {
		font-family: var(--f-mono);
		font-size: 13px;
		color: var(--muted);
		text-decoration: none;
		padding: 5px 9px;
		border-radius: 6px;
	}
	nav a:hover {
		color: var(--ink);
	}
	nav a.active {
		color: var(--ink);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.tools {
		margin-left: auto;
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.search {
		display: flex;
		gap: 8px;
		align-items: center;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 7px;
		padding: 4px 8px;
		cursor: pointer;
		font-family: var(--f-mono);
		font-size: 12.5px;
		color: var(--muted);
	}
	.search:hover {
		border-color: var(--muted);
	}
	kbd {
		font-family: var(--f-mono);
		font-size: 10.5px;
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 4px;
	}
	.icon {
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 7px;
		width: 30px;
		height: 28px;
		cursor: pointer;
		font-size: 15px;
		line-height: 1;
	}
	.foot {
		padding-block: 40px 60px;
		color: var(--muted);
		font-size: 13px;
		font-family: var(--f-mono);
	}
	@media (max-width: 760px) {
		.search .lbl,
		.search kbd {
			display: none;
		}
		.inner {
			gap: 10px;
		}
		.brand span {
			display: none;
		}
		.tools {
			gap: 6px;
		}
	}
	@media (max-width: 420px) {
		nav a {
			padding: 5px 6px;
		}
	}
</style>
