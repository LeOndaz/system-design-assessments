/**
 * A compact awk: translates the common subset to JavaScript and runs it per record.
 * Supported: BEGIN/END, /regex/ and expression patterns, $N/$NF/$(expr), NR/NF/FS/OFS,
 * print/printf, string concatenation by juxtaposition, ~ and !~, arrays + for (k in a),
 * if/else/while/for, next, length/substr/index/split/tolower/toupper/int/sprintf.
 * Runs only the reader's own input inside their own browser sandbox.
 */

type Tok = { k: 'num' | 'str' | 're' | 'id' | 'op' | 'nl'; v: string };

const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'in', 'do', 'next', 'exit', 'return', 'delete', 'BEGIN', 'END', 'getline']);
const FUNCS: Record<string, string> = {
	length: 'LEN',
	substr: 'SUBSTR',
	index: 'INDEX',
	split: 'SPLIT',
	tolower: 'LOWER',
	toupper: 'UPPER',
	int: 'INT',
	sprintf: 'SPRINTF',
	sqrt: 'Math.sqrt',
	log: 'Math.log',
	exp: 'Math.exp'
};
const SPECIAL = new Set(['NR', 'NF', 'FS', 'OFS', 'FNR', 'RS', 'ORS']);

function lex(src: string): Tok[] {
	const toks: Tok[] = [];
	let i = 0;
	const prevAllowsRegex = () => {
		const p = toks[toks.length - 1];
		return !p || p.k === 'nl' || (p.k === 'op' && !['(', ')', ']'].includes(p.v) ? true : p.k === 'op' && p.v === '(') || (p.k === 'id' && KEYWORDS.has(p.v));
	};
	while (i < src.length) {
		const c = src[i];
		if (c === ' ' || c === '\t') i++;
		else if (c === '\n' || c === ';') {
			toks.push({ k: 'nl', v: ';' });
			i++;
		} else if (c === '#') {
			while (i < src.length && src[i] !== '\n') i++;
		} else if (c === '"') {
			let s = '';
			i++;
			while (i < src.length && src[i] !== '"') {
				if (src[i] === '\\' && i + 1 < src.length) {
					const n = src[i + 1];
					s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
					i += 2;
				} else s += src[i++];
			}
			i++;
			toks.push({ k: 'str', v: s });
		} else if (c === '/' && prevAllowsRegex()) {
			let s = '';
			i++;
			while (i < src.length && src[i] !== '/') {
				if (src[i] === '\\' && src[i + 1] === '/') {
					s += '/';
					i += 2;
				} else s += src[i++];
			}
			i++;
			toks.push({ k: 're', v: s });
		} else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
			const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(src.slice(i))!;
			toks.push({ k: 'num', v: m[0] });
			i += m[0].length;
		} else if (/[A-Za-z_]/.test(c)) {
			const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
			toks.push({ k: 'id', v: m[0] });
			i += m[0].length;
		} else {
			const two = src.slice(i, i + 2);
			if (['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '!~', '^='].includes(two)) {
				toks.push({ k: 'op', v: two });
				i += 2;
			} else {
				toks.push({ k: 'op', v: c });
				i++;
			}
		}
	}
	return toks;
}

const endsOperand = (t?: Tok) => !!t && (t.k === 'num' || t.k === 'str' || (t.k === 'id' && !KEYWORDS.has(t.v) && !(t.v in FUNCS)) || (t.k === 'op' && (t.v === ')' || t.v === ']')));
const startsOperand = (t?: Tok) => !!t && (t.k === 'num' || t.k === 'str' || (t.k === 'id' && !KEYWORDS.has(t.v) && t.v !== 'in') || (t.k === 'op' && (t.v === '$' || t.v === '(')));

