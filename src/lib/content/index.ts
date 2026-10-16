import type { Assessment, GlossaryTerm } from './types';

/**
 * Content registry. Files are discovered automatically:
 *   assessments/*.ts  → `export default` one Assessment
 *   glossary/*.ts     → `export default` an array of GlossaryTerm
 * Adding content never requires touching this file.
 */
const assessmentModules = import.meta.glob<{ default: Assessment }>('./assessments/*.ts', { eager: true });
const glossaryModules = import.meta.glob<{ default: GlossaryTerm[] }>('./glossary/*.ts', { eager: true });

export const assessments: Assessment[] = Object.values(assessmentModules)
	.map((m) => m.default)
	.sort((a, b) => a.number - b.number);

export const glossary: GlossaryTerm[] = Object.values(glossaryModules)
	.flatMap((m) => m.default)
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
