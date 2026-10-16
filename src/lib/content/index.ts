import type { Assessment, GlossaryTerm } from './types';
import wiki from './wiki.json';

/**
 * Content registry. Files are discovered automatically:
 *   assessments/*.ts  → `export default` one Assessment
 *   glossary/*.ts     → `export default` an array of GlossaryTerm
 * Adding content never requires touching this file.
 */
const assessmentModules = import.meta.glob<{ default: Assessment }>('./assessments/*.ts', { eager: true });
const glossaryModules = import.meta.glob<{ default: GlossaryTerm[] }>('./glossary/*.ts', { eager: true });

/** Files that don't (yet) default-export an Assessment are skipped here; the validator reports them. */
export const assessmentFilesMissingExport = Object.entries(assessmentModules)
	.filter(([, m]) => !m.default)
	.map(([path]) => path);

export const assessments: Assessment[] = Object.values(assessmentModules)
	.map((m) => m.default)
	.filter(Boolean)
	.sort((a, b) => a.number - b.number);

/** Verified Wikipedia links, id → URL. Kept separate so tooling can regenerate it. */
const wikiLinks: Record<string, string> = wiki;

export const glossary: GlossaryTerm[] = Object.values(glossaryModules)
	.flatMap((m) => m.default)
	.map((t) => (wikiLinks[t.id] && !t.wiki ? { ...t, wiki: wikiLinks[t.id] } : t))
	.sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));

const termById = new Map(glossary.map((t) => [t.id, t]));

export function getTerm(id: string): GlossaryTerm | undefined {
	return termById.get(id);
}

export function getAssessment(id: string): Assessment | undefined {
	return assessments.find((a) => a.id === id);
}

export function questionCount(a: Assessment): number {
	return a.parts.reduce((n, p) => n + p.questions.length, 0);
}

export const TRACKS = [
	{ id: 'core', title: 'Core assessments', short: 'Core', blurb: 'Focused sets, each built around one kind of pressure.' },
	{ id: 'interactive', title: 'Interactive', short: 'Interactive', blurb: 'Work it hands-on: simulated consoles, terminals and code reviews.' },
	{ id: 'mixed', title: 'Mixed', short: 'Mixed', blurb: 'Everything interleaved, the way a real week arrives. No warning about what comes next.' },
	{ id: 'specialist', title: 'Specialist', short: 'Specialist', blurb: 'Outside the mixes: UX, accessibility and product judgement.' }
] as const;

export function trackOf(a: Assessment) {
	return TRACKS.find((t) => t.id === (a.track ?? 'core'))!;
}

/** Assessments in one track, in display order. */
export function inTrack(id: string): Assessment[] {
	return assessments.filter((a) => (a.track ?? 'core') === id);
}

/** 1-based position of an assessment within its own track ("Core 3"). */
export function trackIndex(a: Assessment): number {
	return inTrack(a.track ?? 'core').indexOf(a) + 1;
}