/** Translate a token slice (an expression or statement list) to JS. */
function translate(toks: Tok[]): string {
	let out = '';
	let prev: Tok | undefined;
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i];
		const next = toks[i + 1];
		if (endsOperand(prev) && startsOperand(t) && !(prev?.k === 'id' && t.k === 'op' && t.v === '(')) out += ' + "" + ';

		if (t.k === 'id' && (t.v === 'print' || t.v === 'printf')) {
			// collect args until ; or } at depth 0
			let depth = 0;
			let j = i + 1;
			const args: Tok[][] = [[]];
			for (; j < toks.length; j++) {
				const u = toks[j];
				if (u.k === 'nl' && depth === 0) break;
				if (u.k === 'op' && (u.v === '(' || u.v === '[' || u.v === '{')) depth++;
				if (u.k === 'op' && (u.v === ')' || u.v === ']' || u.v === '}')) {
					if (depth === 0) break;
					depth--;
				}
				if (u.k === 'op' && u.v === '>' && depth === 0) {
					// print > "file": output redirection inside awk is not supported; drop the target.
					j = toks.length;
					break;
				}
				if (u.k === 'op' && u.v === ',' && depth === 0) args.push([]);
				else args[args.length - 1].push(u);
			}
			// unwrap print (a, b)
			if (args.length === 1 && args[0][0]?.v === '(' && args[0][args[0].length - 1]?.v === ')') {
				const inner = args[0].slice(1, -1);
				args.splice(0, 1);
				let cur: Tok[] = [];
				let d = 0;
				for (const u of inner) {
					if (u.v === '(' || u.v === '[') d++;
					if (u.v === ')' || u.v === ']') d--;
					if (u.v === ',' && d === 0) {
						args.push(cur);
						cur = [];
					} else cur.push(u);
				}
				args.push(cur);
			}
			const js = args.filter((a) => a.length).map(translate);
			out += t.v === 'print' ? `P([${js.length ? js.join(',') : 'F(0)'}])` : `PF(${js.join(',')})`;
			i = j - 1;
			prev = { k: 'op', v: ')' };
			continue;
		}

		if (t.k === 'op' && t.v === '$') {
			if (next?.k === 'num' || next?.k === 'id') {
				out += `F(${next.k === 'id' ? translate([next]) : next.v})`;
				i++;
				prev = { k: 'op', v: ')' };
				continue;
			}
			out += 'F';
			prev = t;
			continue;
		}
		if (t.k === 'op' && (t.v === '~' || t.v === '!~')) {
			const re = next?.k === 're' ? `/${next.v}/` : `new RegExp(${translate([next!])})`;
			const operand = lastOperandStart(out);
			const cut = out.lastIndexOf(operand);
			out = out.slice(0, cut) + `${t.v === '!~' ? '!' : ''}M(${re}, ${operand})`;
			i++;
			prev = { k: 'op', v: ')' };
			continue;
		}
		switch (t.k) {
			case 'num':
				out += t.v;
				break;
			case 'str':
				out += JSON.stringify(t.v);
				break;
			case 're':
				out += `M(/${t.v}/, F(0))`;
				break;
			case 'nl':
				out += ';';
				break;
			case 'id':
				if (t.v === 'next') out += 'return';
				else if (t.v === 'exit') out += 'throw EXIT';
				else if (t.v === 'length' && !(next?.k === 'op' && next.v === '(')) out += 'LEN(F(0))';
				else if (t.v in FUNCS) out += FUNCS[t.v];
				else if (KEYWORDS.has(t.v)) out += ` ${t.v} `;
				else if (SPECIAL.has(t.v)) out += `S.${t.v}`;
				else if ((next?.k === 'op' && next.v === '[') || toks[i - 1]?.v === 'in') out += `A(${JSON.stringify(t.v)})`;
				else out += `V.${t.v}`;
				break;
			case 'op':
				out += t.v === '^' ? '**' : t.v === '==' ? '==' : t.v === '!=' ? '!=' : ` ${t.v} `;
				break;
		}
		prev = t;
	}
	return out;
}

/** Find the start of the last operand in already-emitted JS (for wrapping `x ~ /re/`). */
function lastOperandStart(js: string): string {
	const m = /(F\([^()]*\)|V\.\w+|S\.\w+|"[^"]*"|\d+(?:\.\d+)?|A\("\w+"\)\[[^\]]*\])\s*$/.exec(js);
	return m ? m[1] : js;
}

interface Rule {
	kind: 'begin' | 'end' | 'main';
	pattern: string | null;
	action: string | null;
}

function parseRules(src: string): Rule[] {
	const toks = lex(src);
	const rules: Rule[] = [];
	let i = 0;
	const block = (): Tok[] => {
		// toks[i] is '{'
		let depth = 0;
		const start = i + 1;
		for (; i < toks.length; i++) {
			if (toks[i].v === '{' && toks[i].k === 'op') depth++;
			if (toks[i].v === '}' && toks[i].k === 'op') {
				depth--;
				if (depth === 0) break;
			}
		}
		const body = toks.slice(start, i);
		i++;
		return body;
	};
	while (i < toks.length) {
		const t = toks[i];
		if (t.k === 'nl') {
			i++;
			continue;
		}
		if (t.k === 'id' && (t.v === 'BEGIN' || t.v === 'END')) {
			i++;
			while (toks[i]?.k === 'nl') i++;
			rules.push({ kind: t.v === 'BEGIN' ? 'begin' : 'end', pattern: null, action: translate(block()) });
			continue;
		}
		if (t.k === 'op' && t.v === '{') {
			rules.push({ kind: 'main', pattern: null, action: translate(block()) });
			continue;
		}
		const pat: Tok[] = [];
		while (i < toks.length && !(toks[i].k === 'op' && toks[i].v === '{') && toks[i].k !== 'nl') pat.push(toks[i++]);
		const action = toks[i]?.v === '{' ? translate(block()) : null;
		rules.push({ kind: 'main', pattern: translate(pat), action });
	}
	return rules;
}

function fmtNum(v: unknown): string {
	if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
	if (v === undefined || v === null) return '';
	return String(v);
}

