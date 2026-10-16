import { error } from '@sveltejs/kit';
import { assessments, getAssessment } from '$lib/content';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => assessments.map((a) => ({ id: a.id }));

export const load: PageLoad = ({ params }) => {
	const assessment = getAssessment(params.id);
	if (!assessment) error(404, 'Assessment not found');
	return { id: assessment.id };
};
