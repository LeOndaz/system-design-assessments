import { storage } from './storage';

/**
 * SM-2 spaced repetition (the SuperMemo-2 algorithm Anki descends from).
 * Grades: 0 = again, 3 = hard, 4 = good, 5 = easy.
 */
export interface Card {
	ease: number;
	/** Days until next review. */
	interval: number;
	reps: number;
	lapses: number;
	/** Epoch ms when due. */
	due: number;
	/** Epoch ms of the last review. */
	seen: number;
}

export type Grade = 0 | 3 | 4 | 5;

const KEY = 'drills:srs:v1';
const DAY = 86_400_000;
const LEARN_STEP = 10 * 60_000; // "again" brings the card back in 10 minutes

export function schedule(card: Card | undefined, grade: Grade, now: number): Card {
	const c: Card = card ? { ...card } : { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now, seen: now };
	c.seen = now;
	if (grade < 3) {
		c.reps = 0;
		c.lapses++;
		c.interval = 0;
		c.ease = Math.max(1.3, c.ease - 0.2);
		c.due = now + LEARN_STEP;
		return c;
	}
	c.reps++;
	if (c.reps === 1) c.interval = grade === 5 ? 4 : 1;
	else if (c.reps === 2) c.interval = grade === 5 ? 10 : 6;
	else c.interval = Math.round(c.interval * c.ease * (grade === 3 ? 0.8 : grade === 5 ? 1.3 : 1));
	c.ease = Math.max(1.3, c.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
	c.due = now + c.interval * DAY;
	return c;
}

/** Human preview of the next interval for a grade ("10m", "1d", "6d", "3mo"). */
export function preview(card: Card | undefined, grade: Grade, now: number): string {
	const next = schedule(card, grade, now);
	const ms = next.due - now;
	if (ms < DAY) return `${Math.round(ms / 60_000)}m`;
	const d = Math.round(ms / DAY);
	return d < 30 ? `${d}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`;
}

class Deck {
	cards = $state<Record<string, Card>>({});

	load() {
		try {
			this.cards = JSON.parse(storage.get(KEY) ?? '{}');
		} catch {
			this.cards = {};
		}
	}

	answer(id: string, grade: Grade, now = Date.now()) {
		this.cards = { ...this.cards, [id]: schedule(this.cards[id], grade, now) };
		storage.set(KEY, JSON.stringify(this.cards));
	}

	reset() {
		this.cards = {};
		storage.set(KEY, '{}');
	}
}

export const deck = new Deck();
