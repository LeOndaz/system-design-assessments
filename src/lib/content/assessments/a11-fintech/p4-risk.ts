import type { Part } from '../../types';
import { shape, step, timeAxis, dayAxis } from '../../series';

const x = timeAxis('13:00', 60, 1);
const d = dayAxis('Sep 21', 21);

export const risk: Part = {
	id: 'p4',
	nav: '4 · Risk',
	eyebrow: 'Part 4 · 35 minutes · risk & compliance at scale',
	title: 'Saying no correctly',
	meta: 'fraud latency · velocity · sanctions · KYC · audit · PCI',
	minutes: 35,
	intro: [
		{
			type: 'callout',
			tone: 'warn',
			title: 'Severity first',
			text: 'In this part, some symptoms are regulatory incidents (sanctioned payee paid, card numbers in logs, unverified users withdrawing) and some are revenue problems. Say which is which before you rank causes: a compliance breach gets escalated and contained even while you are still debugging. See [[severity-triage]].'
		}
	],
	questions: [
		{
			id: 'k1',
			title: 'Approvals dropped 2.8 points after a better fraud model',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'Fraud model v7 ([[auc|AUC]] up from 0.91 to 0.94 offline) shipped at 13:20. The authorization path calls the fraud service with a 150 ms budget. ~40 authorizations/s.'
				},
				{
					type: 'dashboard',
					dashboard: {
						style: 'datadog',
						title: 'checkout · risk',
						range: '13:00 – 13:59',
						panels: [
							{
								kind: 'timeseries',
								title: 'fraud-score latency',
								unit: 'ms',
								x,
								markers: [{ at: 20, label: 'model v7' }],
								thresholds: [{ value: 150, label: 'client timeout', tone: 'crit' }],
								series: [
									{ name: 'p50', points: shape(60, { base: 38, noise: 0.06, seed: 51 }, step(20, 41)) },
									{ name: 'p99', points: shape(60, { base: 92, noise: 0.06, seed: 52 }, step(20, 205)) }
								],
								span: 3
							},
							{
								kind: 'timeseries',
								title: 'Approval rate',
								unit: '%',
								x,
								yMin: 85,
								yMax: 95,
								series: [{ name: 'approved', points: shape(60, { base: 93, noise: 0.002, seed: 53, round: 1 }, step(20, 90.2)) }],
								span: 3
							},
							{
								kind: 'timeseries',
								title: 'Decisions by source /s',
								x,
								stacked: true,
								series: [
									{ name: 'model: decline', points: shape(60, { base: 1.6, noise: 0.1, seed: 54, round: 2 }, step(20, 1.45)) },
									{ name: 'fallback rule: decline (timeout)', points: shape(60, { base: 0.02, noise: 0.3, seed: 55, round: 2 }, step(20, 1.2)) }
								],
								span: 3
							},
							{
								kind: 'timeseries',
								title: 'Card network auth p95',
								unit: 'ms',
								x,
								series: [{ name: 'p95', points: shape(60, { base: 380, noise: 0.04, seed: 56 }) }],
								span: 2
							},
							{ kind: 'stat', title: 'Confirmed fraud rate (7-day trailing)', value: '0.11%', delta: 'unchanged', span: 1 }
						]
					}
				},
				{ type: 'code', lang: 'python', caption: 'Auth path', code: `try:\n    score = fraud.score(txn, timeout=0.150)\nexcept Timeout:\n    return decline("risk_unavailable")      # fail closed\nreturn approve_or_decline(score)` }
			],
			answer: [
				{
					type: 'p',
					text: 'The model is doing its job: model declines actually *fell* slightly (1.6 → 1.45/s). The new declines are **timeouts converted into declines**. p50 barely moved (38 → 41 ms) but p99 crossed the 150 ms budget, so ~3% of calls time out; the code [[fail-open-closed|fails closed]], declining about 1.2 good customers per second: 3% of 93% ≈ the 2.8-point drop. Roughly 4,300 good orders an hour.'
				},
				{
					type: 'ranked',
					items: [
						{ title: 'Mitigate:', body: 'roll back to v6 (or raise the budget to cover v7\'s p99) while the fallback policy is fixed.' },
						{
							title: 'Fix the fallback, not just the model:',
							body: 'a timeout should fall back to a cheap rules score (or v6 cached), with fail-open for low amounts and known customers, fail-closed only for high-risk segments; mark fallback approvals for post-authorization review.'
						},
						{
							title: 'Fix the tail:',
							body: 'find what v7 added on the slow path (often a new feature fetched synchronously from a cold store), precompute it, or send [[hedged-requests]] at p95.'
						},
						{ title: 'Ship models with latency gates.', body: 'Offline AUC said nothing about p99; a shadow deployment would have shown the timeout rate before customers did.' }
					]
				}
			]
		},
		{
			id: 'k2',
			title: 'The velocity limit is 5. The attacker got 30.',
			tag: 'tricky',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'Rule: max **5 authorization attempts per card number per 10 minutes**. It is enforced with [[rate-limiting|fixed 10-minute windows]] (`floor(now / 600)`) in Redis, separately in each of 3 regions (EU, US, APAC), because a global counter added ~80 ms. During a [[card-testing|card testing]] attack, one card saw 30 attempts in under 2 minutes, all within policy according to the logs.'
				},
				{ type: 'list', items: ['How did 30 attempts pass?', 'What is the worst case per 10 minutes as configured?', 'Fix it without adding 80 ms to every authorization.'] }
			],
			answer: [
				{
					type: 'p',
					text: 'Two multipliers. **Fixed windows** reset at the boundary: 5 attempts at 09:59:5x and 5 more at 10:00:0x is 10 in a few seconds. **Per-region counters** multiply by the number of regions: the attacker\'s bots are spread across all three. 5 × 2 × 3 = **30** in a burst around a window boundary, and the logs are right that each regional counter stayed ≤ 5. Worst case over any 10 minutes: 30 at the boundary.'
				},
				{
					type: 'ranked',
					items: [
						{ title: 'Use a [[sliding-window]] (or token bucket).', body: 'Removes the ×2 boundary burst.' },
						{
							title: 'Give each card a home region.',
							body: 'Pin each card\'s counter to one region chosen from where its legitimate traffic comes from (issuing country, or the region it was first seen in), not a random hash. A cardholder\'s normal authorizations arrive there and stay local. Only requests arriving in another region pay a cross-region hop, and card-testing traffic, spread across regions, is exactly what gets forwarded to that single counter.'
						},
						{
							title: 'Or lease quota.',
							body: 'Each region holds a share of the limit and refills from a global allocator asynchronously ([[quota-leasing]]); bounded overshoot, no synchronous global call.'
						},
						{ title: 'Add a network-level rule.', body: 'Card testing is many cards from few devices/IPs/BIN ranges; a per-card limit alone never catches the attack shape.' }
					]
				}
			]
		},
		{
			id: 'k3',
			title: 'Payouts held for days: "screening is too strict"',
			tag: 'core',
			minutes: 6,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'email',
						from: 'Amira Haddad',
						role: 'Chief Compliance Officer',
						subject: 'Sanctions alert backlog: decision needed',
						time: 'Fri 09:10',
						body: `Since we enabled the vendor's new transliteration rules on Sept 28, sanctions screening alerts went from about 200 a day to about 1,200 a day. My six analysts clear roughly 1,050 a day and payouts to flagged merchants are on hold until cleared, so the backlog grows daily and merchants are complaining.

Engineering proposed raising the match threshold from 85 to 92 to "get back to normal". I need to understand what that does to our actual risk before I sign off. We have had two true hits in the last 12 months.`
					}
				},
				{
					type: 'dashboard',
					dashboard: {
						style: 'kibana',
						title: 'sanctions screening',
						range: 'Sep 21 – Oct 11',
						panels: [
							{
								kind: 'bars',
								title: 'Alerts per day',
								x: d,
								markers: [{ at: 7, label: 'transliteration on' }],
								series: [{ name: 'alerts', points: shape(21, { base: 200, noise: 0.08, seed: 61 }, step(7, 1200)) }],
								span: 3
							},
							{
								kind: 'timeseries',
								title: 'Open alert backlog',
								x: d,
								series: [{ name: 'open', points: shape(21, { base: 30, noise: 0.1, seed: 62 }, (i, v) => (i < 7 ? v : v + (i - 6) * 150)) }],
								span: 3
							}
						]
					}
				}
			],
			answer: [
				{
					type: 'p',
					text: 'First the [[base-rate-fallacy|base rate]]. The ticket does not give payout volume, so assume something like ~40,000 payouts a day go through [[sanctions-screening|sanctions screening]]: 200 alerts/day ≈ 0.5% flagged; 1,200 ≈ 3%. The conclusion does not depend on that number. With about 2 true hits a *year*, essentially **every alert is a false positive** before and after: precision was already ~0.003% and is now ~0.0005%. Capacity: 6 analysts clear 1,050/day against 1,200 arriving → backlog grows ~150/day, as the chart shows.'
				},
				{
					type: 'p',
					text: '**Why not just raise the threshold:** transliteration rules exist because sanctioned names arrive spelled differently (Mohammed / Muhammad / Mokhammed). A threshold tuned on the old matcher interacts unpredictably with the new one, and the cost of one missed true hit (a sanctions breach) is not comparable to analyst hours. The question to answer is not "how many alerts" but "what is our [[recall-precision|recall]] on known-hit test names at 92?"; nobody has measured that.'
				},
				{
					type: 'ranked',
					items: [
						{ title: 'Measure recall.', body: 'Run a labelled test set (list names with realistic variants, plus known false positives) through both thresholds. Sign off with numbers.' },
						{ title: 'Auto-clear on secondary attributes.', body: 'A name match with a mismatched date of birth, nationality and registration country can be auto-dispositioned with audit trail; that removes most alerts without touching name recall.' },
						{ title: 'Remember decisions.', body: 'A cleared match for the same payee and same list entry should not re-alert on every payout; re-screen only when the payee data or the list changes.' },
						{ title: 'Unblock by risk.', body: 'Hold only the payouts whose alert is unresolved and above a risk tier; release the rest with post-review, if your regulator accepts it, which is the CCO\'s call.' }
					]
				},
				{
					type: 'p',
					text: 'Reply to the CCO in her terms: "Raising the threshold would cut alerts, but we cannot yet tell you how many true matches it would miss. By Wednesday we will give you measured recall at 85 and 92 and a proposal to auto-clear alerts where date of birth and country clearly differ, which we estimate removes most of the volume without changing name matching."'
				}
			]
		},
		{
			id: 'k4',
			title: 'Rejected users are "verified" again',
			tag: 'tricky',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'Compliance found 37 users that manual review had **rejected** for forged documents who are now `verified` and withdrew funds. The [[kyc]] vendor auto-approves first, then a human may overturn the decision. [[webhook|Webhooks]] are retried with backoff for up to 72 hours.'
				},
				{
					type: 'code',
					lang: 'typescript',
					code: `const STATUS = {
  "verification.approved": "verified",
  "verification.rejected": "rejected",
  "document.expired": "needs_reverification",
} as const;

export async function onVendorEvent(e: VendorEvent) {
  const user = await users.get(e.userId);
  user.kycStatus = STATUS[e.type];
  await users.save(user);
}`
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Severity first: unverified people moved money. Freeze withdrawals for the 37, notify compliance (this may be reportable), then debug.'
				},
				{
					type: 'p',
					text: 'Cause: **last write wins on [[out-of-order-delivery|out-of-order]] webhooks.** The auto-approval webhook failed delivery (our endpoint was slow, or deploying), the manual rejection arrived and was applied, then the retried approval arrived hours later and overwrote it. The handler has no notion of order or of allowed transitions.'
				},
				{
					type: 'p',
					text: '**Fix:** a [[state-machine]] with allowed transitions (`rejected` is terminal for that verification case; only a *new* case can verify); compare the vendor\'s event timestamp/sequence per case and ignore older events; better, treat the webhook as a notification and fetch the case\'s current decision from the vendor API before transitioning. Require positive verification at withdrawal time, not just a stored flag, and audit-log every status change with its source event.'
				}
			]
		},
		{
			id: 'k5',
			title: 'The audit log "has been tampered with"',
			tag: 'tricky',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'The nightly verifier of the [[hash-chain-audit|hash-chained audit log]] failed at id 1,884,201. Security opened an incident for possible tampering. No one has write access beyond the application role. The insert path and the rows around the break:'
				},
				{
					type: 'code',
					lang: 'python',
					code: `def append(event):
    prev = db.scalar("SELECT hash FROM audit ORDER BY id DESC LIMIT 1")
    h = sha256(prev + canonical_json(event))
    db.execute("INSERT INTO audit (prev_hash, hash, body) VALUES (%s, %s, %s)", prev, h, event)`
				},
				{
					type: 'table',
					head: ['id', 'prev_hash', 'hash', 'created_at'],
					rows: [
						['1,884,199', '…9c1e', '**…a07f**', '10:14:03.112'],
						['1,884,200', '**…a07f**', '…44d2', '10:14:03.118'],
						['1,884,201', '**…a07f**', '…e8b5', '10:14:03.119'],
						['1,884,202', '…e8b5', '…1f30', '10:14:03.140']
					]
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Rows 200 and 201 both chain from `…a07f`: two concurrent writers read the same latest hash 1 ms apart and both appended. The chain **forked**; row 202 continued from 201, so 200 hangs off the side. That is a [[race-condition]], not tampering: tampering would show a row whose stored hash does not equal the hash of its own contents, which you should verify for every row before closing the incident.'
				},
				{
					type: 'p',
					text: 'Treat it as security until proven otherwise (preserve the table, verify content hashes, check DB audit logs), then fix: a single serialized writer per chain (an [[advisory-lock|advisory lock]] around read-prev + insert, or a single appender service), or one chain per partition with a Merkle root over partitions per minute; periodically anchor the latest root somewhere you do not control (a timestamping service or a different account\'s WORM storage). Verification should walk by `prev_hash` links and report forks distinctly from content mismatches.'
				}
			]
		},
		{
			id: 'k6',
			title: 'The auditor found card numbers in our logs',
			tag: 'core',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'Web checkout uses the PSP\'s hosted card fields ([[card-tokenization|tokenized]]), so the team believed the backend was out of [[pci-dss|PCI]] scope. The auditor\'s sample from the log platform:'
				},
				{
					type: 'logs',
					logs: {
						style: 'kibana',
						title: 'api-gateway',
						query: 'status:422 AND path:"/v1/payments"',
						total: '1,212 hits (90 days)',
						lines: [
							{
								ts: 'Oct 02 18:41:07',
								level: 'WARN',
								source: 'api',
								msg: 'validation failed: request body {"card":{"number":"4111 1111 1111 1111","exp":"12/28","cvc":"***"},"amount":2599}',
								fields: { ua: 'ShopApp/5.2.0 iOS', path: '/v1/payments', route_owner: 'legacy-mobile' }
							},
							{
								ts: 'Oct 02 18:43:55',
								level: 'WARN',
								source: 'api',
								msg: 'validation failed: request body {"card":{"number":"5555 5555 5555 4444","exp":"01/27","cvc":"***"},"amount":1450}',
								fields: { ua: 'ShopApp/5.2.0 Android', path: '/v1/payments', route_owner: 'legacy-mobile' }
							}
						]
					}
				}
			],
			answer: [
				{
					type: 'p',
					text: 'The obvious suspect is the web integration; the logs say **mobile**. ShopApp 5.2.0 (iOS and Android; check the full 1,212 hits for older versions too) still posts raw card numbers to a legacy `/v1/payments` route, and a validation middleware logs request bodies on 4xx (it masks `cvc` by field name, not card numbers). So the API, the log pipeline, the log vendor and anything with access to them are in scope, and have been for as long as that route existed.'
				},
				{
					type: 'ranked',
					items: [
						{ title: 'Contain:', body: 'stop body logging now; delete affected log data from the platform, its indexes, archives and backups, and ask the log vendor to purge.' },
						{ title: 'Close the path:', body: 'force-upgrade old app versions to the SDK that tokenizes on device; keep the route returning an error that never echoes or logs the body; then remove it.' },
						{ title: 'Detect:', body: 'a [[pan|PAN]] detector (digit runs passing the Luhn check) in the log pipeline that redacts and alerts, because the next leak will come from a path you also believe is dead.' },
						{ title: 'Report:', body: 'this is a reportable finding for the PCI assessment; the scope reduction claim was wrong and the remediation evidence is what the auditor needs.' }
					]
				}
			]
		}
	]
};
