import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'reconciliation',
		term: 'Reconciliation',
		category: 'business',
		short:
			'Matching two independent records of the same money, such as your database and the payment provider, line by line until every difference is explained. Totals that "almost match" aren\'t good enough: each gap has a cause (timing, refunds, fees, currency), and finance needs the list of causes, not a rounded-off number.',
		analogy: 'Checking your bank statement against your own spending notes, receipt by receipt.',
		related: ['settlement', 'day-boundary', 'minor-units']
	},
	{
		id: 'settlement',
		term: 'Settlement',
		category: 'business',
		short:
			'The moment money actually moves into your bank account, usually 1–7 days after the customer was charged, minus fees and refunds, and grouped into payouts. A "revenue" report can be built on charge date, settlement date or payout date, and each gives a different daily number for the same sales.',
		related: ['reconciliation', 'chargeback']
	},
	{
		id: 'chargeback',
		term: 'Chargeback (dispute)',
		aliases: ['dispute'],
		category: 'business',
		short:
			"The customer asks their bank to reverse a card payment, and the bank pulls the money back from you plus a fee. Card networks watch your dispute rate; above roughly 0.75–1% of transactions you can be put on a monitoring program or lose the ability to take cards. Many disputes aren't fraud: the customer simply doesn't recognise the charge.",
		related: ['billing-descriptor', 'settlement']
	},
	{
		id: 'billing-descriptor',
		term: 'Billing descriptor',
		category: 'business',
		short:
			'The short text that appears on a customer\'s card statement next to a charge (e.g. "LEDGERLY* PRO PLAN"). If it doesn\'t match the brand the customer knows, they think it\'s fraud and dispute it, even though the charge is legitimate.',
		related: ['chargeback']
	},
	{
		id: 'mrr',
		term: 'MRR (monthly recurring revenue)',
		aliases: ['monthly recurring revenue'],
		category: 'business',
		short:
			'The predictable subscription revenue you expect each month, normalised so annual plans count as 1/12 per month. Because it is usually computed as a snapshot at a point in time, it is very sensitive to *when* the snapshot runs relative to renewals, cancellations and upgrades.',
		related: ['proration', 'snapshot-timing']
	},
	{
		id: 'snapshot-timing',
		term: 'Snapshot timing',
		category: 'business',
		short:
			'A report that reads the data at a single moment ("as of 00:15 on the 1st") only sees what has landed by then. If a batch job that writes the data is still running, the report captures a partial picture, and the number looks like a real business drop when it is really a race between two scheduled jobs.',
		related: ['mrr', 'eventual-consistency']
	},
	{
		id: 'day-boundary',
		term: 'Day boundary',
		category: 'money & time',
		short:
			'Where "yesterday" starts and ends depends on the timezone you count in. Midnight in UTC is 20:00 the previous evening in New York, so the same sale can land on different days in two reports. Totals over a long period agree; daily numbers disagree, and the gap moves money between neighbouring days.',
		analogy: 'Two shops that close their tills at different times will report different "daily" takings for the same customers.',
		related: ['utc', 'iana-timezone', 'reconciliation'],
		page: [
			{
				type: 'p',
				text: 'Every daily number has a hidden parameter: *which midnight*. Databases usually store [[utc]] timestamps. Payment dashboards, ad platforms and spreadsheets usually group by the account owner\'s timezone. Neither is wrong; they are answering different questions.'
			},
			{ type: 'heading', text: 'Worked example' },
			{
				type: 'p',
				text: 'A shop on `America/Los_Angeles` (UTC−7 in summer) sells $900 at 18:30 local on Monday. That is 01:30 UTC **Tuesday**.'
			},
			{
				type: 'table',
				head: ['Report', 'Groups by', 'Monday', 'Tuesday'],
				rows: [
					['Our SQL dashboard', '`date(created_at)` in UTC', '$0', '$900'],
					['Payment provider', 'Account timezone (LA)', '$900', '$0']
				]
			},
			{
				type: 'p',
				text: 'Sum the week and both say $900. That is the signature: **daily differences that net to roughly zero over a longer window** and that are biggest on days with lots of evening sales.'
			},
			{ type: 'heading', text: 'How to spot it' },
			{
				type: 'list',
				items: [
					'Differences flip sign between consecutive days (+X on Monday, −X on Tuesday).',
					'Weekly or monthly totals match much better than daily ones.',
					'The gap is proportional to how much business happens in the hours between the two midnights.'
				]
			},
			{ type: 'heading', text: 'Fix' },
			{
				type: 'code',
				lang: 'sql',
				code: "-- Group by the business's day, not the server's\nSELECT (created_at AT TIME ZONE 'America/Los_Angeles')::date AS business_day,\n       sum(amount_cents) / 100.0 AS revenue\nFROM charges\nGROUP BY 1 ORDER BY 1;"
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Pick one business timezone, write it in the report title ("days in Pacific time"), and use an [[iana-timezone]] name, never a fixed offset like `-07:00`, or DST will move the boundary twice a year.'
			}
		]
	},
	{
		id: 'zero-decimal-currency',
		term: 'Zero-decimal currency',
		category: 'money & time',
		short:
			'Currencies like the Japanese yen (JPY) or Korean won (KRW) have no cents, so their smallest unit is 1. Others, like the Kuwaiti or Bahraini dinar, have three decimals. Code that always divides by 100 to turn [[minor-units]] into a display amount is wrong for both groups.',
		related: ['minor-units', 'locale-formatting']
	},
	{
		id: 'locale-formatting',
		term: 'Locale formatting',
		aliases: ['decimal comma', 'number format'],
		category: 'frontend & network',
		short:
			'Different countries write the same number differently: `1,299.50` in the US is `1.299,50` in Germany and `1 299,50` in France. Formatting for display is easy with `Intl.NumberFormat`; the dangerous direction is *parsing* human-entered or spreadsheet text, where `parseFloat("12,99")` quietly returns `12`.',
		related: ['type-coercion', 'zero-decimal-currency']
	},
	{
		id: 'cdn-cache-key',
		term: 'CDN cache key',
		category: 'frontend & network',
		short:
			"A CDN decides whether two requests can share one stored response by comparing a *cache key*, usually just the host and path. Anything the origin used to build the response that isn't in the key (cookie, country, language, logged-in user) is ignored, so the first visitor's version gets served to everyone who comes after.",
		analogy: 'A cloakroom that hands out coats by ticket colour only: fine until two people have the same colour.',
		related: ['vary-header', 'cache-control', 'ttl'],
		page: [
			{
				type: 'p',
				text: 'A CDN sits between users and your servers and keeps copies of responses. For each request it computes a key, by default something like `GET example.com/pricing`, and if it has a fresh copy under that key, it serves it without asking your server.'
			},
			{ type: 'heading', text: 'The failure mode' },
			{
				type: 'flow',
				steps: [
					{ label: 'Visitor in Berlin', note: 'GET /pricing' },
					{ label: 'CDN: MISS', note: 'key = /pricing' },
					{ label: 'Origin', note: 'sees DE → renders €' },
					{ label: 'CDN stores', note: 'under /pricing', tone: 'warn' },
					{ label: 'Visitor in Ohio', note: 'HIT → gets €', tone: 'crit' }
				]
			},
			{
				type: 'p',
				text: 'Same thing with logged-in pages: if `/account` gets cached once, the next person sees the first person\'s name and address. That is a data breach, not a cosmetic bug.'
			},
			{ type: 'heading', text: 'Three ways to fix it' },
			{
				type: 'list',
				ordered: true,
				items: [
					'**Don\'t cache it:** personalised responses send `Cache-Control: private, no-store`.',
					'**Put the input in the key:** add the country / language to the cache key (CDN config), or send a [[vary-header]].',
					'**Put the input in the URL:** `/de/pricing` and `/us/pricing` are different keys by construction. This is the most predictable option.'
				]
			},
			{
				type: 'callout',
				tone: 'crit',
				title: 'Rule of thumb',
				text: 'If the response depends on *who* is asking, it must not be stored in a shared cache. Check this whenever a deploy touches headers, middleware, or CDN rules.'
			}
		]
	},
	{
		id: 'vary-header',
		term: 'Vary header',
		category: 'frontend & network',
		short:
			'A response header (`Vary: Accept-Language`) that tells caches "this response changes depending on that request header, so store a separate copy per value". Forgetting it means caches serve one variant to everyone; using it on high-cardinality headers like `Cookie` effectively disables caching.',
		related: ['cdn-cache-key', 'cache-control', 'cardinality']
	},
	{
		id: 'cache-control',
		term: 'Cache-Control',
		category: 'frontend & network',
		short:
			'The HTTP header that tells browsers and CDNs whether and how long they may store a response. `public, max-age=60` means "anyone, including shared CDNs, may keep this for 60 seconds"; `private` means "only the user\'s own browser"; `no-store` means "don\'t keep it at all". One wrong default in shared middleware can make every page cacheable.',
		related: ['cdn-cache-key', 'vary-header', 'ttl']
	},
	{
		id: 'dns-ttl',
		term: 'DNS TTL',
		category: 'cloud & infra',
		short:
			"How long resolvers (your ISP, an office network, a laptop) may remember the IP address for a domain before asking again. If you move a site to a new IP while the old record had a 24-hour TTL, some people keep going to the old address for up to a day. Who is affected depends on which resolver they use, which is why it looks like 'down for me, fine for everyone else'.",
		related: ['ttl', 'tls-certificate']
	},
	{
		id: 'tls-certificate',
		term: 'TLS certificate',
		category: 'security & compliance',
		short:
			'The file a server presents to prove it really is `example.com`, which makes the padlock appear. Certificates expire (often every 90 days) and must be installed on every edge or load balancer separately, so one forgotten server can show a scary browser warning only to users routed to it.',
		related: ['dns-ttl']
	},
	{
		id: 'gdpr-erasure',
		term: 'Right to erasure (GDPR Art. 17)',
		aliases: ['right to be forgotten', 'data deletion request'],
		category: 'security & compliance',
		short:
			"EU law lets a person ask you to delete their personal data, and you generally must do it within one month. Deleting the row in your main database isn't enough: copies live in email tools, analytics, CRMs, logs and backups, and a deleted person who gets marketing email is evidence the process is broken.",
		related: ['suppression-list', 'personal-data-breach', 'data-remediation'],
		page: [
			{
				type: 'p',
				text: 'An erasure request is a promise that *every* system holding that person\'s data will forget them, and that they won\'t come back. The hard part is not the `DELETE` statement, it\'s the copies.'
			},
			{ type: 'heading', text: 'Where personal data hides' },
			{
				type: 'cards',
				items: [
					{ title: 'Operational', items: ['Primary DB and read replicas', 'Search index', 'Caches'] },
					{ title: 'Third parties', items: ['Email / marketing platform', 'CRM, support desk', 'Analytics, ad audiences'] },
					{ title: 'History', items: ['Backups and snapshots', 'Data warehouse', 'Logs, exported CSVs'] }
				]
			},
			{ type: 'heading', text: 'The resurrection problem' },
			{
				type: 'p',
				text: 'If you restore a backup taken before the deletion, the person is back. If a nightly job syncs your user table to the email tool, they\'re re-subscribed the next night. That\'s why mature systems keep a **[[suppression-list]]**: a list of hashed identifiers that must never be contacted or re-imported, checked by every sync and every send, and re-applied after every restore.'
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Backups are usually allowed to keep the data until they expire *if* you guarantee it is re-deleted when restored. "We restored a backup and forgot" is exactly the failure regulators ask about.'
			}
		]
	},
	{
		id: 'suppression-list',
		term: 'Suppression list',
		category: 'security & compliance',
		short:
			'A permanent "never contact" list (usually hashed email addresses) that every send and every import is checked against. Unlike deleting a contact, which can be undone by the next sync or a backup restore, a suppression entry keeps blocking the person even when their data reappears from somewhere else.',
		related: ['gdpr-erasure']
	},
	{
		id: 'personal-data-breach',
		term: 'Personal data breach',
		category: 'security & compliance',
		short:
			'Under GDPR, any incident where personal data is seen, changed or lost by someone who shouldn\'t have it, including by accident, such as a cache showing one user\'s address to another. The company usually has 72 hours from becoming aware to notify the regulator, so engineers must escalate immediately, not after the fix.',
		related: ['gdpr-erasure', 'severity-triage', 'cdn-cache-key']
	},
	{
		id: 'unicode-normalization',
		term: 'Unicode normalization',
		aliases: ['NFC', 'NFD', 'diacritics'],
		category: 'frontend & network',
		short:
			'The same visible text can be stored as different bytes: "é" can be one character (NFC) or "e" plus a combining accent (NFD). Comparisons, length limits and strict external APIs treat these differently, so a name that looks identical can match in one system and be rejected by another.',
		related: ['type-coercion', 'swallowed-exception'],
		page: [
			{
				type: 'p',
				text: 'Unicode lets you write "é" two ways. They look identical on screen but are different strings to a computer.'
			},
			{
				type: 'table',
				head: ['Form', 'Code points', 'Length in JS', 'UTF-8 bytes'],
				rows: [
					['NFC (composed)', '`U+00E9`', '1', '2'],
					['NFD (decomposed)', '`U+0065 U+0301`', '2', '3']
				],
				numeric: [2, 3]
			},
			{
				type: 'code',
				lang: 'ts',
				code: "const a = 'Jos\\u00e9';          // typed on Windows\nconst b = 'Jose\\u0301';         // pasted from macOS\na === b;                          // false\na.normalize('NFC') === b.normalize('NFC'); // true"
			},
			{ type: 'heading', text: 'Where it bites' },
			{
				type: 'list',
				items: [
					'**Lookups:** searching "José" doesn\'t find the user saved in the other form.',
					'**Length limits:** a 35-character field limit counted in bytes or code points rejects names that look short.',
					'**Strict partner APIs:** carriers, banks and government systems often accept only Latin-1 or ASCII, and reject or mangle "Łukasz", "Zoë", "Nguyễn".'
				]
			},
			{
				type: 'callout',
				text: 'Normalize to NFC once at the boundary (input or save). When a partner can\'t handle Unicode, transliterate deliberately (`Ł → L`) for that partner only, and keep the original name in your own database.'
			}
		]
	},
	{
		id: 'oversell',
		term: 'Oversell',
		category: 'databases',
		short:
			'Selling more units than you have, because two purchases each checked "is there stock?" before either one subtracted. Both saw 1 left, both succeeded, stock is now −1. It only shows up under concurrent traffic, which is why flash sales find it and tests don\'t.',
		related: ['race-condition', 'conditional-update']
	},
	{
		id: 'conditional-update',
		term: 'Conditional (atomic) update',
		category: 'databases',
		short:
			'Doing the check and the change in one database statement, e.g. `UPDATE stock SET qty = qty - 1 WHERE sku = $1 AND qty >= 1`, then looking at how many rows changed. The database makes that single statement atomic, so two buyers can\'t both take the last unit; the loser gets "0 rows updated" and is told it\'s sold out.',
		related: ['oversell', 'race-condition']
	},
	{
		id: 'duplicate-scheduler',
		term: 'Duplicate scheduled jobs',
		aliases: ['in-process cron', 'leader election'],
		category: 'distributed systems',
		short:
			'A timer that lives inside the app process ("every day at 09:00, send the newsletter") runs once per running copy of the app. With one server that\'s fine; after [[autoscaling]] to three, the job runs three times. Scheduled work needs a single owner: an external scheduler, a lock, or leader election.',
		related: ['autoscaling', 'idempotency', 'idempotency-key']
	},
	{
		id: 'queue-age',
		term: 'Age of oldest message',
		aliases: ['queue latency', 'queue lag'],
		category: 'messaging',
		short:
			'How long the oldest unprocessed item has been waiting in a queue. Queue *length* can look fine while age is huge (a few stuck messages), and age is what users feel: a password-reset email that waits 20 minutes in a queue arrives already expired.',
		related: ['ttl', 'eventual-consistency']
	},
	{
		id: 'sample-ratio-mismatch',
		term: 'Sample ratio mismatch (SRM)',
		category: 'business',
		short:
			"In an A/B test meant to split 50/50, getting noticeably uneven group sizes (say 56/44) means something is dropping or adding users in one group, such as a redirect, a crash, or a bot filter. When that happens the test result can't be trusted, however good it looks.",
		related: ['feature-flag']
	},
	{
		id: 'severity-triage',
		term: 'Severity triage',
		category: 'reliability practice',
		short:
			'Deciding how urgent a report is from its impact, not from how loudly or senior the reporter is. The questions: is anyone\'s data exposed, is money being taken or lost, how many people are affected, is it getting worse, and is there a workaround?',
		related: ['personal-data-breach', 'rollback'],
		page: [
			{
				type: 'p',
				text: 'Severity is a property of the **impact**, not the reporter. The CEO saying "the site is down" and an anonymous customer saying "I saw someone else\'s address" are triaged on what is actually happening, and the second is far worse.'
			},
			{
				type: 'table',
				head: ['Level', 'Typical meaning', 'Examples', 'Response'],
				rows: [
					[
						'SEV1',
						'Data exposure, money wrongly taken at scale, full outage',
						'User sees another user\'s data; customers double-charged right now',
						'Page on-call, incident channel, legal/security in the loop, updates every 30–60 min'
					],
					['SEV2', 'Major feature broken or many users affected, workaround hard', 'Checkout failing for one card type; emails delayed hours', 'Same-day fix, owner named, status updates'],
					['SEV3', 'Minority affected, workaround exists', 'Labels missing for some names; dashboard mismatch', 'Scheduled fix this sprint, reply to reporter'],
					['SEV4', 'Cosmetic or question', 'Wrong date format in an export', 'Backlog']
				]
			},
			{ type: 'heading', text: 'Five questions to ask' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Is any personal data exposed to the wrong person? → treat as SEV1 until proven otherwise.',
					'Is money being taken, lost, or misreported to customers?',
					'How many users, and is the number growing?',
					'Is there a workaround the reporter can use today?',
					'Is it ongoing, or did it happen once?'
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'It\'s fine to start high and downgrade. Starting low and discovering a breach two days later is not, because of the [[personal-data-breach|72-hour notification clock]].'
			}
		]
	}
];

export default terms;
