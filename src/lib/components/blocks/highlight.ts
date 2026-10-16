/**
 * Minimal syntax highlighter: comments, strings, numbers, keywords.
 * Not a parser; just enough colour to make short snippets scannable.
 * Output is HTML-escaped before any markup is added.
 */

const KEYWORDS: Record<string, string[]> = {
	python: 'def class return if elif else for while in not and or is None True False import from as with try except finally raise yield lambda async await pass break continue global self'.split(' '),
	typescript: 'const let var function return if else for while of in new class interface type extends implements import export from as async await try catch finally throw null undefined true false this typeof instanceof switch case default break continue'.split(' '),
	go: 'func return if else for range var const type struct interface package import go defer chan select case default nil true false map make err'.split(' '),
	sql: 'SELECT FROM WHERE AND OR NOT IN IS NULL JOIN LEFT RIGHT INNER ON GROUP BY ORDER LIMIT OFFSET INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX CONCURRENTLY ALTER ADD COLUMN BEGIN COMMIT ROLLBACK FOR AS DESC ASC WITH RETURNING PRIMARY KEY DEFAULT EXPLAIN ANALYZE LOCK EXISTS COUNT SUM MAX MIN DISTINCT HAVING CASE WHEN THEN ELSE END'.split(' '),
	yaml: [],
	text: []
};
KEYWORDS.javascript = KEYWORDS.typescript;
KEYWORDS.ts = KEYWORDS.typescript;
KEYWORDS.js = KEYWORDS.typescript;
KEYWORDS.py = KEYWORDS.python;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(code: string, lang = 'text'): string {
	const l = lang.toLowerCase();
	if (l === 'text' || l === 'plain' || l === 'log') return esc(code);
	const kw = new Set(KEYWORDS[l] ?? []);
	const ci = l === 'sql';
	const comment = l === 'python' || l === 'py' || l === 'yaml' || l === 'bash' || l === 'sh' ? '#[^\\n]*' : l === 'sql' ? '--[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
	const re = new RegExp(
		`(${comment})|("""[\\s\\S]*?"""|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)|([A-Za-z_][A-Za-z0-9_]*)|(@[A-Za-z_][\\w.]*)`,
		'g'
	);
	let out = '';
	let last = 0;
	for (const m of code.matchAll(re)) {
		out += esc(code.slice(last, m.index));
		const [tok, c, s, n, w, deco] = m;
		if (c) out += `<span class="hl-c">${esc(tok)}</span>`;
		else if (s) out += `<span class="hl-s">${esc(tok)}</span>`;
		else if (n) out += `<span class="hl-n">${esc(tok)}</span>`;
		else if (deco) out += `<span class="hl-d">${esc(tok)}</span>`;
		else if (w && kw.has(ci ? w.toUpperCase() : w)) out += `<span class="hl-k">${esc(tok)}</span>`;
		else out += esc(tok);
		last = m.index + tok.length;
	}
	return out + esc(code.slice(last));
}
