/**
 * A small POSIX-ish shell over the in-memory filesystem.
 * Supports quoting, $VAR / ${VAR}, globs, pipes, &&, ||, ;, >, >>, <, 2>/dev/null and 2>&1.
 * Scenario commands (kubectl, psql…) take precedence over builtins.
 */
import type { TermCtx, TermResult, TerminalScenario } from '$lib/content/types';
import { VFS, expandGlob } from './fs';
import { builtins } from './builtins';

type Tok = { t: 'word'; v: string; glob: boolean } | { t: 'op'; v: string };

export interface ShellOutput {
	text: string;
	clear?: boolean;
	exit?: boolean;
	solved?: boolean;
}

export class Shell {
	fs: VFS;
	cwd: string;
	env: Record<string, string>;
	history: string[] = [];
	state: Record<string, unknown>;
	user: string;
	host: string;
	solved = false;
	lastCode = 0;

	constructor(public scenario: TerminalScenario) {
		this.user = scenario.user ?? 'ops';
		this.host = scenario.host ?? 'sandbox';
		const home = this.user === 'root' ? '/root' : `/home/${this.user}`;
		this.fs = new VFS(scenario.files, [...(scenario.dirs ?? []), home, '/tmp']);
		this.cwd = scenario.cwd ?? home;
		this.fs.mkdirp(this.cwd);
		this.env = { HOME: home, USER: this.user, HOSTNAME: this.host, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', PWD: this.cwd, ...(scenario.env ?? {}) };
		this.state = structuredClone(scenario.state ?? {});
	}

	get home() {
		return this.env.HOME;
	}

	prompt(): string {
		const where = this.cwd === this.home ? '~' : this.cwd.startsWith(this.home + '/') ? '~' + this.cwd.slice(this.home.length) : this.cwd;
		return `${this.user}@${this.host}:${where}${this.user === 'root' ? '#' : '$'} `;
	}

	commandNames(): string[] {
		return [...new Set([...Object.keys(builtins), ...Object.keys(this.scenario.commands ?? {})])].sort();
	}

	ctx(stdin: string): TermCtx {
		const fs = this.fs;
		const r = (p: string) => fs.resolve(this.cwd, p, this.home);
		return {
			cwd: this.cwd,
			env: this.env,
			stdin,
			state: this.state,
			fs: {
				read: (p) => fs.read(r(p)),
				write: (p, c) => fs.write(r(p), c),
				exists: (p) => fs.exists(r(p)),
				isDir: (p) => fs.isDir(r(p)),
				list: (p) => fs.list(r(p)),
				resolve: r
			}
		};
	}

	/** Run one input line. */
	run(line: string, record = true): ShellOutput {
		const trimmed = line.trim();
		if (!trimmed) return { text: '' };
		if (record) this.history.push(trimmed);
		// for VAR in a b c; do body; done   (single level, words or a $(…)-free list)
		const loop = /^for\s+([A-Za-z_]\w*)\s+in\s+(.*?)\s*;\s*do\s+(.*?)\s*;?\s*done\s*$/.exec(trimmed);
		if (loop) {
			const [, name, list, body] = loop;
			const words = this.tokenize(list).flatMap((t) => (t.t === 'word' ? (t.glob ? expandGlob(this.fs, this.cwd, t.v, this.home) : [t.v]) : []));
			let text = '';
			const prev = this.env[name];
			for (const w of words) {
				this.env[name] = w;
				const r = this.run(body, false);
				text += r.text;
				if (r.exit) break;
			}
			if (prev === undefined) delete this.env[name];
			else this.env[name] = prev;
			return { text, solved: this.solved };
		}
		let toks: Tok[];
		try {
			toks = this.tokenize(trimmed);
		} catch (e) {
			return { text: `bash: ${(e as Error).message}\n` };
		}

		// Split into pipelines joined by && || ;
		const chain: { connector: string | null; toks: Tok[] }[] = [];
		let cur: Tok[] = [];
		let connector: string | null = null;
		for (const tk of toks) {
			if (tk.t === 'op' && (tk.v === '&&' || tk.v === '||' || tk.v === ';')) {
				chain.push({ connector, toks: cur });
				connector = tk.v;
				cur = [];
			} else cur.push(tk);
		}
		chain.push({ connector, toks: cur });

		let text = '';
		let clear = false;
		let exit = false;
		for (const step of chain) {
			if (!step.toks.length) continue;
			if (step.connector === '&&' && this.lastCode !== 0) continue;
			if (step.connector === '||' && this.lastCode === 0) continue;
			const res = this.runPipeline(step.toks);
			if (res.clear) {
				clear = true;
				text = '';
			}
			if (res.exit) exit = true;
			text += res.text;
		}
		return { text, clear, exit, solved: this.solved };
	}

	private runPipeline(toks: Tok[]): ShellOutput {
		const stages: Tok[][] = [[]];
		for (const tk of toks) {
			if (tk.t === 'op' && tk.v === '|') stages.push([]);
			else stages[stages.length - 1].push(tk);
		}
		let stdin = '';
		let errText = '';
		let out = '';
		let clear = false;
		let exit = false;
		for (let i = 0; i < stages.length; i++) {
			const { argv, redirect, append, input, dropErr, errToOut } = this.parseRedirects(stages[i]);
			if (input !== null) {
				const inPath = this.fs.resolve(this.cwd, input, this.home);
				const content = inPath === '/dev/null' ? '' : this.fs.read(inPath);
				if (content === null) {
					errText += `bash: ${input}: No such file or directory\n`;
					this.lastCode = 1;
					return { text: errText };
				}
				stdin = content;
			}
			if (!argv.length) continue;
			const res = this.exec(argv, stdin);
			if (res.clear) clear = true;
			if (res.exit) exit = true;
			let o = res.out ?? '';
			const e = res.err ?? '';
			if (errToOut) o += e;
			else if (!dropErr) errText += e;
			this.lastCode = res.code ?? (e && !o ? 1 : 0);
			if (redirect) {
				const path = this.fs.resolve(this.cwd, redirect, this.home);
				if (path !== '/dev/null') {
					if (this.fs.isDir(path)) {
						errText += `bash: ${redirect}: Is a directory\n`;
					} else this.fs.write(path, (append ? (this.fs.read(path) ?? '') : '') + o);
				}
				o = '';
			}
			stdin = o;
			out = o;
		}
		return { text: errText + out, clear, exit };
	}

	private parseRedirects(stage: Tok[]) {
		const argv: string[] = [];
		let redirect: string | null = null;
		let append = false;
		let input: string | null = null;
		let dropErr = false;
		let errToOut = false;
		for (let i = 0; i < stage.length; i++) {
			const tk = stage[i];
			if (tk.t === 'op') {
				const next = stage[i + 1];
				if (tk.v === '2>&1') errToOut = true;
				else if (tk.v === '2>') {
					if (next?.t === 'word' && next.v === '/dev/null') dropErr = true;
					i++;
				} else if ((tk.v === '>' || tk.v === '>>') && next?.t === 'word') {
					redirect = next.v;
					append = tk.v === '>>';
					i++;
				} else if (tk.v === '<' && next?.t === 'word') {
					input = next.v;
					i++;
				}
				continue;
			}
			if (tk.glob) {
				const matches = expandGlob(this.fs, this.cwd, tk.v, this.home);
				argv.push(...(matches.length ? matches : [tk.v]));
			} else argv.push(tk.v);
		}
		return { argv, redirect, append, input, dropErr, errToOut };
	}

	exec(argv: string[], stdin: string): TermResult & { clear?: boolean; exit?: boolean } {
		const [name, ...args] = argv;
		// VAR=value assignment
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name) && !args.length) {
			const eq = name.indexOf('=');
			this.env[name.slice(0, eq)] = name.slice(eq + 1);
			return { code: 0 };
		}
		if (name === 'sudo') return args.length ? this.exec(args, stdin) : { err: 'usage: sudo command\n', code: 1 };
		const scen = this.scenario.commands?.[name];
		if (scen) {
			try {
				const r = scen(args, this.ctx(stdin));
				return typeof r === 'string' ? { out: ensureNl(r), code: 0 } : { ...r, out: r.out !== undefined ? ensureNl(r.out) : undefined };
			} catch (e) {
				return { err: `${name}: ${(e as Error).message}\n`, code: 1 };
			}
		}
		const b = builtins[name];
		if (!b) return { err: `bash: ${name}: command not found\n`, code: 127 };
		try {
			return b(args, this.ctx(stdin), this);
		} catch (e) {
			return { err: `${name}: ${(e as Error).message}\n`, code: 1 };
		}
	}

	private tokenize(src: string): Tok[] {
		const toks: Tok[] = [];
		let i = 0;
		let word = '';
		let inWord = false;
		let glob = false;
		const push = () => {
			if (inWord) toks.push({ t: 'word', v: word, glob });
			word = '';
			inWord = false;
			glob = false;
		};
		const expandVar = (from: number): [string, number] => {
			if (src[from] === '?') return [String(this.lastCode), from + 1];
			if (src[from] === '{') {
				const end = src.indexOf('}', from);
				if (end < 0) throw new Error('bad substitution');
				return [this.env[src.slice(from + 1, end)] ?? '', end + 1];
			}
			const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(from));
			if (!m) return ['$', from];
			return [this.env[m[0]] ?? '', from + m[0].length];
		};
		while (i < src.length) {
			const c = src[i];
			if (c === ' ' || c === '\t') {
				push();
				i++;
			} else if (c === "'") {
				const end = src.indexOf("'", i + 1);
				if (end < 0) throw new Error('unexpected EOF while looking for matching `\'\'');
				word += src.slice(i + 1, end);
				inWord = true;
				i = end + 1;
			} else if (c === '"') {
				i++;
				inWord = true;
				while (i < src.length && src[i] !== '"') {
					if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) {
						word += src[i + 1];
						i += 2;
					} else if (src[i] === '$') {
						const [v, ni] = expandVar(i + 1);
						word += v;
						i = ni;
					} else word += src[i++];
				}
				if (src[i] !== '"') throw new Error('unexpected EOF while looking for matching `"\'');
				i++;
			} else if (c === '\\' && i + 1 < src.length) {
				word += src[i + 1];
				inWord = true;
				i += 2;
			} else if (c === '$') {
				const [v, ni] = expandVar(i + 1);
				word += v;
				inWord = true;
				i = ni;
			} else if (src.startsWith('2>&1', i)) {
				push();
				toks.push({ t: 'op', v: '2>&1' });
				i += 4;
			} else if (src.startsWith('2>', i) && !inWord) {
				push();
				toks.push({ t: 'op', v: '2>' });
				i += 2;
			} else if (src.startsWith('&&', i) || src.startsWith('||', i) || src.startsWith('>>', i)) {
				push();
				toks.push({ t: 'op', v: src.slice(i, i + 2) });
				i += 2;
			} else if ('|;><'.includes(c)) {
				push();
				toks.push({ t: 'op', v: c });
				i++;
			} else if (c === '#' && !inWord) {
				break;
			} else {
				if (c === '*' || c === '?' || c === '[') glob = true;
				word += c;
				inWord = true;
				i++;
			}
		}
		push();
		return toks;
	}

	/** Tab completion: command names for the first word, paths otherwise. */
	complete(line: string): { line: string; options: string[] } {
		const m = /(\S*)$/.exec(line)!;
		const partial = m[1];
		const before = line.slice(0, line.length - partial.length);
		const isCmd = !before.trim() || /[|;&]\s*$/.test(before);
		let options: string[];
		if (isCmd) options = this.commandNames().filter((c) => c.startsWith(partial));
		else {
			const slash = partial.lastIndexOf('/');
			const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
			const base = partial.slice(slash + 1);
			const dir = this.fs.resolve(this.cwd, dirPart || '.', this.home);
			options = this.fs
				.list(dir)
				.filter((n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')))
				.map((n) => dirPart + n + (this.fs.isDir(dir === '/' ? `/${n}` : `${dir}/${n}`) ? '/' : ''));
		}
		if (options.length === 1) {
			const done = options[0];
			return { line: before + done + (done.endsWith('/') ? '' : ' '), options: [] };
		}
		if (options.length > 1) {
			let common = options[0];
			for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
			return { line: before + (common.length > partial.length ? common : partial), options };
		}
		return { line, options: [] };
	}
}

export function ensureNl(s: string): string {
	return s && !s.endsWith('\n') ? s + '\n' : s;
}
