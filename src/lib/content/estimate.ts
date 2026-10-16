import type { Assessment, Question } from './types';

/** Default minutes per question when content doesn't set `minutes`. */
const BY_TAG: Record<Question['tag'], number> = {
	core: 6,
	tricky: 8,
	variant: 4,
	template: 5,
	teaser: 2,
	design: 12,
	coding: 15
};

const INTERACTIVE = new Set(['lab', 'terminal', 'diff', 'mock']);

/** Estimated minutes for one question. Interactive blocks without an explicit estimate get a floor of 10. */
export function questionMinutes(q: Question): number {
	if (q.minutes) return q.minutes;
	const base = BY_TAG[q.tag] ?? 6;
	return q.prompt.some((b) => INTERACTIVE.has(b.type)) ? Math.max(base, 10) : base;
}

/** Total estimated minutes for an assessment, summed from its questions. */
export function assessmentMinutes(a: Assessment): number {
	return a.parts.reduce((n, p) => n + p.questions.reduce((m, q) => m + questionMinutes(q), 0), 0);
}

/** "2 h 35 min" / "45 min". */
export function formatMinutes(m: number): string {
	const h = Math.floor(m / 60);
	const r = m % 60;
	return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}
