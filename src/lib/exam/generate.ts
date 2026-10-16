import { assessments } from '$lib/content';
import { questionMinutes } from '$lib/content/estimate';
import { rng } from '$lib/content/series';
import type { Assessment, Question, QuestionTag } from '$lib/content/types';

export interface ExamConfig {
	seed: number;
	count: number;
	/** Assessment ids to draw from. Empty = all. */
	from: string[];
	tags: QuestionTag[];
	/** Include labs, terminals, diffs and mocks. */
	interactive: boolean;
}

export interface ExamItem {
	assessment: Assessment;
	partNav: string;
	question: Question;
	minutes: number;
}

export const ALL_TAGS: QuestionTag[] = ['core', 'tricky', 'variant', 'design', 'coding', 'teaser', 'template'];
export const DEFAULT_TAGS: QuestionTag[] = ['core', 'tricky', 'design', 'coding'];
const INTERACTIVE = new Set(['lab', 'terminal', 'diff', 'mock']);

/** Every question that matches the filters. */
export function pool(cfg: Omit<ExamConfig, 'seed' | 'count'>): ExamItem[] {
	return assessments
		.filter((a) => !cfg.from.length || cfg.from.includes(a.id))
		.flatMap((a) =>
			a.parts.flatMap((p) =>
				p.questions
					.filter((q) => cfg.tags.includes(q.tag))
					.filter((q) => q.answer.length > 0)
					.filter((q) => cfg.interactive || !q.prompt.some((b) => INTERACTIVE.has(b.type)))
					.map((q) => ({ assessment: a, partNav: p.nav, question: q, minutes: questionMinutes(q) }))
			)
		);
}

/**
 * Seeded draw, spread across assessments: round-robin over shuffled per-assessment queues
 * so one huge assessment can't dominate the exam.
 */
export function generate(cfg: ExamConfig): ExamItem[] {
	const r = rng(cfg.seed);
	const shuffle = <T>(xs: T[]) => {
		const a = [...xs];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(r() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};
	const byAssessment = new Map<string, ExamItem[]>();
	for (const item of pool(cfg)) byAssessment.set(item.assessment.id, [...(byAssessment.get(item.assessment.id) ?? []), item]);
	const queues = shuffle([...byAssessment.values()].map(shuffle));
	const out: ExamItem[] = [];
	while (out.length < cfg.count && queues.some((q) => q.length)) {
		for (const q of queues) {
			const next = q.shift();
			if (next) out.push(next);
			if (out.length >= cfg.count) break;
		}
	}
	return shuffle(out);
}

export function toQuery(cfg: ExamConfig): string {
	const p = new URLSearchParams({ seed: String(cfg.seed), n: String(cfg.count), tags: cfg.tags.join(','), i: cfg.interactive ? '1' : '0' });
	if (cfg.from.length) p.set('from', cfg.from.join(','));
	return p.toString();
}

export function fromQuery(q: URLSearchParams): ExamConfig | null {
	if (!q.get('seed')) return null;
	return {
		seed: Number(q.get('seed')) || 1,
		count: Math.min(60, Math.max(1, Number(q.get('n')) || 10)),
		from: (q.get('from') ?? '').split(',').filter(Boolean),
		tags: ((q.get('tags') ?? DEFAULT_TAGS.join(',')).split(',').filter((t) => ALL_TAGS.includes(t as QuestionTag)) as QuestionTag[]) || DEFAULT_TAGS,
		interactive: q.get('i') !== '0'
	};
}
