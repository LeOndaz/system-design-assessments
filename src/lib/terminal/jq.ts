/**
 * A practical jq subset: paths (.a.b, .[0], .[], .["k"], .[1:3]), pipes, commas, // defaults,
 * comparisons, and/or/not, arithmetic, array/object construction and common builtins
 * (select, map, keys, length, sort_by, group_by, unique, min/max, add, has, to_entries,
 * from_entries, test, contains, startswith, endswith, split, join, ascii_downcase, tostring,
 * tonumber, type, first, last, reverse, flatten, values, any, all, empty, select).
 */

type J = unknown;
type Node =
	| { t: 'id' }
	| { t: 'recurse' }
	| { t: 'lit'; v: J }
	| { t: 'field'; of: Node; name: string; opt: boolean }
	| { t: 'index'; of: Node; idx: Node }
	| { t: 'slice'; of: Node; from: Node | null; to: Node | null }
	| { t: 'iter'; of: Node; opt: boolean }
	| { t: 'pipe'; l: Node; r: Node }
	| { t: 'comma'; l: Node; r: Node }
	| { t: 'bin'; op: string; l: Node; r: Node }
	| { t: 'arr'; body: Node | null }
	| { t: 'obj'; entries: { key: Node | string; val: Node | null }[] }
	| { t: 'call'; name: string; args: Node[] }
	| { t: 'neg'; v: Node };

