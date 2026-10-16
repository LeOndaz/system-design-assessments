import type { Assessment, Block, Question, Rich } from './types';
import { plainText, termRefs } from './inline';

/** Collect every Rich string inside a block tree. */
export function richIn(blocks: Block[] | undefined, out: Rich[] = []): Rich[] {
	for (const b of blocks ?? []) {
		switch (b.type) {
			case 'p':
			case 'heading':
				out.push(b.text);
				break;
			case 'list':
				out.push(...b.items);
				break;
			case 'ranked':
				for (const it of b.items) out.push(it.title, it.body ?? '', it.confirm ?? '');
				break;
			case 'code':
				out.push(b.caption ?? '');
				break;
			case 'callout':
				out.push(b.text, b.title ?? '');
				break;
			case 'table':
				out.push(...b.head, ...b.rows.flat(), b.caption ?? '');
				break;
			case 'cards':
				for (const c of b.items) out.push(c.title, ...c.items);
				break;
			case 'budget':
				out.push(...b.items.map((i) => i.label));
				break;
			case 'flow':
				for (const s of b.steps) out.push(s.label, s.note ?? '');
				out.push(b.caption ?? '');
				break;
			case 'lab':
				out.push(b.lab.brief, b.lab.win.text, ...(b.lab.lose ?? []).map((l) => l.text));
				for (const r of b.lab.resources) for (const f of r.fields ?? []) out.push(f.help ?? '');
				break;
			case 'mock': {
				const walk = (els: import('./types').MockEl[]) =>
					els.forEach((e) => {
						out.push(e.issue ?? '', e.decoy ?? '');
						if (e.children) walk(e.children);
					});
				walk(b.mock.elements);
				break;
			}
			case 'columns':
				for (const c of b.columns) {
					out.push(c.title ?? '');
					richIn(c.blocks, out);
				}
				break;
		}
	}
	return out;
}

/** Plain text of non-Rich payloads (tickets, code, logs) for search. */
function rawIn(blocks: Block[] | undefined, out: string[] = []): string[] {
	for (const b of blocks ?? []) {
		if (b.type === 'ticket') out.push(b.ticket.subject ?? '', b.ticket.body, b.ticket.role);
		else if (b.type === 'code') out.push(b.code);
		else if (b.type === 'logs') out.push(...b.logs.lines.map((l) => l.msg));
		else if (b.type === 'dashboard') out.push(b.dashboard.title, ...b.dashboard.panels.map((p) => p.title));
		else if (b.type === 'columns') for (const c of b.columns) rawIn(c.blocks, out);
		else if (b.type === 'lab') out.push(b.lab.title, ...b.lab.resources.map((r) => `${r.service} ${r.name} ${r.type}`));
		else if (b.type === 'mock') out.push(b.mock.url ?? '', b.mock.title ?? '');
	}
	return out;
}

export function questionRich(q: Question): Rich[] {
	return [q.title, ...(q.hints ?? []), ...richIn(q.prompt), ...richIn(q.answer)];
}

export function questionText(q: Question): string {
	return [...questionRich(q).map((r) => plainText(r)), ...rawIn(q.prompt)].join(' ');
}

export interface TermUsage {
	assessment: Assessment;
	partId: string;
	question: Question;
}

/** Map of term id → questions that reference it. */
export function termUsage(assessments: Assessment[]): Map<string, TermUsage[]> {
	const map = new Map<string, TermUsage[]>();
	for (const a of assessments)
		for (const p of a.parts)
			for (const q of p.questions) {
				const ids = new Set(questionRich(q).flatMap(termRefs));
				for (const id of ids) {
					const list = map.get(id) ?? [];
					list.push({ assessment: a, partId: p.id, question: q });
					map.set(id, list);
				}
			}
	return map;
}
