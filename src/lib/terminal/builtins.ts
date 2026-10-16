/**
 * Builtin commands for the sandbox shell. Each takes argv (without the name), a context and the shell.
 * Output is plain text; errors go to `err`. Kept dependency-free.
 */
import type { TermCtx, TermResult } from '$lib/content/types';
import type { Shell } from './shell';
import { globToRegex } from './fs';
import { runAwk } from './awk';
import { runJq } from './jq';

export type Builtin = (args: string[], ctx: TermCtx, sh: Shell) => TermResult & { clear?: boolean; exit?: boolean };

// ───────── helpers ─────────

/** Split short flags (-la → -l -a) and collect positional args. Flags listed in `withValue` consume the next arg. */
function parseFlags(args: string[], withValue = '') {
	const flags: Record<string, string | true> = {};
	const pos: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--') {
			pos.push(...args.slice(i + 1));
			break;
		}
		if (a.startsWith('--')) {
			const [k, v] = a.slice(2).split('=');
			flags[k] = v ?? true;
		} else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
			const chars = a.slice(1);
			for (let j = 0; j < chars.length; j++) {
				const f = chars[j];
				if (withValue.includes(f)) {
					const rest = chars.slice(j + 1);
					flags[f] = rest || args[++i] || '';
					break;
				}
				flags[f] = true;
			}
		} else pos.push(a);
	}
	return { flags, pos };
}

const lines = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s).split('\n');
const join = (ls: string[]) => (ls.length ? ls.join('\n') + '\n' : '');

/** Read files from args, or stdin when no args. Returns [name, content][] and errors. */
function inputs(cmd: string, files: string[], ctx: TermCtx): { items: [string, string][]; err: string } {
	if (!files.length) return { items: [['-', ctx.stdin]], err: '' };
	const items: [string, string][] = [];
	let err = '';
	for (const f of files) {
		if (f === '-') {
			items.push(['-', ctx.stdin]);
			continue;
		}
		if (ctx.fs.isDir(f)) {
			err += `${cmd}: ${f}: Is a directory\n`;
			continue;
		}
		const c = ctx.fs.read(f);
		if (c === null) err += `${cmd}: ${f}: No such file or directory\n`;
		else items.push([f, c]);
	}
	return { items, err };
}

function humanSize(n: number): string {
	const u = ['B', 'K', 'M', 'G', 'T'];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return i === 0 ? `${n}` : `${v < 10 ? v.toFixed(1) : Math.round(v)}${u[i]}`;
}

function parseHuman(s: string): number {
	const m = /^([\d.]+)\s*([KMGT]?)/i.exec(s.trim());
	if (!m) return Number(s) || 0;
	return parseFloat(m[1]) * 1024 ** ' KMGT'.indexOf(m[2].toUpperCase() || ' ');
}

function fakeHash(s: string, len: number): string {
	let h1 = 0x811c9dc5;
	let out = '';
	while (out.length < len) {
		for (let i = 0; i < s.length; i++) h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
		h1 = Math.imul(h1 ^ out.length, 2246822507) >>> 0;
		out += h1.toString(16).padStart(8, '0');
	}
	return out.slice(0, len);
}

