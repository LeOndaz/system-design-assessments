import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html', strict: true }),
		// GitHub Pages serves project sites from /<repo>; the deploy workflow sets BASE_PATH.
		paths: { base: process.env.BASE_PATH ?? '' },
		prerender: { handleHttpError: 'fail' }
	}
};

export default config;
