import { error } from '@sveltejs/kit';
import { getTerm, glossary } from '$lib/content';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => glossary.map((t) => ({ id: t.id }));

export const load: PageLoad = ({ params }) => {
	if (!getTerm(params.id)) error(404, 'Term not found');
	return { id: params.id };
};
