import type { Assessment, Block, CodeDiff, Question, QuestionTag } from '../types';

// ───────────────────────── builder ─────────────────────────

/** A review question: the prompt is the PR (review mode); the answer is the model review. */
function pr(
	id: string,
	group: string,
	title: string,
	minutes: number,
	diff: CodeDiff,
	answer: Block[],
	opts: { tag?: QuestionTag; intro?: string; hints?: string[] } = {}
): Question {
	return {
		id,
		group,
		title,
		tag: opts.tag ?? 'tricky',
		minutes,
		prompt: [
			{ type: 'p', text: opts.intro ?? 'Review this pull request. Click every line you would leave a comment on, then submit your review.' },
			{ type: 'diff', diff }
		],
		hints: opts.hints,
		answerLabel: 'Show model review',
		answer
	};
}

// ═════════════════════════ PART 1 · Backend PRs ═════════════════════════

const b1 = pr(
	'b1-capture-retry',
	'Backend PRs',
	'"Retry captures when the provider flakes"',
	9,
	{
		title: 'Retry payment capture on transient provider errors',
		author: 'dana',
		description:
			'The payment provider has been returning sporadic 502s and timeouts during peak. Ops has been re-running failed captures by hand. This wraps `capture()` in a retry loop so we self-heal. Tested by pointing the client at a stub that fails twice then succeeds.',
		files: [
			{
				path: 'billing/capture.py',
				lang: 'python',
				oldStart: 1,
				newStart: 1,
				patch: `
 import logging
 import time
+
+import requests

 from billing.provider import client
 from billing.models import Order

 log = logging.getLogger(__name__)

+MAX_ATTEMPTS = 3
+

 def capture(order: Order) -> str:
-    resp = client.post("/captures", json={"auth_id": order.auth_id, "amount": order.total_cents})
-    resp.raise_for_status()
-    return resp.json()["capture_id"]
+    payload = {"auth_id": order.auth_id, "amount": order.total_cents}
+    deadline = time.monotonic() + 20
+    for attempt in range(MAX_ATTEMPTS):
+        try:
+            resp = client.post("/captures", json=payload, timeout=5)
+            resp.raise_for_status()
+            return resp.json()["capture_id"]
+        except Exception as exc:
+            log.warning("capture failed attempt=%s headers=%s err=%s", attempt, client.headers, exc)
+            if time.monotonic() > deadline:
+                break
+            time.sleep(1)
+    else:
+        raise RuntimeError(f"capture failed after {MAX_ATTEMPTS} attempts")
+    raise TimeoutError("capture deadline exceeded")`,
				notes: [
					{
						match: 'resp = client.post("/captures", json=payload, timeout=5)',
						severity: 'blocker',
						issue:
							'Retries a non-idempotent POST with no [[idempotency-key]]. A 5 s client [[timeout]] does not mean the capture failed; the provider may have captured and the response was slow. The retry then captures twice. Send `Idempotency-Key: capture-{order.id}` (stable across attempts) and only then retry.'
					},
					{
						match: 'except Exception as exc:',
						severity: 'major',
						issue:
							'Retries **everything**, including 4xx (declined, already captured, invalid amount) and bugs like a `KeyError` on the response. Only retry timeouts, connection errors, 502/503/504 and 429; a 4xx should fail fast with the provider\'s error.'
					},
					{
						match: 'log.warning("capture failed attempt=%s headers=%s err=%s", attempt, client.headers, exc)',
						severity: 'major',
						issue: 'Logs `client.headers`, which carries the provider API key (`Authorization: Bearer sk_live_…`). Secrets in logs end up in the log platform, exports and support tickets. Log the status code and provider request id instead.'
					},
					{
						match: 'time.sleep(1)',
						severity: 'minor',
						issue:
							'Fixed 1 s sleep with no [[jitter]]: when the provider blips, every worker retries in lock-step and hits it again at the same instant. Use [[exponential-backoff]] with jitter, and honour `Retry-After` on 429/503.'
					},
					{
						match: '    else:',
						decoy:
							"Python's `for … else` runs the `else` only when the loop finishes without `break`. Here that means \"all attempts used\", and `break` (deadline hit) falls through to the `TimeoutError`. Unusual but correct; at most a readability nit."
					},
					{
						match: 'deadline = time.monotonic() + 20',
						decoy: '`time.monotonic()` is the right clock for measuring elapsed time; `time.time()` can jump with NTP adjustments. Fine.'
					}
				]
			}
		]
	},
	[
		{
			type: 'ranked',
			items: [
				{
					title: 'Blocker: idempotency key before any retry.',
					body: 'Without it this PR converts "occasionally slow" into "occasionally double-charged", which is worse than the manual re-runs it replaces. The stub test passes because the stub never succeeds on the first attempt and then times out; the real failure mode is success with a slow response.',
					confirm: 'Ask for a test where the stub records the capture **and** sleeps past the timeout: the provider must see one capture.'
				},
				{ title: 'Major: narrow the retryable errors.', body: 'Retry on `requests.Timeout`, `ConnectionError` and 5xx/429 only.' },
				{ title: 'Major: stop logging the auth header.', body: 'Also rotate the key if this has run anywhere with real traffic.' },
				{ title: 'Minor: backoff with jitter, respect Retry-After.' }
			]
		},
		{
			type: 'code',
			lang: 'python',
			caption: 'What the fixed core could look like.',
			code: `RETRYABLE = {429, 502, 503, 504}

def capture(order: Order) -> str:
    headers = {"Idempotency-Key": f"capture-{order.id}"}
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = client.post("/captures", json=payload, headers=headers, timeout=5)
            if resp.status_code in RETRYABLE:
                raise TransientError(resp.status_code)
            resp.raise_for_status()          # 4xx → fail fast
            return resp.json()["capture_id"]
        except (requests.Timeout, requests.ConnectionError, TransientError) as exc:
            log.warning("capture retry order=%s attempt=%s err=%s", order.id, attempt, exc)
            time.sleep(min(8, 0.5 * 2 ** attempt) * random.uniform(0.5, 1.5))
    raise CaptureFailed(order.id)`
		},
		{ type: 'p', text: '**Verdict: request changes.** The goal is right; the blocker makes it unsafe to merge as is.' }
	]
);