function rangeList(spec: string): (n: number) => boolean {
	const parts = spec.split(',').map((p) => {
		const [a, b] = p.split('-');
		const lo = a ? Number(a) : 1;
		const hi = p.includes('-') ? (b ? Number(b) : Infinity) : lo;
		return [lo, hi] as const;
	});
	return (n) => parts.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Expand tr-style sets: a-z, \n, [:upper:] … */
function trSet(s: string): string {
	s = s
		.replace(/\[:upper:\]/g, 'A-Z')
		.replace(/\[:lower:\]/g, 'a-z')
		.replace(/\[:digit:\]/g, '0-9')
		.replace(/\[:space:\]/g, ' \t\n')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t');
	let out = '';
	for (let i = 0; i < s.length; i++) {
		if (s[i + 1] === '-' && i + 2 < s.length) {
			for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out += String.fromCharCode(c);
			i += 2;
		} else out += s[i];
	}
	return out;
}

function lsLong(ctx: TermCtx, sh: Shell, path: string, name: string, human: boolean): string {
	const abs = ctx.fs.resolve(path);
	const isDir = ctx.fs.isDir(abs);
	const size = isDir ? 4096 : sh.fs.size(abs);
	const mt = sh.fs.mtimes.get(abs);
	const d = mt ? new Date(mt * 1000) : new Date(Date.UTC(2026, 9, 14, 9, 12));
	const mon = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
	const when = `${mon} ${String(d.getUTCDate()).padStart(2)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
	const perm = isDir ? 'drwxr-xr-x' : abs.includes('/bin/') || name.endsWith('.sh') ? '-rwxr-xr-x' : '-rw-r--r--';
	const owner = abs.startsWith('/home/') ? sh.user : 'root';
	return `${perm} 1 ${owner.padEnd(5)} ${owner.padEnd(5)} ${(human ? humanSize(size) : String(size)).padStart(6)} ${when} ${name}`;
}

const HELP = `Sandbox shell. Pipes (|), &&, ||, ;, > >> < and $VARS work. Tab completes, ↑/↓ history, Ctrl+L clears.

Files      ls cd pwd cat less head tail tree find stat file du df touch mkdir rm cp mv
Shell      for x in a b; do …; done   VAR=value   $?
Text       grep egrep wc sort uniq cut tr awk sed rev nl column tee xargs diff
Data       jq (-r -c -s) base64 sha256sum md5sum seq
System     echo printf env export unset history clear whoami id hostname uname date uptime
           ps free nproc which type man sleep true false basename dirname realpath
Scenario   submit <answer>   (check your answer)
`;

// ───────── commands ─────────

export const builtins: Record<string, Builtin> = {
	help: () => ({ out: HELP }),
	man: (args) => ({ out: args[0] ? `${args[0]}: see 'help'. This sandbox implements the common flags only.\n` : 'What manual page do you want?\n', code: args[0] ? 0 : 1 }),
	clear: () => ({ clear: true }),
	exit: () => ({ exit: true, out: 'logout\n' }),
	true: () => ({ code: 0 }),
	false: () => ({ code: 1 }),
	sleep: () => ({ code: 0 }),
	pwd: (_a, ctx) => ({ out: ctx.cwd + '\n' }),
	whoami: (_a, _c, sh) => ({ out: sh.user + '\n' }),
	id: (_a, _c, sh) => ({ out: sh.user === 'root' ? 'uid=0(root) gid=0(root) groups=0(root)\n' : `uid=1000(${sh.user}) gid=1000(${sh.user}) groups=1000(${sh.user}),27(sudo)\n` }),
	hostname: (_a, _c, sh) => ({ out: sh.host + '\n' }),
	uname: (args, _c, sh) => ({ out: args.includes('-a') ? `Linux ${sh.host} 6.8.0-1015-aws #16-Ubuntu SMP x86_64 GNU/Linux\n` : 'Linux\n' }),
	date: (args) => {
		const d = new Date(Date.UTC(2026, 9, 14, 9, 41, 7));
		if (args.includes('-u') || args.includes('--utc')) return { out: d.toUTCString().replace('GMT', 'UTC') + '\n' };
		if (args[0] === '+%s') return { out: `${Math.floor(d.getTime() / 1000)}\n` };
		return { out: 'Wed Oct 14 09:41:07 UTC 2026\n' };
	},
	uptime: () => ({ out: ' 09:41:07 up 41 days,  3:12,  1 user,  load average: 0.42, 0.51, 0.48\n' }),
	nproc: () => ({ out: '4\n' }),
	free: (args) =>
		args.includes('-h')
			? { out: '               total        used        free      shared  buff/cache   available\nMem:            15Gi       6.1Gi       1.2Gi        12Mi       8.1Gi       8.9Gi\nSwap:             0B          0B          0B\n' }
			: { out: '               total        used        free      shared  buff/cache   available\nMem:        16106112     6402040     1287300       12480     8416772     9322068\nSwap:              0           0           0\n' },
	ps: () => ({
		out: '    PID TTY          TIME CMD\n   2201 pts/0    00:00:00 bash\n   2310 pts/0    00:00:00 ps\n'
	}),
	df: (args) => {
		const h = args.some((a) => a.includes('h'));
		const i = args.some((a) => /^-\w*i/.test(a));
		if (i) return { out: 'Filesystem      Inodes  IUsed   IFree IUse% Mounted on\n/dev/root      6553600 412311 6141289    7% /\n' };
		return { out: h ? 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/root        97G   41G   57G  42% /\ntmpfs           7.7G     0  7.7G   0% /dev/shm\n' : 'Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/root      101445540 42788212  58640944  42% /\n' };
	},
	echo: (args) => {
		let nl = true;
		let esc = false;
		while (args[0] === '-n' || args[0] === '-e') {
			if (args[0] === '-n') nl = false;
			else esc = true;
			args = args.slice(1);
		}
		let s = args.join(' ');
		if (esc) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
		return { out: s + (nl ? '\n' : '') };
	},
	printf: (args) => {
		const [fmt = '', ...vals] = args;
		let k = 0;
		const out = fmt
			.replace(/%(-?\d*)(\.\d+)?([sdfx%])/g, (_m, w, p, t) => {
				if (t === '%') return '%';
				const v = vals[k++] ?? '';
				let s = t === 'd' ? String(Math.trunc(Number(v))) : t === 'f' ? Number(v).toFixed(p ? Number(p.slice(1)) : 6) : t === 'x' ? Math.trunc(Number(v)).toString(16) : v;
				const width = Math.abs(Number(w || 0));
				if (width) s = w.startsWith('-') ? s.padEnd(width) : s.padStart(width);
				return s;
			})
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t');
		return { out };
	},
	env: (_a, ctx) => ({ out: join(Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`)) }),
	printenv: (args, ctx) => (args[0] ? (args[0] in ctx.env ? { out: ctx.env[args[0]] + '\n' } : { code: 1 }) : { out: join(Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`)) }),
	export: (args, ctx) => {
		for (const a of args) {
			const eq = a.indexOf('=');
			if (eq > 0) ctx.env[a.slice(0, eq)] = a.slice(eq + 1);
		}
		return { code: 0 };
	},
	unset: (args, ctx) => {
		for (const a of args) delete ctx.env[a];
		return { code: 0 };
	},
	history: (_a, _c, sh) => ({ out: join(sh.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)) }),
	which: (args, _c, sh) => {
		const names = sh.commandNames();
		const found = args.filter((a) => names.includes(a));
		return { out: join(found.map((a) => `/usr/bin/${a}`)), code: found.length === args.length ? 0 : 1 };
	},
	type: (args, _c, sh) => ({ out: join(args.map((a) => (sh.commandNames().includes(a) ? `${a} is /usr/bin/${a}` : `bash: type: ${a}: not found`))) }),
	basename: (args) => ({ out: (args[0] ?? '').replace(/\/+$/, '').split('/').pop()!.replace(args[1] ?? '\0', '') + '\n' }),
	dirname: (args) => {
		const p = (args[0] ?? '').replace(/\/+$/, '');
		const i = p.lastIndexOf('/');
		return { out: (i > 0 ? p.slice(0, i) : i === 0 ? '/' : '.') + '\n' };
	},
	realpath: (args, ctx) => ({ out: join(args.map((a) => ctx.fs.resolve(a))) }),
	seq: (args) => {
		const n = args.map(Number);
		const [a, step, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : [n[0], n[1], n[2]];
		const out: number[] = [];
		for (let x = a; step > 0 ? x <= b : x >= b; x += step) {
			out.push(x);
			if (out.length > 10000) break;
		}
		return { out: join(out.map(String)) };
	},

	// ── files ──
	cd: (args, ctx, sh) => {
		const target = args[0] === '-' ? (ctx.env.OLDPWD ?? ctx.cwd) : (args[0] ?? ctx.env.HOME);
		const p = ctx.fs.resolve(target);
		if (!ctx.fs.exists(p)) return { err: `bash: cd: ${target}: No such file or directory\n`, code: 1 };
		if (!ctx.fs.isDir(p)) return { err: `bash: cd: ${target}: Not a directory\n`, code: 1 };
		ctx.env.OLDPWD = sh.cwd;
		sh.cwd = p;
		ctx.env.PWD = p;
		return { code: 0 };
	},
	ls: (args, ctx, sh) => {
		const { flags, pos } = parseFlags(args);
		const all = !!flags.a || !!flags.A;
		const long = !!flags.l;
		const human = !!flags.h;
		const targets = pos.length ? pos : ['.'];
		let out = '';
		let err = '';
		const fileTargets = targets.filter((t) => ctx.fs.exists(t) && !ctx.fs.isDir(t));
		const dirTargets = targets.filter((t) => ctx.fs.isDir(t));
		for (const t of targets) if (!ctx.fs.exists(t)) err += `ls: cannot access '${t}': No such file or directory\n`;
		const fmt = (dir: string, names: string[]) => {
			let ns = names;
			if (flags.t) ns = [...ns].sort((x, y) => (sh.fs.mtimes.get(ctx.fs.resolve(`${dir}/${y}`)) ?? 0) - (sh.fs.mtimes.get(ctx.fs.resolve(`${dir}/${x}`)) ?? 0));
			if (flags.S) ns = [...ns].sort((x, y) => sh.fs.size(ctx.fs.resolve(`${dir}/${y}`)) - sh.fs.size(ctx.fs.resolve(`${dir}/${x}`)));
			if (flags.r) ns = [...ns].reverse();
			if (long) return `total ${ns.length * 4}\n` + join(ns.map((n) => lsLong(ctx, sh, dir === '.' ? n : `${dir}/${n}`, n, human)));
			if (flags['1']) return join(ns);
			return ns.length ? ns.map((n) => (ctx.fs.isDir(dir === '.' ? n : `${dir}/${n}`) ? n + '/' : n)).join('  ') + '\n' : '';
		};
		if (fileTargets.length) out += long ? join(fileTargets.map((f) => lsLong(ctx, sh, f, f, human))) : fileTargets.join('  ') + '\n';
		for (const d of dirTargets) {
			let names = ctx.fs.list(d);
			if (!all) names = names.filter((n) => !n.startsWith('.'));
			else if (flags.a) names = ['.', '..', ...names];
			if (targets.length > 1) out += `${out ? '\n' : ''}${d}:\n`;
			out += fmt(d, names);
		}
		return { out, err, code: err ? 2 : 0 };
	},
	tree: (args, ctx) => {
		const { flags, pos } = parseFlags(args, 'L');
		const root = pos[0] ?? '.';
		const max = flags.L ? Number(flags.L) : Infinity;
		if (!ctx.fs.isDir(root)) return { err: `${root} [error opening dir]\n`, code: 2 };
		let dirs = 0;
		let files = 0;
		const outLines = [root];
		const walk = (dir: string, prefix: string, depth: number) => {
			if (depth > max) return;
			const names = ctx.fs.list(dir).filter((n) => flags.a || !n.startsWith('.'));
			names.forEach((n, i) => {
				const last = i === names.length - 1;
				const p = `${dir}/${n}`;
				outLines.push(`${prefix}${last ? '└── ' : '├── '}${n}`);
				if (ctx.fs.isDir(p)) {
					dirs++;
					walk(p, prefix + (last ? '    ' : '│   '), depth + 1);
				} else files++;
			});
		};
		walk(root, '', 1);
		return { out: join(outLines) + `\n${dirs} directories, ${files} files\n` };
	},
	cat: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		const { items, err } = inputs('cat', pos, ctx);
		let text = items.map(([, c]) => c).join('');
		if (flags.n) text = join(lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`));
		return { out: text, err, code: err ? 1 : 0 };
	},
	less: (args, ctx, sh) => builtins.cat(args, ctx, sh),
	more: (args, ctx, sh) => builtins.cat(args, ctx, sh),
	zcat: (args, ctx, sh) => builtins.cat(args, ctx, sh),
	head: (args, ctx) => {
		const norm = args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
		const { flags, pos } = parseFlags(norm, 'nc');
		const n = flags.n ? Number(flags.n) : 10;
		const { items, err } = inputs('head', pos, ctx);
		const out = items
			.map(([name, c]) => (items.length > 1 ? `==> ${name} <==\n` : '') + (flags.c ? c.slice(0, Number(flags.c)) : join(n < 0 ? lines(c).slice(0, n) : lines(c).slice(0, n))))
			.join(items.length > 1 ? '\n' : '');
		return { out, err };
	},
	tail: (args, ctx) => {
		const norm = args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
		const { flags, pos } = parseFlags(norm, 'n');
		const spec = String(flags.n ?? '10');
		const { items, err } = inputs('tail', pos, ctx);
		const out = items
			.map(([name, c]) => {
				const ls = lines(c);
				const body = spec.startsWith('+') ? ls.slice(Number(spec.slice(1)) - 1) : ls.slice(-Number(spec) || ls.length);
				return (items.length > 1 ? `==> ${name} <==\n` : '') + join(body);
			})
			.join(items.length > 1 ? '\n' : '');
		return { out: out + (flags.f ? '^C (follow mode is not available in the sandbox)\n' : ''), err };
	},
	wc: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		const { items, err } = inputs('wc', pos, ctx);
		const pick: Record<string, unknown> = flags.l || flags.w || flags.c || flags.m ? flags : { l: true, w: true, c: true };
		const rows = items.map(([name, c]) => {
			const cols: number[] = [];
			if (pick.l) cols.push((c.match(/\n/g) ?? []).length);
			if (pick.w) cols.push(c.split(/\s+/).filter(Boolean).length);
			if (pick.c || pick.m) cols.push(new TextEncoder().encode(c).length);
			return cols.map((x) => String(x).padStart(items.length > 1 || cols.length > 1 ? 7 : 0)).join(' ') + (name === '-' ? '' : ` ${name}`);
		});
		return { out: join(rows), err };
	},
	stat: (args, ctx, sh) => {
		const out: string[] = [];
		for (const a of args) {
			if (!ctx.fs.exists(a)) return { err: `stat: cannot statx '${a}': No such file or directory\n`, code: 1 };
			const p = ctx.fs.resolve(a);
			const dir = ctx.fs.isDir(a);
			out.push(`  File: ${a}`, `  Size: ${dir ? 4096 : sh.fs.size(p)}\tBlocks: 8\tIO Block: 4096\t${dir ? 'directory' : 'regular file'}`, `Access: (${dir ? '0755/drwxr-xr-x' : '0644/-rw-r--r--'})  Uid: (    0/    root)`, `Modify: 2026-10-14 09:12:00.000000000 +0000`);
		}
		return { out: join(out) };
	},
	file: (args, ctx) => ({
		out: join(
			args.map((a) => {
				if (ctx.fs.isDir(a)) return `${a}: directory`;
				const c = ctx.fs.read(a);
				if (c === null) return `${a}: cannot open (No such file or directory)`;
				if (c.startsWith('{') || c.startsWith('[')) return `${a}: JSON text data`;
				if (c.startsWith('#!')) return `${a}: ${c.split('\n')[0].slice(2).trim()} script, ASCII text executable`;
				if (/\.gz$/.test(a)) return `${a}: gzip compressed data`;
				return `${a}: ${c.length ? 'ASCII text' : 'empty'}`;
			})
		)
	}),
	du: (args, ctx, sh) => {
		const { flags, pos } = parseFlags(args, 'd');
		const targets = pos.length ? pos : ['.'];
		const fmt = (n: number) => (flags.h ? humanSize(n) : String(Math.ceil(n / 1024)));
		const out: string[] = [];
		for (const t of targets) {
			if (!ctx.fs.exists(t)) return { err: `du: cannot access '${t}': No such file or directory\n`, code: 1 };
			const abs = ctx.fs.resolve(t);
			if (flags.s || !ctx.fs.isDir(t)) out.push(`${fmt(sh.fs.size(abs))}\t${t}`);
			else {
				const depth = flags.d !== undefined ? Number(flags.d) : Infinity;
				const base = abs.split('/').filter(Boolean).length;
				const ds = sh.fs.walk(abs).filter((p) => sh.fs.isDir(p) && p.split('/').filter(Boolean).length - base <= depth);
				for (const d of ds.reverse()) out.push(`${fmt(sh.fs.size(d))}\t${t === '.' ? '.' + d.slice(abs.length) : t.replace(/\/$/, '') + d.slice(abs.length)}`);
			}
		}
		return { out: join(out) };
	},
	mkdir: (args, ctx, sh) => {
		const { pos } = parseFlags(args);
		for (const p of pos) sh.fs.mkdirp(ctx.fs.resolve(p));
		return { code: 0 };
	},
	touch: (args, ctx) => {
		for (const p of args.filter((a) => !a.startsWith('-'))) if (!ctx.fs.exists(p)) ctx.fs.write(p, '');
		return { code: 0 };
	},
	rm: (args, ctx, sh) => {
		const { flags, pos } = parseFlags(args);
		let err = '';
		for (const p of pos) {
			const abs = ctx.fs.resolve(p);
			if (abs === '/' || abs === '/etc' || abs === '/usr') {
				err += `rm: refusing to remove '${p}' (the sandbox is not that kind of lab)\n`;
				continue;
			}
			if (!sh.fs.exists(abs)) {
				if (!flags.f) err += `rm: cannot remove '${p}': No such file or directory\n`;
			} else if (sh.fs.isDir(abs) && !flags.r && !flags.R) err += `rm: cannot remove '${p}': Is a directory\n`;
			else sh.fs.remove(abs, true);
		}
		return { err, code: err ? 1 : 0 };
	},
	rmdir: (args, ctx, sh) => {
		for (const p of args) if (!sh.fs.remove(ctx.fs.resolve(p))) return { err: `rmdir: failed to remove '${p}': Directory not empty\n`, code: 1 };
		return { code: 0 };
	},
	cp: (args, ctx, sh) => {
		const { flags, pos } = parseFlags(args);
		const dest = pos.pop();
		if (!dest || !pos.length) return { err: 'cp: missing file operand\n', code: 1 };
		for (const src of pos) {
			const s = ctx.fs.resolve(src);
			if (!sh.fs.exists(s)) return { err: `cp: cannot stat '${src}': No such file or directory\n`, code: 1 };
			const d = ctx.fs.isDir(dest) ? `${ctx.fs.resolve(dest)}/${s.split('/').pop()}` : ctx.fs.resolve(dest);
			if (sh.fs.isDir(s)) {
				if (!flags.r && !flags.R && !flags.a) return { err: `cp: -r not specified; omitting directory '${src}'\n`, code: 1 };
				for (const p of sh.fs.walk(s)) {
					if (sh.fs.isDir(p)) sh.fs.mkdirp(d + p.slice(s.length));
					else sh.fs.write(d + p.slice(s.length), sh.fs.read(p)!);
				}
			} else sh.fs.write(d, sh.fs.read(s)!);
		}
		return { code: 0 };
	},
	mv: (args, ctx, sh) => {
		const r = builtins.cp(['-r', ...args], ctx, sh);
		if (r.code) return { ...r, err: r.err?.replace(/^cp/, 'mv') };
		for (const src of args.slice(0, -1).filter((a) => !a.startsWith('-'))) sh.fs.remove(ctx.fs.resolve(src), true);
		return { code: 0 };
	},
	find: (args, ctx, sh) => {
		let i = 0;
		const roots: string[] = [];
		while (i < args.length && !args[i].startsWith('-')) roots.push(args[i++]);
		if (!roots.length) roots.push('.');
		const tests: ((p: string, depth: number) => boolean)[] = [];
		let maxdepth = Infinity;
		let mindepth = 0;
		let exec: string[] | null = null;
		for (; i < args.length; i++) {
			const a = args[i];
			const v = args[i + 1];
			if (a === '-name' || a === '-iname') {
				const re = globToRegex(a === '-iname' ? v.toLowerCase() : v);
				tests.push((p) => re.test(a === '-iname' ? p.split('/').pop()!.toLowerCase() : p.split('/').pop()!));
				i++;
			} else if (a === '-path') {
				const re = new RegExp('^' + v.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
				tests.push((p) => re.test(p));
				i++;
			} else if (a === '-type') {
				tests.push((p) => (v === 'd' ? sh.fs.isDir(ctx.fs.resolve(p)) : !sh.fs.isDir(ctx.fs.resolve(p))));
				i++;
			} else if (a === '-maxdepth') {
				maxdepth = Number(v);
				i++;
			} else if (a === '-mindepth') {
				mindepth = Number(v);
				i++;
			} else if (a === '-size') {
				const m = /^([+-]?)(\d+)([ckMG]?)$/.exec(v);
				if (m) {
					const n = Number(m[2]) * ({ c: 1, k: 1024, M: 1024 ** 2, G: 1024 ** 3, '': 512 } as Record<string, number>)[m[3]];
					tests.push((p) => {
						const s = sh.fs.size(ctx.fs.resolve(p));
						return m[1] === '+' ? s > n : m[1] === '-' ? s < n : s === n;
					});
				}
				i++;
			} else if (a === '-empty') tests.push((p) => (sh.fs.isDir(ctx.fs.resolve(p)) ? sh.fs.list(ctx.fs.resolve(p)).length === 0 : sh.fs.size(ctx.fs.resolve(p)) === 0));
			else if (a === '-newer') {
				const ref = sh.fs.mtimes.get(ctx.fs.resolve(v)) ?? 0;
				tests.push((p) => (sh.fs.mtimes.get(ctx.fs.resolve(p)) ?? 0) > ref);
				i++;
			} else if (a === '-mtime' || a === '-mmin') {
				i++; // accepted, not modelled
			} else if (a === '-exec') {
				const end = args.indexOf(';', i);
				exec = args.slice(i + 1, end < 0 ? undefined : end);
				i = end < 0 ? args.length : end;
			} else if (a === '-print') {
				/* default */
			}
		}
		const hits: string[] = [];
		let err = '';
		for (const root of roots) {
			if (!ctx.fs.exists(root)) {
				err += `find: '${root}': No such file or directory\n`;
				continue;
			}
			const abs = ctx.fs.resolve(root);
			const base = abs === '/' ? 0 : abs.split('/').filter(Boolean).length;
			for (const p of sh.fs.walk(abs)) {
				const depth = (p === '/' ? 0 : p.split('/').filter(Boolean).length) - base;
				if (depth > maxdepth || depth < mindepth) continue;
				const shown = root === '/' ? p : root.replace(/\/$/, '') + p.slice(abs.length);
				if (tests.every((t) => t(shown, depth))) hits.push(shown);
			}
		}
		if (exec) {
			let out = '';
			for (const h of hits) {
				const r = sh.exec(exec.map((x) => (x === '{}' ? h : x)), '');
				out += (r.out ?? '') + (r.err ?? '');
			}
			return { out, err };
		}
		return { out: join(hits), err, code: err ? 1 : 0 };
	},

	// ── text ──
	grep: (args, ctx, sh) => {
		const { flags, pos } = parseFlags(args, 'ABCem');
		const pattern = flags.e !== undefined ? String(flags.e) : pos.shift();
		if (pattern === undefined) return { err: 'usage: grep [OPTION]... PATTERNS [FILE]...\n', code: 2 };
		const fixed = !!flags.F;
		const src = fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : toJsRegex(pattern, !!flags.E || !!flags.P);
		const re = new RegExp(flags.w ? `\\b(?:${src})\\b` : flags.x ? `^(?:${src})$` : src, flags.i ? 'i' : '');
		let files = pos;
		if ((flags.r || flags.R) && !files.length) files = ['.'];
		if (flags.r || flags.R) {
			const expanded: string[] = [];
			for (const f of files) {
				if (ctx.fs.isDir(f)) {
					const abs = ctx.fs.resolve(f);
					for (const p of sh.fs.walk(abs)) if (!sh.fs.isDir(p)) expanded.push(f === '.' ? p.slice(abs.length + 1) : f.replace(/\/$/, '') + p.slice(abs.length));
				} else expanded.push(f);
			}
			files = expanded;
		}
		const { items, err } = inputs('grep', files, ctx);
		const multi = items.length > 1 || !!flags.r || !!flags.R;
		const showName = multi && !flags.h;
		const A = Number(flags.A ?? flags.C ?? 0);
		const B = Number(flags.B ?? flags.C ?? 0);
		const max = flags.m !== undefined ? Number(flags.m) : Infinity;
		const out: string[] = [];
		let any = false;
		for (const [name, c] of items) {
			const ls = lines(c);
			if (c === '') continue;
			let count = 0;
			const keep = new Set<number>();
			const matched = new Set<number>();
			ls.forEach((l, i) => {
				if (count >= max) return;
				if (re.test(l) !== !!flags.v) {
					count++;
					matched.add(i);
					for (let k = Math.max(0, i - B); k <= Math.min(ls.length - 1, i + A); k++) keep.add(k);
				}
			});
			if (count) any = true;
			if (flags.c) {
				out.push(showName ? `${name}:${count}` : String(count));
				continue;
			}
			if (flags.l) {
				if (count) out.push(name);
				continue;
			}
			if (flags.L) {
				if (!count) out.push(name);
				continue;
			}
			let last = -2;
			for (const i of [...keep].sort((a, b) => a - b)) {
				if ((A || B) && last >= 0 && i > last + 1) out.push('--');
				last = i;
				const sep = matched.has(i) ? ':' : '-';
				const prefix = (showName ? name + sep : '') + (flags.n ? `${i + 1}${sep}` : '');
				if (flags.o && matched.has(i)) {
					const g = new RegExp(re.source, re.flags + 'g');
					for (const m of ls[i].matchAll(g)) out.push(prefix + m[0]);
				} else out.push(prefix + ls[i]);
			}
		}
		return { out: join(out), err, code: any ? 0 : 1 };
	},
	egrep: (args, ctx, sh) => builtins.grep(['-E', ...args], ctx, sh),
	zgrep: (args, ctx, sh) => builtins.grep(args, ctx, sh),
	sort: (args, ctx) => {
		const { flags, pos } = parseFlags(args, 'kt');
		const { items, err } = inputs('sort', pos, ctx);
		let ls = items.flatMap(([, c]) => (c ? lines(c) : []));
		const sep = flags.t ? String(flags.t) : null;
		const keySpec = flags.k ? String(flags.k) : null;
		const keyOf = (l: string) => {
			if (!keySpec) return l;
			const [startS, endS] = keySpec.split(',');
			const start = parseInt(startS);
			const end = endS ? parseInt(endS) : start;
			const fields = sep ? l.split(sep) : l.trim().split(/\s+/);
			return fields.slice(start - 1, end).join(sep ?? ' ');
		};
		const numeric = flags.n || flags.g || /n/.test(keySpec ?? '');
		const human = flags.h || /h/.test(keySpec ?? '');
		const reverse = flags.r || /r/.test(keySpec?.replace(/^\d+,?\d*/, '') ?? '');
		ls.sort((a, b) => {
			const ka = keyOf(a);
			const kb = keyOf(b);
			let c = human ? parseHuman(ka) - parseHuman(kb) : numeric ? (parseFloat(ka) || 0) - (parseFloat(kb) || 0) : ka < kb ? -1 : ka > kb ? 1 : 0;
			if (c === 0 && (numeric || human)) c = a < b ? -1 : a > b ? 1 : 0;
			return reverse ? -c : c;
		});
		if (flags.u) ls = ls.filter((l, i) => i === 0 || keyOf(l) !== keyOf(ls[i - 1]));
		return { out: join(ls), err };
	},
	uniq: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		const { items, err } = inputs('uniq', pos.slice(0, 1), ctx);
		const ls = items.flatMap(([, c]) => (c ? lines(c) : []));
		const groups: [string, number][] = [];
		const key = (l: string) => (flags.i ? l.toLowerCase() : l);
		for (const l of ls) {
			const g = groups[groups.length - 1];
			if (g && key(g[0]) === key(l)) g[1]++;
			else groups.push([l, 1]);
		}
		const kept = groups.filter(([, n]) => (flags.d ? n > 1 : flags.u ? n === 1 : true));
		return { out: join(kept.map(([l, n]) => (flags.c ? `${String(n).padStart(7)} ${l}` : l))), err };
	},
	cut: (args, ctx) => {
		const { flags, pos } = parseFlags(args, 'dfc');
		const { items, err } = inputs('cut', pos, ctx);
		const ls = items.flatMap(([, c]) => (c ? lines(c) : []));
		if (flags.c) {
			const ok = rangeList(String(flags.c));
			return { out: join(ls.map((l) => [...l].filter((_, i) => ok(i + 1)).join(''))), err };
		}
		if (!flags.f) return { err: 'cut: you must specify a list of bytes, characters, or fields\n', code: 1 };
		const d = flags.d !== undefined ? String(flags.d) : '\t';
		const ok = rangeList(String(flags.f));
		return { out: join(ls.map((l) => (l.includes(d) ? l.split(d).filter((_, i) => ok(i + 1)).join(d) : flags.s ? null : l)).filter((x): x is string => x !== null)), err };
	},
	tr: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		const a = trSet(pos[0] ?? '');
		const b = trSet(pos[1] ?? '');
		let s = ctx.stdin;
		if (flags.d) s = [...s].filter((c) => !a.includes(c)).join('');
		else if (b) s = [...s].map((c) => (a.includes(c) ? (b[a.indexOf(c)] ?? b[b.length - 1]) : c)).join('');
		if (flags.s) {
			const set = b || a;
			s = s.replace(new RegExp(`([${set.replace(/[\]\\^-]/g, '\\$&')}])\\1+`, 'g'), '$1');
		}
		return { out: s };
	},
	rev: (args, ctx) => {
		const { items, err } = inputs('rev', args, ctx);
		return { out: join(items.flatMap(([, c]) => (c ? lines(c) : [])).map((l) => [...l].reverse().join(''))), err };
	},
	nl: (args, ctx) => {
		const { items, err } = inputs('nl', args, ctx);
		let n = 0;
		return { out: join(items.flatMap(([, c]) => (c ? lines(c) : [])).map((l) => (l ? `${String(++n).padStart(6)}\t${l}` : ''))), err };
	},
	column: (args, ctx) => {
		const { flags, pos } = parseFlags(args, 's');
		const { items, err } = inputs('column', pos, ctx);
		const ls = items.flatMap(([, c]) => (c ? lines(c) : []));
		if (!flags.t) return { out: join(ls), err };
		const sep = flags.s ? String(flags.s) : null;
		const rows = ls.map((l) => (sep ? l.split(sep) : l.trim().split(/\s+/)));
		const widths: number[] = [];
		for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
		return { out: join(rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  '))), err };
	},
	tee: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		for (const f of pos) ctx.fs.write(f, (flags.a ? (ctx.fs.read(f) ?? '') : '') + ctx.stdin);
		return { out: ctx.stdin };
	},
	xargs: (args, ctx, sh) => {
		const { flags, pos } = parseFlags(args, 'In');
		const words = ctx.stdin.split(/\s+/).filter(Boolean);
		const cmd = pos.length ? pos : ['echo'];
		let out = '';
		let err = '';
		if (flags.I) {
			const token = String(flags.I);
			for (const l of lines(ctx.stdin).filter(Boolean)) {
				const r = sh.exec(cmd.map((c) => c.split(token).join(l)), '');
				out += r.out ?? '';
				err += r.err ?? '';
			}
		} else {
			const n = flags.n ? Number(flags.n) : words.length || 1;
			for (let i = 0; i < Math.max(words.length, 1); i += n) {
				const r = sh.exec([...cmd, ...words.slice(i, i + n)], '');
				out += r.out ?? '';
				err += r.err ?? '';
			}
		}
		return { out, err };
	},
	diff: (args, ctx) => {
		const [a, b] = args.filter((x) => !x.startsWith('-'));
		const ca = ctx.fs.read(a ?? '');
		const cb = ctx.fs.read(b ?? '');
		if (ca === null || cb === null) return { err: `diff: ${ca === null ? a : b}: No such file or directory\n`, code: 2 };
		if (ca === cb) return { code: 0 };
		const la = lines(ca);
		const lb = lines(cb);
		// LCS-based line diff (fine for small files).
		const dp = Array.from({ length: la.length + 1 }, () => new Array(lb.length + 1).fill(0));
		for (let i = la.length - 1; i >= 0; i--) for (let j = lb.length - 1; j >= 0; j--) dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		const out: string[] = [];
		let i = 0;
		let j = 0;
		while (i < la.length || j < lb.length) {
			if (i < la.length && j < lb.length && la[i] === lb[j]) {
				i++;
				j++;
			} else if (j < lb.length && (i >= la.length || dp[i][j + 1] >= dp[i + 1][j])) out.push(`> ${lb[j++]}`);
			else out.push(`< ${la[i++]}`);
		}
		return { out: join(out), code: 1 };
	},
	sed: (args, ctx) => {
		const { flags, pos } = parseFlags(args, 'e');
		const script = flags.e !== undefined ? String(flags.e) : pos.shift();
		if (!script) return { err: 'Usage: sed [OPTION]... {script} [input-file]...\n', code: 1 };
		const { items, err } = inputs('sed', pos, ctx);
		const ls = items.flatMap(([, c]) => (c ? lines(c) : []));
		const quiet = !!flags.n;
		const ext = !!flags.E || !!flags.r;
		const out: string[] = [];
		const cmds = script.split(/;\s*(?![^/]*\/[gip]*$)/).map((s) => s.trim()).filter(Boolean);
		ls.forEach((line, idx) => {
			let l = line;
			let printed = false;
			let deleted = false;
			for (const c of cmds) {
				let m: RegExpExecArray | null;
				if ((m = /^s(.)(.*?)\1(.*?)\1([gip]*)$/.exec(c))) {
					const re = new RegExp(toJsRegex(m[2], ext), (m[4].includes('g') ? 'g' : '') + (m[4].includes('i') ? 'i' : ''));
					const before = l;
					l = l.replace(re, m[3].replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&'));
					if (m[4].includes('p') && l !== before) {
						out.push(l);
						printed = true;
					}
				} else if ((m = /^(\d+)(?:,(\d+|\$))?([pd])$/.exec(c))) {
					const lo = Number(m[1]);
					const hi = m[2] === '$' ? Infinity : m[2] ? Number(m[2]) : lo;
					if (idx + 1 >= lo && idx + 1 <= hi) {
						if (m[3] === 'p') out.push(l);
						else deleted = true;
					}
				} else if ((m = /^\/(.*)\/([pd])$/.exec(c))) {
					if (new RegExp(toJsRegex(m[1], ext)).test(l)) {
						if (m[2] === 'p') out.push(l);
						else deleted = true;
					}
				} else if (c === '$p') {
					if (idx === ls.length - 1) out.push(l);
				} else return;
			}
			if (!quiet && !deleted && !printed) out.push(l);
		});
		return { out: join(out), err };
	},
	awk: (args, ctx) => {
		const { flags, pos } = parseFlags(args, 'Fv');
		const prog = pos.shift();
		if (!prog) return { err: 'usage: awk [-F fs] \'program\' [file ...]\n', code: 2 };
		const { items, err } = inputs('awk', pos, ctx);
		const text = items.map(([, c]) => c).join('');
		return { ...runAwk(prog, text, flags.F !== undefined ? String(flags.F) : null), err };
	},
	jq: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		const filter = pos.shift() ?? '.';
		const { items, err } = inputs('jq', pos, ctx);
		if (err) return { err, code: 2 };
		try {
			return { out: runJq(filter, items.map(([, c]) => c).join('\n'), { raw: !!flags.r, compact: !!flags.c, slurp: !!flags.s }) };
		} catch (e) {
			return { err: `jq: error: ${(e as Error).message}\n`, code: 5 };
		}
	},
	base64: (args, ctx) => {
		const { flags, pos } = parseFlags(args);
		const { items, err } = inputs('base64', pos, ctx);
		const text = items.map(([, c]) => c).join('');
		try {
			if (flags.d) return { out: new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s+/g, '')), (c) => c.charCodeAt(0))), err };
			const bytes = new TextEncoder().encode(text);
			let bin = '';
			for (const b of bytes) bin += String.fromCharCode(b);
			return { out: btoa(bin) + '\n', err };
		} catch {
			return { err: 'base64: invalid input\n', code: 1 };
		}
	},
	sha256sum: (args, ctx) => {
		const { items, err } = inputs('sha256sum', args, ctx);
		return { out: join(items.map(([n, c]) => `${fakeHash(c, 64)}  ${n}`)), err };
	},
	md5sum: (args, ctx) => {
		const { items, err } = inputs('md5sum', args, ctx);
		return { out: join(items.map(([n, c]) => `${fakeHash(c, 32)}  ${n}`)), err };
	},

	// ── scenario ──
	submit: (args, _ctx, sh) => {
		const a = sh.scenario.answer;
		if (!a) return { out: 'This terminal has no question to answer: just explore.\n' };
		const answer = args.join(' ').trim();
		if (!answer) return { err: `usage: submit <${a.prompt}>\n`, code: 1 };
		const r = a.check(answer, sh.state);
		if (r === true) {
			sh.solved = true;
			return { out: `✔ Correct. ${a.success ?? ''}\n`.replace(/ \n$/, '\n') };
		}
		return { err: `✘ Not quite. ${r}\n`, code: 1 };
	}
};

/** Translate POSIX basic/extended regex bits JS doesn't share. */
function toJsRegex(src: string, extended: boolean): string {
	let s = src.replace(/\[\[:(\w+):\]\]/g, (_m, c) => ({ digit: '\\d', space: '\\s', alpha: '[A-Za-z]', alnum: '[A-Za-z0-9]', upper: '[A-Z]', lower: '[a-z]' })[c as string] ?? '.');
	s = s.replace(/\[:(\w+):\]/g, (_m, c) => ({ digit: '0-9', space: '\\s', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z' })[c as string] ?? '');
	if (!extended) s = s.replace(/\\([|(){}+?])/g, '\u0000$1').replace(/([|(){}+?])/g, '\\$1').replace(/\u0000(.)/g, '$1');
	return s;
}
