/** Practice countdown shared by the header and question cards. */
class Timer {
	endAt = $state(0);
	now = $state(Date.now());
	#tick: ReturnType<typeof setInterval> | null = null;

	get running() {
		return this.endAt > 0;
	}

	get left() {
		return Math.max(0, Math.round((this.endAt - this.now) / 1000));
	}

	start(minutes: number) {
		this.endAt = Date.now() + minutes * 60_000;
		this.now = Date.now();
		if (this.#tick) clearInterval(this.#tick);
		this.#tick = setInterval(() => {
			this.now = Date.now();
			if (this.left === 0 && this.#tick) {
				clearInterval(this.#tick);
				this.#tick = null;
			}
		}, 250);
	}

	stop() {
		if (this.#tick) clearInterval(this.#tick);
		this.#tick = null;
		this.endAt = 0;
	}
}

export const timer = new Timer();
