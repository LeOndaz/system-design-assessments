import type { Assessment, Block } from '../types';
import { dayAxis, ramp, shape, step, timeAxis, window_, bump } from '../series';

// ───────────────────────── helpers ─────────────────────────

function reply(to: string, body: string): Block {
	return { type: 'ticket', ticket: { channel: 'email', from: 'You', role: `Reply to ${to}`, body } };
}

// ───────────────────────── chart data ─────────────────────────

// LCP regression: 28 days, carousel release on day 14.
const d28 = dayAxis('Sep 01', 28);
const lcpDesktop = shape(28, { base: 1.8, noise: 0.05, seed: 1, round: 2 });
const lcpHigh = shape(28, { base: 2.2, noise: 0.05, seed: 2, round: 2 }, step(14, 2.6));
const lcpLow = shape(28, { base: 2.9, noise: 0.05, seed: 3, round: 2 }, step(14, 4.7));
const ttfb = shape(28, { base: 0.42, noise: 0.06, seed: 4, round: 2 });
const jsKb = shape(28, { base: 312, noise: 0.004, seed: 5 }, step(14, 324));
const loadDelay = shape(28, { base: 0.15, noise: 0.1, seed: 6, round: 2 }, step(14, 1.9));
const imgKb = shape(28, { base: 148, noise: 0.01, seed: 7 });

// INP on the orders page: 24 hourly points.
const h24 = timeAxis('00:00', 24, 60);
const inpFilter = shape(24, { base: 610, noise: 0.08, seed: 11 });
const inpOther = shape(24, { base: 120, noise: 0.08, seed: 12 });
const apiP95 = shape(24, { base: 180, noise: 0.1, seed: 13 });
const longTasks = shape(24, { base: 14, noise: 0.12, seed: 14, round: 1 });

// CLS on checkout by region.
const clsEu = shape(28, { base: 0.06, noise: 0.08, seed: 21, round: 3 }, step(10, 0.27));
const clsUs = shape(28, { base: 0.05, noise: 0.08, seed: 22, round: 3 });
const clsApac = shape(28, { base: 0.05, noise: 0.08, seed: 23, round: 3 });
const adRevenue = shape(28, { base: 100, noise: 0.05, seed: 24 });

// Peeking: cumulative p-value and observed lift over 28 days.
const pval = shape(28, { base: 0.5, noise: 0.18, seed: 31, round: 3 }, ramp(0, 4, 0.55, 0.035), ramp(5, 13, 0.04, 0.4), ramp(13, 28, 0.4, 0.58));
const liftCum = shape(28, { base: 0, noise: 0.15, seed: 32, round: 1 }, ramp(0, 4, 9, 6.5), ramp(4, 28, 6.5, 0.6));

// Novelty effect: weekly nav clicks per user, 6 weeks.
const weeks = ['wk 1', 'wk 2', 'wk 3', 'wk 4', 'wk 5', 'wk 6'];

