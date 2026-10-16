import type { GlossaryTerm } from '../types';
import { dayAxis, shape, step, ramp } from '../series';

const days = dayAxis('Sep 01', 28);

const terms: GlossaryTerm[] = [
	{
		id: 'core-web-vitals',
		term: 'Core Web Vitals',
		aliases: ['CWV', 'web vitals'],
		category: 'frontend & network',
		short:
			"Three field metrics browsers report about real page loads: [[lcp|LCP]] (how long until the main content shows), [[inp|INP]] (how long the page takes to react when you tap or type) and [[cls|CLS]] (how much things jump around). They're measured on real users' devices, at the 75th percentile, so a fast laptop in the office tells you almost nothing about them.",
		analogy:
			'A restaurant review that only counts three things: how long until food arrives, how fast the waiter responds when you wave, and whether the table wobbles.',
		related: ['lcp', 'inp', 'cls', 'rum', 'percentiles'],
		page: [
			{
				type: 'p',
				text: 'Each vital answers a different user complaint, and each has a different usual cause. Debugging starts by splitting the metric by **device class**, **route** and **connection type**: a global p75 hides that one template on low-end Android is the whole problem.'
			},
			{
				type: 'table',
				head: ['Metric', 'User feels', 'Good (p75)', 'Usual causes', 'Not the cause (common red herring)'],
				rows: [
					[
						'[[lcp|LCP]]',
						'"Blank / half-loaded for ages"',
						'≤ 2.5 s',
						'Hero image lazy-loaded or set as CSS background; render-blocking CSS/fonts; slow TTFB; client-side rendering of the hero',
						'Total JS bundle size when the hero is an image the browser could have fetched early'
					],
					[
						'[[inp|INP]]',
						'"I tapped and nothing happened"',
						'≤ 200 ms',
						'Long tasks on the main thread after input: synchronous re-render of big lists, heavy event handlers, hydration still running, third-party scripts',
						'Network latency of the API the click triggers (INP ends at the next paint, not when data arrives)'
					],
					[
						'[[cls|CLS]]',
						'"I clicked the wrong thing because it moved"',
						'≤ 0.1',
						'Images without width/height, late banners (consent, promo) inserted above content, web fonts swapping with different metrics, ads',
						'Animations using transform (they don\'t count as layout shift)'
					]
				]
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'datadog',
					title: 'RUM · p75 by device class',
					range: 'Sep 01 – Sep 28',
					panels: [
						{
							kind: 'timeseries',
							title: 'LCP p75',
							unit: ' s',
							span: 6,
							x: days,
							series: [
								{ name: 'desktop', points: shape(28, { base: 1.9, noise: 0.05, seed: 3, round: 2 }) },
								{ name: 'mobile high-end', points: shape(28, { base: 2.3, noise: 0.05, seed: 4, round: 2 }) },
								{ name: 'mobile low-end', points: shape(28, { base: 3.1, noise: 0.05, seed: 5, round: 2 }, step(14, 4.6)) }
							],
							markers: [{ at: 14, label: 'carousel release' }],
							thresholds: [{ value: 2.5, tone: 'warn', label: 'good ≤ 2.5 s' }]
						}
					]
				}
			},
			{
				type: 'callout',
				tone: 'info',
				title: 'How to read it',
				text: 'The release only moved the low-end line. That points at something CPU- or bandwidth-sensitive (a bigger hero, a JS-rendered carousel) rather than a backend regression, which would move all three lines together.'
			}
		]
	},
	{
		id: 'lcp',
		term: 'LCP (Largest Contentful Paint)',
		aliases: ['largest contentful paint'],
		category: 'frontend & network',
		short:
			"The moment the biggest visible thing in the viewport (usually the hero image or headline) finishes rendering. It's the browser's guess at \"the page looks loaded\". It's slow when the browser discovers the hero late: lazy-loaded, set as a CSS background, or injected by JavaScript after the bundle runs.",
		related: ['core-web-vitals', 'inp', 'cls', 'request-waterfall']
	},
	{
		id: 'inp',
		term: 'INP (Interaction to Next Paint)',
		aliases: ['interaction to next paint'],
		category: 'frontend & network',
		short:
			'How long from a tap, click or keypress until the screen visibly updates, taking roughly the worst interaction on the page. It measures main-thread blocking, not network: if a click starts a 3 s fetch but immediately shows a spinner, INP is fine. If a keystroke synchronously re-renders 2,000 rows, INP is terrible even with no network at all.',
		related: ['core-web-vitals', 'event-loop', 'optimistic-ui']
	},
	{
		id: 'cls',
		term: 'CLS (Cumulative Layout Shift)',
		aliases: ['layout shift'],
		category: 'frontend & network',
		short:
			'A score for how much visible content moves unexpectedly while the page is in use. Content that jumps because something above it loaded late (an image with no size, a consent banner, a font swap) counts; movement within 500 ms of a user input does not. High CLS causes mis-taps, which is why it matters for checkout buttons especially.',
		related: ['core-web-vitals', 'lcp']
	},
	{
		id: 'hydration-mismatch',
		term: 'Hydration mismatch',
		category: 'frontend & network',
		short:
			"Server-side rendering sends finished HTML, then the browser runs the same components to attach event handlers (hydration). If the browser's render produces different output than the server's (dates formatted in a different timezone, `Math.random()`, `window` checks, locale), frameworks either patch the difference, warn, or throw away the server HTML and re-render from scratch. That costs the speed SSR was supposed to buy, and it only happens for some users.",
		analogy: "A stage set built from a script, then the actors arrive with a different version of the script and have to rebuild the furniture mid-show.",
		related: ['iana-timezone', 'utc', 'lcp', 'cls']
	},
	{
		id: 'focus-management',
		term: 'Focus management',
		category: 'security & compliance',
		short:
			'Deciding where keyboard focus goes when the page changes: into a dialog when it opens, back to the button that opened it when it closes, to the new heading after client-side navigation. Without it, keyboard and screen-reader users are dropped at the top of the document or on an element that no longer exists, and lose their place entirely.',
		related: ['aria-live', 'accessible-name'],
		page: [
			{
				type: 'p',
				text: 'Sighted mouse users never notice focus. Keyboard and screen-reader users navigate *by* it, so every time the UI opens, closes or replaces something, you owe them an answer to "where am I now?".'
			},
			{
				type: 'table',
				head: ['Event', 'Focus should go to', 'What breaks if you skip it'],
				rows: [
					['Modal opens', 'The first meaningful control, or the dialog title (with `tabindex="-1"`)', 'Tab keeps moving through the page *behind* the overlay'],
					['Modal closes', 'The element that opened it', 'Focus lands on `<body>`; the next Tab starts from the top of the page'],
					['Item deleted from a list', 'The next item, or the list heading', 'Focus was on the deleted row\'s button, which no longer exists'],
					['Client-side route change', 'The new page\'s `<h1>` (and announce the title)', 'Screen reader says nothing; the user doesn\'t know the page changed'],
					['Inline form error', 'The first invalid field (on submit)', 'The user hears "submit" and silence']
				]
			},
			{
				type: 'code',
				lang: 'typescript',
				caption: 'The minimum for a dialog: remember the opener, move focus in, trap Tab, restore on close.',
				code: `function openDialog(dialog: HTMLDialogElement) {
  const opener = document.activeElement as HTMLElement | null;
  dialog.showModal();              // native <dialog> traps focus and handles Escape
  dialog.addEventListener('close', () => opener?.focus(), { once: true });
}`
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Test it with the keyboard only, then with VoiceOver/NVDA. Automated checkers can\'t tell you where focus *went*; they only catch missing labels.'
			}
		]
	},
	{
		id: 'aria-live',
		term: 'ARIA live region',
		aliases: ['aria-live', 'live region'],
		category: 'security & compliance',
		short:
			'An element marked `aria-live="polite"` (or `assertive`, or `role="status"` / `role="alert"`) whose text changes are read out by screen readers without the user moving focus there. It\'s how "3 results found" or "Saved" reach a blind user. The region must already exist in the DOM before the text changes; inserting a new live element with text in it is often not announced. `assertive` interrupts whatever is being read, so using it for every toast is hostile.',
		related: ['focus-management', 'accessible-name']
	},
	{
		id: 'accessible-name',
		term: 'Accessible name',
		category: 'security & compliance',
		short:
			"The text a screen reader announces for a control: from its `<label>`, its text content, `aria-label`, or `aria-labelledby`. Icon-only buttons (×, 👁, 🗑) have no accessible name unless you give them one, so they're announced as just \"button\". A placeholder is not a reliable name and disappears once the user types.",
		related: ['placeholder-as-label', 'focus-management']
	},
	{
		id: 'placeholder-as-label',
		term: 'Placeholder as label',
		category: 'security & compliance',
		short:
			"Using the grey hint text inside an input instead of a visible label. It vanishes as soon as the user types (so they forget what the field was), it's usually too low-contrast to read, autofill hides it instantly, and some screen readers don't announce it. Fine as an example format; never as the only label.",
		related: ['accessible-name', 'color-contrast']
	},
	{
		id: 'color-contrast',
		term: 'Colour contrast',
		aliases: ['contrast ratio', 'WCAG contrast'],
		category: 'security & compliance',
		short:
			'The luminance ratio between text and its background. WCAG asks for 4.5:1 for body text and 3:1 for large text and for UI parts like input borders and focus rings. Light grey on white (common for "disabled", hints and placeholders) usually fails. Contrast is also why colour alone must never carry meaning: ~8% of men can\'t tell red from green apart, so status needs an icon or word too.',
		related: ['reduced-motion', 'placeholder-as-label']
	},
	{
		id: 'reduced-motion',
		term: 'Reduced motion',
		aliases: ['prefers-reduced-motion'],
		category: 'security & compliance',
		short:
			'A user setting exposed to CSS and JS as `prefers-reduced-motion: reduce`. People with vestibular disorders get nausea or dizziness from parallax, zooms and large sliding transitions. Respecting it means replacing big movement with fades or nothing; it does not mean removing all feedback.',
		related: ['color-contrast']
	},
	{
		id: 'tap-target',
		term: 'Tap target size',
		category: 'frontend & network',
		short:
			"The touchable area of a control on a touchscreen. Guidelines are about 44×44 pt (iOS) / 48×48 dp (Android); WCAG 2.2's minimum is 24×24 CSS px. Small steppers, close icons and inline links packed together cause mis-taps, especially next to destructive actions. The visible icon can stay small if the hit area around it is padded.",
		related: ['safe-area-inset']
	},
	{
		id: 'safe-area-inset',
		term: 'Safe-area inset',
		category: 'frontend & network',
		short:
			"The parts of a phone screen covered by the notch, rounded corners or the home-indicator bar. Sticky footers and full-bleed buttons must pad by `env(safe-area-inset-bottom)` or they sit under the home indicator, where a swipe-up gesture takes the user out of the app instead of pressing your button.",
		related: ['tap-target']
	},
	{
		id: 'ime-composition',
		term: 'IME composition',
		aliases: ['input method editor', 'compositionstart'],
		category: 'frontend & network',
		short:
			"Japanese, Chinese and Korean users (and many mobile keyboards) type through an input method editor: keystrokes build up an unconfirmed \"composition\" that is only committed when they pick a candidate. During composition the input's value changes on every key but isn't final. Code that validates, reformats or submits on every `input`/`keydown` (Enter to submit, auto-capitalise, strip characters) breaks their typing. Check `event.isComposing` / listen for `compositionend`.",
		related: ['unicode-normalization', 'autofill-events']
	},
	{
		id: 'autofill-events',
		term: 'Autofill events',
		category: 'frontend & network',
		short:
			"When the browser or a password manager fills fields, it doesn't always fire the `input`/`keyup` events your form logic listens to (it varies by browser and by whether the user has interacted with the page yet). A \"Submit\" button that enables only after onChange fires can stay disabled with visibly filled fields. Derive state from the actual field values on submit, not from a tally of change events.",
		related: ['ime-composition']
	},
	{
		id: 'optimistic-ui',
		term: 'Optimistic UI',
		category: 'frontend & network',
		short:
			"Showing the result of an action immediately (the like turns red, the item disappears) before the server confirms, then rolling back if it fails. It makes the app feel instant, but the rollback is the hard part: with several actions in flight, restoring a stale snapshot can wipe out a later action that succeeded. Rollback must be per-action, and the final state should come from the server's answer.",
		analogy: 'Telling a friend "booked!" while the booking site is still loading. Fine if you correct it carefully, chaotic if you booked twice and then "cancel" by restoring yesterday\'s calendar.',
		related: ['race-condition', 'stale-response', 'idempotency-key'],
		page: [
			{
				type: 'p',
				text: 'The classic bug: two quick toggles, each saves a snapshot of state before applying its change. The first request fails *after* the second succeeds, and its rollback restores the snapshot from before **both** changes.'
			},
			{
				type: 'table',
				head: ['Time', 'Event', 'UI shows', 'Server has'],
				rows: [
					['t0', 'Start', 'off', 'off'],
					['t1', 'Click 1: snapshot=off, show on, send PUT on', 'on', 'off'],
					['t2', 'Click 2: snapshot=on, show off, send PUT off', 'off', 'off'],
					['t3', 'PUT off succeeds', 'off', 'off'],
					['t4', 'PUT on fails (timeout) → restore snapshot "off"', 'off', 'off'],
					['t5', 'Looks fine… but swap the order and the rollback restores "on" over a confirmed "off"', '**on**', '**off**']
				]
			},
			{
				type: 'list',
				items: [
					'Tag each mutation with a sequence number; ignore responses (and rollbacks) older than the latest mutation for that entity.',
					'Roll back by *re-fetching* or by applying the inverse of only the failed change, never by restoring a whole snapshot.',
					'Serialize mutations per entity (queue them) when order matters, e.g. toggles and counters.',
					'Use [[idempotency-key|idempotency keys]] so a retried mutation can\'t apply twice.'
				]
			}
		]
	},
	{
		id: 'stale-response',
		term: 'Stale response race',
		aliases: ['out-of-order responses', 'request race'],
		category: 'frontend & network',
		short:
			'When a UI fires several requests for changing input (search-as-you-type, filter clicks, tab switches) and renders whichever response arrives last instead of the one for the latest input. Responses don\'t come back in the order they were sent, so the screen ends up showing results for "ab" while the box says "abc". Fix by cancelling old requests (AbortController) or ignoring any response whose request id isn\'t the latest.',
		related: ['race-condition', 'optimistic-ui', 'out-of-order-delivery']
	},
	{
		id: 'service-worker',
		term: 'Service worker',
		category: 'frontend & network',
		short:
			"A script the browser keeps between visits that can intercept every network request from your site and answer it from a cache. Great for offline support; dangerous for deploys: a cached old `index.html` keeps referencing JavaScript chunk files that the new deploy deleted, so lazy-loaded routes fail with ChunkLoadError until the worker updates (which can take until all tabs are closed).",
		related: ['chunk-load-error', 'cache-control']
	},
	{
		id: 'chunk-load-error',
		term: 'ChunkLoadError',
		category: 'frontend & network',
		short:
			"The error a bundled app throws when it tries to lazy-load a JavaScript file (a route, a modal) that the server no longer has, usually because a deploy replaced the hashed filenames while a user still had the old app open or cached. It spikes right after deploys and on long-lived tabs. Fixes: keep previous builds' assets for a while, catch the error and reload once, and don't let a service worker pin an old HTML shell.",
		related: ['service-worker', 'cache-control']
	},
	{
		id: 'content-security-policy',
		term: 'Content Security Policy (CSP)',
		aliases: ['CSP'],
		category: 'security & compliance',
		short:
			"An HTTP header telling the browser which scripts, styles, frames and connections a page may use. It's a strong defence against XSS, but switching it straight to enforcing mode breaks anything you forgot to list: inline tag-manager snippets, analytics pixels, payment iframes. Those failures are silent to users and to your error tracker. Roll out with `Content-Security-Policy-Report-Only` and a report endpoint first.",
		related: ['samesite-cookie']
	},
	{
		id: 'samesite-cookie',
		term: 'SameSite cookies',
		aliases: ['SameSite', 'third-party cookies'],
		category: 'security & compliance',
		short:
			"A cookie attribute deciding whether the browser sends the cookie on requests that come from another site. `Lax` (the default in most browsers) blocks it inside cross-site iframes and on cross-site POSTs. Safari also blocks third-party cookies entirely, even with `SameSite=None; Secure`, and Firefox partitions them per top-level site. So an app embedded in a partner's iframe can log in successfully and still look logged-out on the next request, producing a login loop in one browser only.",
		related: ['content-security-policy', 'sso']
	},
	{
		id: 'peeking',
		term: 'Peeking (A/B tests)',
		aliases: ['optional stopping'],
		category: 'business',
		short:
			"Checking an A/B test's p-value every day and stopping the first time it dips below 0.05. Each look is another chance for random noise to cross the line, so with daily checks over two weeks the real false-positive rate is several times higher than 5%. Fix: decide the sample size in advance, or use a sequential method designed for repeated looks.",
		analogy: 'Flipping a fair coin and declaring it biased the first time you happen to be 5 heads ahead.',
		related: ['novelty-effect', 'simpsons-paradox', 'sample-ratio-mismatch'],
		page: [
			{
				type: 'p',
				text: 'A p-value of 0.05 means "5% chance of a result this extreme *if you look once*". Each extra look is another lottery ticket for noise.'
			},
			{
				type: 'table',
				head: ['Looks at the data', 'Actual false-positive rate (approx.)'],
				numeric: [0, 1],
				rows: [
					['1', '5%'],
					['2', '8%'],
					['5', '14%'],
					['10', '19%'],
					['20 (daily for ~3 weeks)', '25%']
				],
				caption: 'For an A/A test (no real difference) stopped at the first p < 0.05.'
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'datadog',
					title: 'Checkout test · cumulative p-value',
					range: 'days 1–28',
					panels: [
						{
							kind: 'timeseries',
							title: 'p-value (cumulative)',
							span: 6,
							x: days,
							yMax: 1,
							series: [
								{
									name: 'p-value',
									points: shape(28, { base: 0.5, noise: 0.25, seed: 11, round: 3 }, ramp(0, 5, 0.6, 0.04), ramp(5, 12, 0.04, 0.45), ramp(12, 28, 0.45, 0.62))
								}
							],
							thresholds: [{ value: 0.05, tone: 'crit', label: 'p = 0.05' }],
							markers: [{ at: 5, label: 'someone shipped it here' }]
						}
					]
				}
			},
			{
				type: 'callout',
				tone: 'info',
				text: 'The curve dipped under 0.05 on day 6 and wandered back. Stopping there "proves" a win that was noise.'
			}
		]
	},
	{
		id: 'novelty-effect',
		term: 'Novelty effect',
		category: 'business',
		short:
			"Returning users click a changed thing because it's new, not because it's better, so a redesign's lift is largest in the first days and fades. The tell: the effect is big for returning users, near zero for new users (to whom nothing is new), and shrinks week over week. Run long enough to see the curve flatten, or judge on new users.",
		related: ['peeking', 'simpsons-paradox']
	},
	{
		id: 'simpsons-paradox',
		term: "Simpson's paradox",
		category: 'business',
		short:
			"A trend that appears in every subgroup reverses when the groups are combined, because the groups are mixed in different proportions. Variant B can convert worse on mobile *and* worse on desktop yet better overall, if B happened to get more desktop traffic (which converts higher). Always check the mix of segments between arms before trusting a pooled number.",
		related: ['sample-ratio-mismatch', 'peeking'],
		page: [
			{
				type: 'table',
				head: ['Segment', 'A: visitors', 'A: conv.', 'B: visitors', 'B: conv.'],
				numeric: [1, 2, 3, 4],
				rows: [
					['Desktop', '2,000', '10.0%', '8,000', '9.5%'],
					['Mobile', '8,000', '3.0%', '2,000', '2.5%'],
					['**All**', '10,000', '**4.4%**', '10,000', '**8.1%**']
				],
				caption: 'B loses in both segments and "wins" overall, purely because B got 4× the desktop share.'
			},
			{
				type: 'p',
				text: 'In a properly randomized test the segment mix should be the same in both arms. If it isn\'t, the randomization or the logging is broken: a [[sample-ratio-mismatch]] at the segment level. Find out why before reading any result.'
			}
		]
	},
	{
		id: 'analytics-schema-drift',
		term: 'Analytics schema drift',
		category: 'business',
		short:
			"When one client (say, the web app) renames or reshapes an analytics event or property and the others don't, or the pipeline's parser doesn't. Dashboards then show a real-looking drop or spike that is purely instrumentation. The tell: the change lines up with one platform's release and the funnel step's *raw* event count by client version tells the story.",
		related: ['schema-evolution', 'data-drift']
	},
	{
		id: 'dark-pattern',
		term: 'Dark pattern',
		category: 'business',
		short:
			"An interface designed to push users into something they wouldn't choose with clear information: pre-ticked marketing consent, \"confirmshaming\" decline links, cancellation hidden behind five screens, a default that grants more than needed. Besides eroding trust, several are now illegal (GDPR consent must be opt-in; US and EU rules on subscription cancellation). Not every friction is a dark pattern: a confirmation before a destructive action protects the user.",
		related: ['confirm-vs-undo', 'suppression-list']
	},
	{
		id: 'confirm-vs-undo',
		term: 'Confirm vs undo',
		category: 'frontend & network',
		short:
			"Two ways to protect against mistakes. A confirm dialog interrupts every time, so users learn to click through it. Undo lets the action happen and offers a few seconds to reverse it, which is better for frequent, recoverable actions. Undo only works if the system really can reverse it: if the server deletes for good before the undo window ends, the undo button lies.",
		related: ['dark-pattern', 'optimistic-ui']
	},
	{
		id: 'empty-state',
		term: 'Empty, loading and error states',
		aliases: ['empty state', 'zero state'],
		category: 'frontend & network',
		short:
			'The three screens every list needs besides "has data": still loading, genuinely empty, and failed to load. When they look the same (a blank area, or "No results"), users conclude their data is gone when it\'s really a timeout, or wait forever on something that will never arrive. Each needs different words and a different next action (retry, reset filters, create the first item).',
		related: ['confirm-vs-undo']
	},
	{
		id: 'i18n-pluralization',
		term: 'Pluralization (i18n)',
		aliases: ['plural rules', 'ICU MessageFormat'],
		category: 'money & time',
		short:
			'Languages have different plural categories: English has two (one / other), Polish and Russian have four, Arabic six, Japanese one. `count === 1 ? "item" : "items"` is wrong for most of the world and even for English edge cases. Use `Intl.PluralRules` or ICU MessageFormat so translators supply every form their language needs.',
		related: ['locale-formatting', 'rtl', 'text-expansion']
	},
	{
		id: 'text-expansion',
		term: 'Text expansion',
		category: 'money & time',
		short:
			'Translated text is usually longer than English: German and Finnish often 30–40% longer, short labels can double. Fixed-width buttons and tabs then truncate or wrap ("Kontoeinstellu…"). Design for the longest language, not English.',
		related: ['i18n-pluralization', 'rtl']
	},
	{
		id: 'rtl',
		term: 'Right-to-left (RTL) layout',
		aliases: ['RTL', 'bidi'],
		category: 'money & time',
		short:
			'Arabic, Hebrew, Persian and Urdu read right to left, so the whole layout mirrors: navigation, back arrows, progress steppers, the side a drawer opens from. Numbers, code and Latin brand names stay left to right inside the sentence. Use logical CSS (`margin-inline-start`, not `margin-left`) and mirror directional icons, but not clocks, media play buttons or logos.',
		related: ['i18n-pluralization', 'text-expansion', 'locale-formatting']
	},
	{
		id: 'least-privilege-default',
		term: 'Least-privilege default',
		category: 'security & compliance',
		short:
			'When a form offers a role or permission, the preselected option should be the one granting the least access. A team-invite form that defaults to "Admin" turns every rushed invite into a full-access account, and the person clicking "Send" rarely looks at the dropdown.',
		related: ['dark-pattern']
	}
];

export default terms;
