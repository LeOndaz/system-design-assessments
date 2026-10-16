import type { Part } from '../../types';
import { shape, step, ramp, bump, timeAxis } from '../../series';

const x = timeAxis('06:00', 48, 15);

export const payments: Part = {
	id: 'p1',
	nav: '1 · Payments',
	eyebrow: 'Part 1 · 35 minutes · payments in flight',
	title: 'Money that is neither here nor there',
	meta: 'auth · capture · reversal · 3DS · webhooks · disputes',
	minutes: 35,
	intro: [
		{
			type: 'flow',
			steps: [
				{ label: 'Checkout', note: '[[payment-intent|payment intent]] created' },
				{ label: 'Orchestrator', note: 'idempotency key, routing' },
				{ label: 'PSP', note: 'acquirer gateway' },
				{ label: 'Card network', note: 'routes to [[issuer-acquirer|issuer]]' },
				{ label: 'Issuer', note: 'approves, places hold' },
				{ label: 'Capture → settlement', note: 'T+1…T+3, netted payout', tone: 'info' }
			],
			caption:
				'An [[auth-and-capture|authorization]] reserves money; a capture claims it; [[settlement]] moves it days later. Every arrow can time out, and a [[timeout]] on any of them is an *unknown outcome*.'
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'The rule that answers half of this part',
			text: 'Every payment bug in a distributed system is one of three things: an attempt you think failed that succeeded, an attempt you think succeeded that failed, or one attempt you counted twice. Before ranking hypotheses, ask which of the three the symptom is.'
		}
	],
	questions: [
		{
			id: 'f1',
			title: '"Two pending charges, one order"',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'support',
						from: 'Priya Natarajan',
						role: 'Customer Support · Tier 2',
						subject: 'Customers see double charges after "card declined"',
						time: 'Tue 10:42',
						body: `We've had 31 tickets since 09:00 with the same story. The customer pays, gets "Your card was declined, please try again", presses Pay again, it works, and they get the confirmation email. Then their banking app shows TWO pending charges for the same amount.

Our admin panel shows one order, one successful payment. The first attempt shows as "declined". Finance says we only received the money once.

Are we charging people twice or is this the bank's problem? Can I tell them the extra one will disappear?`
					}
				},
				{
					type: 'logs',
					logs: {
						style: 'kibana',
						title: 'payment-orchestrator',
						query: 'order_id:"ord_88213"',
						total: '6 hits',
						lines: [
							{ ts: '09:14:02.118', level: 'INFO', source: 'orchestrator', msg: 'auth request sent', fields: { attempt: 'att_1', idem_key: 'click-6f1a', amount: '84.20 USD', psp: 'psp-a' } },
							{ ts: '09:14:10.120', level: 'WARN', source: 'orchestrator', msg: 'psp timeout after 8000ms', fields: { attempt: 'att_1' } },
							{ ts: '09:14:10.121', level: 'INFO', source: 'orchestrator', msg: 'attempt failed → card_declined returned to client', fields: { attempt: 'att_1' } },
							{ ts: '09:14:19.507', level: 'INFO', source: 'orchestrator', msg: 'auth request sent', fields: { attempt: 'att_2', idem_key: 'click-93bd', amount: '84.20 USD', psp: 'psp-a' } },
							{ ts: '09:14:20.311', level: 'INFO', source: 'orchestrator', msg: 'auth approved', fields: { attempt: 'att_2', auth_code: '448120' } },
							{ ts: '09:14:21.044', level: 'INFO', source: 'webhook', msg: 'event payment.authorized ignored: attempt already final', fields: { attempt: 'att_1', psp_status: 'authorized', received: '09:14:21' } }
						]
					}
				}
			],
			hints: ['Read the last log line slowly. What did PSP-A actually do with att_1?', 'Who generates the idempotency key, and how often?'],
			answer: [
				{
					type: 'p',
					text: 'The tempting reading is "the bank shows a temporary duplicate, it will drop off". Half true and the wrong conclusion: **we placed two real authorizations**. The bank is right; our system is wrong.'
				},
				{
					type: 'ranked',
					items: [
						{
							title: 'A timeout was translated into a decline.',
							body: 'att_1 timed out at 8 s; the orchestrator told the customer "declined". PSP-A approved it anyway and said so at 09:14:21, and the [[webhook|webhook]] handler ignored the news because the attempt was already "final". A timeout is an unknown outcome, never a decline.',
							confirm: 'For every attempt marked failed after a timeout today, query PSP-A by attempt id. Count how many are actually `authorized`.'
						},
						{
							title: 'The idempotency key is per click, not per payment.',
							body: '`click-6f1a` and `click-93bd`: a fresh [[idempotency-key]] on each Pay press means the PSP correctly treats the retry as a new payment. The key must belong to the payment intent (one per checkout), so a second press re-asks "what happened to this payment?" instead of creating another.',
							confirm: 'Grep the client: where is `idem_key` generated? If it is in the button handler, that is it.'
						},
						{
							title: 'The orphaned authorization is never reversed.',
							body: 'att_1 will never be captured, so the hold sits on the card until it expires (often ~7 days). Nothing sends an [[auth-reversal]].'
						}
					]
				},
				{
					type: 'p',
					text: '**Mitigate now:** stop mapping timeouts to `card_declined`: return "we\'re confirming your payment" and poll. Run a script that finds today\'s timed-out attempts that PSP-A authorized and sends reversals (the holds disappear in hours, not days). **Fix properly:** key per payment intent; a `pending_unknown` state that only the PSP\'s answer can resolve; webhooks may move an attempt out of `pending_unknown` but never get ignored silently; an alert on "authorized at PSP, failed locally".'
				},
				{
					type: 'ticket',
					ticket: {
						channel: 'slack',
						from: 'You',
						role: 'Payments engineering',
						body: `Priya, you're right to flag this, and it's on us, not the bank. When our payment provider was slow this morning, we told some customers their card was declined when it had actually been approved. When they paid again, their bank kept a hold for the first attempt too.

They were only charged once: the first hold will never turn into a charge. We're cancelling those holds now, so they should disappear from banking apps within a day (some banks take up to 3).

Suggested reply: "You haven't been charged twice. The second amount is a temporary hold from a payment attempt we cancelled; it will disappear from your bank within 1–3 days without you doing anything." I'll post the list of affected orders in this thread by 14:00.`
					}
				}
			]
		},
		{
			id: 'f2',
			title: 'Paid at the bank, "failed" in our system',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'Since adding iDEAL and [[sepa-direct-debit]] plus 3DS2, about 0.8% of payments marked **failed** later show up as money received in the PSP [[settlement|settlement report]]. Customers were charged; no order exists; the inventory was released. Webhook delivery success is 99.97%.'
				},
				{
					type: 'code',
					lang: 'python',
					code: `TERMINAL_OK = {"succeeded"}

def poll_pending():                      # cron, every minute
    for p in payments.where(status="pending"):
        remote = psp.payments.get(p.psp_id).status
        if remote in TERMINAL_OK:
            mark_paid(p)
        elif now() - p.created_at > timedelta(minutes=10):
            mark_failed(p)               # sets status="failed"
            release_inventory(p.order_id)

@app.post("/webhooks/psp")
def on_webhook(evt):
    p = payments.get(psp_id=evt.payment_id)
    if p.status in ("paid", "failed"):   # terminal: ignore
        return 200
    if evt.type == "payment.succeeded":
        mark_paid(p)
    return 200`
				}
			],
			answer: [
				{
					type: 'p',
					text: 'The obvious guess, "webhooks are being lost", is ruled out by the 99.97%. The webhooks arrive; **we throw them away**.'
				},
				{
					type: 'ranked',
					items: [
						{
							title: 'The poller converts "still in progress" into "failed".',
							body: 'Anything that is not `succeeded` after 10 minutes is failed. But `processing` (SEPA debits take days to confirm), `requires_action` (a 3DS challenge the buyer is completing on their phone) and bank-redirect methods are all legitimately non-final for longer than 10 minutes.',
							confirm: 'Group the 0.8% by payment method and by the PSP status at the moment we marked them failed. Expect `processing` / `requires_action`, not `failed`/`canceled`.'
						},
						{
							title: 'A local "terminal" state blocks the truth from arriving.',
							body: 'Once locally failed, the later `payment.succeeded` webhook is ignored. "Failed" was our guess, not the PSP\'s answer, so it must not be terminal. A [[state-machine]] should only treat states as final when they came from the source of truth.'
						},
						{
							title: 'Failing has side effects that are hard to undo.',
							body: 'Inventory was released, so even after you fix the state, some of those orders cannot be fulfilled.'
						}
					]
				},
				{
					type: 'p',
					text: '**Fix:** map PSP statuses explicitly (`succeeded` → paid; `failed`/`canceled` → failed; everything else → keep waiting, with per-method timeouts measured in days for debits); "expired" only via an explicit PSP cancel call that you confirm; webhooks and polling both feed one idempotent transition function. **[[data-remediation|Remediation]]:** list payments failed locally but succeeded at the PSP, and for each either fulfil (stock permitting) or refund, and tell the customer which. Webhooks and polling are both needed: webhooks for speed, polling (or the settlement report) for completeness.'
				}
			]
		},
		{
			id: 'f3',
			title: 'Customers come back from 3DS logged out with an empty cart',
			tag: 'tricky',
			minutes: 4,
			prompt: [
				{
					type: 'list',
					items: [
						'Since Monday\'s security hardening release, ~22% of [[three-ds|3DS]] challenges end with the buyer on the login page and an empty cart. Some of them pay again; a few end up with two orders.',
						'The 3DS provider\'s dashboard shows challenges completing normally.',
						'Release notes: "session cookie: `SameSite=Strict`, `Secure`, `HttpOnly`".',
						'The issuer\'s challenge page returns the buyer with an HTTP **POST** to `/checkout/3ds/return`.'
					]
				}
			],
			answer: [
				{
					type: 'p',
					text: '**`SameSite=Strict` drops the session cookie on the cross-site return.** The return arrives from the issuer\'s domain. Strict cookies are never sent on cross-site requests, and Lax cookies are only sent on top-level GET navigations, so a cross-site POST arrives with no session: logged out, cart (stored in session) gone. The ~78% that work are frictionless flows or app-based challenges that never left the page. The tempting guess, "the 3DS provider is broken", is contradicted by its own dashboard.'
				},
				{
					type: 'p',
					text: '**Fix:** do not depend on the browser session for the return leg. Put the payment intent id in the return URL (or POST body), verify its signature/state server-side, look up the intent, and resume. Keep `SameSite=Strict` ([[samesite-cookie|SameSite]]) for the session if you want it; add a separate short-lived, single-purpose cookie only if the flow truly needs one. The duplicate orders come from the same idempotency mistake as the previous question: the retry must resume the existing intent.'
				}
			]
		},
		{
			id: 'f4',
			title: 'The second parcel will not charge',
			tag: 'core',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'Order of three items, **$300.00** [[auth-and-capture|authorized]] on **Oct 1**. Items ship separately and you capture per shipment:'
				},
				{
					type: 'table',
					head: ['Shipment', 'Date', 'Item', 'Capture', 'Result'],
					numeric: [3],
					rows: [
						['1', 'Oct 2', 'Pan set', '120.00', 'succeeded'],
						['2', 'Oct 9', 'Kettle (backordered)', '100.00', '`charge_already_captured`'],
						['3', 'Oct 9', 'Knife set', '80.00', '`charge_already_captured`']
					]
				},
				{ type: 'p', text: 'The ops lead says the customer\'s card "must have run out of money". What actually happened, and would fixing the first cause be enough?' }
			],
			answer: [
				{
					type: 'ranked',
					items: [
						{
							title: 'Single-capture semantics.',
							body: 'Most PSPs allow one capture per authorization unless [[multicapture]] is explicitly enabled; capturing $120 of a $300 auth releases the other $180. The error code says exactly that; "insufficient funds" would be a different code.',
							confirm: 'Check the account\'s multicapture setting and the auth\'s `amount_capturable` after the first capture (it will be 0).'
						},
						{
							title: 'Even with multicapture, Oct 9 is too late.',
							body: 'An [[auth-expiry|authorization]] is only guaranteed for a limited window, often about 7 days for online card payments. Oct 1 → Oct 9 is 8 days. Turning on multicapture alone would turn this error into an expired-authorization decline or a downgraded fee tier.'
						}
					]
				},
				{
					type: 'p',
					text: '**Fix:** enable multicapture and mark non-final captures as such; for items shipping after the validity window, either re-authorize (as a [[merchant-initiated-transaction|merchant-initiated transaction]] on stored credentials) or authorize per shipment. Release what you will never capture with an [[auth-reversal]] so the customer\'s funds are not frozen. Model it in the order: an authorization has an expiry timestamp, and the fulfilment planner must see it.'
				}
			]
		},
		{
			id: 'f5',
			title: 'The ledger shows the sale twice',
			tag: 'tricky',
			minutes: 5,
			prompt: [
				{
					type: 'p',
					text: 'Finance found 214 sales booked twice in the ledger this month, all during periods when the orchestrator failed over between PSPs. The handler below is called both from the synchronous capture response and from the PSP webhook.'
				},
				{
					type: 'code',
					lang: 'python',
					code: `def on_capture_succeeded(capture):
    if ledger.exists(external_id=capture.psp_charge_id):
        return                                    # already booked
    ledger.post_entries(
        external_id=capture.psp_charge_id,
        lines=[("dr", "psp_receivable", capture.amount),
               ("cr", "revenue",        capture.amount)],
    )`
				}
			],
			answer: [
				{
					type: 'p',
					text: 'Two independent bugs, and fixing only the first leaves the 214.'
				},
				{
					type: 'ranked',
					items: [
						{
							title: 'Check-then-insert [[race-condition|race]].',
							body: 'The sync response and the webhook often arrive within milliseconds; both run `exists`, both see nothing, both post. That explains duplicates in general, not their clustering around failovers.'
						},
						{
							title: 'The dedupe key is the PSP\'s id, but the duplicate crosses PSPs.',
							body: 'On failover the orchestrator retries a timed-out PSP-A attempt on PSP-B. If PSP-A had in fact captured, there are now two real captures with two different `psp_charge_id`s; the ledger correctly books both. The ledger isn\'t double-counting a payment; the business really captured twice. That is why they cluster at failovers.',
							confirm: 'Join the 214 pairs on our payment intent id: expect one capture at each PSP.'
						}
					]
				},
				{
					type: 'p',
					text: '**Fix:** ledger idempotency on *our* identifiers: a unique constraint on `(payment_intent_id, entry_type, sequence)` and `INSERT … ON CONFLICT DO NOTHING` (an [[upsert|upsert]]) inside the same transaction as the entries (no check-then-act). In the orchestrator, never re-drive a timed-out attempt on another PSP until the first PSP has answered "not captured" (see the lab in Part 5). **Remediation:** the second capture at each pair is real money taken twice: refund it, then post the refund to the ledger, rather than deleting the "duplicate" entries, which would hide a customer overcharge.'
				}
			]
		},
		{
			id: 'f6',
			title: 'We "improved" retries and approvals dropped',
			tag: 'tricky',
			minutes: 6,
			prompt: [
				{
					type: 'p',
					text: 'At 10:00 the team shipped "smart retries": on a [[soft-decline|soft decline]] the orchestrator retries the same card up to twice within 3 seconds. The goal was +1.5 points of approval rate.'
				},
				{
					type: 'dashboard',
					dashboard: {
						style: 'grafana',
						title: 'card authorizations',
						range: '06:00 – 18:00 UTC',
						filters: ['env=prod', 'region=eu'],
						panels: [
							{
								kind: 'timeseries',
								title: 'Approval rate by issuer',
								unit: '%',
								x,
								yMin: 60,
								yMax: 100,
								markers: [{ at: 16, label: 'smart retries' }],
								series: [
									{ name: 'Issuer A', points: shape(48, { base: 92, noise: 0.008, seed: 11, round: 1 }) },
									{ name: 'Issuer B', points: shape(48, { base: 90.5, noise: 0.008, seed: 12, round: 1 }) },
									{ name: 'Issuer C', points: shape(48, { base: 91, noise: 0.008, seed: 13, round: 1 }, ramp(16, 22, 91, 74)) },
									{ name: 'Issuer D', points: shape(48, { base: 89, noise: 0.008, seed: 14, round: 1 }, ramp(16, 22, 89, 86.5)) }
								],
								span: 4
							},
							{ kind: 'stat', title: 'Checkout conversion vs last week', value: '−3.1%', tone: 'crit', span: 2 },
							{
								kind: 'timeseries',
								title: 'Authorization attempts per order',
								x,
								markers: [{ at: 16, label: 'smart retries' }],
								series: [{ name: 'attempts/order', points: shape(48, { base: 1.03, noise: 0.01, seed: 15, round: 2 }, step(16, 1.31)) }],
								span: 2
							},
							{
								kind: 'bars',
								title: 'Issuer C declines by code (% of attempts)',
								unit: '%',
								x,
								stacked: true,
								series: [
									{ name: 'do_not_honor', points: shape(48, { base: 4, noise: 0.1, seed: 16, round: 1 }, step(16, 9)) },
									{ name: 'insufficient_funds', points: shape(48, { base: 3, noise: 0.1, seed: 17, round: 1 }) },
									{ name: 'suspected_fraud', points: shape(48, { base: 0.4, noise: 0.2, seed: 18, round: 1 }, ramp(17, 24, 0.4, 9)) }
								],
								span: 2
							},
							{
								kind: 'timeseries',
								title: 'PSP auth latency p95',
								unit: 'ms',
								x,
								series: [{ name: 'p95', points: shape(48, { base: 390, noise: 0.04, seed: 19 }, bump(26, 33, 70)) }],
								span: 2
							}
						]
					}
				},
				{ type: 'p', text: 'Which panel is the red herring, what is happening at Issuer C, and why did conversion fall even at issuers whose approval rate barely moved?' }
			],
			answer: [
				{
					type: 'p',
					text: '**Red herring:** PSP latency. Its bump is 12:30–14:15, two hours after the change, and small (+70 ms on 390).'
				},
				{
					type: 'ranked',
					items: [
						{
							title: 'Issuer C reads the rapid retries as [[card-testing|card testing]].',
							body: 'Attempts per order jump from 1.03 to 1.31 exactly at the marker. Issuer C\'s `do_not_honor` doubles immediately (retries of soft declines decline again), and then `suspected_fraud` climbs from ~0.4% to ~9% over the next 90 minutes as its risk models learn the pattern: identical amount, same card, three attempts in three seconds. Now *first* attempts from good customers are declined too. Approval falls 91% → 74%.',
							confirm: 'Approval rate of **first** attempts only at Issuer C, before vs after 10:00. If first attempts fell, the retries poisoned the merchant\'s reputation at that issuer, not just their own outcome.'
						},
						{
							title: 'Conversion fell because the denominator changed shape.',
							body: 'Retries add latency (up to 3 s more at the moment of paying) and more "declined" screens; Issuer D dipped too. Approval rate per *attempt* hides this: what matters is approval per *order*.'
						}
					]
				},
				{
					type: 'p',
					text: '**Mitigate:** turn smart retries off now; Issuer C\'s risk scoring will take hours to days to recover. **Fix properly:** retry only codes the [[card-network|scheme rules]] allow, with spacing (hours, not seconds) and caps per card per period; never retry hard declines; measure approval per order and per first attempt; roll out per issuer with a [[holdout-group|holdout]]. The deeper lesson: issuers, not your code, decide whether a retry is "smart".'
				}
			]
		},
		{
			id: 'f7',
			title: '"We send tracking numbers and still lose every dispute"',
			tag: 'core',
			minutes: 4,
			prompt: [
				{
					type: 'ticket',
					ticket: {
						channel: 'email',
						from: 'Marco Bellini',
						role: 'Head of Customer Operations',
						subject: 'Chargebacks: something is broken',
						time: 'Thu 16:05',
						body: `Since we automated dispute responses in August we've lost 94% of chargebacks, up from about 40% when Joana did them by hand. The automation attaches the tracking number and delivery photo for every dispute, which is MORE evidence than Joana used to send.

Are the banks just siding with customers now? Should we stop fighting disputes under €50?`
					}
				},
				{
					type: 'code',
					lang: 'python',
					code: `def respond_to_dispute(d):
    evidence = {
        "shipping_tracking_number": d.order.tracking,
        "shipping_documentation": upload(d.order.delivery_photo),
        "customer_communication": upload(d.order.email_thread),
    }
    psp.disputes.update(d.psp_dispute_id, evidence=evidence)
    d.mark("responded")`
				},
				{
					type: 'table',
					head: ['Outcome (Aug–Oct)', 'Disputes'],
					numeric: [1],
					rows: [
						['won', '19'],
						['lost: reason "no response by deadline"', '268'],
						['lost: reason "insufficient evidence"', '31']
					]
				}
			],
			answer: [
				{
					type: 'p',
					text: 'The obvious story, "banks side with customers", is contradicted by the table: 268 of 299 lost [[chargeback|chargebacks]] say **no response**. The evidence is uploaded but never submitted. Many PSP dispute APIs stage evidence on `update` and only send it to the issuer when you submit (a `submit: true` flag or a separate submit call); the manual process clicked "Submit" in the dashboard. Our code marks the dispute "responded", so nobody looks again until the deadline passes and [[representment]] is lost automatically.'
				},
				{
					type: 'p',
					text: '**Fix:** submit explicitly, then confirm by reading the dispute back (status `under_review`, `evidence_details.submission_count ≥ 1`) before marking it responded; alert on disputes within 3 days of `evidence_due_by` that are not under review. **Remediation:** most of those disputes are past their deadline and gone; the ones still open can be submitted today. Don\'t stop fighting sub-€50 disputes on the basis of this data; it measures a bug, not the banks.'
				}
			]
		}
	]
};