// Schema drift: hourly funnel step counts over 3 days.
const fx = ['Mon', 'Tue', 'Wed'].flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d} ${String(h).padStart(2, '0')}h`));
const traffic = (seed: number, base: number) => shape(72, { base, noise: 0.08, seed }, (i, v) => v * (0.45 + 0.55 * Math.sin(((i % 24) - 6) / 24 * Math.PI) ** 2 + 0.1));
const checkoutViews = traffic(41, 1000);
const payWeb = shape(72, { base: 1, noise: 0, seed: 1 }, (i) => checkoutViews[i] * 0.42 * 0.62, window_(34, 72, 0));
const payWebNew = shape(72, { base: 0, noise: 0, seed: 1 }, (i) => (i >= 34 ? checkoutViews[i] * 0.42 * 0.62 : 0));
const payIos = shape(72, { base: 1, noise: 0, seed: 1 }, (i) => checkoutViews[i] * 0.42 * 0.38);
const payParsed = payWeb.map((v, i) => Math.round(v + payIos[i]));
const ordersHour = shape(72, { base: 1, noise: 0.04, seed: 44 }, (i) => checkoutViews[i] * 0.31);

// Service worker ChunkLoadError histogram: 48 half-hour buckets, deploys at 10 and 34.
const swX = timeAxis('00:00', 48, 30);
const chunkErr = shape(48, { base: 3, noise: 0.3, seed: 51 }, bump(10, 16, 420), bump(16, 26, 90), bump(34, 40, 460), bump(40, 48, 110));

// ───────────────────────── assessment ─────────────────────────

const assessment: Assessment = {
	id: 'ux',
	number: 8,
	title: 'UX under scrutiny',
	tagline: 'Spot what\'s wrong with real screens, debug frontend bugs only some users hit, read vitals and A/B dashboards.',
	description:
		'For engineers who ship UI. You\'ll flag problems on mock screens (with decoys that look wrong and aren\'t), chase frontend bugs that only some browsers or languages hit, read [[core-web-vitals|Web Vitals]] and experiment dashboards that are designed to mislead, and rewrite copy so a stressed user knows what to do next.',
	minutes: 145,
	difficulty: 'advanced',
	track: 'specialist',
	topics: ['Accessibility', 'Forms & input', 'Web performance', 'Experimentation', 'i18n', 'Frontend races', 'UX copy'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Spot the problems', minutes: 45 },
				{ label: '2 · Frontend bugs', minutes: 35 },
				{ label: '3 · Web Vitals', minutes: 20 },
				{ label: '4 · Experiments', minutes: 20 },
				{ label: '5 · Copy & flows', minutes: 15 },
				{ label: 'Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'cards',
			items: [
				{
					title: 'Rank by harm',
					items: [
						'Money lost or charged twice',
						'Data loss or privacy/consent violations',
						'A user group locked out (keyboard, screen reader, IME, a browser)',
						'Wrong decision from wrong numbers',
						'Friction and polish last'
					]
				},
				{
					title: 'For every issue',
					items: ['Who is hurt, and how often', 'Why it happens (mechanism, not taste)', 'The fix, and how you\'d verify it']
				},
				{
					title: 'Decoys',
					items: [
						'Some elements look odd but are correct: legal labels, platform conventions, deliberate friction.',
						'Flagging them costs points in a real review: it signals rules applied without understanding.'
					]
				}
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'What a reviewer is grading',
			text: 'Not "I would make the button blue". They want harm-ranked findings with a mechanism: "the Pay button stays enabled during processing, so a double tap creates two charges unless the request carries an [[idempotency-key]]". Taste-only comments score near zero.'
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Spot',
			eyebrow: 'Part 1 · 45 minutes · interactive',
			title: 'Spot the problems',
			meta: 'click what\'s wrong, then check · each screen hides decoys',
			minutes: 45,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'How these work',
					text: 'Click every element you think is a problem, then **Check my picks**. Planted issues show as found or missed; decoys (purple) are things that look wrong but aren\'t. Then open the answer for the ranked critique. Aim for the subtle ones: anyone can spot low contrast.'
				}
			],
			questions: [
				{
					id: 'ux1',
					title: 'Checkout: the payment step',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'The payment step of a checkout, captured a moment after the user clicked **Pay**.' },
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'shop.lumen.example/checkout/payment',
								mode: 'spot',
								elements: [
									{ kind: 'nav', text: 'Lumen Store', items: ['Cart', 'Account'] },
									{ kind: 'stepper', items: ['Cart', 'Shipping', 'Payment', 'Review'], active: 2 },
									{
										kind: 'banner',
										tone: 'crit',
										text: 'Error 402: payment_intent_unexpected_state',
										issue: 'A raw provider error code shown to a shopper. It doesn\'t say whether they were charged or what to do. After a 402 on payment, the user\'s first fear is "did it take my money?". Say that plainly and give one action: "Your bank declined this card. You haven\'t been charged. Try another card or contact your bank."'
									},
									{
										kind: 'card',
										look: { width: 'half' },
										children: [
											{ kind: 'heading', text: 'Payment', look: { size: 'sm' } },
											{
												kind: 'input',
												placeholder: 'Card number',
												issue: '[[placeholder-as-label|Placeholder used as the only label]]. It disappears on focus and on autofill, so users can\'t check what a filled field was; screen readers may announce just "edit text". Add a visible label.'
											},
											{
												kind: 'row',
												children: [
													{ kind: 'input', label: 'Expiry', placeholder: 'MM / YY' },
													{
														kind: 'input',
														label: 'CVC',
														placeholder: '123',
														hint: '3 digits on the back (4 on the front for Amex)',
														decoy: 'Looks like wordy help text, but it\'s exactly right: Amex puts a 4-digit code on the front, and users regularly type the wrong number without this hint.'
													}
												]
											},
											{ kind: 'input', label: 'Name on card', value: 'Dana Whitfield' },
											{
												kind: 'checkbox',
												label: 'Save this card for future purchases',
												checked: true,
												issue: 'Storing a payment method pre-ticked. Saving a card should be an explicit choice: it\'s consent to store payment data and to future one-click charges. Users who share a computer get burned. Default it off.'
											},
											{
												kind: 'row',
												children: [
													{
														kind: 'button',
														variant: 'ghost',
														text: '← Back',
														decoy: 'A secondary "Back" on the left of the primary action is the standard order on web forms; it\'s visually de-emphasised, as it should be.'
													},
													{
														kind: 'button',
														variant: 'primary',
														text: 'Pay $86.40',
														issue: 'Still enabled while the payment is processing. A double click or an impatient second tap sends a second charge request. Disable it and show progress *on the button* the instant it\'s clicked, and send an [[idempotency-key]] with the request so a duplicate can\'t charge twice even if one slips through.'
													}
												]
											}
										]
									},
									{
										kind: 'card',
										look: { width: 'half' },
										children: [
											{ kind: 'heading', text: 'Order summary', look: { size: 'sm' } },
											{ kind: 'table', head: ['', ''], rows: [['Subtotal', '$80.00'], ['Shipping', '$0.00'], ['Tax', '$6.40'], ['Total', '$86.40']] }
										]
									},
									{
										kind: 'toast',
										text: 'Processing payment…',
										issue: 'The only progress indicator is a toast that auto-dismisses after 3 s while the payment may still be pending, and it isn\'t in an [[aria-live|ARIA live region]]. Users see it vanish, assume failure, and reload or pay again. Keep progress inline and persistent until the result is known.'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Pay button enabled during processing (double charge).',
									body: 'Direct money harm. Disable on click, show inline progress, and make the backend idempotent per checkout session.'
								},
								{
									title: 'Auto-dismissing toast as the only "processing" signal.',
									body: 'Causes the reload-and-pay-again behaviour that turns into duplicate charges and support tickets. Persistent inline state, announced politely to screen readers.'
								},
								{
									title: 'Raw error code with no "were you charged?" answer.',
									body: 'Every unclear payment error becomes a support contact or an abandoned cart.'
								},
								{ title: 'Pre-ticked "save card".', body: 'Consent and trust issue; on shared devices it\'s a security issue too.' },
								{ title: 'Placeholder-only card number label.', body: 'Accessibility and error recovery: after autofill, the user can\'t tell which field is which.' }
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'The tempting "the stepper should be clickable" or "make Pay green" comments are taste. A reviewer wants the two money issues first.'
						}
					]
				},
				{
					id: 'ux2',
					title: 'Search results that are almost right',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'Search-as-you-type on a product catalogue. The user typed quickly and stopped.' },
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'shop.lumen.example/search?q=wireless+headph',
								mode: 'spot',
								elements: [
									{
										kind: 'row',
										children: [
											{ kind: 'input', value: 'wireless headph', look: { width: 'full' } },
											{
												kind: 'button',
												variant: 'ghost',
												text: '×',
												look: { tiny: true },
												issue: 'Icon-only clear button with no [[accessible-name]] (announced as "button") and a ~16 px hit area. Give it `aria-label="Clear search"` and a 24 px+ target.'
											}
										]
									},
									{
										kind: 'row',
										children: [
											{
												kind: 'badge',
												text: 'In stock',
												tone: 'ok',
												issue: 'Selected filter chips are distinguished only by colour (green vs grey). Colour-blind users and screen readers can\'t tell which filters are on. Add a check icon and `aria-pressed`.'
											},
											{ kind: 'badge', text: 'Over-ear' },
											{ kind: 'badge', text: 'Under $100' }
										]
									},
									{
										kind: 'text',
										text: '40 results for "wireless head"',
										issue: 'The results are for **"wireless head"** while the box says **"wireless headph"**: a [[stale-response|stale response]] from an earlier keystroke arrived last and overwrote the newer one. Users see results that don\'t match what they typed and can\'t tell why.'
									},
									{
										kind: 'list',
										items: ['Headrest pillow, wireless charging (Sponsored)', 'Studio headphones X2 · $89', 'Wireless head torch · $24'],
										issue: 'The count and results update silently. Screen-reader users get no announcement that results changed (or that there were none). Put "40 results" in a polite [[aria-live]] region that exists before the update.'
									},
									{
										kind: 'badge',
										text: 'Sponsored',
										tone: 'info',
										decoy: 'Looks like clutter, but labelling paid placements is a legal requirement in most markets (e.g. FTC, EU [[digital-services-act|DSA]]) and a trust signal. Removing it would be the bug.'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Stale response overwrote newer results.',
									body: 'Correctness bug: the UI lies about what it searched. Fix with AbortController or a request sequence number, not with a longer debounce (a debounce narrows the window but responses can still arrive out of order).'
								},
								{ title: 'No live announcement of result changes.', body: 'Screen-reader users don\'t know the search ran.' },
								{ title: 'Filter state shown by colour only.', body: 'Users can\'t tell which filters are applied, so results look "wrong".' },
								{ title: 'Unlabelled, tiny clear button.', body: 'Minor but cheap to fix.' }
							]
						}
					]
				},
				{
					id: 'ux3',
					title: 'The delete-account dialog',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'app.northwind.example/settings/account',
								mode: 'spot',
								elements: [
									{ kind: 'nav', text: 'Northwind', items: ['Projects', 'Billing', 'Settings'] },
									{ kind: 'heading', text: 'Account settings' },
									{ kind: 'skeleton' },
									{
										kind: 'modal',
										issue: 'No close button, and Escape does nothing; Tab moves to the page behind the overlay. Keyboard users can get trapped or lost. Use a native `<dialog>` (or a proper focus trap), close on Escape, return focus to the trigger ([[focus-management]]).',
										children: [
											{ kind: 'heading', text: 'Delete account?', look: { size: 'sm' } },
											{
												kind: 'text',
												text: 'This permanently deletes the workspace "Northwind", 14 projects and all files. This can\'t be undone.',
												issue: 'It says nothing about the active paid subscription. Will billing stop? Is there a refund? Is an export possible first? The person most likely to delete is an admin cleaning up, and the next ticket is "you charged us after we deleted".'
											},
											{
												kind: 'input',
												label: 'Type the workspace name to confirm',
												placeholder: 'Northwind',
												decoy: 'Type-to-confirm looks like annoying friction, but for an irreversible action with a large blast radius it\'s appropriate: it forces the user to read *which* workspace they\'re deleting.'
											},
											{
												kind: 'row',
												children: [
													{
														kind: 'button',
														variant: 'secondary',
														text: 'Cancel',
														look: { faint: true },
														issue: 'Cancel is styled so faintly it looks disabled, nudging users toward the destructive button. It fails contrast and is a mild [[dark-pattern]]. The safe choice should look clickable.'
													},
													{
														kind: 'button',
														variant: 'danger',
														text: 'Delete account',
														issue: 'Enabled before the confirmation field matches, so the type-to-confirm safeguard is decorative; validation only happens server-side after click. Keep it disabled until the name matches.'
													}
												]
											}
										]
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Delete enabled before confirmation matches.', body: 'The safeguard doesn\'t safeguard anything.' },
								{ title: 'Billing consequence not explained.', body: 'Business and trust harm; guaranteed support escalations.' },
								{ title: 'No Escape, no close, focus escapes the modal.', body: 'Keyboard and screen-reader users.' },
								{ title: 'Faint Cancel.', body: 'Steers users to the irreversible action.' }
							]
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'Danger button on the right of Cancel is the common web/macOS order; flagging button order is the most common false positive on this screen.'
						}
					]
				},
				{
					id: 'ux4',
					title: 'Bulk actions on the orders table',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'An operations user clicked the header checkbox, then hovered the bulk bar.' },
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'admin.lumen.example/orders?page=1',
								mode: 'spot',
								elements: [
									{ kind: 'heading', text: 'Orders' },
									{
										kind: 'banner',
										tone: 'info',
										text: '✓ All 1,240 orders selected',
										issue: 'The header checkbox selected the **25 visible rows**, but the banner (and the bulk action) says **all 1,240**. The user only ever saw 25. Use the two-step pattern: "25 orders on this page selected. Select all 1,240?", and repeat the exact count on the confirm.'
									},
									{
										kind: 'row',
										children: [
											{ kind: 'button', text: 'Export CSV' },
											{ kind: 'button', text: 'Mark as shipped' },
											{
												kind: 'button',
												variant: 'danger',
												text: 'Cancel orders',
												look: { tiny: true },
												issue: 'A destructive bulk action squeezed right next to the most frequent one, same height, no gap, no confirmation stating the count. One mis-click cancels 1,240 orders. Separate it, and confirm with the number.'
											}
										]
									},
									{
										kind: 'table',
										head: ['', 'Order', 'Customer', 'Status', 'Total'],
										rows: [
											['☑', '#A7F3…9C2', 'Rao Logistics', 'Paid', '$1,204.00'],
											['☑', '#B19E…04A', 'Dana W.', 'Paid', '$86.40'],
											['☑', '#C88D…77F', 'M. Okafor', 'Refunded', '$412.10']
										],
										issue: 'Money column left-aligned in a proportional font, so $1,204.00 and $86.40 are hard to compare at a glance. Right-align numbers with [[tabular-figures|tabular figures]].'
									},
									{
										kind: 'text',
										text: '#A7F3…9C2: hover to see the full ID, click to copy',
										look: { size: 'xs' },
										decoy: 'Truncated IDs with hover and copy are fine: nobody reads a 32-character ID, but they do paste it into support tools.'
									},
									{
										kind: 'text',
										text: 'Live updates on: new orders appear at the top · Page 1 of 50',
										issue: 'Live inserts at the top of an offset-paginated list shift every row. Rows move under the cursor while selecting, and paging to page 2 skips or repeats orders. Pause live inserts while a selection exists (show "3 new orders · show"), and paginate with [[keyset-pagination|keyset pagination]].'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Selection scope mismatch (25 vs 1,240).', body: 'A bulk action on records the user never saw. Highest harm.' },
								{ title: 'Destructive bulk action next to the common one.', body: 'Mis-click risk with large blast radius.' },
								{ title: 'Live inserts + offset pages.', body: 'Silent skipped orders; wrong rows selected.' },
								{ title: 'Left-aligned money.', body: 'Readability.' }
							]
						}
					]
				},
				{
					id: 'ux5',
					title: 'Sign-up on mobile',
					tag: 'core',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'The user is still typing their email address.' },
						{
							type: 'mock',
							mock: {
								device: 'mobile',
								title: 'Create account',
								mode: 'spot',
								elements: [
									{ kind: 'heading', text: 'Create your account' },
									{
										kind: 'input',
										label: 'Full name',
										required: true,
										value: 'Dana Whitfield',
										decoy: 'Red asterisks for required fields are a widely understood convention. (Better still: mark the *optional* ones if most are required.)'
									},
									{
										kind: 'input',
										label: 'Email',
										required: true,
										value: 'dana@',
										error: 'Please enter a valid email address',
										issue: 'Validating while the user is still typing ("dana@" mid-keystroke) shouts an error at someone who hasn\'t made one. Validate on blur or submit, then re-validate live only *after* a field has been flagged.'
									},
									{
										kind: 'row',
										children: [
											{ kind: 'input', label: 'Password', value: '••••••••', look: { width: 'full' } },
											{
												kind: 'button',
												variant: 'ghost',
												text: '👁',
												look: { tiny: true },
												issue: 'Show/hide toggle has no [[accessible-name]] or state (`aria-pressed`), and its target is far below [[tap-target|44 pt]].'
											}
										]
									},
									{
										kind: 'progress',
										label: 'Strength',
										percent: 30,
										look: { color: 'red' },
										issue: 'Strength is communicated only by a red bar, and the actual rules ("12+ characters") appear only after a failed submit. Show requirements up front, as text that ticks off.'
									},
									{
										kind: 'input',
										label: 'Phone',
										placeholder: '+1 (555) 000-0000',
										hint: 'Digits only, no spaces',
										issue: 'The placeholder shows a formatted number and the hint forbids formatting. Pasting "+1 555-010-2299" from a contact card fails. Accept any common format and normalise server-side.'
									},
									{
										kind: 'checkbox',
										label: 'Send me product news and offers',
										checked: true,
										issue: 'Pre-ticked marketing consent. Under [[gdpr|GDPR]] consent must be an affirmative opt-in, so these subscribers aren\'t validly consented, and the list becomes a legal liability.'
									},
									{ kind: 'button', variant: 'primary', text: 'Create account', look: { width: 'full' } },
									{
										kind: 'link',
										text: 'Already have an account? Sign in',
										decoy: 'A sign-in link at the bottom of sign-up is expected; returning users land here from ads all the time.'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Pre-ticked marketing consent.', body: 'Legal exposure across the whole list, not just one user.' },
								{ title: 'Phone format rejection.', body: 'Silent drop-off at sign-up; often the biggest conversion leak on forms like this.' },
								{ title: 'Premature email error.', body: 'Feels hostile; raises abandonment.' },
								{ title: 'Hidden password rules + colour-only meter.', body: 'Failed submits, and inaccessible feedback.' },
								{ title: 'Unlabelled eye toggle.', body: 'Accessibility.' }
							]
						}
					]
				},
				{
					id: 'ux6',
					title: 'The KPI dashboard everyone screenshots',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'An executive dashboard. Two managers in different countries keep pasting different "last 7 days" revenue into the same thread.' },
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'insights.northwind.example/overview',
								mode: 'spot',
								elements: [
									{ kind: 'nav', text: 'Insights', items: ['Overview', 'Reports'] },
									{
										kind: 'row',
										children: [
											{ kind: 'select', value: 'Last 7 days' },
											{
												kind: 'text',
												text: 'Range: Oct 9 – Oct 15 (your device\'s time zone)',
												issue: '"Last 7 days" is computed in each viewer\'s device time zone, so a manager in Singapore and one in New York get different day boundaries and different totals for the same label. Business reporting should use the account\'s [[iana-timezone|time zone]] and say which one.'
											},
											{
												kind: 'text',
												text: 'Updated 2 min ago',
												look: { size: 'xs' },
												issue: '"Updated 2 min ago" reflects the last *attempt*; background refreshes have failed since 06:00 and the numbers are hours old. Show the time of the last *successful* load and an error state when refresh fails.'
											}
										]
									},
									{
										kind: 'row',
										children: [
											{
												kind: 'card',
												children: [
													{ kind: 'text', text: 'Revenue', look: { size: 'xs' } },
													{ kind: 'heading', text: '$48.2k' },
													{ kind: 'badge', text: '▲ 12%', tone: 'ok' }
												]
											},
											{
												kind: 'card',
												children: [
													{ kind: 'text', text: 'Refunds', look: { size: 'xs' } },
													{ kind: 'heading', text: '$3.1k' },
													{
														kind: 'badge',
														text: '▲ 40%',
														tone: 'ok',
														issue: 'Refunds up 40% shown in **green** because the component colours every "up" green. Colour must follow whether the change is good for this metric, and must not be the only signal (add "worse"/"better" or an icon).'
													}
												]
											},
											{
												kind: 'card',
												children: [
													{ kind: 'text', text: 'Active users', look: { size: 'xs' } },
													{ kind: 'heading', text: '1,204' },
													{ kind: 'text', text: 'vs 1,180 previous', look: { size: 'xs' } }
												]
											}
										]
									},
									{
										kind: 'image',
										text: 'Revenue sparkline (canvas)',
										issue: 'The chart is a canvas with no text alternative or data table, so screen-reader users get nothing, and nobody can copy the numbers.'
									},
									{
										kind: 'text',
										text: 'Y-axis: $40k – $52k',
										look: { size: 'xs' },
										decoy: 'A non-zero baseline looks like a "lying chart" rule violation, but for a line/[[sparkline|sparkline]] showing *change over time* it\'s appropriate. The zero-baseline rule is about bar charts, where length encodes value.'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Device-timezone "last 7 days".', body: 'Leadership argues over numbers that are both "right". Wrong decisions, wasted meetings.' },
								{ title: 'Stale data presented as fresh.', body: 'Decisions on hours-old numbers during an incident or a launch.' },
								{ title: 'Green for rising refunds.', body: 'Misleading at a glance, which is how dashboards are read.' },
								{ title: 'No text alternative for the chart.', body: 'Accessibility.' }
							]
						}
					]
				},
				{
					id: 'ux7',
					title: 'Mobile add-to-bag sheet',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'mock',
							mock: {
								device: 'mobile',
								title: 'Trail Runner 3',
								mode: 'spot',
								elements: [
									{
										kind: 'divider',
										decoy: 'The unlabelled grabber bar at the top of a bottom sheet is decorative; the sheet also closes via swipe and a close button. It doesn\'t need a label.'
									},
									{ kind: 'image', text: 'product photo' },
									{ kind: 'heading', text: 'Trail Runner 3', look: { size: 'sm' } },
									{ kind: 'text', text: '$120.00' },
									{
										kind: 'badge',
										text: 'Only 2 left',
										tone: 'crit',
										decoy: 'Scarcity messaging is a dark pattern *when it\'s fake*. Here it\'s driven by real inventory, and it helps a user decide not to wait. Flag it only if you can show it\'s invented.'
									},
									{
										kind: 'row',
										children: [
											{ kind: 'button', text: 'S' },
											{ kind: 'button', variant: 'primary', text: 'M' },
											{ kind: 'button', text: 'L' },
											{
												kind: 'button',
												text: 'XL',
												disabled: true,
												look: { faint: true },
												issue: 'XL is greyed out with no reason. Sold out? Not shipped to your country? Coming back? The faint text also fails contrast. Say why ("Sold out · notify me").'
											}
										]
									},
									{
										kind: 'row',
										children: [
											{
												kind: 'button',
												text: '−',
												look: { tiny: true },
												issue: 'Quantity stepper buttons are ~24 px, half the recommended [[tap-target|touch target]], and they sit next to each other.'
											},
											{
												kind: 'text',
												text: '0',
												issue: 'Quantity can reach 0 while "Add to bag" stays enabled and still shows $120. Clamp to 1 (remove is a separate action) or disable the CTA.'
											},
											{ kind: 'button', text: '+', look: { tiny: true } }
										]
									},
									{
										kind: 'button',
										variant: 'primary',
										text: 'Add to bag · $120',
										look: { width: 'full' },
										issue: 'The sticky CTA sits flush with the bottom edge, under the iOS home indicator. Taps near the bottom trigger the system swipe instead of the button. Pad by `env(safe-area-inset-bottom)` ([[safe-area-inset]]).'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'CTA under the home indicator.', body: 'The main conversion button is unreliable on modern iPhones.' },
								{ title: 'Quantity 0 with an enabled CTA.', body: 'Error states or empty-bag confusion at the most important step.' },
								{ title: 'Tiny steppers.', body: 'Mis-taps.' },
								{ title: 'Unexplained disabled size.', body: 'Lost sales (no "notify me") and contrast.' }
							]
						}
					]
				},
				{
					id: 'ux8',
					title: 'Notification settings',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{ type: 'p', text: 'Each toggle auto-saves. This user denied push permission in iOS Settings last week.' },
						{
							type: 'mock',
							mock: {
								device: 'mobile',
								title: 'Notifications',
								mode: 'spot',
								elements: [
									{ kind: 'heading', text: 'Notifications' },
									{ kind: 'checkbox', label: 'Email · Product updates', checked: true },
									{
										kind: 'checkbox',
										label: 'Email · Receipts and security alerts (required)',
										checked: true,
										disabled: true,
										decoy: 'A locked transactional toggle looks like a dark pattern but isn\'t: receipts and security alerts are part of the service, not marketing, and it\'s honestly labelled.'
									},
									{
										kind: 'checkbox',
										label: 'Push · Order status',
										checked: true,
										issue: 'Shows ON while the OS permission is denied. The user believes they\'ll be told when the order ships and won\'t be. Reflect the real state ("Off: allow in Settings") with a deep link.'
									},
									{
										kind: 'checkbox',
										label: 'SMS · Offers and promotions',
										checked: true,
										issue: 'Marketing SMS on by default. Promotional texts need prior express consent in most jurisdictions (e.g. [[tcpa|TCPA]] in the US); fines are per message.'
									},
									{ kind: 'button', variant: 'ghost', text: 'Pause all for 1 hour' },
									{
										kind: 'button',
										variant: 'danger',
										text: 'Unsubscribe from everything',
										issue: 'One tap unsubscribes from *everything*, including password-reset and security alerts it can\'t legally or safely stop. Unsubscribe-all should cover marketing only, and say so.'
									},
									{
										kind: 'toast',
										text: 'Saved',
										issue: 'The "Saved" toast appears immediately on every toggle, before the request completes, and nothing rolls back when it fails offline. The screen claims settings that the server never stored ([[optimistic-ui]] without rollback).'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Default-on marketing SMS.', body: 'Per-message legal liability.' },
								{ title: 'Push toggle ignores OS permission.', body: 'Users miss order updates they think they enabled; "I never got notified" tickets.' },
								{ title: '"Unsubscribe from everything" includes security mail.', body: 'Users stop getting reset links and fraud alerts.' },
								{ title: 'Optimistic "Saved" without confirmation.', body: 'Settings silently not persisted.' }
							]
						}
					]
				},
				{
					id: 'ux9',
					title: 'Inviting teammates',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'app.northwind.example/settings/team',
								mode: 'spot',
								elements: [
									{ kind: 'heading', text: 'Invite teammates' },
									{
										kind: 'input',
										label: 'Email addresses',
										value: 'ana@northwind.io, li@northwind.io, sam@northwnd.io',
										hint: 'Press Enter after each address',
										issue: 'Chips are only created on Enter, so a pasted comma-separated list becomes one invalid "address". Split on commas, spaces and newlines on paste, and validate each.'
									},
									{
										kind: 'select',
										label: 'Role',
										value: 'Admin',
										issue: '[[least-privilege-default|Defaults to Admin]]. Every rushed invite grants billing and deletion rights. Default to the least-privileged role.'
									},
									{ kind: 'button', variant: 'primary', text: 'Send invites' },
									{
										kind: 'toast',
										text: '✓ Invites sent to 3 people',
										issue: '"sam@northwnd.io" (typo in the domain) bounced, but the toast reports success for all three. Show per-recipient status, and catch obvious domain typos against the team\'s domain.'
									},
									{
										kind: 'table',
										head: ['Pending invite', 'Role', 'Sent', ''],
										rows: [
											['ravi@northwind.io', 'Member', '2 days ago', 'Resend · Revoke'],
											['old@contractor.dev', 'Admin', '5 months ago', 'Resend · Revoke']
										],
										issue: 'A 5-month-old **Admin** invite to a former contractor is still live: anyone with that email link can join with full rights. Invites should expire (e.g. 7 days) and stale admin invites should be flagged.'
									},
									{
										kind: 'text',
										text: '"2 days ago" shows the exact date on hover',
										look: { size: 'xs' },
										decoy: 'Relative time for recent items with the absolute date on hover is a sound pattern; nobody needs "2026-10-14 09:12:33 UTC" in a list.'
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Never-expiring admin invite.', body: 'Security exposure that outlives the contractor relationship.' },
								{ title: 'Admin as default role.', body: 'Privilege creep on every invite.' },
								{ title: 'Success toast hides a bounce.', body: 'Someone waits for an invite that never arrives.' },
								{ title: 'Paste handling.', body: 'Friction; the most common way people invite in bulk.' }
							]
						}
					]
				},
				{
					id: 'ux10',
					title: 'A German storefront, built by an English-only team',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'shop.lumen.example/de-DE/p/studio-x2',
								mode: 'spot',
								elements: [
									{ kind: 'nav', text: 'Lumen Store · DE', items: ['Warenkorb: 1 Artikel(n)'] },
									{
										kind: 'text',
										text: 'Warenkorb: 1 Artikel(n)',
										look: { size: 'xs' },
										issue: '"Artikel(n)" is a plural hack instead of real plural rules. Use `Intl.PluralRules` / [[icu-messageformat|ICU]] messages ([[i18n-pluralization]]). The same code produces "1 items" in English.'
									},
									{ kind: 'heading', text: 'Studio-Kopfhörer X2' },
									{ kind: 'text', text: '1.299,00 €' },
									{
										kind: 'text',
										text: 'Statt 1,499.00 €',
										issue: 'Mixed formats: the line above uses German separators ("1.299,00 €"), this one uses US separators with a German symbol position. Someone formatted the number with a hard-coded US locale (`price.toLocaleString("en-US", { minimumFractionDigits: 2 })`) and appended "€". Format every amount with `Intl.NumberFormat(locale, { style: "currency" })` ([[locale-formatting]]).'
									},
									{
										kind: 'text',
										text: 'inkl. MwSt., zzgl. Versand',
										look: { size: 'xs' },
										decoy: 'Small "incl. VAT, plus shipping" text looks like legal clutter, but German price-display rules require it next to the price. Removing it is the bug.'
									},
									{
										kind: 'banner',
										tone: 'info',
										text: 'Kostenloser Versand ab $50.00',
										issue: 'A free-shipping threshold in **US dollars** on a euro storefront, and the order is far above it, yet shipping is charged below. Thresholds must be configured per currency, not converted at render.'
									},
									{
										kind: 'card',
										children: [
											{ kind: 'table', head: ['', ''], rows: [['Kopfhörer', '1.299,00 €'], ['Versand', '4,99 €'], ['Gesamt', '1.299,00 €']] }
										],
										issue: 'The total (1.299,00 €) doesn\'t include the 4,99 € shipping line. Either the shipping line is wrong (free shipping applies) or the total is. A visible sum mismatch destroys trust at checkout.'
									},
									{ kind: 'button', variant: 'primary', text: 'In den Warenkorb' }
								]
							}
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{ title: 'Total ≠ sum of lines.', body: 'Trust and potential legal issue (price display rules), and support load.' },
								{ title: 'USD threshold on a EUR store.', body: 'Shipping charged incorrectly; promises broken.' },
								{ title: 'Inconsistent number formatting.', body: 'Reads as a scam to German users; "1,499.00" means something else to them.' },
								{ title: 'Plural hack.', body: 'Polish and fixable in one place with the platform API.' }
							]
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'Root cause for the two money-display bugs: amounts are rendered as hand-built strings instead of an amount plus a currency. One `formatMoney(amount, currency, locale)` helper fixes a class of bugs, not just this screen. The total mismatch is a separate pricing-logic bug.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Bugs',
			eyebrow: 'Part 2 · 35 minutes · code + symptom',
			title: 'Frontend bugs only some users hit',
			meta: 'races · hydration · input methods · caching · browser privacy',
			minutes: 35,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					title: 'The pattern',
					text: '"Only some users" in frontend almost always means a dimension you can segment by: browser, input method, language, time zone, network speed, how long the tab has been open, or whether a previous version is cached. Name the dimension first; the bug follows.'
				}
			],
			questions: [
				{
					id: 'fb1',
					title: '"Search shows the wrong results, but only if I type fast"',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `const [results, setResults] = useState<Item[]>([]);

