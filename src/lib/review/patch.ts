import type { DiffFile } from '$lib/content/types';

export interface DiffRow {
	kind: 'ctx' | 'add' | 'del' | 'hunk';
	text: string;
	old?: number;
	new?: number;
}

/** Parse a file's unified-diff body into numbered rows. */
export function parsePatch(file: DiffFile): DiffRow[] {
	const rows: DiffRow[] = [];
	let o = file.oldStart ?? 1;
	let n = file.newStart ?? 1;
	const body = file.patch.replace(/^\n/, '').replace(/\n$/, '');
	for (const line of body.split('\n')) {
		const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
		if (h) {
			o = Number(h[1]);
			n = Number(h[2]);
			rows.push({ kind: 'hunk', text: line });
			continue;
		}
		const sign = line[0];
		const text = line.slice(1);
		if (sign === '+') rows.push({ kind: 'add', text, new: n++ });
		else if (sign === '-') rows.push({ kind: 'del', text, old: o++ });
		else rows.push({ kind: 'ctx', text: sign === ' ' ? text : line, old: o++, new: n++ });
	}
	return rows;
}
