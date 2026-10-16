import { storage } from './storage';

type Theme = 'light' | 'dark';
const KEY = 'drills:theme';

/** Two-state theme toggle. Until the user picks, the effective theme follows the OS setting. */
class ThemeState {
	value = $state<Theme>('light');

	load() {
		const saved = storage.get(KEY);
		const system: Theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		this.value = saved === 'light' || saved === 'dark' ? saved : system;
		if (saved === 'light' || saved === 'dark') this.apply();
	}

	toggle() {
		this.value = this.value === 'dark' ? 'light' : 'dark';
		storage.set(KEY, this.value);
		this.apply();
	}

	private apply() {
		document.documentElement.setAttribute('data-theme', this.value);
	}
}

export const theme = new ThemeState();
