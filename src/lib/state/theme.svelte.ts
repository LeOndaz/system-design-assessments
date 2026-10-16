import { storage } from './storage';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'drills:theme';

class ThemeState {
	value = $state<Theme>('system');

	load() {
		const v = storage.get(KEY);
		if (v === 'light' || v === 'dark') this.value = v;
		this.apply();
	}

	cycle() {
		this.value = this.value === 'system' ? 'dark' : this.value === 'dark' ? 'light' : 'system';
		storage.set(KEY, this.value);
		this.apply();
	}

	private apply() {
		const root = document.documentElement;
		if (this.value === 'system') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', this.value);
	}
}

export const theme = new ThemeState();