function lex(src: string): string[] {
	const re = /\s*(\.\.|\/\/|==|!=|<=|>=|\.\[|[.[\]{}(),:|<>+\-*/%?]|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*)/y;
	const toks: string[] = [];
	let m: RegExpExecArray | null;
	re.lastIndex = 0;
	while (re.lastIndex < src.length) {
		const at = re.lastIndex;
		m = re.exec(src);
		if (!m || m.index !== at) {
			if (/^\s*$/.test(src.slice(at))) break;
			throw new Error(`syntax error near "${src.slice(at, at + 10)}"`);
		}
		toks.push(m[1] === '.[' ? '.' : m[1]);
		if (m[1] === '.[') toks.push('[');
	}
	return toks;
}

function parse(src: string): Node {
	const toks = lex(src);
	let i = 0;
	const peek = () => toks[i];
	const eat = (v?: string) => {
		const t = toks[i++];
		if (v !== undefined && t !== v) throw new Error(`expected ${v} but got ${t ?? 'end'}`);
		return t;
	};
	const pipe = (): Node => {
		let l = comma();
		while (peek() === '|') {
			eat();
			l = { t: 'pipe', l, r: comma() };
		}
		return l;
	};
	const comma = (): Node => {
		let l = alt();
		while (peek() === ',') {
			eat();
			l = { t: 'comma', l, r: alt() };
		}
		return l;
	};
	const alt = (): Node => {
		let l = or();
		while (peek() === '//') {
			eat();
			l = { t: 'bin', op: '//', l, r: or() };
		}
		return l;
	};
	const or = (): Node => {
		let l = and();
		while (peek() === 'or') {
			eat();
			l = { t: 'bin', op: 'or', l, r: and() };
		}
		return l;
	};
	const and = (): Node => {
		let l = cmp();
		while (peek() === 'and') {
			eat();
			l = { t: 'bin', op: 'and', l, r: cmp() };
		}
		return l;
	};
	const cmp = (): Node => {
		const l = add();
		if (['==', '!=', '<', '<=', '>', '>='].includes(peek())) {
			const op = eat();
			return { t: 'bin', op, l, r: add() };
		}
		return l;
	};
	const add = (): Node => {
		let l = mul();
		while (peek() === '+' || peek() === '-') {
			const op = eat();
			l = { t: 'bin', op, l, r: mul() };
		}
		return l;
	};
	const mul = (): Node => {
		let l = postfix();
		while (peek() === '*' || peek() === '/' || peek() === '%') {
			const op = eat();
			l = { t: 'bin', op, l, r: postfix() };
		}
		return l;
	};
	const suffixes = (n: Node): Node => {
		for (;;) {
			if (peek() === '.' && /^[A-Za-z_"]/.test(toks[i + 1] ?? '')) {
				eat();
				const name = eat();
				n = { t: 'field', of: n, name: name.startsWith('"') ? JSON.parse(name) : name, opt: false };
			} else if (peek() === '[') {
				eat();
				if (peek() === ']') {
					eat();
					n = { t: 'iter', of: n, opt: false };
				} else if (peek() === ':') {
					eat();
					const to = pipe();
					eat(']');
					n = { t: 'slice', of: n, from: null, to };
				} else {
					const idx = pipe();
					if (peek() === ':') {
						eat();
						const to = peek() === ']' ? null : pipe();
						eat(']');
						n = { t: 'slice', of: n, from: idx, to };
					} else {
						eat(']');
						n = { t: 'index', of: n, idx };
					}
				}
			} else if (peek() === '?') {
				eat();
				if (n.t === 'field' || n.t === 'iter') n = { ...n, opt: true };
			} else return n;
		}
	};
	const postfix = (): Node => suffixes(primary());
	const primary = (): Node => {
		const t = peek();
		if (t === undefined) throw new Error('unexpected end of filter');
		if (t === '.') {
			eat();
			const nx = peek();
			if (nx && (/^[A-Za-z_]/.test(nx) || nx.startsWith('"'))) {
				const name = eat();
				return { t: 'field', of: { t: 'id' }, name: name.startsWith('"') ? JSON.parse(name) : name, opt: false };
			}
			return { t: 'id' };
		}
		if (t === '..') {
			eat();
			return { t: 'recurse' };
		}
		if (t === '(') {
			eat();
			const n = pipe();
			eat(')');
			return n;
		}
		if (t === '[') {
			eat();
			if (peek() === ']') {
				eat();
				return { t: 'arr', body: null };
			}
			const body = pipe();
			eat(']');
			return { t: 'arr', body };
		}
		if (t === '{') {
			eat();
			const entries: { key: Node | string; val: Node | null }[] = [];
			while (peek() !== '}') {
				const k = eat();
				let key: Node | string;
				if (k === '(') {
					key = pipe();
					eat(')');
				} else key = k.startsWith('"') ? JSON.parse(k) : k;
				let val: Node | null = null;
				if (peek() === ':') {
					eat();
					val = alt();
				}
				entries.push({ key, val });
				if (peek() === ',') eat();
			}
			eat('}');
			return { t: 'obj', entries };
		}
		if (t === '-') {
			eat();
			return { t: 'neg', v: postfix() };
		}
		if (t.startsWith('"')) {
			eat();
			return { t: 'lit', v: JSON.parse(t) };
		}
		if (/^-?\d/.test(t)) {
			eat();
			return { t: 'lit', v: Number(t) };
		}
		if (t === 'true' || t === 'false' || t === 'null') {
			eat();
			return { t: 'lit', v: t === 'null' ? null : t === 'true' };
		}
		if (/^[A-Za-z_]/.test(t)) {
			eat();
			const args: Node[] = [];
			if (peek() === '(') {
				eat();
				args.push(pipe());
				while (peek() === ';') {
					eat();
					args.push(pipe());
				}
				eat(')');
			}
			return { t: 'call', name: t, args };
		}
		throw new Error(`unexpected token ${t}`);
	};
	const n = pipe();
	if (i < toks.length) throw new Error(`unexpected token ${toks[i]}`);
	return n;
}

const typeOf = (v: J) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v);
const truthy = (v: J) => v !== false && v !== null && v !== undefined;
const order = ['null', 'boolean', 'number', 'string', 'array', 'object'];
function compare(a: J, b: J): number {
	const ta = order.indexOf(typeOf(a));
	const tb = order.indexOf(typeOf(b));
	if (ta !== tb) return ta - tb;
	if (typeof a === 'number' || typeof a === 'boolean') return Number(a) - Number(b);
	if (typeof a === 'string') return a < (b as string) ? -1 : a > (b as string) ? 1 : 0;
	return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
}
const eq = (a: J, b: J) => JSON.stringify(a) === JSON.stringify(b);

function evaluate(n: Node, input: J): J[] {
	switch (n.t) {
		case 'id':
			return [input];
		case 'recurse': {
			const out: J[] = [];
			const walk = (v: J) => {
				out.push(v);
				if (v && typeof v === 'object') for (const c of Object.values(v as object)) walk(c);
			};
			walk(input);
			return out;
		}
		case 'lit':
			return [n.v];
		case 'field':
			return evaluate(n.of, input).flatMap((v) => {
				if (v === null || v === undefined) return [null];
				if (typeof v !== 'object' || Array.isArray(v)) {
					if (n.opt) return [];
					throw new Error(`Cannot index ${typeOf(v)} with "${n.name}"`);
				}
				return [(v as Record<string, J>)[n.name] ?? null];
			});
		case 'index':
			return evaluate(n.of, input).flatMap((v) =>
				evaluate(n.idx, input).map((k) => {
					if (v === null) return null;
					if (typeof k === 'number') return Array.isArray(v) ? (v[k < 0 ? v.length + k : k] ?? null) : null;
					return (v as Record<string, J>)[String(k)] ?? null;
				})
			);
		case 'slice':
			return evaluate(n.of, input).map((v) => {
				const from = n.from ? (evaluate(n.from, input)[0] as number) : 0;
				const to = n.to ? (evaluate(n.to, input)[0] as number) : undefined;
				return typeof v === 'string' || Array.isArray(v) ? v.slice(from, to) : null;
			});
		case 'iter':
			return evaluate(n.of, input).flatMap((v) => {
				if (Array.isArray(v)) return v;
				if (v && typeof v === 'object') return Object.values(v);
				if (n.opt) return [];
				throw new Error(`Cannot iterate over ${typeOf(v)}`);
			});
		case 'pipe':
			return evaluate(n.l, input).flatMap((v) => evaluate(n.r, v));
		case 'comma':
			return [...evaluate(n.l, input), ...evaluate(n.r, input)];
		case 'neg':
			return evaluate(n.v, input).map((v) => -(v as number));
		case 'arr':
			return [n.body ? evaluate(n.body, input) : []];
		case 'obj': {
			let outs: Record<string, J>[] = [{}];
			for (const e of n.entries) {
				const keys = typeof e.key === 'string' ? [e.key] : evaluate(e.key, input).map(String);
				const vals = e.val ? evaluate(e.val, input) : [typeof e.key === 'string' ? ((input as Record<string, J>)?.[e.key] ?? null) : null];
				const next: Record<string, J>[] = [];
				for (const o of outs) for (const k of keys) for (const v of vals) next.push({ ...o, [k]: v });
				outs = next;
			}
			return outs;
		}
		case 'bin': {
			if (n.op === '//') {
				const l = evaluate(n.l, input).filter(truthy);
				return l.length ? l : evaluate(n.r, input);
			}
			if (n.op === 'and' || n.op === 'or') {
				return evaluate(n.l, input).flatMap((a) => {
					if (n.op === 'and' && !truthy(a)) return [false];
					if (n.op === 'or' && truthy(a)) return [true];
					return evaluate(n.r, input).map(truthy);
				});
			}
			const ls = evaluate(n.l, input);
			const rs = evaluate(n.r, input);
			const out: J[] = [];
			for (const b of rs)
				for (const a of ls) {
					switch (n.op) {
						case '==':
							out.push(eq(a, b));
							break;
						case '!=':
							out.push(!eq(a, b));
							break;
						case '<':
							out.push(compare(a, b) < 0);
							break;
						case '<=':
							out.push(compare(a, b) <= 0);
							break;
						case '>':
							out.push(compare(a, b) > 0);
							break;
						case '>=':
							out.push(compare(a, b) >= 0);
							break;
						case '+':
							out.push(
								a === null ? b : b === null ? a : Array.isArray(a) ? [...a, ...(b as J[])] : typeof a === 'object' ? { ...(a as object), ...(b as object) } : (a as number) + (b as number)
							);
							break;
						case '-':
							out.push(Array.isArray(a) ? a.filter((x) => !(b as J[]).some((y) => eq(x, y))) : (a as number) - (b as number));
							break;
						case '*':
							out.push((a as number) * (b as number));
							break;
						case '/':
							out.push(typeof a === 'string' ? a.split(b as string) : (a as number) / (b as number));
							break;
						case '%':
							out.push((a as number) % (b as number));
							break;
					}
				}
			return out;
		}
		case 'call':
			return call(n.name, n.args, input);
	}
}

function call(name: string, args: Node[], input: J): J[] {
	const arg = (k: number, v: J = input) => evaluate(args[k], v);
	const arr = () => {
		if (!Array.isArray(input)) throw new Error(`${typeOf(input)} cannot be iterated by ${name}`);
		return input as J[];
	};
	switch (name) {
		case 'empty':
			return [];
		case 'not':
			return [!truthy(input)];
		case 'select':
			return arg(0).some(truthy) ? [input] : [];
		case 'map':
			return [arr().flatMap((v) => arg(0, v))];
		case 'map_values':
			return [Object.fromEntries(Object.entries(input as object).map(([k, v]) => [k, arg(0, v)[0]]))];
		case 'keys':
		case 'keys_unsorted':
			return [Array.isArray(input) ? input.map((_, i) => i) : name === 'keys' ? Object.keys(input as object).sort() : Object.keys(input as object)];
		case 'values':
			return truthy(input) ? [input] : [];
		case 'length':
			return [input === null ? 0 : typeof input === 'string' || Array.isArray(input) ? input.length : typeof input === 'object' ? Object.keys(input as object).length : Math.abs(input as number)];
		case 'type':
			return [typeOf(input)];
		case 'has':
			return [Object.prototype.hasOwnProperty.call(input, arg(0)[0] as string)];
		case 'in':
			return [Object.prototype.hasOwnProperty.call(arg(0)[0], input as string)];
		case 'add':
			return [arr().reduce((a: J, b) => (a === null ? b : typeof a === 'string' || typeof a === 'number' ? (a as number) + (b as number) : Array.isArray(a) ? [...a, ...(b as J[])] : { ...(a as object), ...(b as object) }), null)];
		case 'sort':
			return [[...arr()].sort(compare)];
		case 'sort_by':
			return [[...arr()].sort((a, b) => compare(arg(0, a), arg(0, b)))];
		case 'group_by': {
			const groups = new Map<string, J[]>();
			for (const v of [...arr()].sort((a, b) => compare(arg(0, a), arg(0, b)))) {
				const k = JSON.stringify(arg(0, v));
				groups.set(k, [...(groups.get(k) ?? []), v]);
			}
			return [[...groups.values()]];
		}
		case 'unique':
			return [[...new Map(arr().map((v) => [JSON.stringify(v), v])).values()].sort(compare)];
		case 'unique_by':
			return [[...new Map([...arr()].sort((a, b) => compare(arg(0, a), arg(0, b))).map((v) => [JSON.stringify(arg(0, v)), v])).values()]];
		case 'min':
		case 'max': {
			const a = [...arr()].sort(compare);
			return [a.length ? (name === 'min' ? a[0] : a[a.length - 1]) : null];
		}
		case 'min_by':
		case 'max_by': {
			const a = [...arr()].sort((x, y) => compare(arg(0, x), arg(0, y)));
			return [a.length ? (name === 'min_by' ? a[0] : a[a.length - 1]) : null];
		}
		case 'reverse':
			return [typeof input === 'string' ? [...input].reverse().join('') : [...arr()].reverse()];
		case 'first':
			return args.length ? arg(0).slice(0, 1) : [arr()[0] ?? null];
		case 'last':
			return args.length ? arg(0).slice(-1) : [arr()[arr().length - 1] ?? null];
		case 'flatten':
			return [arr().flat(Infinity)];
		case 'any':
			return [args.length ? arr().some((v) => truthy(arg(0, v)[0])) : arr().some(truthy)];
		case 'all':
			return [args.length ? arr().every((v) => truthy(arg(0, v)[0])) : arr().every(truthy)];
		case 'to_entries':
			return [Object.entries(input as object).map(([key, value]) => ({ key, value }))];
		case 'from_entries':
			return [Object.fromEntries(arr().map((e) => [String((e as Record<string, J>).key ?? (e as Record<string, J>).name), (e as Record<string, J>).value]))];
		case 'with_entries':
			return call('from_entries', [], call('map', args, call('to_entries', [], input)[0])[0]);
		case 'tostring':
			return [typeof input === 'string' ? input : JSON.stringify(input)];
		case 'tonumber':
			return [Number(input)];
		case 'ascii_downcase':
			return [String(input).toLowerCase()];
		case 'ascii_upcase':
			return [String(input).toUpperCase()];
		case 'test':
			return [new RegExp(arg(0)[0] as string, (args[1] ? (arg(1)[0] as string) : '').replace(/[^gimsuy]/g, '')).test(String(input))];
		case 'contains': {
			const b = arg(0)[0];
			return [typeof input === 'string' ? input.includes(b as string) : JSON.stringify(input).includes(JSON.stringify(b).replace(/^[[{]|[\]}]$/g, ''))];
		}
		case 'startswith':
			return [String(input).startsWith(arg(0)[0] as string)];
		case 'endswith':
			return [String(input).endsWith(arg(0)[0] as string)];
		case 'ltrimstr':
			return [String(input).startsWith(arg(0)[0] as string) ? String(input).slice(String(arg(0)[0]).length) : input];
		case 'rtrimstr':
			return [String(input).endsWith(arg(0)[0] as string) ? String(input).slice(0, -String(arg(0)[0]).length) : input];
		case 'split':
			return [String(input).split(arg(0)[0] as string)];
		case 'join':
			return [arr().map((v) => (v === null ? '' : String(v))).join(arg(0)[0] as string)];
		case 'floor':
			return [Math.floor(input as number)];
		case 'round':
			return [Math.round(input as number)];
		case 'range': {
			const [a, b] = args.length > 1 ? [arg(0)[0] as number, arg(1)[0] as number] : [0, arg(0)[0] as number];
			return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
		}
		case 'paths':
		case 'leaf_paths': {
			const out: J[] = [];
			const walk = (v: J, p: J[]) => {
				if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, [...p, Array.isArray(v) ? Number(k) : k]);
				else if (p.length) out.push(p);
			};
			walk(input, []);
			return out;
		}
		case 'now':
			return [1791970867];
		case 'todate':
		case 'todateiso8601':
			return [new Date((input as number) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')];
		case 'fromdateiso8601':
		case 'fromdate':
			return [Math.floor(Date.parse(String(input)) / 1000)];
		default:
			throw new Error(`${name}/${args.length} is not defined`);
	}
}

function render(v: J, compact: boolean, raw: boolean): string {
	if (raw && typeof v === 'string') return v;
	return compact ? JSON.stringify(v) : JSON.stringify(v, null, 2);
}

/** Run `filter` over every JSON value in `text` (supports concatenated / newline-delimited JSON). */
export function runJq(filter: string, text: string, opts: { raw: boolean; compact: boolean; slurp?: boolean }): string {
	const ast = parse(filter);
	const inputs: J[] = [];
	const s = text.trim();
	if (s) {
		try {
			inputs.push(JSON.parse(s));
		} catch {
			for (const line of s.split('\n').filter((l) => l.trim())) {
				try {
					inputs.push(JSON.parse(line));
				} catch {
					throw new Error(`Cannot parse input as JSON: ${line.slice(0, 40)}`);
				}
			}
		}
	}
	return (opts.slurp ? [inputs] : inputs)
		.flatMap((v) => evaluate(ast, v))
		.map((v) => render(v, opts.compact, opts.raw) + '\n')
		.join('');
}
