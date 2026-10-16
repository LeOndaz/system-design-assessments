import { base } from '$app/paths';

/** Prefix an absolute app path with the deploy base (GitHub Pages project path). Adds a trailing slash. */
export function href(path: string): string {
	const [p, hash] = path.split('#');
	const withSlash = p.endsWith('/') ? p : `${p}/`;
	return `${base}${withSlash}${hash ? `#${hash}` : ''}`;
}

export const termHref = (id: string) => href(`/glossary/${id}`);
export const assessmentHref = (id: string, hash?: string) => href(`/a/${id}${hash ? `#${hash}` : ''}`);
