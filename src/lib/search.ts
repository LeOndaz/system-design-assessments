import { assessments, glossary } from './content';
import { plainText } from './content/inline';
import { questionText } from './content/walk';
import { assessmentHref, termHref } from './paths';

export interface SearchItem {
	kind: 'question' | 'term' | 'assessment';
	title: string;
	context: string;
	href: string;
	haystack: string;
}

let index: SearchItem[] | null = null;

function build(): SearchItem[] {
	const items: SearchItem[] = [];
	for (const a of assessments) {
		items.push({
			kind: 'assessment',
			title: a.title,
			context: a.tagline,
			href: assessmentHref(a.id),
			haystack: `${a.title} ${a.tagline} ${a.topics.join(' ')}`.toLowerCase()
		});
		for (const p of a.parts)
			for (const q of p.questions) {
				const title = plainText(q.title);
				items.push({
					kind: 'question',
					title,
					context: `${a.title} · ${p.nav}`,
					href: assessmentHref(a.id, `q-${q.id}`),
					haystack: `${title} ${questionText(q)}`.toLowerCase()
				});
			}
	}
	for (const t of glossary)
		items.push({
			kind: 'term',
			title: t.term,
			context: t.category,
			href: termHref(t.id),
			haystack: `${t.term} ${(t.aliases ?? []).join(' ')} ${t.id} ${plainText(t.short)}`.toLowerCase()
		});
	return items;
}

/** Rank: title prefix > title contains > body contains (all words must match somewhere). */
export function search(query: string, limit = 30): SearchItem[] {
	index ??= build();
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const scored: { item: SearchItem; score: number }[] = [];
	for (const item of index) {
		const title = item.title.toLowerCase();
		if (!words.every((w) => item.haystack.includes(w) || title.includes(w))) continue;
		let score = 0;
		for (const w of words) {
			if (title.startsWith(w)) score += 6;
			else if (title.includes(w)) score += 3;
			else score += 1;
		}
		if (item.kind === 'term') score += 1;
		if (item.kind === 'assessment') score += 2;
		scored.push({ item, score });
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}
