<!-- A human report rendered in the visual idiom of its channel (email, chat, support desk, issue tracker, meeting notes). -->
<script lang="ts">
	import type { Ticket } from '$lib/content/types';

	let { ticket }: { ticket: Ticket } = $props();

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
	const paras = (body: string) => body.split(/\n\s*\n/).map((p) => p.trim());
	const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

	const channelLabel = {
		email: 'Email',
		slack: 'Chat',
		support: 'Support ticket',
		jira: 'Issue',
		meeting: 'Meeting notes'
	} as const;
</script>

<div class="ticket {ticket.channel}">
	<div class="chrome">
		<span class="kind">{channelLabel[ticket.channel]}</span>
		{#if ticket.subject}<span class="subject">{ticket.subject}</span>{/if}
	</div>
	<div class="msg">
		<span class="avatar" style:--h={hue(ticket.from)} aria-hidden="true">{initials(ticket.from)}</span>
		<div class="content">
			<div class="who">
				<strong>{ticket.from}</strong>
				<span class="role">{ticket.role}</span>
				{#if ticket.time}<span class="time">{ticket.time}</span>{/if}
			</div>
			<div class="body">
				{#each paras(ticket.body) as p, i (i)}<p>{p}</p>{/each}
			</div>
			{#if ticket.attachments?.length}
				<div class="attach">
					{#each ticket.attachments as a, i (i)}<span class="file">📎 {a}</span>{/each}
				</div>
			{/if}
		</div>
	</div>
	{#each ticket.thread ?? [] as r, i (i)}
		<div class="msg reply">
			<span class="avatar" style:--h={hue(r.from)} aria-hidden="true">{initials(r.from)}</span>
			<div class="content">
				<div class="who">
					<strong>{r.from}</strong>
					{#if r.role}<span class="role">{r.role}</span>{/if}
					{#if r.time}<span class="time">{r.time}</span>{/if}
				</div>
				<div class="body">{#each paras(r.body) as p, j (j)}<p>{p}</p>{/each}</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.ticket {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
		font-size: 15px;
		min-width: 0;
	}
	.chrome {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 8px 14px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--line);
		flex-wrap: wrap;
	}
	.kind {
		font-family: var(--f-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.subject {
		font-weight: 600;
	}
	.msg {
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: 12px;
		padding: 14px;
	}
	.reply {
		border-top: 1px dashed var(--line);
	}
	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-size: 13px;
		font-weight: 600;
		color: #fff;
		background: hsl(var(--h) 45% 42%);
	}
	.email .avatar,
	.support .avatar {
		border-radius: 50%;
	}
	.content {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: baseline;
	}
	.role,
	.time {
		font-size: 13px;
		color: var(--muted);
	}
	.time {
		font-family: var(--f-mono);
		font-size: 12px;
	}
	.body {
		display: grid;
		gap: 8px;
		white-space: pre-line;
	}
	.slack .body {
		font-size: 15px;
	}
	.meeting .body {
		font-style: italic;
	}
	.attach {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.file {
		font-family: var(--f-mono);
		font-size: 12px;
		padding: 3px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--surface-2);
	}
	.support .chrome {
		border-left: 3px solid var(--warn);
	}
	.jira .chrome {
		border-left: 3px solid var(--info);
	}
	.slack .chrome {
		border-left: 3px solid var(--accent);
	}
</style>