const onInput = debounce(async (q: string) => {
  const res = await fetch(\`/api/search?q=\${encodeURIComponent(q)}\`);
  setResults(await res.json());
}, 150);`
						},
						{ type: 'p', text: 'A teammate proposes raising the [[debounce|debounce]] to 400 ms. Is that the fix?' }
					],
					answer: [
						{
							type: 'p',
							text: '**No: it\'s a [[stale-response|stale response race]].** Debounce reduces how many requests are sent, but any two that are sent can still return out of order ("headph" is cached on the server and fast; "head" hits cold shards and arrives later). Whatever resolves last wins `setResults`. A longer debounce makes it rarer and the UI slower, which is worse: the bug becomes harder to reproduce.'
						},
						{
							type: 'code',
							lang: 'typescript',
							code: `let controller: AbortController | null = null;

const onInput = debounce(async (q: string) => {
  controller?.abort();                 // cancel the previous in-flight request
  controller = new AbortController();
  try {
    const res = await fetch(\`/api/search?q=\${encodeURIComponent(q)}\`, { signal: controller.signal });
    setResults(await res.json());
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}, 150);`
						},
						{
							type: 'p',
							text: 'Alternatives: keep a request counter and ignore responses whose id isn\'t the latest; or key the result by query and render only `results[currentQuery]`. Data libraries (TanStack Query, SWR) do this by keying on the query.'
						}
					]
				},
				{
					id: 'fb2',
					title: '"I toggled it off, and it came back on by itself"',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `async function toggle(id: string) {
  const snapshot = structuredClone(state.items);      // for rollback
  state.items = state.items.map(i => i.id === id ? { ...i, on: !i.on } : i);
  try {
    await api.put(\`/items/\${id}\`, { on: state.items.find(i => i.id === id)!.on });
  } catch {
    state.items = snapshot;                          // undo on failure
    toast('Could not save');
  }
}`
						},
						{ type: 'p', text: 'Reported mostly from users on trains. The server logs show every successful PUT applied correctly.' }
					],
					hints: ['Two quick toggles on a flaky connection. Walk through which snapshot each one took.'],
					answer: [
						{
							type: 'p',
							text: '**Rollback restores a whole-list snapshot that predates later successful changes** ([[optimistic-ui]]). Toggle A (snapshot S0) and toggle B (snapshot S1, includes A) are in flight. B succeeds; A times out and restores S0, erasing B in the UI and A\'s visual state, while the server has B applied. Also, two toggles on the *same* item race on the server: whichever PUT lands last wins, regardless of click order.'
						},
						{
							type: 'list',
							items: [
								'Roll back only the failed change (flip that one item back), or re-fetch the item from the server on failure.',
								'Serialize mutations per item; drop responses older than the latest mutation for that item (sequence number).',
								'Send the intended absolute value with a version (`If-Match`/[[etag|ETag]]) so an older request can\'t overwrite a newer one.',
								'Tricky part to say out loud: the server is right; the client is lying. "Server logs look fine" is the clue.'
							]
						}
					]
				},
				{
					id: 'fb3',
					title: '"The page flickers and LCP regressed, only outside the UK"',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							caption: 'Rendered on the server (UTC) and then hydrated in the browser.',
							code: `function DueLabel({ due }: { due: string }) {
  const d = new Date(due);
  const today = new Date();
  const label = d.toDateString() === today.toDateString()
    ? 'Due today'
    : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }).format(d);
  return <span>{label}</span>;
}`
						},
						{
							type: 'p',
							text: 'RUM shows LCP up 0.9 s and CLS up for users in the US and Asia; UK (UTC+0/+1) is unaffected. Console shows "Text content did not match server-rendered HTML".'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[hydration-mismatch|Hydration mismatch]].** The server formats in UTC with the server\'s default locale; the browser formats in the user\'s zone and locale. Near midnight, or for any user far from UTC, "Due today" vs "Thu 16" differ. React discards the server HTML for that subtree and re-renders on the client: extra main-thread work (LCP) and visible text swaps (CLS). UK users match the server most of the time, so they never see it.'
						},
						{
							type: 'list',
							items: [
								'Render with an explicit zone and locale on both sides: the account\'s [[iana-timezone]] passed from server to client (cookie or profile), `Intl.DateTimeFormat(locale, { timeZone })`.',
								'Or render a stable value server-side (absolute date) and switch to the relative label after mount, in a reserved-width element.',
								'Not the fix: `suppressHydrationWarning` everywhere. It hides the warning and keeps the wrong text.'
							]
						}
					]
				},
				{
					id: 'fb4',
					title: '"Japanese customers can\'t search; the login button is broken in Chrome"',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `// search box
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSearch(input.value);
});

// login form
const [filled, setFilled] = useState({ email: false, password: false });
<input name="email" onChange={() => setFilled(f => ({ ...f, email: true }))} />
<input name="password" type="password" onChange={() => setFilled(f => ({ ...f, password: true }))} />
<button disabled={!filled.email || !filled.password}>Sign in</button>`
						},
						{
							type: 'p',
							text: 'Two tickets the same week: Japanese users say search "submits half-typed words"; others say Sign in is greyed out even though their password manager filled both fields.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Search: [[ime-composition|IME composition]].** Japanese users press Enter to *confirm a kanji candidate*, not to submit. `keydown` Enter fires during composition, so the half-converted text is searched. Check `e.isComposing` (and `keyCode 229` for older Safari), or submit on `compositionend` + Enter.'
						},
						{
							type: 'p',
							text: '**Login: [[autofill-events|autofill doesn\'t reliably fire `onChange`]]**, especially before the user has interacted with the page (Chrome may not expose the filled value until a [[user-gesture|user gesture]]). The button\'s enabled state is a tally of events instead of the actual values. Don\'t disable submit based on events; read `form.elements` on submit and validate then.'
						},
						{
							type: 'callout',
							tone: 'info',
							text: 'Common thread: the code assumes "one keystroke = one final character" and "every value change fires an event". Neither holds for IMEs, autofill, voice input, or paste.'
						}
					]
				},
				{
					id: 'fb5',
					title: 'ChunkLoadError spikes after every deploy',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								title: 'frontend-errors',
								query: 'error.type:ChunkLoadError',
								total: '6,914 hits · last 24h',
								histogram: { x: swX, counts: chunkErr },
								lines: [
									{ ts: '05:14:02.118', level: 'ERROR', source: 'web', msg: 'ChunkLoadError: Loading chunk 812 failed. (missing: /assets/settings.4f2a1c.js)', fields: { release: 'web@2026.10.15-1', sw_controlled: true, tab_age_min: 410 } },
									{ ts: '05:14:09.551', level: 'ERROR', source: 'web', msg: 'ChunkLoadError: Loading chunk 812 failed. (missing: /assets/settings.4f2a1c.js)', fields: { release: 'web@2026.10.15-1', sw_controlled: true, tab_age_min: 2 } },
									{ ts: '05:15:40.007', level: 'ERROR', source: 'web', msg: 'ChunkLoadError: Loading chunk 377 failed. (missing: /assets/reports.91bd02.js)', fields: { release: 'web@2026.10.15-1', sw_controlled: true, tab_age_min: 1 } },
									{ ts: '17:03:11.420', level: 'ERROR', source: 'web', msg: 'ChunkLoadError: Loading chunk 812 failed. (missing: /assets/settings.a90e33.js)', fields: { release: 'web@2026.10.15-2', sw_controlled: true, tab_age_min: 0 } }
								]
							}
						},
						{
							type: 'p',
							text: 'Deploys at 05:00 and 17:00. The CDN team says purges complete in under 60 s. Note `tab_age_min: 1` and `2`: these are *fresh* page loads.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**A [[service-worker|service worker]] is serving the old `index.html` from its cache**, which references the previous build\'s hashed chunks; the deploy deleted them from the origin. Long-lived tabs explain some errors, but `tab_age_min: 1` with `sw_controlled: true` is the tell: a *new* page load got old HTML from the worker. The CDN purge is a red herring; the stale copy is in the browser.'
						},
						{
							type: 'list',
							items: [
								'Serve the HTML shell network-first (or never cache it in the SW); cache only immutable hashed assets.',
								'Keep the previous one or two builds\' assets on the origin for a few days (deploys add, cleanup removes later).',
								'On ChunkLoadError, reload once (guard against loops with a session flag), or prompt "A new version is available".',
								'Call `registration.update()` on navigation and use `skipWaiting` + `clients.claim` deliberately, knowing it swaps code under open tabs.'
							]
						}
					]
				},
				{
					id: 'fb6',
					title: '"Conversions dropped 35% overnight"',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Priya Nair',
								role: 'Growth Marketing',
								time: 'Thu 09:40',
								body: 'Our ad platform shows conversions down ~35% since yesterday evening. Did checkout break?? Paid campaigns are optimising on this number and spend is already shifting. Can someone look urgently?'
							}
						},
						{
							type: 'p',
							text: 'Orders in the database are flat. Security shipped a "harden headers" change yesterday at 18:00. No JS errors in the error tracker.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The new [[content-security-policy|Content Security Policy]] is enforcing and blocks the [[tag-manager|tag manager]]\'s inline snippet and the ad pixel\'s domain.** Checkout works (orders flat), but the [[conversion-pixel|conversion pixel]] never fires. Your error tracker shows nothing because CSP violations aren\'t JS exceptions; they appear as console messages and `securitypolicyviolation` events nobody collects.'
						},
						{
							type: 'list',
							items: [
								'Confirm: browser console on the thank-you page ("Refused to load the script…"), and CSP violation reports if a `report-to` endpoint exists.',
								'Mitigate: add the pixel and tag-manager origins (or a nonce for the inline snippet) to the policy, or temporarily switch to `Content-Security-Policy-Report-Only`.',
								'Prevent: CSP changes ship report-only first, with violation reports flowing to a dashboard, then enforce.',
								'Also tell marketing to pause [[automated-bidding|automated bidding]] adjustments: the ad platform is "learning" from fake data.'
							]
						},
						reply(
							'Priya',
							"Checkout is fine: real orders are normal. A security change last night stopped our pages from loading the ad platform's tracking script, so it stopped counting conversions. We're fixing it this morning. Until then the ad platform's numbers are low by about a third; if your campaigns auto-adjust bids, pause that so it doesn't cut spend on campaigns that are actually working."
						)
					]
				},
				{
					id: 'fb7',
					title: 'Login loop inside a partner\'s portal, Safari only',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Your scheduling widget is embedded in a partner\'s site via `<iframe src="https://app.yourco.example/embed">`. Users sign in inside the iframe, see "Welcome", then the next click shows the login screen again. Chrome works. Safari and Firefox (strict) loop forever. Server logs show successful logins and `Set-Cookie: session=…; SameSite=None; Secure; HttpOnly`.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Third-party cookie blocking.** Inside the partner\'s page, your domain is third-party. `SameSite=None; Secure` is necessary but no longer sufficient: Safari (ITP) and Firefox strict mode block third-party cookies outright, so the session cookie is set and immediately not sent ([[samesite-cookie]]). The tempting guesses (clock skew on JWT expiry, Safari caching) don\'t explain "works in Chrome every time".'
						},
						{
							type: 'list',
							items: [
								'Use the [[third-party-cookie-blocking|Storage Access API]] (`document.requestStorageAccess()` after a user gesture), or',
								'Open authentication in a top-level popup/window and pass a short-lived token to the iframe, kept in memory (not a cookie), or',
								'Serve the embed from a subdomain of the partner (first-party) via [[cname-record|CNAME]], or use partitioned cookies (CHIPS: `Partitioned`) where supported.',
								'Don\'t treat "works in Chrome" as safe: Google dropped its default-blocking plan, but Chrome users can still block third-party cookies (Incognito does by default), so design for the blocked case.'
							]
						}
					]
				},
				{
					id: 'fb8',
					title: '"After I close any popup I end up at the top of the page"',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Marcus Lee',
								role: 'Customer (uses a screen reader)',
								subject: 'Edit dialog makes me lose my place',
								body: "Every time I edit a row in the invoices list and close the edit window, I'm sent back to the very top of the page and have to tab through 80 links to get back to where I was. With 200 invoices this takes me all afternoon."
							}
						},
						{
							type: 'code',
							lang: 'typescript',
							code: `function EditInvoice({ id, onClose }) {
  return createPortal(
    <div className="modal" role="dialog">
      <InvoiceForm id={id} />
      <button onClick={onClose}>Close</button>
    </div>,
    document.body
  );
}`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**No [[focus-management|focus restoration]].** When the dialog unmounts, the focused element (the Close button) disappears, so the browser drops focus to `<body>` and the next Tab starts from the top. Sighted mouse users never notice; this user loses minutes per row.'
						},
						{
							type: 'list',
							items: [
								'Store `document.activeElement` when opening and call `.focus()` on it after closing (or use native `<dialog>` + `showModal()`).',
								'While open: move focus into the dialog, trap Tab, close on Escape, `aria-modal="true"` and `aria-labelledby` the dialog title.',
								'Test with a keyboard and a screen reader; automated a11y checkers can\'t detect this.'
							]
						},
						reply(
							'Marcus',
							'Thank you for the detail; it pointed us straight at the problem. When the edit window closes we weren\'t returning you to the row you came from. We\'re fixing it so closing the window puts you back on that same invoice, and we\'re checking our other pop-up windows for the same issue. I\'ll write as soon as it\'s live.'
						)
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Vitals',
			eyebrow: 'Part 3 · 20 minutes · dashboards',
			title: 'Web Vitals that lie a little',
			meta: 'LCP · INP · CLS · field data by segment',
			minutes: 20,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					text: 'Field data (real users, [[rum|RUM]]) at p75, split by device and route, beats any lab score. The first job is always: *which segment moved?* Then: what is that metric actually timing? [[lcp|LCP]] is discovery + download + render of one element; [[inp|INP]] is main-thread time after input; [[cls|CLS]] is late layout changes.'
				}
			],
			questions: [
				{
					id: 'v1',
					title: 'LCP jumped on product pages after the carousel release',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'RUM · product page',
								range: 'Sep 01 – Sep 28',
								filters: ['route:/p/*', 'p75'],
								panels: [
									{
										kind: 'timeseries',
										title: 'LCP p75 by device class',
										unit: ' s',
										span: 6,
										x: d28,
										series: [
											{ name: 'desktop', points: lcpDesktop },
											{ name: 'mobile high-end', points: lcpHigh },
											{ name: 'mobile low-end', points: lcpLow }
										],
										markers: [{ at: 14, label: 'carousel v2' }],
										thresholds: [{ value: 2.5, tone: 'warn', label: '2.5 s' }]
									},
									{ kind: 'timeseries', title: 'TTFB p75', unit: ' s', span: 2, x: d28, series: [{ name: 'ttfb', points: ttfb }], yMin: 0, yMax: 1 },
									{ kind: 'timeseries', title: 'JS transferred (KB)', span: 2, x: d28, series: [{ name: 'js', points: jsKb, color: 2 }], yMin: 0, markers: [{ at: 14, label: '+12 KB' }] },
									{ kind: 'timeseries', title: 'LCP image bytes (KB)', span: 2, x: d28, series: [{ name: 'img', points: imgKb, color: 4 }], yMin: 0 },
									{
										kind: 'timeseries',
										title: 'LCP sub-part: resource load delay p75',
										subtitle: 'time from TTFB until the browser starts fetching the LCP image',
										unit: ' s',
										span: 4,
										x: d28,
										series: [{ name: 'load delay', points: loadDelay, color: 3 }]
									},
									{ kind: 'stat', title: 'LCP element', value: 'img.hero', delta: 'unchanged since Aug', span: 2 }
								]
							}
						},
						{ type: 'p', text: 'The carousel team says "we only added 12 KB of JS, it can\'t be us". What happened, and what\'s the fix?' }
					],
					answer: [
						{
							type: 'p',
							text: '**The hero image is now discovered late.** [[ttfb|TTFB]] is flat (not the server), image bytes are flat (not a bigger image), JS grew only 12 KB (red herring: parse cost of 12 KB doesn\'t add 1.8 s). The panel that moved is **resource load delay: 0.15 s → 1.9 s**: the browser starts fetching the hero almost 2 s later. Carousel v2 renders slides from JS after hydration and marks images `loading="lazy"`, including the first slide. The preload scanner can\'t see an image that doesn\'t exist in the HTML. (All figures here are [[rum|RUM]] field data at [[percentiles|p75]].)'
						},
						{
							type: 'p',
							text: 'Why low-end mobile most: the time until the JS runs and creates the `<img>` scales with CPU speed, and lazy-load waits for layout too.'
						},
						{
							type: 'list',
							items: [
								'Server-render the first slide as a real `<img>` with `fetchpriority="high"` and no `loading="lazy"`; lazy-load only slides 2+.',
								'Or `<link rel="preload" as="image" imagesrcset=…>` in the head.',
								'Add a CI check: the [[lcp|LCP]] element must be in the initial HTML and not lazy.'
							]
						}
					]
				},
				{
					id: 'v2',
					title: 'INP is 600 ms on the orders page, the API is fast',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'RUM · /orders interactions',
								range: 'last 24h',
								panels: [
									{
										kind: 'timeseries',
										title: 'INP p75 by interaction target',
										unit: ' ms',
										span: 4,
										x: h24,
										series: [
											{ name: 'input#filter (keypress)', points: inpFilter },
											{ name: 'all other targets', points: inpOther }
										],
										thresholds: [{ value: 200, tone: 'warn', label: 'good ≤ 200 ms' }]
									},
									{ kind: 'stat', title: 'Rows rendered', value: '2,000', delta: 'no pagination', span: 2 },
									{ kind: 'timeseries', title: 'GET /api/orders?filter p95', unit: ' ms', span: 3, x: h24, series: [{ name: 'api', points: apiP95, color: 2 }], yMin: 0 },
									{ kind: 'timeseries', title: 'Long tasks per page view', span: 3, x: h24, series: [{ name: 'long tasks', points: longTasks, color: 3 }], yMin: 0 }
								]
							}
						},
						{
							type: 'code',
							lang: 'typescript',
							code: `const [q, setQ] = useState('');
const visible = orders
  .filter(o => matches(o, q))           // 2,000 rows, regex per row
  .sort(byDateDesc);
return <>
  <input id="filter" value={q} onChange={e => setQ(e.target.value)} />
  <OrdersTable rows={visible} />          {/* renders all 2,000 rows */}
</>;`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[main-thread|Main-thread]] blocking on every keystroke.** INP ends at the next paint after input; each key synchronously filters, sorts and re-renders 2,000 rows before the browser can paint the typed character. The API p95 (180 ms) is a red herring: [[inp|INP]] doesn\'t wait for network, and this filter runs client-side anyway.'
						},
						{
							type: 'list',
							items: [
								'Keep the input responsive: `useDeferredValue(q)` / `startTransition` for the filtered list, so typing paints first.',
								'[[list-virtualization|Virtualize]] the table (render ~40 visible rows, not 2,000).',
								'Memoize: sort once when data changes, not per keystroke; precompile the matcher.',
								'Debouncing the *render* helps, but debouncing a fetch wouldn\'t; there\'s no fetch on this path.'
							]
						}
					]
				},
				{
					id: 'v3',
					title: 'CLS on checkout jumped 4x, only in Europe',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'RUM · /checkout',
								range: 'Sep 01 – Sep 28',
								panels: [
									{
										kind: 'timeseries',
										title: 'CLS p75 by region',
										span: 4,
										x: d28,
										series: [
											{ name: 'EU', points: clsEu },
											{ name: 'US', points: clsUs },
											{ name: 'APAC', points: clsApac }
										],
										markers: [{ at: 10, label: 'consent v3 + brand font' }],
										thresholds: [{ value: 0.1, tone: 'warn', label: '0.1' }]
									},
									{ kind: 'timeseries', title: 'Ad slot revenue index', span: 2, x: d28, series: [{ name: 'ads', points: adRevenue, color: 5 }] },
									{
										kind: 'table',
										title: 'Top layout-shift sources (EU, p75 session)',
										span: 6,
										head: ['Element', 'Shift score', 'When'],
										numeric: [1],
										rows: [
											['div#consent-banner (inserted at top)', '0.19', '~1.4 s after load'],
											['h1, .price (font swap)', '0.06', '~0.9 s after load'],
											['button.place-order', '0.02', 'moved by the above']
										],
										highlight: [0]
									}
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The consent banner (shown only to EU visitors) is inserted at the top of the page after load and pushes everything down** (a [[cls|layout shift]]), including the Place Order button, so users mis-tap. The font swap adds a smaller second shift on top. Ads are a red herring: there are no ads on checkout, and the ad index didn\'t move.'
						},
						{
							type: 'list',
							items: [
								'Render the banner as an overlay fixed to the bottom of the viewport (no layout shift), or reserve its space server-side for EU traffic.',
								'Fonts: `font-display: optional` or a fallback font with `size-adjust`/`ascent-override` matched to the brand font so the swap doesn\'t move text.',
								'Why it matters beyond the score: a shift on checkout causes clicks on the wrong thing (e.g. "Apply coupon" instead of "Place order").'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Experiments',
			eyebrow: 'Part 4 · 20 minutes · dashboards + judgment',
			title: 'Experiments and analytics',
			meta: 'peeking · novelty · Simpson · instrumentation',
			minutes: 20,
			intro: [
				{
					type: 'callout',
					tone: 'info',
					text: 'Before reading any result: check the split ([[sample-ratio-mismatch|SRM]]), check the segment mix, check that the metric\'s events didn\'t change shape. Most "surprising" experiment results are measurement problems.'
				}
			],
			questions: [
				{
					id: 'e1',
					title: '"It was significant on day 5, so we shipped it"',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'Experiment: one-page checkout',
								range: 'days 1–28 (kept running in holdout)',
								panels: [
									{ kind: 'timeseries', title: 'Cumulative p-value', span: 3, x: d28, yMin: 0, yMax: 1, series: [{ name: 'p', points: pval }], thresholds: [{ value: 0.05, tone: 'crit', label: '0.05' }], markers: [{ at: 4, label: 'shipped' }] },
									{ kind: 'timeseries', title: 'Observed lift in conversion (%)', unit: '%', span: 3, x: d28, series: [{ name: 'lift', points: liftCum, color: 2 }], markers: [{ at: 4, label: 'shipped' }] },
									{ kind: 'stat', title: 'Planned sample size', value: '120k / arm', delta: 'reached on day 21', span: 2 },
									{ kind: 'stat', title: 'Times dashboard checked', value: '23', span: 2 },
									{ kind: 'stat', title: 'Split', value: '50.1 / 49.9', delta: 'SRM check passes', span: 2 }
								]
							}
						},
						{ type: 'p', text: 'The PM asks why the revenue forecast built on "+6.5%" hasn\'t shown up.' }
					],
					answer: [
						{
							type: 'p',
							text: '**[[peeking|Peeking]].** The team checked 23 times and stopped the first time p dipped below 0.05 (day 5), at a fraction of the planned sample. Early lifts are noisy and big; by the planned sample size (day 21) the lift has shrunk to ~2.5% (and keeps sliding toward ~1%) and p ≈ 0.5. The "+6.5%" was mostly noise. The split is fine (SRM passes), so the randomization isn\'t the problem; the stopping rule is.'
						},
						{
							type: 'list',
							items: [
								'Fix the sample size in advance from the minimum effect you care about, and only decide at that point; or use a sequential test (e.g. always-valid [[statistical-significance|p-values]]) built for repeated looks.',
								'Report confidence intervals, not just p: on day 5 the interval was something like −1% to +14%.',
								'For the PM: the change is probably neutral, not harmful. Keep it if it\'s simpler, but drop the forecast.'
							]
						}
					]
				},
				{
					id: 'e2',
					title: 'The redesign that won big and then didn\'t',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'Nav redesign · clicks on "Reports" per user',
								range: '6 weeks',
								panels: [
									{
										kind: 'bars',
										title: 'Lift vs control (%) · returning users',
										unit: '%',
										span: 3,
										x: weeks,
										series: [{ name: 'returning', points: [18, 11, 6, 3, 2, 1] }]
									},
									{
										kind: 'bars',
										title: 'Lift vs control (%) · new users',
										unit: '%',
										span: 3,
										x: weeks,
										series: [{ name: 'new', points: [1, 2, 1, 2, 1, 2], color: 2 }]
									},
									{ kind: 'stat', title: 'Report exports per user', value: '+0.4%', delta: 'n.s. across all 6 weeks', span: 3 },
									{ kind: 'stat', title: 'Support tickets "can\'t find…"', value: '−3%', delta: 'n.s.', span: 3 }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[novelty-effect|Novelty effect]].** Returning users click the new thing because it\'s new: an 18% lift decaying to ~1% over six weeks. New users, to whom nothing is new, never showed a lift. And the outcome that matters (exports, i.e. getting the report) never moved. The first-week number measured curiosity, not usefulness.'
						},
						{
							type: 'list',
							items: [
								'Judge on new users, or on the stable tail after the curve flattens.',
								'Pick an outcome metric (task completed) over an engagement proxy (clicks).',
								'The reverse also exists: change aversion makes a better design look worse in week 1 for returning users.'
							]
						}
					]
				},
				{
					id: 'e3',
					title: 'B loses on every channel and wins overall',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'table',
							head: ['Traffic source', 'A visitors', 'A conv.', 'B visitors', 'B conv.'],
							numeric: [1, 2, 3, 4],
							rows: [
								['Email (returning customers)', '3,000', '12.0%', '9,000', '11.4%'],
								['Paid social (cold traffic)', '9,000', '1.5%', '3,000', '1.3%'],
								['**Total**', '12,000', '**4.1%**', '12,000', '**8.9%**']
							]
						},
						{ type: 'p', text: 'The growth lead wants to ship B: "+117% conversion!". What do you say?' }
					],
					answer: [
						{
							type: 'p',
							text: '**[[simpsons-paradox|Simpson\'s paradox]], and a broken experiment.** B is worse in both segments; it "wins" in total only because B received 75% of its traffic from email (high-converting) while A got mostly cold paid traffic. Overall totals are equal (12,000 each), so a top-level [[sample-ratio-mismatch|SRM]] check passes, but the *segment* mix is wildly different. In a randomized test that shouldn\'t happen.'
						},
						{
							type: 'list',
							items: [
								'Don\'t ship on this data. Find out why assignment correlates with source: e.g. B was enabled via a campaign link, or email traffic hit a cached page that always served B.',
								'Check SRM per segment, not just overall.',
								'If you must read it now: compare within segments (B is ~5–13% worse), never the pooled number.'
							]
						}
					]
				},
				{
					id: 'e4',
					title: 'The funnel step that fell off a cliff on Tuesday',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'Checkout funnel · hourly',
								range: 'Mon – Wed',
								panels: [
									{
										kind: 'timeseries',
										title: 'Event: checkout_payment_added (parsed)',
										span: 6,
										x: fx,
										series: [{ name: 'payment_added', points: payParsed }],
										markers: [{ at: 34, label: 'web release 4.12' }]
									},
									{
										kind: 'timeseries',
										title: 'Orders created (backend)',
										span: 3,
										x: fx,
										series: [{ name: 'orders', points: ordersHour, color: 2 }]
									},
									{
										kind: 'timeseries',
										title: 'Raw events by platform',
										span: 3,
										x: fx,
										stacked: true,
										series: [
											{ name: 'web · payment_added', points: payWeb },
											{ name: 'web · paymentAdded', points: payWebNew, color: 3 },
											{ name: 'ios · payment_added', points: payIos, color: 2 }
										]
									}
								]
							}
						},
						{ type: 'p', text: 'Product wants to roll back the new payment form in release 4.12.' }
					],
					answer: [
						{
							type: 'p',
							text: '**[[analytics-schema-drift|Analytics schema drift]], not a user drop.** Backend orders are unchanged. Release 4.12 renamed the web event from `checkout_payment_added` to `paymentAdded`; the pipeline only parses the old name, so the web share (~62%) vanished from the funnel. The raw-events panel shows the web volume continuing under the new name.'
						},
						{
							type: 'list',
							items: [
								'Don\'t roll back the form; map the new event name in the pipeline and backfill the gap.',
								'Prevent: a tracking plan with typed event schemas (shared package across web/iOS/Android), and CI that fails on unknown or renamed events.',
								'Alert on the *ratio* between a funnel step and the backend truth (orders) rather than on raw counts.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · Copy & flows',
			eyebrow: 'Part 5 · 15 minutes · written',
			title: 'Copy, states and flows',
			meta: 'errors · undo · empty vs failed · i18n',
			minutes: 15,
			questions: [
				{
					id: 'c1',
					title: 'Rewrite this error message',
					tag: 'core',
					minutes: 3,
					prompt: [
						{
							type: 'mock',
							mock: {
								device: 'mobile',
								title: 'Send money',
								mode: 'view',
								elements: [
									{ kind: 'heading', text: 'Send €2,400 to Aiko Tanaka' },
									{ kind: 'banner', tone: 'crit', text: 'Error 500: An unexpected error occurred. Please try again later.' },
									{ kind: 'button', variant: 'primary', text: 'Try again', look: { width: 'full' } }
								]
							}
						},
						{
							type: 'p',
							text: 'The backend actually returned `422 DAILY_LIMIT_EXCEEDED` (limit €2,000, resets at midnight in the user\'s zone; can be raised in Settings after [[kyc|ID check]]). The client maps every non-2xx to this banner.'
						}
					],
					answer: [
						{
							type: 'code',
							lang: 'text',
							code: `This transfer is over your daily limit
You can send up to €2,000 per day. You've sent €0 today.

• Send €2,000 now and the rest after midnight, or
• Raise your limit in Settings (takes about 5 minutes with ID)

[Send €2,000 now]   [Raise my limit]

No money has left your account.`
						},
						{
							type: 'list',
							items: [
								'Say what happened in the user\'s terms, and whether money moved. That\'s the first fear in any payment error.',
								'Give the next actions as buttons, not advice. "Try again" here guarantees the same failure.',
								'Engineering fix behind the copy: stop collapsing errors into a generic 500 banner. Map typed error codes to messages; a 422 is not "unexpected".'
							]
						}
					]
				},
				{
					id: 'c2',
					title: 'Undo that lies',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'p',
							text: 'Deleting a file shows a toast "File deleted · Undo" for 8 seconds. Users report that Undo sometimes says "Something went wrong" and the file is gone. The client calls `DELETE /files/:id` immediately; Undo calls `POST /files/:id/restore`. The storage service hard-deletes objects in a background job that runs every 5 seconds.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The undo window (8 s) is longer than the server\'s recoverability window (0–5 s).** Whether Undo works depends on where the cleanup job happens to be in its cycle: a race the user can\'t see. [[confirm-vs-undo|Undo]] is only honest if the system can really reverse the action for the whole time the button is shown.'
						},
						{
							type: 'list',
							items: [
								'Soft delete: mark `deleted_at`, hide it, and hard-delete after a retention period (e.g. 30 days, which also gives a "Recently deleted" view).',
								'Or delay the request: keep the delete client-side until the toast expires (risky if the tab closes, so pair with a server-side delayed job).',
								'The undo window shown in the UI must come from the server\'s guarantee, not a hard-coded toast duration.',
								'Bulk deletes or deleting shared content probably warrant a confirm *and* a recoverable soft delete.'
							]
						}
					]
				},
				{
					id: 'c3',
					title: '"All my projects are gone!"',
					tag: 'core',
					minutes: 4,
					prompt: [
						{
							type: 'mock',
							mock: {
								device: 'desktop',
								url: 'app.northwind.example/projects',
								mode: 'view',
								elements: [
									{ kind: 'heading', text: 'Projects' },
									{ kind: 'image', text: 'friendly empty-box illustration' },
									{ kind: 'text', text: 'No projects yet. Create your first project to get started!', look: { align: 'center' } },
									{ kind: 'button', variant: 'primary', text: '+ New project' }
								]
							}
						},
						{
							type: 'p',
							text: 'Support gets panicked tickets every time the projects API times out. The frontend renders the list as `data?.projects ?? []`.'
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Failure renders as the empty state.** `data?.projects ?? []` turns "request failed" into "you have zero projects", and the copy even invites users to start over. [[empty-state|Loading, empty and error]] are three different states with different messages and actions.'
						},
						{
							type: 'table',
							head: ['State', 'What to show', 'Primary action'],
							rows: [
								['Loading', 'Skeleton rows (after ~200 ms, to avoid a flash)', 'none'],
								['Empty (request succeeded, 0 items)', '"No projects yet"', 'Create project'],
								['Empty because of filters', '"No projects match \'Q3\' in Archived"', 'Clear filters'],
								['Error', '"We couldn\'t load your projects. Your data is safe."', 'Retry (and status page link)']
							]
						},
						{ type: 'p', text: 'Root cause in code: a [[nullish-coalescing|nullish]] default hiding an error, a cousin of the [[swallowed-exception]].' }
					]
				},
				{
					id: 'c4',
					title: 'Shipping to Germany, Poland and Saudi Arabia',
					tag: 'tricky',
					minutes: 4,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `const label = \`\${n} file\${n === 1 ? '' : 's'} selected\`;
<button style={{ width: 120 }}>{t('account_settings')}</button>   // "Kontoeinstellungen"
<span className="icon-chevron-right" />                        // "next" in the stepper
<span style={{ marginLeft: 8 }}>{t('price')}</span>`
						},
						{ type: 'p', text: 'List every bug for de-DE, pl-PL and ar-SA and the fix for each.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Plurals.',
									body: 'Polish has distinct forms for 1, 2–4, 5–21, 22–24… ("1 plik", "2 pliki", "5 plików"); Arabic has six categories. Use `Intl.PluralRules` / [[icu-messageformat|ICU MessageFormat]] with every form supplied by translators ([[i18n-pluralization]]). Also: never concatenate translated fragments; word order differs.'
								},
								{
									title: 'Fixed-width button.',
									body: '"Kontoeinstellungen" won\'t fit in 120 px ([[text-expansion]]). Size to content with min/max widths and allow wrapping; test with pseudo-localization (padded, accented strings).'
								},
								{
									title: 'Direction-specific icon and margin.',
									body: 'In Arabic the layout mirrors ([[rtl]]): "next" points left. Use logical CSS (`margin-inline-start`) and an icon that flips under `dir="rtl"`. Don\'t flip everything: numbers, clocks and media controls stay.'
								}
							]
						}
					]
				}
			]
		},

		// ───────────────────────── TEASERS ─────────────────────────
		{
			id: 'teasers',
			nav: 'Rapid fire',
			eyebrow: 'Rapid fire · 1–2 min each',
			title: 'Rapid fire',
			questions: [
				{
					id: 'r1',
					title: 'Disable the submit button until the form is valid?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Usually no. A disabled button can\'t be focused or explain itself; users don\'t know *what* is missing, and [[autofill-events|autofill]] can leave it stuck disabled. Keep it enabled, validate on submit, focus the first invalid field and explain. Exception: preventing duplicate submits *after* a click.'
						}
					]
				},
				{
					id: 'r2',
					title: '`<div onClick={save}>Save</div>`: what\'s missing?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Everything a `<button>` gives for free: keyboard focus, Enter/Space activation, the button role, disabled semantics, form submission. Adding `role="button"` alone fixes the announcement, not the keyboard. Use a `<button>`.'
						}
					]
				},
				{
					id: 'r3',
					title: 'The skeleton flashes for 80 ms on every navigation. Problem?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Yes. A sub-200 ms flash reads as flicker and makes the app feel *slower*. Delay showing loading UI by ~150–300 ms, and once shown, keep it for a minimum (~300 ms) so it doesn\'t strobe.'
						}
					]
				},
				{
					id: 'r4',
					title: '`*:focus { outline: none }` in the reset stylesheet',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Keyboard users can\'t see where they are. If designers dislike rings on mouse click, use `:focus-visible` to show them only for keyboard focus; never remove them outright.'
						}
					]
				},
				{
					id: 'r5',
					title: 'A confetti animation on "Order placed" ignores user settings',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'Respect `prefers-reduced-motion: reduce` ([[reduced-motion]]): replace large motion with a static success state or a gentle fade. Celebration is fine; vestibular triggers aren\'t.'
						}
					]
				},
				{
					id: 'r6',
					title: '"Are you sure?" before deleting 3,000 contacts: enough?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'No. Generic confirmations get clicked through by habit. State the consequence with the number ("Delete 3,000 contacts, including 412 with open deals?"), make it recoverable (soft delete / restore), and require typed confirmation only for the truly irreversible, high-blast-radius cases.'
						}
					]
				}
			]
		}
	]
};

export default assessment;
