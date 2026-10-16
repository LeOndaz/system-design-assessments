/** In-memory filesystem for terminal scenarios. Paths are absolute, '/'-separated. */

export function normalize(path: string): string {
	const out: string[] = [];
	for (const seg of path.split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') out.pop();
		else out.push(seg);
	}
	return '/' + out.join('/');
}

export class VFS {
	files = new Map<string, string>();
	dirs = new Set<string>(['/']);
	/** Optional modification times (epoch seconds) for `ls -l`, `find -newer`, `stat`. */
	mtimes = new Map<string, number>();

	constructor(files: Record<string, string> = {}, dirs: string[] = []) {
		for (const [p, c] of Object.entries(files)) this.write(normalize(p), c);
		for (const d of dirs) this.mkdirp(normalize(d));
	}

	resolve(cwd: string, path: string, home = '/root'): string {
		if (path === '~' || path.startsWith('~/')) path = home + path.slice(1);
		return normalize(path.startsWith('/') ? path : `${cwd}/${path}`);
	}

	mkdirp(dir: string) {
		const parts = normalize(dir).split('/').filter(Boolean);
		let cur = '';
		for (const p of parts) {
			cur += '/' + p;
			this.dirs.add(cur);
		}
	}

	write(path: string, content: string) {
		const p = normalize(path);
		this.mkdirp(p.slice(0, p.lastIndexOf('/')) || '/');
		this.files.set(p, content);
	}

	read(path: string): string | null {
		return this.files.get(normalize(path)) ?? null;
	}

	exists(path: string): boolean {
		const p = normalize(path);
		return this.files.has(p) || this.dirs.has(p);
	}

	isDir(path: string): boolean {
		return this.dirs.has(normalize(path));
	}

	/** Direct children names (dirs get no trailing slash). */
	list(dir: string): string[] {
		const d = normalize(dir);
		const prefix = d === '/' ? '/' : d + '/';
		const names = new Set<string>();
		for (const p of [...this.files.keys(), ...this.dirs]) {
			if (p !== d && p.startsWith(prefix)) {
				const rest = p.slice(prefix.length);
				if (rest && !rest.includes('/')) names.add(rest);
			}
		}
		return [...names].sort();
	}

	/** Every path under dir (inclusive), depth-first, sorted. */
	walk(dir: string): string[] {
		const d = normalize(dir);
		const out: string[] = [d];
		for (const name of this.list(d)) {
			const p = d === '/' ? `/${name}` : `${d}/${name}`;
			if (this.isDir(p)) out.push(...this.walk(p));
			else out.push(p);
		}
		return out;
	}

	remove(path: string, recursive = false): boolean {
		const p = normalize(path);
		if (this.files.delete(p)) return true;
		if (!this.dirs.has(p) || p === '/') return false;
		const inside = [...this.files.keys(), ...this.dirs].filter((x) => x.startsWith(p + '/'));
		if (inside.length && !recursive) return false;
		for (const x of inside) {
			this.files.delete(x);
			this.dirs.delete(x);
		}
		this.dirs.delete(p);
		return true;
	}

	size(path: string): number {
		const p = normalize(path);
		if (this.files.has(p)) return new TextEncoder().encode(this.files.get(p)!).length;
		return this.walk(p)
			.filter((x) => this.files.has(x))
			.reduce((n, x) => n + new TextEncoder().encode(this.files.get(x)!).length, 0);
	}
}

/** Shell glob (* ? [abc]) → RegExp for one path segment. */
export function globToRegex(glob: string): RegExp {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*') re += '[^/]*';
		else if (c === '?') re += '[^/]';
		else if (c === '[') {
			const end = glob.indexOf(']', i);
			if (end > i) {
				re += '[' + glob.slice(i + 1, end).replace(/^!/, '^') + ']';
				i = end;
			} else re += '\\[';
		} else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
	}
	return new RegExp(`^${re}$`);
}

/** Expand a glob word against the filesystem. Returns [] when nothing matches. */
export function expandGlob(fs: VFS, cwd: string, word: string, home: string): string[] {
	const abs = word.startsWith('/') || word.startsWith('~');
	const full = fs.resolve(cwd, word, home);
	const segs = full.split('/').filter(Boolean);
	let paths = ['/'];
	for (const seg of segs) {
		const next: string[] = [];
		const re = /[*?[]/.test(seg) ? globToRegex(seg) : null;
		for (const base of paths) {
			if (re) {
				for (const name of fs.list(base)) if (re.test(name) && (seg.startsWith('.') || !name.startsWith('.'))) next.push(base === '/' ? `/${name}` : `${base}/${name}`);
			} else {
				const p = base === '/' ? `/${seg}` : `${base}/${seg}`;
				if (fs.exists(p)) next.push(p);
			}
		}
		paths = next;
	}
	if (abs) return paths;
	// Return relative paths when the user typed a relative glob.
	const prefix = cwd === '/' ? '/' : cwd + '/';
	return paths.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
}