const b2 = pr(
	'b2-go-fanout',
	'Backend PRs',
	'"Parallelise price lookups"',
	9,
	{
		title: 'Fetch prices concurrently (p95 2.1 s → 300 ms)',
		author: 'marek',
		description: 'Cart pricing called the pricing service once per item, sequentially. This fans out with one goroutine per item. Benchmarked locally with a 40-item cart.',
		files: [
			{
				path: 'cart/pricing.go',
				lang: 'go',
				oldStart: 18,
				newStart: 18,
				patch: `
-func (s *Service) Prices(ctx context.Context, items []Item) (map[string]Money, error) {
-	out := make(map[string]Money, len(items))
-	for _, it := range items {
-		p, err := s.client.Price(ctx, it.SKU)
-		if err != nil {
-			return nil, err
-		}
-		out[it.SKU] = p
-	}
-	return out, nil
-}
+func (s *Service) Prices(ctx context.Context, items []Item) (map[string]Money, error) {
+	out := make(map[string]Money, len(items))
+	errs := make(chan error)
+	var wg sync.WaitGroup
+	for _, it := range items { // one goroutine per item
+		wg.Add(1)
+		go func(sku string) {
+			defer wg.Done()
+			p, err := s.client.Price(context.Background(), sku)
+			if err != nil {
+				errs <- err
+				return
+			}
+			out[sku] = p
+		}(it.SKU)
+	}
+	go func() { wg.Wait(); close(errs) }()
+	if err := <-errs; err != nil {
+		return nil, err
+	}
+	return out, nil
+}`,
				notes: [
					{
						match: '			out[sku] = p',
						severity: 'blocker',
						issue: 'Concurrent writes to a plain Go `map` from many goroutines: a data race that can panic with `concurrent map writes` or corrupt the map. Guard with a `sync.Mutex`, or write to a pre-sized slice by index.'
					},
					{
						match: '				errs <- err',
						severity: 'blocker',
						issue:
							'`errs` is unbuffered and the caller reads it **once**. After the first error returns, every other failing goroutine blocks forever on this send: a [[goroutine-leak]] that grows with every failed cart. Use `errgroup` (first error cancels the rest), or a channel buffered to `len(items)`.'
					},
					{
						match: 'p, err := s.client.Price(context.Background(), sku)',
						severity: 'major',
						issue:
							'`context.Background()` drops the request\'s cancellation and deadline ([[context-propagation]]). If the client disconnects or the handler times out, these calls keep running. Pass `ctx` (or the errgroup\'s derived ctx).'
					},
					{
						match: '	for _, it := range items { // one goroutine per item',
						severity: 'minor',
						issue: 'Unbounded fan-out: a 400-item cart opens 400 concurrent calls to the pricing service from one request. Cap concurrency (`errgroup.SetLimit(16)`) or use a batch endpoint.'
					},
					{
						match: '		}(it.SKU)',
						decoy:
							'Passing `it.SKU` as an argument avoids the classic loop-variable capture bug (and since Go 1.22 each iteration has its own variable anyway). Correct as written.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'Two blockers that tests rarely catch: the map race (run tests with `-race`; it fails immediately) and the goroutine leak on the error path (only visible as a slow climb in goroutine count in production).'
		},
		{
			type: 'code',
			lang: 'go',
			caption: 'The idiomatic shape with errgroup.',
			code: `func (s *Service) Prices(ctx context.Context, items []Item) (map[string]Money, error) {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(16)
	prices := make([]Money, len(items))
	for i, it := range items {
		g.Go(func() error {
			p, err := s.client.Price(ctx, it.SKU)
			prices[i] = p // distinct index per goroutine: no lock needed
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	out := make(map[string]Money, len(items))
	for i, it := range items {
		out[it.SKU] = prices[i]
	}
	return out, nil
}`
		},
		{ type: 'p', text: '**Verdict: request changes.** Ask for the benchmark to be rerun with `-race` and a test where one SKU fails.' }
	]
);

const b3 = pr(
	'b3-invoice-download',
	'Backend PRs',
	'"Let customers download invoice PDFs"',
	8,
	{
		title: 'Add GET /invoices/:id/pdf',
		author: 'sam',
		description: 'Customers asked for PDF downloads in the billing page. Route is behind `requireAuth`, so only logged-in users can hit it.',
		files: [
			{
				path: 'src/routes/invoices.ts',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
 import { Router } from 'express';
 import { requireAuth } from '../auth';
 import { db } from '../db';
 import { renderPdf } from '../pdf';
+import { audit } from '../audit';

 export const invoices = Router();

 invoices.get('/invoices', requireAuth, async (req, res) => {
   const rows = await db.invoice.findMany({ where: { tenantId: req.user.tenantId } });
   res.json(rows);
 });
+
+invoices.get('/invoices/:id/pdf', requireAuth, async (req, res) => {
+  const invoice = await db.invoice.findUnique({ where: { id: req.params.id } });
+  if (!invoice) return res.status(404).end();
+  audit.log('invoice.download', { user: req.user.id, invoice: invoice.id });
+  const pdf = await renderPdf(invoice);
+  res.setHeader('Content-Type', 'application/pdf');
+  res.setHeader('Content-Disposition', \`attachment; filename="\${invoice.customerName}-\${invoice.number}.pdf"\`);
+  res.setHeader('Cache-Control', 'private, no-store');
+  res.send(pdf);
+});`,
				notes: [
					{
						match: "const invoice = await db.invoice.findUnique({ where: { id: req.params.id } });",
						severity: 'blocker',
						issue:
							'[[idor|IDOR]]: any logged-in user can download **any tenant\'s** invoice by changing the id. Authentication is not authorization. Scope the query (`where: { id, tenantId: req.user.tenantId }`) and return 404, not 403, for other tenants\' ids so existence isn\'t leaked. The list route above already does this, which is exactly why the gap is easy to miss.'
					},
					{
						match: "audit.log('invoice.download', { user: req.user.id, invoice: invoice.id });",
						severity: 'major',
						issue:
							'Not awaited. If `audit.log` is async and rejects, it becomes an unhandled rejection (which can crash the process in Node 15+), and the audit trail silently misses downloads. `await` it, or use a fire-and-forget helper that catches.'
					},
					{
						match: 'Content-Disposition',
						severity: 'minor',
						issue:
							'`customerName` goes into a header unescaped. Quotes, commas or non-ASCII names produce a broken or ambiguous filename (and CR/LF would be header injection if the framework didn\'t reject it). Use `filename*=UTF-8\'\'…` with encoding, or a safe slug.'
					},
					{
						match: "res.setHeader('Cache-Control', 'private, no-store');",
						decoy: '`private, no-store` is exactly right for a per-customer document: no CDN or browser cache keeps a copy. Leave it.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'The description\'s reasoning ("behind `requireAuth`, so only logged-in users") is the bug in sentence form. Ask for a test that logs in as tenant B and requests tenant A\'s invoice id. Also check that invoice ids aren\'t sequential; even after the fix, guessable ids make probing cheap.'
		},
		{ type: 'p', text: '**Verdict: request changes** (blocker: cross-tenant data exposure).' }
	]
);

const b4 = pr(
	'b4-dashboard-totals',
	'Backend PRs',
	'"Today\'s orders on the merchant dashboard"',
	9,
	{
		title: "Show today's orders and revenue on the dashboard",
		author: 'lea',
		description: 'Adds a "Today" card. Works great on my seed data (12 orders).',
		files: [
			{
				path: 'dashboard/views.py',
				lang: 'python',
				oldStart: 40,
				newStart: 40,
				patch: `
 @login_required
 def dashboard(request):
     merchant = request.user.merchant
+    today = date.today()
+    orders = Order.objects.filter(merchant=merchant, created_at__date=today).select_related("customer")
+    rows = []
+    revenue = Decimal(0)
+    for o in orders:
+        items = list(o.items.all())
+        total = sum(float(i.unit_price) * i.quantity for i in items)
+        revenue += Decimal(total)
+        rows.append({"id": o.id, "customer": o.customer.name, "items": len(items), "total": total})
     return render(request, "dashboard.html", {
         "merchant": merchant,
+        "today_orders": rows,
+        "today_revenue": revenue,
     })`,
				notes: [
					{
						match: 'items = list(o.items.all())',
						severity: 'major',
						issue:
							'[[n-plus-one|N+1]]: one query per order for its items. 12 seed orders is invisible; a merchant with 3,000 orders a day makes 3,001 queries on every dashboard load. Add `.prefetch_related("items")` (or aggregate in SQL).'
					},
					{
						match: 'orders = Order.objects.filter(merchant=merchant, created_at__date=today).select_related("customer")',
						severity: 'major',
						issue:
							'Unbounded: loads every order of the day into memory to render a card. Show the latest N with pagination and compute the revenue with an aggregate query (`Sum(F("unit_price") * F("quantity"))`).'
					},
					{
						match: 'total = sum(float(i.unit_price) * i.quantity for i in items)',
						severity: 'major',
						issue:
							'Converts money to [[floating-point|float]], then back to Decimal. `Decimal(0.1 + 0.2)` is `0.3000000000000000444…`, so revenue drifts and won\'t reconcile with invoices. Keep `Decimal` (or integer [[minor-units]]) end to end.'
					},
					{
						match: 'today = date.today()',
						severity: 'minor',
						issue:
							'"Today" is the **server\'s** date, and `created_at__date` truncates in the DB session timezone (UTC). A merchant in Los Angeles sees "today" switch at 5 pm. Use the merchant\'s [[iana-timezone]] to compute the day\'s UTC range.'
					},
					{
						match: 'revenue = Decimal(0)',
						decoy: '`Decimal(0)` from an int is exact. The problem is the float that gets added later, not this line.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'Every issue here is invisible on seed data: small N hides the N+1 and the unbounded load, UTC-adjacent developers hide the timezone bug, and small totals hide float drift. A good review asks "what does this do for the biggest merchant, in the furthest timezone?"'
		},
		{
			type: 'code',
			lang: 'python',
			code: `start, end = merchant_day_bounds(merchant.timezone)   # aware datetimes in UTC
qs = Order.objects.filter(merchant=merchant, created_at__gte=start, created_at__lt=end)
revenue = qs.aggregate(v=Sum(F("items__unit_price") * F("items__quantity")))["v"] or Decimal(0)
latest = qs.select_related("customer").prefetch_related("items").order_by("-created_at")[:20]`
		},
		{ type: 'p', text: '**Verdict: request changes**, kindly: none of these are visible from the author\'s test data.' }
	],
	{ tag: 'core' }
);

const b5 = pr(
	'b5-reserve-stock',
	'Backend PRs',
	'"Reserve stock before charging"',
	10,
	{
		title: 'Reserve inventory and charge in one transaction',
		author: 'priya',
		description: 'Fixes overselling: we now check stock, charge the card, and decrement, all inside one @Transactional so it either all happens or none of it does.',
		files: [
			{
				path: 'src/main/java/shop/checkout/CheckoutService.java',
				lang: 'java',
				oldStart: 31,
				newStart: 31,
				patch: `
+    @Transactional
+    public boolean checkout(long productId, int qty, PaymentRequest payment) {
+        Product p = products.findById(productId).orElseThrow();
+        if (p.getStock() < qty) {
+            return false;
+        }
+        try {
+            paymentClient.charge(payment);
+        } catch (Exception e) {
+            return false;
+        }
+        p.setStock(p.getStock() - qty);
+        products.save(p);
+        return true;
+    }
+
+    @Transactional(readOnly = true)
+    public int available(long productId) {
+        return products.findById(productId).map(Product::getStock).orElse(0);
+    }`,
				notes: [
					{
						match: '        if (p.getStock() < qty) {',
						severity: 'blocker',
						issue:
							'[[check-then-act]] under READ COMMITTED: two checkouts both read stock = 1, both pass, both decrement and save. @Transactional does not serialize them. The oversell this PR claims to fix still happens. Use an atomic conditional update (`UPDATE product SET stock = stock - :qty WHERE id = :id AND stock >= :qty`, check rows affected) or `SELECT … FOR UPDATE`.'
					},
					{
						match: '            paymentClient.charge(payment);',
						severity: 'blocker',
						issue:
							'A network call **inside** the DB transaction. The transaction can\'t roll back a card charge: if the save fails after charging, money is taken and no stock is reserved. It also holds a DB connection (and row locks, once you add them) for the length of a payment call. Reserve stock in a short transaction, charge outside it, then confirm or release.'
					},
					{
						match: '        } catch (Exception e) {',
						severity: 'major',
						issue:
							'[[swallowed-exception|Swallows]] everything, including a payment **timeout** where the charge may have succeeded, and returns `false` ("out of stock?") with no log. Distinguish declined vs unknown outcome; unknown needs reconciliation, not a silent false.'
					},
					{
						match: '    @Transactional(readOnly = true)',
						decoy: '`readOnly = true` on a pure read is correct and lets the driver/ORM skip dirty checking. Not a problem.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'The description describes the transaction as "all or nothing", but the payment provider is not part of the transaction. The correct pattern is a small state machine: `reserve` (atomic stock decrement, status RESERVED) → `charge` outside the transaction with an [[idempotency-key]] → `confirm` or `release`, with a sweeper that releases stale reservations.'
		},
		{ type: 'p', text: '**Verdict: request changes.** Ask for a concurrency test: 50 parallel checkouts against stock = 10 must produce exactly 10 successes.' }
	]
);

const b6 = pr(
	'b6-link-preview',
	'Backend PRs',
	'"Link previews in chat"',
	9,
	{
		title: 'Unfurl links posted in chat',
		author: 'noor',
		description: 'When a message contains a URL we fetch it server-side, read the <title> and og:image, and cache the result so popular links are instant.',
		files: [
			{
				path: 'src/unfurl.ts',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
+import { parse } from 'node-html-parser';
+
+const cache = new Map<string, Preview>();
+
+export async function unfurl(rawUrl: string): Promise<Preview> {
+  const url = new URL(rawUrl);
+  const hit = cache.get(url.href);
+  if (hit) return hit;
+
+  const res = await fetch(url, { redirect: 'follow' });
+  const html = await res.text();
+  const doc = parse(html);
+  const preview = {
+    title: doc.querySelector('title')?.text.trim() ?? url.hostname,
+    image: doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
+  };
+  cache.set(url.href, preview);
+  return preview;
+}`,
				notes: [
					{
						match: "  const res = await fetch(url, { redirect: 'follow' });",
						severity: 'blocker',
						issue:
							'[[ssrf|SSRF]]: the server fetches any URL a user types, including `http://169.254.169.254/` ([[instance-metadata]]), `http://localhost:6379`, and internal admin hosts. Following redirects means even a validated public URL can bounce inside. Resolve the host, reject private/link-local/loopback ranges at connect time (not just on the hostname), disable redirects or re-validate each hop, and run the fetcher in a network-isolated egress proxy.'
					},
					{
						match: '  const html = await res.text();',
						severity: 'major',
						issue:
							'No [[timeout]] on the fetch and no size cap: a slow or 2 GB response ties up the worker and memory. Add `AbortSignal.timeout(3000)`, check `content-type` is HTML, and stop reading after ~512 KB.'
					},
					{
						match: 'const cache = new Map<string, Preview>();',
						severity: 'major',
						issue:
							'[[unbounded-cache|Unbounded]] module-level cache keyed by user-supplied URLs. Every unique link stays forever; anyone can grow memory by posting `?x=1`, `?x=2`… Use an LRU with a size limit and TTL.'
					},
					{
						match: '  const url = new URL(rawUrl);',
						decoy: "Parsing with `new URL()` is the right first step (it throws on garbage and normalises the href for the cache key). It is not sufficient protection, but the line itself is correct; the fix goes after it."
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'The scheme check people usually add (`url.protocol === "https:"`) does nothing for SSRF; hostname denylists lose to DNS tricks and redirects. The robust fix is enforcement at the network layer: the fetcher runs where it cannot reach internal addresses at all.'
		},
		{ type: 'p', text: '**Verdict: request changes.** This is a common way cloud credentials get stolen.' }
	]
);

// ═════════════════════════ PART 2 · Data & migrations ═════════════════════════

const d1 = pr(
	'd1-status-migration',
	'Data & migrations',
	'"Add order status column and index"',
	10,
	{
		title: 'orders: add fulfilment_status, rename state → legacy_state',
		author: 'ivo',
		description: 'Prep for the new fulfilment flow. Ships in the same deploy as the code that reads `fulfilment_status`. `orders` has ~80M rows. Migration runs before the new pods roll out.',
		files: [
			{
				path: 'migrations/0142_fulfilment_status.sql',
				lang: 'sql',
				patch: `
+BEGIN;
+
+ALTER TABLE orders ADD COLUMN fulfilment_status text NOT NULL DEFAULT 'pending';
+
+UPDATE orders SET fulfilment_status = 'shipped' WHERE shipped_at IS NOT NULL;
+
+CREATE INDEX idx_orders_fulfilment ON orders (merchant_id, fulfilment_status);
+
+ALTER TABLE orders RENAME COLUMN state TO legacy_state;
+
+COMMIT;`,
				notes: [
					{
						match: "ALTER TABLE orders ADD COLUMN fulfilment_status text NOT NULL DEFAULT 'pending';",
						decoy:
							'On Postgres 11+, adding a column with a **constant** default is metadata-only: no table rewrite, instant. Looks scary on 80M rows, but it is fine (a volatile default like `now()` would rewrite).'
					},
					{
						match: "UPDATE orders SET fulfilment_status = 'shipped' WHERE shipped_at IS NOT NULL;",
						severity: 'major',
						issue:
							'One UPDATE over tens of millions of rows in a single transaction: rewrites every matched row (bloat, WAL spike, [[replication-lag]]) and holds row locks until COMMIT, blocking writes to those orders for minutes. Backfill in batches (10k by id range) outside the schema migration.'
					},
					{
						match: 'CREATE INDEX idx_orders_fulfilment ON orders (merchant_id, fulfilment_status);',
						severity: 'blocker',
						issue:
							'Plain `CREATE INDEX` takes a lock that blocks all INSERT/UPDATE/DELETE on `orders` for the whole build (minutes on 80M rows): checkout stops. Use [[create-index-concurrently|CREATE INDEX CONCURRENTLY]], which also cannot run inside `BEGIN … COMMIT`, so it needs its own migration.'
					},
					{
						match: 'ALTER TABLE orders RENAME COLUMN state TO legacy_state;',
						severity: 'blocker',
						issue:
							'The migration runs before the new pods roll out, so the **old** code (still reading `state`) breaks the moment this commits, and stays broken for the whole rolling deploy. Renames need [[expand-contract-migration|expand/contract]]: add the new column, dual-write, move reads, drop the old one a release later.'
					},
					{
						match: 'BEGIN;',
						severity: 'minor',
						issue:
							'No `SET lock_timeout`. Even the "instant" ALTERs need an ACCESS EXCLUSIVE lock; if a long query holds `orders`, the ALTER waits and every query queues behind it ([[lock-queue]]). `SET lock_timeout = \'3s\'` makes it fail fast and retry ([[statement-timeout]]).'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'Split into four steps across two deploys: (1) add column (with `lock_timeout`), (2) `CREATE INDEX CONCURRENTLY` in its own non-transactional migration, (3) batched backfill job, (4) a later release adds `legacy_state` via expand/contract if the rename is still wanted at all.'
		},
		{ type: 'p', text: '**Verdict: request changes.** The decoy is the line most reviewers flag; the two blockers are the ones that cause the outage.' }
	]
);

const d2 = pr(
	'd2-consumer-commit',
	'Data & migrations',
	'"Faster order-event consumer"',
	9,
	{
		title: 'Commit offsets early to speed up the order consumer',
		author: 'tomas',
		description: 'Throughput was capped by synchronous commits. Committing right after poll doubled throughput in staging. Also publishes an `order.indexed` event for the search team.',
		files: [
			{
				path: 'consumers/orders.py',
				lang: 'python',
				oldStart: 12,
				newStart: 12,
				patch: `
 consumer = Consumer({"bootstrap.servers": BROKERS, "group.id": "orders-indexer",
                      "enable.auto.commit": False})
 consumer.subscribe(["orders"])

 while True:
     msg = consumer.poll(1.0)
     if msg is None:
         continue
+    consumer.commit(message=msg, asynchronous=True)
     event = json.loads(msg.value())
-    index_order(event)
-    consumer.commit(message=msg)
+    while True:
+        try:
+            index_order(event)
+            break
+        except Exception:
+            time.sleep(2)
+    db.execute("UPDATE orders SET indexed_at = now() WHERE id = %s", (event["id"],))
+    producer.produce("order.indexed", json.dumps({"id": event["id"]}))`,
				notes: [
					{
						match: '    consumer.commit(message=msg, asynchronous=True)',
						severity: 'blocker',
						issue:
							'Commits the [[offset-commit|offset]] **before** processing. If the pod crashes or is redeployed mid-message, the message is never processed again: silent data loss. The staging speedup is exactly this: skipping the safety. Commit after processing, and batch commits (every N messages or T ms) for throughput.'
					},
					{
						match: '        except Exception:',
						severity: 'major',
						issue:
							'Retries forever. One [[poison-message|poison message]] (bad JSON field, deleted order) blocks the partition permanently and [[consumer-lag|lag]] grows without bound. Cap attempts, then send to a [[dead-letter-queue]] with the error.'
					},
					{
						match: '    producer.produce("order.indexed", json.dumps({"id": event["id"]}))',
						severity: 'major',
						issue:
							'[[dual-write|Dual write]]: the DB update and the Kafka publish are not atomic. A crash between them leaves `indexed_at` set with no event (or with retries, duplicate events). Use a [[transactional-outbox]], or make the search team consume CDC from the table.'
					},
					{
						match: '"enable.auto.commit": False})',
						decoy: 'Disabling auto-commit is correct: it is what lets you commit only after processing. The bug is where the manual commit was moved to.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'Throughput fixes for a consumer that are safe: process a batch, commit once per batch; add partitions and consumers; make `index_order` idempotent so at-least-once redelivery is harmless.'
		},
		{ type: 'p', text: '**Verdict: request changes.**' }
	]
);

const d3 = pr(
	'd3-order-by',
	'Data & migrations',
	'"Sortable order list API"',
	8,
	{
		title: 'Let the order list sort by any column',
		author: 'kai',
		description: 'Frontend wants sortable columns. Added `sort` and `dir` query params. Values are passed straight through so new columns work without backend changes.',
		files: [
			{
				path: 'api/orders.py',
				lang: 'python',
				oldStart: 20,
				newStart: 20,
				patch: `
 @app.get("/orders")
 def list_orders():
     tenant_id = g.user.tenant_id
-    sql = "SELECT id, number, total_cents, created_at FROM orders WHERE tenant_id = %s ORDER BY created_at DESC LIMIT 50"
+    sort = request.args.get("sort", "created_at")
+    direction = request.args.get("dir", "desc")
+    page = int(request.args.get("page", 0))
+    sql = (
+        "SELECT id, number, total_cents, created_at FROM orders WHERE tenant_id = %s "
+        f"ORDER BY {sort} {direction} LIMIT 50 OFFSET {page * 50}"
+    )
     rows = db.fetchall(sql, (tenant_id,))
     return jsonify(rows)`,
				notes: [
					{
						match: '        f"ORDER BY {sort} {direction} LIMIT 50 OFFSET {page * 50}"',
						severity: 'blocker',
						issue:
							'[[sql-injection|SQL injection]] through `sort`/`dir`. Identifiers can\'t be bound parameters, so "passing straight through" means a user can inject `(SELECT … FROM users)` or a `CASE WHEN` that leaks other tenants\' data a bit at a time. Map `sort` through an allowlist dict and `dir` to exactly `ASC`/`DESC`.'
					},
					{
						match: '    page = int(request.args.get("page", 0))',
						severity: 'minor',
						issue:
							'Deep `OFFSET` pages scan and throw away `page × 50` rows (slow on big tenants), and negative pages error. Prefer [[keyset-pagination]] (`WHERE (created_at, id) < (:c, :id)`), or at least clamp `page`.'
					},
					{
						match: '    rows = db.fetchall(sql, (tenant_id,))',
						decoy: '`tenant_id` is passed as a bound parameter: this part is correct. The danger is the f-string two lines above.'
					}
				]
			}
		]
	},
	[
		{
			type: 'code',
			lang: 'python',
			code: `SORTABLE = {"created": "created_at", "total": "total_cents", "number": "number"}
col = SORTABLE.get(request.args.get("sort"), "created_at")
direction = "ASC" if request.args.get("dir") == "asc" else "DESC"
sql = f"SELECT … WHERE tenant_id = %s ORDER BY {col} {direction}, id {direction} LIMIT 50"`
		},
		{ type: 'p', text: 'Note the tie-breaker `id`: without it, sorting on a non-unique column gives unstable pages. **Verdict: request changes.**' }
	],
	{ tag: 'core' }
);

const d4 = pr(
	'd4-renewal-job',
	'Data & migrations',
	'"Monthly renewal job"',
	9,
	{
		title: 'Bill monthly renewals with tax',
		author: 'olu',
		description: 'Nightly job: on each customer\'s renewal day, charge plan price plus 20% VAT. Scheduled at 02:30 Europe/London via the cron service.',
		files: [
			{
				path: 'jobs/renewals.ts',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
+// cron: "30 2 * * *"  TZ=Europe/London
+export async function runRenewals(now = new Date()) {
+  const today = now.getDate();
+  const subs = await db.subscription.findMany({ where: { renewalDay: today, active: true } });
+  for (const s of subs) {
+    const amount = s.planPriceCents * 1.2;
+    await billing.charge({
+      customerId: s.customerId,
+      amountCents: Math.round(amount),
+      idempotencyKey: \`renewal-\${s.id}-\${now.toISOString().slice(0, 7)}\`,
+    });
+  }
+}`,
				notes: [
					{
						match: '// cron: "30 2 * * *"  TZ=Europe/London',
						severity: 'major',
						issue:
							'02:30 in Europe/London does not exist on the spring-forward night and happens twice on the fall-back night ([[dst]]). Depending on the scheduler the job is skipped or runs twice. Schedule in UTC, or pick a time outside 01:00–03:00.'
					},
					{
						match: '  const subs = await db.subscription.findMany({ where: { renewalDay: today, active: true } });',
						severity: 'major',
						issue:
							'Customers with `renewalDay` 29, 30 or 31 are **never** billed in shorter months: there is no 31 June. Clamp to the last day of the month ([[end-of-month-clamping]]): on the last day, also select all renewal days greater than today.'
					},
					{
						match: '  const today = now.getDate();',
						severity: 'minor',
						issue: '`getDate()` uses the **process** timezone, which may be UTC in the container while the cron fires in London time. Compute the business date explicitly in the intended [[iana-timezone]].'
					},
					{
						match: 'idempotencyKey: `renewal-',
						decoy: 'A per-subscription, per-month key is exactly right: a re-run on the same month is deduplicated by the billing provider. (It also neutralises the DST double-run, as long as both runs fall in the same UTC month.)'
					},
					{
						match: '    const amount = s.planPriceCents * 1.2;',
						decoy:
							'Multiplying integer cents by 1.2 and rounding once is acceptable here: the float error is ~1e-13 of a cent and `Math.round` lands on the right integer for any realistic price. The money smell is when floats are *summed* or stored. A reviewer can still suggest integer math (`price * 12 / 10`) for clarity, as a nit.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'This is a "time & money" PR where the obvious suspect (float × 1.2) is the least important line. The real money loss is the 29/30/31 customers who silently get free months, and the DST night that skips or doubles the run.'
		},
		{ type: 'p', text: '**Verdict: request changes** (two majors with direct revenue impact).' }
	]
);

const d5 = pr(
	'd5-retention-purge',
	'Data & migrations',
	'"30-day retention for events"',
	8,
	{
		title: 'Purge analytics events older than 30 days',
		author: 'zoe',
		description: 'Legal asked us to keep raw events for 30 days max. This adds a nightly purge. `events` is ~2B rows, ~60M/day.',
		files: [
			{
				path: 'jobs/purge_events.sql',
				lang: 'sql',
				patch: `
+-- runs nightly at 03:00 UTC
+DELETE FROM events
+WHERE created_at < now() - interval '30 days';
+
+VACUUM FULL events;`,
				notes: [
					{
						match: 'DELETE FROM events',
						severity: 'major',
						issue:
							'The first run deletes ~1.2B rows in one statement and one transaction: hours of WAL, replica lag, locks and an undo cost if it is cancelled. Nightly runs after that are still 60M rows at once. Delete in batches (`… WHERE id IN (SELECT id … LIMIT 10000)`), or better, partition `events` by day and `DROP` old partitions (instant, no bloat).'
					},
					{
						match: 'VACUUM FULL events;',
						severity: 'blocker',
						issue:
							'`VACUUM FULL` rewrites the whole table under an ACCESS EXCLUSIVE lock: no reads or writes to `events` for the duration (hours at this size), every night. Plain autovacuum reclaims space for reuse; partition dropping avoids the problem entirely.'
					},
					{
						match: "WHERE created_at < now() - interval '30 days';",
						decoy: 'With `created_at timestamptz`, `now() - interval \'30 days\'` is a correct absolute cutoff (no timezone ambiguity). The condition is right; the volume and the VACUUM FULL are the problem.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'Also ask the compliance question the SQL can\'t answer: retention applies to copies too. Events exported to the warehouse, search indexes and backups older than 30 days need their own expiry, or the legal requirement isn\'t met.'
		},
		{ type: 'p', text: '**Verdict: request changes.** Suggest daily partitions as the real fix.' }
	],
	{ tag: 'core' }
);

// ═════════════════════════ PART 3 · Frontend PRs ═════════════════════════

const f1 = pr(
	'f1-search-effect',
	'Frontend PRs',
	'"Live search with a result counter"',
	9,
	{
		title: 'Search-as-you-type + auto-refreshing "updated Ns ago"',
		author: 'ines',
		description: 'Search now fires on every keystroke (no button). Added a little "updated 12s ago" label that ticks every second.',
		files: [
			{
				path: 'src/components/Search.tsx',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
 import { useEffect, useState } from 'react';
 import { api } from '../api';
 
 export function Search() {
   const [query, setQuery] = useState('');
   const [results, setResults] = useState<Result[]>([]);
+  const [secondsAgo, setSecondsAgo] = useState(0);
+
+  useEffect(() => {
+    if (!query) return;
+    api.search(query).then((r) => {
+      setResults(r.items);
+      setSecondsAgo(0);
+    });
+  }, [query]);
+
+  useEffect(() => {
+    const id = setInterval(() => setSecondsAgo(secondsAgo + 1), 1000);
+  }, []);
 
   return (
     <div>
       <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search orders" />
+      <small>updated {secondsAgo}s ago</small>
       <ul>
         {results.map((r) => (
           <li key={r.id}>{r.title}</li>
         ))}
       </ul>
     </div>
   );
 }`,
				notes: [
					{
						match: '    api.search(query).then((r) => {',
						severity: 'major',
						issue:
							'No cancellation or ordering guard ([[stale-response]]). Typing "abc" fires three requests; if the "ab" response arrives after "abc", the list shows results for the wrong query. Abort the previous request in the [[effect-cleanup|cleanup]] (`AbortController`), or ignore responses whose query isn\'t current. Debounce ~250 ms too.'
					},
					{
						match: '    const id = setInterval(() => setSecondsAgo(secondsAgo + 1), 1000);',
						severity: 'major',
						issue:
							'[[stale-closure|Stale closure]]: the interval captured `secondsAgo = 0` from the first render, so it sets 1 forever ("updated 1s ago" never changes). Use the functional form `setSecondsAgo((s) => s + 1)`.'
					},
					{
						match: '  }, []);',
						severity: 'major',
						issue: 'No [[effect-cleanup|cleanup]]: the interval keeps running after unmount (state update on an unmounted component, and a new interval every time the component remounts). Return `() => clearInterval(id)`.'
					},
					{
						match: '<li key={r.id}>{r.title}</li>',
						decoy: 'Keyed by a stable id: correct. The index-as-key smell would be `key={i}`.'
					},
					{
						match: '    if (!query) return;',
						severity: 'minor',
						issue: 'Clearing the input leaves the old results on screen (the effect returns early without resetting). Clear `results` when the query is empty.'
					}
				]
			}
		]
	},
	[
		{
			type: 'code',
			lang: 'typescript',
			code: `useEffect(() => {
  if (!query) { setResults([]); return; }
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    api.search(query, { signal: ctrl.signal }).then((r) => { setResults(r.items); setSecondsAgo(0); }).catch(ignoreAbort);
  }, 250);
  return () => { clearTimeout(t); ctrl.abort(); };
}, [query]);

useEffect(() => {
  const id = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
  return () => clearInterval(id);
}, []);`
		},
		{ type: 'p', text: '**Verdict: request changes.** Each bug is a classic; together they make the feature look flaky in ways QA will struggle to reproduce.' }
	],
	{ tag: 'core' }
);

const f2 = pr(
	'f2-comment-modal',
	'Frontend PRs',
	'"Rich comments in a modal"',
	9,
	{
		title: 'Show comment preview in a modal (with formatting)',
		author: 'rob',
		description: 'Comments support **bold** and links now, so the preview renders the HTML from the markdown endpoint. Modal closes on Escape.',
		files: [
			{
				path: 'src/components/CommentModal.tsx',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
+import { useEffect } from 'react';
+import { createPortal } from 'react-dom';
+
+export function CommentModal({ comment, onClose }: { comment: Comment; onClose: () => void }) {
+  useEffect(() => {
+    document.addEventListener('keydown', (e) => {
+      if (e.key === 'Escape') onClose();
+    });
+  });
+
+  return createPortal(
+    <div className="backdrop" onClick={onClose}>
+      <div className="modal" onClick={(e) => e.stopPropagation()}>
+        <h2>{comment.author}</h2>
+        <div dangerouslySetInnerHTML={{ __html: comment.html }} />
+        <span className="close" onClick={onClose}>×</span>
+      </div>
+    </div>,
+    document.body,
+  );
+}`,
				notes: [
					{
						match: '        <div dangerouslySetInnerHTML={{ __html: comment.html }} />',
						severity: 'blocker',
						issue:
							'[[xss|XSS]]: comment HTML is user-controlled. Any comment with `<img src=x onerror=…>` runs script in every viewer\'s session. Sanitize with an allowlist sanitizer (DOMPurify) on the server and client, or render markdown to React elements instead of HTML.'
					},
					{
						match: "    document.addEventListener('keydown', (e) => {",
						severity: 'major',
						issue:
							'Effect has no dependency array **and** no cleanup: a new keydown listener is added on every render and never removed. After a few renders, Escape calls `onClose` many times, and listeners outlive the modal. Add `[onClose]` and return a cleanup that removes the same handler.'
					},
					{
						match: '        <span className="close" onClick={onClose}>×</span>',
						severity: 'minor',
						issue:
							'A clickable `<span>` is not focusable or announced as a button; keyboard and screen-reader users can\'t find it. Use `<button type="button" aria-label="Close">`. Also move focus into the dialog on open and back to the trigger on close ([[focus-management]]).'
					},
					{
						match: '  return createPortal(',
						decoy: 'Portaling a modal to `document.body` is the standard way to escape parent `overflow`/`z-index` stacking contexts. Fine.'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes** (blocker: stored XSS). Accessibility of the close control is worth fixing in the same PR since it is one line.' }]
);

const f3 = pr(
	'f3-account-page-cache',
	'Frontend PRs',
	'"Speed up the account page"',
	9,
	{
		title: 'Cache the account page at the CDN (TTFB 900 ms → 40 ms)',
		author: 'yuki',
		description: 'The account page is server-rendered and slow. Added a 5-minute public cache header so the CDN serves it. Also show the "last login" time in the header.',
		files: [
			{
				path: 'src/pages/account.tsx',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
 export async function getServerSideProps({ req, res }) {
   const user = await getUserFromSession(req);
+  res.setHeader('Cache-Control', 'public, s-maxage=300');
   const orders = await getRecentOrders(user.id);
   return { props: { user, orders } };
 }
 
 export default function Account({ user, orders }) {
   return (
     <Layout>
       <h1>Hi {user.firstName}</h1>
+      <p>Last login: {new Date(user.lastLoginAt).toLocaleString()}</p>
       <OrderList orders={orders} />
     </Layout>
   );
 }`,
				notes: [
					{
						match: "  res.setHeader('Cache-Control', 'public, s-maxage=300');",
						severity: 'blocker',
						issue:
							'Caches a **personalised** page publicly at the CDN. The cache key is the URL, so the next visitor within 5 minutes is served the previous user\'s name and orders: a data breach ([[cdn-cache-key]]). Personalised responses must be `private, no-store`; speed up the data fetching or cache the non-personal shell instead.'
					},
					{
						match: '      <p>Last login: {new Date(user.lastLoginAt).toLocaleString()}</p>',
						severity: 'minor',
						issue:
							'[[hydration-mismatch|Hydration mismatch]]: the server formats in its timezone/locale, the browser in the user\'s, so the text differs and React logs a mismatch (and may re-render the subtree). Format on the client after mount, or pass an explicit timezone/locale.'
					},
					{
						match: 'const orders = await getRecentOrders(user.id);',
						decoy: 'Fetching orders by the **session** user\'s id (not an id from the URL) is the correct, IDOR-safe pattern. The data access is fine; it is the caching of the response that leaks it.'
					}
				]
			}
		]
	},
	[
		{
			type: 'p',
			text: 'A reviewer should stop at the cache header and ask "who else can receive this response?". This is one of the most common causes of "I was logged in as someone else" incidents.'
		},
		{ type: 'p', text: '**Verdict: request changes, and do not deploy** until the header is removed.' }
	]
);

const f4 = pr(
	'f4-optimistic-toggle',
	'Frontend PRs',
	'"Snappier favourite button"',
	8,
	{
		title: 'Optimistic favourite toggle',
		author: 'ana',
		description: 'The heart button waited for the server. Now it flips instantly and rolls back if the request fails.',
		files: [
			{
				path: 'src/components/FavouriteButton.tsx',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
+export function FavouriteButton({ item }: { item: Item }) {
+  const [fav, setFav] = useState(item.favourite);
+
+  async function toggle() {
+    const previous = fav;
+    setFav(!fav);
+    try {
+      await api.setFavourite(item.id, !fav);
+    } catch (e) {
+      console.log(e);
+      setFav(previous);
+    }
+  }
+
+  return (
+    <button type="button" aria-pressed={fav} onClick={toggle} aria-label="Favourite">
+      {fav ? '♥' : '♡'}
+    </button>
+  );
+}`,
				notes: [
					{
						match: '      setFav(previous);',
						severity: 'major',
						issue:
							'Rollback restores a **snapshot** taken at click time. Click twice quickly: first request fails after the second succeeded, and the rollback sets the button back to the pre-first-click value, which is now wrong ([[optimistic-ui]] clobbering). Track a request sequence number and only roll back if no newer toggle happened, or refetch the true state on failure.'
					},
					{
						match: '      await api.setFavourite(item.id, !fav);',
						severity: 'major',
						issue:
							'Sends a **toggle-derived** value from a possibly stale `fav`, and rapid clicks race on the server too (two in-flight requests may land in either order). Send the intended absolute state from the click and serialize or debounce requests per item.'
					},
					{
						match: '      console.log(e);',
						severity: 'minor',
						issue: 'The failure is invisible to the user (the heart silently flips back) and to monitoring. Show a toast and report the error.'
					},
					{
						match: '    <button type="button" aria-pressed={fav} onClick={toggle} aria-label="Favourite">',
						decoy: '`aria-pressed` on a real `<button>` is exactly how a toggle should be exposed to assistive tech. Correct.'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes.** Optimistic UI is fine; the rollback has to be aware of later actions.' }]
);

const f5 = pr(
	'f5-big-ids',
	'Frontend PRs',
	'"Show order ids and totals in the export table"',
	7,
	{
		title: 'Order export table: ids and formatted totals',
		author: 'leo',
		description: 'Orders now use 64-bit snowflake ids from the new id service. Table shows id and total.',
		files: [
			{
				path: 'src/export/rows.ts',
				lang: 'typescript',
				oldStart: 1,
				newStart: 1,
				patch: `
+export function toRow(o: ApiOrder) {
+  const id = Number(o.id);
+  const total = '$' + (o.totalCents / 100).toFixed(2);
+  const placed = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: o.storeTimeZone }).format(new Date(o.placedAt));
+  return { id, total, placed };
+}`,
				notes: [
					{
						match: '  const id = Number(o.id);',
						severity: 'blocker',
						issue:
							'64-bit ids exceed `Number.MAX_SAFE_INTEGER` (2^53 − 1). `Number("1793448231552876545")` rounds to `1793448231552876500`: wrong id shown, wrong order looked up ([[json-number-precision]]). Keep ids as strings end to end (and make sure the API sends them as strings, not JSON numbers).'
					},
					{
						match: "  const total = '$' + (o.totalCents / 100).toFixed(2);",
						severity: 'minor',
						issue:
							'Hard-codes `$` and the decimal format: wrong for EUR stores, JPY (0 decimals) and locales using `1.234,56` ([[locale-formatting]]). Use `Intl.NumberFormat(locale, { style: "currency", currency: o.currency })` with [[minor-units]] per currency.'
					},
					{
						match: '  const placed = new Intl.DateTimeFormat(undefined, { dateStyle: \'medium\', timeZone: o.storeTimeZone }).format(new Date(o.placedAt));',
						decoy: 'Formatting in the **store\'s** IANA timezone is the right choice for an order export (the business day the store saw). Correct.'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes** (the id bug corrupts every row).' }],
	{ tag: 'core' }
);

// ═════════════════════════ PART 4 · Infra & CI PRs ═════════════════════════

const i1 = pr(
	'i1-pr-target',
	'Infra & CI PRs',
	'"Run previews for contributor PRs"',
	9,
	{
		title: 'ci: build previews for PRs from forks',
		author: 'gil',
		description: 'Fork PRs couldn\'t deploy previews because `pull_request` doesn\'t get secrets. Switched to `pull_request_target` so contributors get previews too.',
		files: [
			{
				path: '.github/workflows/preview.yml',
				lang: 'yaml',
				oldStart: 1,
				newStart: 1,
				patch: `
 name: preview
 on:
-  pull_request:
+  pull_request_target:
 
+permissions: write-all
+
 concurrency:
   group: preview-\${{ github.event.pull_request.number }}
   cancel-in-progress: true
 
 jobs:
   build:
     runs-on: ubuntu-latest
     steps:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@main
+        with:
+          ref: \${{ github.event.pull_request.head.sha }}
       - run: npm ci && npm run build
       - run: npx vercel deploy --token \${{ secrets.VERCEL_TOKEN }}`,
				notes: [
					{
						match: '          ref: ${{ github.event.pull_request.head.sha }}',
						severity: 'blocker',
						issue:
							'[[pull-request-target]] runs with repository secrets **and** this checks out the untrusted fork code, then runs its `npm ci` (install scripts) and build. Any fork PR can exfiltrate `VERCEL_TOKEN` and the write token. Never run fork code in a `pull_request_target` job; build untrusted code in `pull_request` without secrets and deploy the artifact from a separate trusted workflow (`workflow_run`).'
					},
					{
						match: 'permissions: write-all',
						severity: 'major',
						issue: 'Grants the job write access to contents, packages, actions, etc. Combined with the above, a fork PR could push to `main`. Default to `contents: read` and grant only what a step needs ([[least-privilege]]).'
					},
					{
						match: '      - uses: actions/checkout@main',
						severity: 'minor',
						issue: 'Unpinned action ref: `@main` can change under you (supply-chain risk). Pin to a release tag at minimum, ideally a full commit SHA.'
					},
					{
						match: 'cancel-in-progress: true',
						decoy: 'Cancelling superseded preview builds for the same PR saves runner time and is standard. Fine.'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes, urgently.** This exact pattern ("pwn request") has leaked tokens from large open-source projects.' }]
);

const i2 = pr(
	'i2-terraform-rename',
	'Infra & CI PRs',
	'"Tidy up the database module"',
	9,
	{
		title: 'terraform: rename db resource, open access for the analytics VPN, upgrade Postgres',
		author: 'ola',
		description: 'Housekeeping: `aws_db_instance.main` → `aws_db_instance.orders`, analytics needs to connect from their VPN, and we are behind on Postgres.',
		files: [
			{
				path: 'infra/db.tf',
				lang: 'text',
				oldStart: 1,
				newStart: 1,
				patch: `
-resource "aws_db_instance" "main" {
+resource "aws_db_instance" "orders" {
   identifier          = "orders-prod"
-  engine_version      = "14.11"
+  engine_version      = "16.3"
+  allow_major_version_upgrade = true
+  apply_immediately   = true
   instance_class      = "db.r6g.xlarge"
   deletion_protection = true
 }
 
 resource "aws_security_group_rule" "pg_analytics" {
   type              = "ingress"
   from_port         = 5432
   to_port           = 5432
   protocol          = "tcp"
-  cidr_blocks       = ["10.20.0.0/16"]
+  cidr_blocks       = ["0.0.0.0/0"]
   security_group_id = aws_security_group.db.id
 }`,
				notes: [
					{
						match: 'resource "aws_db_instance" "orders" {',
						severity: 'blocker',
						issue:
							'Renaming a resource address without a [[moved-block|`moved` block]] makes Terraform plan **destroy `main` + create `orders`**: a new empty database ([[terraform-forces-replacement]]). `deletion_protection` will make the apply fail, which is the only thing standing between this PR and data loss. Add `moved { from = aws_db_instance.main  to = aws_db_instance.orders }` and confirm the plan shows no replacement.'
					},
					{
						match: '  cidr_blocks       = ["0.0.0.0/0"]',
						severity: 'blocker',
						issue:
							'Opens Postgres to the whole internet to fix one VPN. Use the VPN\'s CIDR or, better, a security-group reference to the VPN endpoint\'s group ([[security-group]]).'
					},
					{
						match: '  apply_immediately   = true',
						severity: 'major',
						issue:
							'Combined with a **major** version upgrade, the instance restarts and upgrades on apply, outside a maintenance window, with minutes to an hour of downtime and no tested rollback. Do major upgrades as a planned change (snapshot, test restore, blue/green or a window), not inside a housekeeping PR.'
					},
					{
						match: '  deletion_protection = true',
						decoy: 'Exactly what you want on a production database, and today it is the guardrail that turns the rename blocker into a failed apply instead of data loss.'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes**; split into three PRs (rename with `moved`, network rule, version upgrade) and paste the plan output in each.' }]
);

const i3 = pr(
	'i3-k8s-deploy',
	'Infra & CI PRs',
	'"Production manifest for the new API"',
	9,
	{
		title: 'k8s: deployment for orders-api',
		author: 'ben',
		description: 'First production manifest for orders-api. Health endpoint `/health` checks DB + Redis + the payments API so we know when anything is wrong.',
		files: [
			{
				path: 'deploy/orders-api.yaml',
				lang: 'yaml',
				oldStart: 1,
				newStart: 1,
				patch: `
+apiVersion: apps/v1
+kind: Deployment
+metadata:
+  name: orders-api
+spec:
+  replicas: 6
+  strategy:
+    rollingUpdate:
+      maxUnavailable: 100%
+      maxSurge: 0
+  template:
+    spec:
+      terminationGracePeriodSeconds: 45
+      containers:
+        - name: api
+          image: registry.internal/orders-api:latest
+          ports: [{ containerPort: 8080 }]
+          lifecycle:
+            preStop: { exec: { command: ["sleep", "10"] } }
+          livenessProbe:
+            httpGet: { path: /health, port: 8080 }
+            periodSeconds: 5
+            failureThreshold: 2
+          readinessProbe:
+            httpGet: { path: /ready, port: 8080 }`,
				notes: [
					{
						match: '            httpGet: { path: /health, port: 8080 }',
						severity: 'blocker',
						issue:
							'Liveness probe on a **deep** health check. When the payments API or Redis blips for 10 s, every pod fails liveness and Kubernetes restarts all of them at once, turning a dependency hiccup into a full outage ([[liveness-probe]], [[deep-health-check]]). Liveness should only check "is this process alive"; dependency checks belong (carefully) in readiness, if anywhere.'
					},
					{
						match: '      maxUnavailable: 100%',
						severity: 'major',
						issue: 'Allows the rollout to take **all** pods down at once: every deploy is a brief outage. Use something like `maxUnavailable: 0, maxSurge: 25%` ([[rolling-update]]).'
					},
					{
						match: '          image: registry.internal/orders-api:latest',
						severity: 'major',
						issue: '`:latest` is mutable: a node rescheduling pulls whatever was pushed last, and rollback cannot target a version ([[mutable-image-tag]]). Deploy by immutable tag or [[image-digest|digest]].'
					},
					{
						match: '        - name: api',
						severity: 'major',
						issue: 'No resource `requests`/`limits`. The scheduler cannot place pods sensibly, HPA on CPU has nothing to compute against, and a memory leak can starve neighbours ([[resource-requests]]).'
					},
					{
						match: '            preStop: { exec: { command: ["sleep", "10"] } }',
						decoy: 'A short preStop sleep (well under the 45 s grace period) lets the load balancer deregister the pod before it stops accepting connections. A deliberate, correct pattern for [[graceful-shutdown]].'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes.** The liveness probe is the one that will page someone at 3 am.' }]
);

const i4 = pr(
	'i4-dockerfile',
	'Infra & CI PRs',
	'"Install private packages in the image"',
	8,
	{
		title: 'docker: support private npm packages',
		author: 'eva',
		description: 'We now depend on @acme/ui from the private registry. Pass NPM_TOKEN as a build arg in CI.',
		files: [
			{
				path: 'Dockerfile',
				lang: 'text',
				oldStart: 1,
				newStart: 1,
				patch: `
 FROM node:20-slim AS build
 WORKDIR /app
+ARG NPM_TOKEN
+RUN echo "//npm.acme.dev/:_authToken=\${NPM_TOKEN}" > .npmrc
 COPY package.json package-lock.json ./
-RUN npm ci
+RUN npm install
+RUN rm .npmrc
 COPY . .
 RUN npm run build
 
 FROM node:20-slim
 WORKDIR /app
 COPY --from=build /app/dist ./dist
 COPY --from=build /app/node_modules ./node_modules
 CMD ["node", "dist/server.js"]`,
				notes: [
					{
						match: 'RUN echo "//npm.acme.dev/:_authToken=${NPM_TOKEN}" > .npmrc',
						severity: 'blocker',
						issue:
							'The token is written into a layer of the build stage, and `ARG` values are also recorded in the image history. `rm .npmrc` later only hides it in a newer layer ([[build-secrets]]). If the build stage is ever pushed or cached remotely, the token is readable. Use `RUN --mount=type=secret,id=npmrc,target=/app/.npmrc npm ci`.'
					},
					{
						match: 'RUN npm install',
						severity: 'major',
						issue: '`npm install` may update the lockfile and resolve different versions than CI tested; `npm ci` installs exactly the lockfile and fails if it is out of date ([[lockfile-integrity]]). Keep `npm ci`.'
					},
					{
						match: 'CMD ["node", "dist/server.js"]',
						severity: 'minor',
						issue: 'The runtime image still runs as root and ships dev dependencies (`node_modules` from the build stage). Add `USER node` and `npm prune --omit=dev` (or install prod deps in the final stage).'
					},
					{
						match: 'FROM node:20-slim AS build',
						decoy: 'A multi-stage build is the right structure: the final stage only copies outputs. (It is also why the secret *might* not reach the final image, but "might" is not good enough for a credential.)'
					}
				]
			}
		]
	},
	[{ type: 'p', text: '**Verdict: request changes**, and rotate the token if this image was already built and pushed anywhere.' }]
);

// ═════════════════════════ PART 5 · Review the review ═════════════════════════

const r1: Question = {
	id: 'r1-review-the-review',
	group: 'Review the review',
	title: 'Which of these review comments should block the merge?',
	tag: 'tricky',
	minutes: 8,
	prompt: [
		{ type: 'p', text: 'A teammate reviewed this PR and requested changes. Read the diff, then decide for each comment: **valid & blocking**, **valid but non-blocking**, or **wrong**.' },
		{
			type: 'diff',
			diff: {
				title: 'Add per-user rate limit to /export',
				author: 'jo',
				mode: 'view',
				description: 'Exports are expensive. Limit each user to 5 exports per hour using the existing Redis token-bucket helper.',
				files: [
					{
						path: 'api/export.py',
						lang: 'python',
						oldStart: 10,
						newStart: 10,
						patch: `
 @app.post("/export")
 @login_required
 def export():
+    allowed = rate_limiter.allow(key=f"export:{g.user.id}", capacity=5, refill_per_sec=5 / 3600)
+    if not allowed:
+        return jsonify(error="Export limit reached, try again later"), 429
     job = exports.enqueue(user_id=g.user.id, filters=request.json)
     return jsonify(job_id=job.id), 202`
					}
				]
			}
		},
		{
			type: 'table',
			head: ['#', "Reviewer's comment"],
			rows: [
				['1', '"Key on `g.user.id`: users in the same company can each export 5/hour, so a 200-seat customer gets 1,000/hour. Should this be per tenant?"'],
				['2', '"`5 / 3600` is a float. Use Decimal for money-like precision." (blocking)'],
				['3', '"Return a `Retry-After` header with the 429 so clients know when to try again."'],
				['4', '"Rename `allowed` to `is_allowed`." (blocking)'],
				['5', '"This isn\'t atomic: two requests can both read 1 token left and both pass." (blocking)']
			]
		}
	],
	answerLabel: 'Show verdicts',
	answer: [
		{
			type: 'ranked',
			items: [
				{
					title: '#1: valid; blocking or not depends on the goal.',
					body: 'This is a product question worth asking, not a bug. If the goal is protecting the export workers, a per-tenant limit (or both) is right. Ask, then decide; "question:" not "must".'
				},
				{
					title: '#3: valid, non-blocking.',
					body: '`Retry-After` is good API hygiene and cheap to add; suggest it, don\'t block on it.'
				},
				{
					title: '#5: probably wrong.',
					body: 'The PR uses the **existing** token-bucket helper; if that helper is the usual Lua script / single Redis command, it is atomic. The right move is to check the helper (one click), not to block on an assumption. If the helper really does GET-then-SET, the bug is in the helper and deserves its own PR.'
				},
				{
					title: '#2: wrong.',
					body: 'A refill rate is not money; float precision of 5/3600 is irrelevant to a rate limiter. Marking it blocking wastes a review cycle.'
				},
				{
					title: '#4: nit at most; must not block.',
					body: 'Naming preference. Label it `nit:` or drop it ([[blocking-comment]]).'
				}
			]
		},
		{ type: 'p', text: '**Net:** approve after the #1 conversation (and optionally #3). Two of the three "blocking" comments should not have been blocking.' }
	]
};

const r2: Question = {
	id: 'r2-lgtm',
	group: 'Review the review',
	title: 'The approved PR that caused the incident',
	tag: 'tricky',
	minutes: 7,
	prompt: [
		{ type: 'p', text: 'This PR was approved with "LGTM, nice cleanup 👍" and caused an incident the next day: some customers received *other customers\'* notification emails. Find what the reviewer should have caught.' },
		{
			type: 'diff',
			diff: {
				title: 'refactor: cache user lookups in the notifier',
				author: 'max',
				mode: 'review',
				description: 'The notifier looked up the same users repeatedly. Moved the lookup into a small cache to cut DB load.',
				files: [
					{
						path: 'notifier/send.py',
						lang: 'python',
						oldStart: 1,
						newStart: 1,
						patch: `
+_user_cache = {}
+
+def get_user(user_id, tenant_id):
+    if user_id not in _user_cache:
+        _user_cache[user_id] = db.users.get(id=user_id, tenant_id=tenant_id)
+    return _user_cache[user_id]
+
 def send_notification(event):
-    user = db.users.get(id=event.user_id, tenant_id=event.tenant_id)
+    user = get_user(event.user_id, event.tenant_id)
     body = render(event.template, user=user)
     mailer.send(to=user.email, body=body)`,
						notes: [
							{
								match: '    if user_id not in _user_cache:',
								severity: 'blocker',
								issue:
									'The cache key drops `tenant_id`. User ids are only unique **per tenant** here (the original query needed both), so user 42 of tenant A is served for user 42 of tenant B: cross-tenant data leak ([[tenant-isolation]]). Key by `(tenant_id, user_id)`.'
							},
							{
								match: '_user_cache = {}',
								severity: 'major',
								issue: '[[unbounded-cache|Unbounded]] and never invalidated: a user who changes their email keeps receiving mail at the old address until the process restarts. Use an LRU with a short TTL, or no cache: this lookup is a primary-key read.'
							}
						]
					}
				]
			}
		}
	],
	answerLabel: 'Show model review',
	answer: [
		{
			type: 'p',
			text: '"Refactor" PRs get the lightest reviews and cause a disproportionate share of incidents. The tell was in the diff itself: the old line passed two arguments to the query, the new cache key uses one. A reviewer comparing removed vs added lines catches it in seconds.'
		},
		{
			type: 'p',
			text: 'Process fix for the postmortem: a contract test that two tenants with the same user id get their own emails, and a norm that "cache" in a PR title triggers the questions *what is the key, what invalidates it, how big can it grow*.'
		}
	]
};

// ═════════════════════════ PART 6 · Teasers ═════════════════════════

const t = (id: string, title: string, prompt: string, answer: string, minutes = 2): Question => ({
	id,
	group: 'Rapid fire',
	title,
	tag: 'teaser',
	minutes,
	prompt: prompt ? [{ type: 'p', text: prompt }] : [],
	answer: [{ type: 'p', text: answer }]
});

const teasers: Question[] = [
	t(
		't1-tests-pass',
		'"All tests pass", so what?',
		'The PR adds a retry and all 412 tests are green. What is the first thing you check?',
		'Whether any test **exercises the change**. A new code path with no test (here: success-after-timeout) is "green" by default. Check the diff of the test files first; if it is empty, the green build says nothing about this PR.'
	),
	t(
		't2-flag-default',
		'A feature flag defaulting to on',
		'`new_checkout: bool = flags.get("new_checkout", default=True)`. What is wrong?',
		'If the flag service is unreachable or the flag is missing in an environment, everyone gets the unfinished feature. Defaults should be the **safe/old** behaviour (`False`), so a flag outage degrades to yesterday, not to an experiment ([[feature-flag]]).'
	),
	t(
		't3-review-size',
		'The 2,400-line PR',
		'Someone asks for review on a 2,400-line PR "just refactoring + the new feature". What do you do first?',
		'Ask to split it: mechanical refactor (reviewable quickly, behaviour-preserving) and the feature (reviewable carefully). Review quality drops sharply with size; a huge mixed diff hides exactly the kind of one-line change that caused the tenant leak in the previous question.'
	),
	t(
		't4-api-field',
		'Renaming a response field',
		'A PR renames `total` to `totalCents` in a public JSON response "for clarity". Approve?',
		'Not as is: it is a [[breaking-change]] for every client, including old mobile app versions you cannot force-update. Add `totalCents` alongside `total`, deprecate, measure usage, remove later (or ship under a new API version).'
	),
	t(
		't5-ask-vs-tell',
		'Ask or tell?',
		'You think a loop is O(n²) but aren\'t sure how big n gets. How do you phrase the comment?',
		'As a question with your reasoning: "question: this nested loop is O(n²); how many line items can an invoice have? If it can reach thousands, a dict lookup would avoid it." Telling ("make this O(n)") is right when you know it matters; asking invites context you may lack and keeps the review collaborative.'
	)
];

// ═════════════════════════ assessment ═════════════════════════

const assessment: Assessment = {
	id: 'code-review',
	number: 18,
	title: 'Code review',
	tagline: 'Real-looking pull requests: click the lines you would comment on, then compare with a model review.',
	description:
		'Each question is a pull request. Click every line you would leave a comment on, submit, and see what you found, what you missed, and which "suspicious" lines were actually fine. The model review then ranks the comments, shows the fix, and gives a verdict. The bugs are the kind that pass CI: races, retries without [[idempotency-key|idempotency keys]], unsafe migrations, leaks across tenants, and infrastructure changes that delete things.',
	minutes: 200,
	difficulty: 'advanced',
	track: 'interactive',
	topics: ['backend', 'migrations', 'React', 'CI/CD', 'Terraform', 'Kubernetes', 'security', 'review etiquette'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Backend PRs', minutes: 54 },
				{ label: '2 · Data & migrations', minutes: 44 },
				{ label: '3 · Frontend PRs', minutes: 42 },
				{ label: '4 · Infra & CI PRs', minutes: 35 },
				{ label: '5 · Review the review', minutes: 15 },
				{ label: 'Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'How to review (and how this is scored)',
			text: '**Read the description first**, then ask "what is the riskiest thing this change could do?" before reading line by line. Compare removed and added lines: many bugs are a dropped argument or condition. For each comment decide **blocking** (correctness, security, data loss, unsafe deploy) vs **non-blocking** (`nit:`, `suggestion:`, `question:`). Scoring: each planted issue found counts; **noise comments** (flagging fine lines, the decoys) count against you, just as they cost a real team time.'
		},
		{
			type: 'callout',
			tone: 'warn',
			title: 'Ask vs tell',
			text: 'Tell when you are sure and it matters ("this leaks tenant data: scope the query by tenant_id"). Ask when you are missing context ("question: can this list exceed 1,000 items?"). Explain *why* in one sentence, suggest a fix, and never block on taste ([[blocking-comment]]).'
		}
	],
	parts: [
		{ id: 'p1', nav: '1 · Backend', eyebrow: 'Part 1 · 54 minutes', title: 'Backend PRs', meta: 'Python · Go · TypeScript · Java', minutes: 54, questions: [b1, b2, b3, b4, b5, b6] },
		{ id: 'p2', nav: '2 · Data', eyebrow: 'Part 2 · 44 minutes', title: 'Data & migrations', meta: 'SQL · Kafka consumers · jobs', minutes: 44, questions: [d1, d2, d3, d4, d5] },
		{ id: 'p3', nav: '3 · Frontend', eyebrow: 'Part 3 · 42 minutes', title: 'Frontend PRs', meta: 'React · Next.js · TypeScript', minutes: 42, questions: [f1, f2, f3, f4, f5] },
		{ id: 'p4', nav: '4 · Infra & CI', eyebrow: 'Part 4 · 35 minutes', title: 'Infra & CI PRs', meta: 'GitHub Actions · Terraform · Kubernetes · Docker', minutes: 35, questions: [i1, i2, i3, i4] },
		{ id: 'p5', nav: '5 · Meta', eyebrow: 'Part 5 · 15 minutes', title: 'Review the review', meta: 'judging other people\'s comments', minutes: 15, questions: [r1, r2] },
		{ id: 'teasers', nav: 'Rapid fire', eyebrow: 'Rapid fire · 2 min each', title: 'Rapid fire', minutes: 10, questions: teasers }
	]
};

export default assessment;
