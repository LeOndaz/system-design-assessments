import { storage } from './storage';

const KEY = 'drills:progress:v1';

/** Completed question keys, "assessmentId/questionId". Persisted per browser. */
class Progress {
	done = $state<Record<string, true>>({});

	load() {
		try {
			this.done = JSON.parse(storage.get(KEY) ?? '{}');
		} catch {
			this.done = {};
		}
	}

	is(assessment: string, question: string): boolean {
		return !!this.done[`${assessment}/${question}`];
	}

	set(assessment: string, question: string, value: boolean) {
		const key = `${assessment}/${question}`;
		const next = { ...this.done };
		if (value) next[key] = true;
		else delete next[key];
		this.done = next;
		storage.set(KEY, JSON.stringify(next));
	}

	count(assessment: string, ids: string[]): number {
		return ids.filter((id) => this.is(assessment, id)).length;
	}
}

export const progress = new Progress();