function sprintf(fmt: string, ...vals: unknown[]): string {
	let k = 0;
	return String(fmt).replace(/%(-?)(\d*)(?:\.(\d+))?([sdifxeg%c])/g, (_m, left, w, p, t) => {
		if (t === '%') return '%';
		const v = vals[k++];
		let s: string;
		if (t === 'd' || t === 'i') s = String(Math.trunc(Number(v) || 0));
		else if (t === 'f') s = (Number(v) || 0).toFixed(p !== undefined ? Number(p) : 6);
		else if (t === 'e') s = (Number(v) || 0).toExponential(p !== undefined ? Number(p) : 6);
		else if (t === 'g') s = fmtNum(Number(v) || 0);
		else if (t === 'x') s = Math.trunc(Number(v) || 0).toString(16);
		else if (t === 'c') s = typeof v === 'number' ? String.fromCharCode(v) : String(v ?? '').charAt(0);
		else s = p !== undefined ? fmtNum(v).slice(0, Number(p)) : fmtNum(v);
		const width = Number(w || 0);
		return width ? (left ? s.padEnd(width) : s.padStart(width)) : s;
	});
}

const numeric = (s: string): string | number => (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s.trim()) ? Number(s) : s);

export function runAwk(program: string, input: string, fs: string | null): { out: string; code?: number } {
	let rules: Rule[];
	try {
		rules = parseRules(program);
	} catch (e) {
		return { out: `awk: syntax error: ${(e as Error).message}\n`, code: 2 };
	}
	let buf = '';
	const S = { NR: 0, NF: 0, FNR: 0, FS: fs ?? ' ', OFS: ' ', ORS: '\n', RS: '\n' };
	const arrays: Record<string, Record<string, unknown>> = {};
	const vars: Record<string, unknown> = {};
	const V = new Proxy(vars, { get: (o, k: string) => (k in o ? o[k] : 0), set: (o, k: string, v) => ((o[k] = v), true) });
	let fields: string[] = [];
	let line = '';
	const splitLine = (l: string) => {
		line = l;
		const sep = S.FS;
		fields = sep === ' ' ? l.trim().split(/\s+/).filter(Boolean) : l.split(sep.length === 1 ? sep : new RegExp(sep));
		S.NF = fields.length;
	};
	const F = (n: number) => (Number(n) === 0 ? numeric(line) : numeric(fields[Number(n) - 1] ?? ''));
	const helpers = {
		F,
		V,
		S,
		// awk arrays: missing elements read as 0 / "" so `count[$1]++` works.
		A: (name: string) =>
			(arrays[name] ??= new Proxy(Object.create(null) as Record<string, unknown>, {
				get: (o, k) => (typeof k === 'string' && !(k in o) ? 0 : o[k as string])
			})),
		M: (re: RegExp, s: unknown) => re.test(String(s)),
		P: (vals: unknown[]) => (buf += vals.map(fmtNum).join(S.OFS) + S.ORS),
		PF: (fmt: string, ...vals: unknown[]) => (buf += sprintf(fmt, ...vals)),
		LEN: (s: unknown) => (s && typeof s === 'object' ? Object.keys(s).length : String(s ?? '').length),
		SUBSTR: (s: unknown, m: number, n?: number) => String(s).substr(Math.max(0, m - 1), n ?? Infinity),
		INDEX: (s: unknown, t: unknown) => String(s).indexOf(String(t)) + 1,
		SPLIT: (s: unknown, arr: Record<string, unknown>, sep?: string) => {
			const parts = String(s).split(sep === undefined ? /\s+/ : sep.length === 1 ? sep : new RegExp(sep));
			for (const k of Object.keys(arr)) delete arr[k];
			parts.forEach((p, i) => (arr[i + 1] = numeric(p)));
			return parts.length;
		},
		LOWER: (s: unknown) => String(s).toLowerCase(),
		UPPER: (s: unknown) => String(s).toUpperCase(),
		INT: (n: unknown) => Math.trunc(Number(n) || 0),
		SPRINTF: sprintf,
		EXIT: {}
	};
	const names = Object.keys(helpers);
	const compile = (body: string) => new Function(...names, body) as (...a: unknown[]) => unknown;
	try {
		const begin = rules.filter((r) => r.kind === 'begin').map((r) => compile(r.action ?? ''));
		const end = rules.filter((r) => r.kind === 'end').map((r) => compile(r.action ?? ''));
		const main = rules
			.filter((r) => r.kind === 'main')
			.map((r) => compile(r.pattern ? `if (${r.pattern}) { ${r.action ?? 'P([F(0)])'} }` : (r.action ?? 'P([F(0)])')));
		const vals = Object.values(helpers);
		try {
			for (const f of begin) f(...vals);
			const recs = input.endsWith('\n') ? input.slice(0, -1).split('\n') : input ? input.split('\n') : [];
			for (const rec of recs) {
				S.NR++;
				S.FNR++;
				splitLine(rec);
				for (const f of main) f(...vals);
			}
			for (const f of end) f(...vals);
		} catch (e) {
			if (e !== helpers.EXIT) throw e;
		}
	} catch (e) {
		return { out: `awk: ${(e as Error).message}\n`, code: 2 };
	}
	return { out: buf };
}
