/**
 * Tiny inline-markup parser for `Rich` strings.
 *
 *   **bold**  *em*  `code`  [[term-id]]  [[term-id|label]]  [text](url)
 *
 * Bold and emphasis may contain other markup; code and term labels are literal.
 * Anything that doesn't close is kept as plain text, so a stray `*` is harmless.
 */

export type Inline =
	| { t: 'text'; v: string }
	| { t: 'code'; v: string }
	| { t: 'strong'; c: Inline[] }
	| { t: 'em'; c: Inline[] }
	| { t: 'term'; id: string; label?: string }
	| { t: 'link'; href: string; c: Inline[] };

const cache = new Map<string, Inline[]>();

export function parseInline(src: string): Inline[] {
	let hit = cache.get(src);
	if (!hit) {
		hit = parse(src);
		cache.set(src, hit);
	}
	return hit;
}

function parse(src: string): Inline[] {
	const out: Inline[] = [];
	let buf = '';
	const flush = () => {
		if (buf) out.push({ t: 'text', v: buf });
		buf = '';
	};

	let i = 0;
	while (i < src.length) {
		const ch = src[i];

		if (ch === '\\' && i + 1 < src.length) {
			buf += src[i + 1];
			i += 2;
			continue;
		}

		if (ch === '`') {
			const end = src.indexOf('`', i + 1);
			if (end > i) {
				flush();
				out.push({ t: 'code', v: src.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}

		if (src.startsWith('[[', i)) {
			const end = src.indexOf(']]', i + 2);
			if (end > i) {
				flush();
				const [id, label] = src.slice(i + 2, end).split('|');
				out.push({ t: 'term', id: id.trim(), label: label?.trim() });
				i = end + 2;
				continue;
			}
		}

		if (ch === '[') {
			const close = findClosing(src, i + 1, ']');
			if (close > i && src[close + 1] === '(') {
				const paren = src.indexOf(')', close + 2);
				if (paren > close) {
					flush();
					out.push({ t: 'link', href: src.slice(close + 2, paren), c: parse(src.slice(i + 1, close)) });
					i = paren + 1;
					continue;
				}
			}
		}

		if (src.startsWith('**', i)) {
			const end = findDelim(src, i + 2, '**');
			if (end > i + 2) {
				flush();
				out.push({ t: 'strong', c: parse(src.slice(i + 2, end)) });
				i = end + 2;
				continue;
			}
		}

		if (ch === '*' && src[i + 1] !== ' ' && src[i + 1] !== '*') {
			const end = findDelim(src, i + 1, '*');
			if (end > i + 1 && src[end - 1] !== ' ') {
				flush();
				out.push({ t: 'em', c: parse(src.slice(i + 1, end)) });
				i = end + 1;
				continue;
			}
		}

		buf += ch;
		i++;
	}
	flush();
	return out;
}

/** Find `delim` starting at `from`, skipping over code spans and term refs. */
function findDelim(src: string, from: number, delim: string): number {
	let i = from;
	while (i < src.length) {
		if (src[i] === '\\') {
			i += 2;
			continue;
		}
		if (src[i] === '`') {
			const end = src.indexOf('`', i + 1);
			if (end < 0) return -1;
			i = end + 1;
			continue;
		}
		if (src.startsWith('[[', i)) {
			const end = src.indexOf(']]', i + 2);
			if (end < 0) return -1;
			i = end + 2;
			continue;
		}
		if (delim === '*' && src.startsWith('**', i)) {
			const end = src.indexOf('**', i + 2);
			if (end < 0) return -1;
			i = end + 2;
			continue;
		}
		if (src.startsWith(delim, i)) return i;
		i++;
	}
	return -1;
}

function findClosing(src: string, from: number, ch: string): number {
	for (let i = from; i < src.length; i++) {
		if (src[i] === '`') {
			const end = src.indexOf('`', i + 1);
			if (end < 0) return -1;
			i = end;
		} else if (src[i] === ch) return i;
	}
	return -1;
}

/** All term ids referenced in a Rich string (used by the content validator). */
export function termRefs(src: string): string[] {
	const ids: string[] = [];
	const walk = (nodes: Inline[]) => {
		for (const n of nodes) {
			if (n.t === 'term') ids.push(n.id);
			else if (n.t === 'strong' || n.t === 'em' || n.t === 'link') walk(n.c);
		}
	};
	walk(parseInline(src));
	return ids;
}

/** Strip markup to plain text (for search and meta descriptions). */
export function plainText(src: string, termName: (id: string) => string = (id) => id): string {
	const walk = (nodes: Inline[]): string =>
		nodes
			.map((n) => {
				switch (n.t) {
					case 'text':
					case 'code':
						return n.v;
					case 'term':
						return n.label ?? termName(n.id);
					default:
						return walk(n.c);
				}
			})
			.join('');
	return walk(parseInline(src));
}
