<script lang="ts">
	import { page } from '$app/state';
	import { href } from '$lib/paths';
</script>

<div class="wrap" style="padding-block: 60px; display: grid; gap: 14px">
	<span class="eyebrow">{page.status}</span>
	<h1>{page.status === 404 ? 'Nothing here' : 'Something broke'}</h1>
	<p class="lede">{page.error?.message}</p>
	<p><a class="btn" href={href('/')}>← Back to assessments</a></p>
</div>
