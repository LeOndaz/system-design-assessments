import type { GlossaryTerm } from '../types';

/** Terms introduced by the code-review assessment (#18). */
const terms: GlossaryTerm[] = [
	{
		id: 'check-then-act',
		term: 'Check-then-act',
		aliases: ['TOCTOU', 'time-of-check to time-of-use'],
		category: 'distributed systems',
		short:
			'Code that reads a value, decides based on it, and then writes in a separate step: "if stock > 0, then decrement". Between the check and the act another request can change the value, so two requests both pass the check and both act. It hides in tests because tests rarely run two requests at the same instant.',
		analogy: 'Two people look at the last seat on a flight, both see "available", and both click Book.',
		related: ['race-condition', 'lost-update', 'conditional-update', 'atomic-update', 'select-for-update', 'oversell']
	},
	{
		id: 'sql-injection',
		term: 'SQL injection',
		aliases: ['parameterized query', 'prepared statement', 'ORDER BY injection'],
		category: 'security & compliance',
		short:
			'Building a SQL string by gluing in user input, so the input can change the query itself instead of being treated as data. Parameterized queries (`WHERE id = %s` with the value passed separately) fix it for values, but identifiers such as column names in `ORDER BY` cannot be parameters, so they must be mapped through an allowlist.',
		analogy: 'Letting a customer fill in the blank on a cheque by handing them the pen and the whole cheque.',
		related: ['least-privilege', 'row-level-security'],
		page: [
			{ type: 'heading', text: 'Values vs identifiers' },
			{
				type: 'columns',
				columns: [
					{
						title: 'Unsafe',
						blocks: [
							{
								type: 'code',
								lang: 'python',
								code: `sort = request.args["sort"]          # "created_at; DROP TABLE orders--"
sql = f"SELECT * FROM orders ORDER BY {sort}"
cur.execute(sql)`
							}
						]
					},
					{
						title: 'Safe',
						blocks: [
							{
								type: 'code',
								lang: 'python',
								code: `SORTABLE = {"created": "created_at", "total": "total_cents"}
col = SORTABLE.get(request.args.get("sort"), "created_at")
direction = "DESC" if request.args.get("dir") == "desc" else "ASC"
cur.execute(f"SELECT * FROM orders WHERE tenant_id = %s ORDER BY {col} {direction}", (tenant_id,))`
							}
						]
					}
				]
			},
			{
				type: 'p',
				text: 'The f-string in the safe version is fine: everything it interpolates comes from a dictionary or a fixed choice the code controls. Every *value* still goes through the parameter tuple. The review smell is any f-string or `+` that touches request data on its way into SQL.'
			}
		]
	},
	{
		id: 'stale-closure',
		term: 'Stale closure',
		aliases: ['stale state', 'useEffect dependency array'],
		category: 'frontend & network',
		short:
			'A function that captured variables when it was created and keeps using those old values later. In React, an interval or event listener created in an effect sees the state from the render that created it, so `setCount(count + 1)` keeps writing the same number. The fixes are a functional update (`setCount(c => c + 1)`), listing the variable in the dependency array, or a ref.',
		analogy: 'A sticky note with yesterday\'s price on it: you keep quoting the note instead of checking the shelf.',
		related: ['effect-cleanup', 'stale-response', 'optimistic-ui']
	},
	{
		id: 'effect-cleanup',
		term: 'Effect cleanup',
		aliases: ['useEffect cleanup', 'AbortController', 'removeEventListener'],
		category: 'frontend & network',
		short:
			'The function an effect returns so React can undo it before the effect runs again or the component unmounts: clear the interval, remove the listener, abort the fetch. Without it, listeners pile up on every re-render, timers keep firing after unmount, and a slow old request can overwrite the result of a newer one.',
		related: ['stale-closure', 'stale-response', 'memory-leak']
	},
	{
		id: 'xss',
		term: 'Cross-site scripting (XSS)',
		aliases: ['XSS', 'dangerouslySetInnerHTML', 'innerHTML'],
		category: 'security & compliance',
		short:
			'Getting a victim\'s browser to run attacker-supplied script inside your site, where it can read the page, act as the logged-in user, and steal tokens. Frameworks escape text by default; the holes are the escape hatches (`dangerouslySetInnerHTML`, `innerHTML`, `v-html`, unescaped template output) fed with user-controlled content. Sanitize with an allowlist sanitizer or render as text.',
		related: ['content-security-policy', 'csrf']
	},
	{
		id: 'context-propagation',
		term: 'Context propagation (Go)',
		aliases: ['context.Context', 'context.Background', 'ctx'],
		category: 'distributed systems',
		short:
			'Passing the caller\'s `context.Context` down every call so cancellation and deadlines flow through. When a handler uses `context.Background()` instead of the request\'s `ctx`, work keeps running after the client has gone or the deadline has passed, holding goroutines and connections for nobody.',
		related: ['deadline-propagation', 'goroutine-leak', 'timeout']
	},
	{
		id: 'breaking-change',
		term: 'Breaking API change',
		aliases: ['backward compatibility', 'API contract'],
		category: 'reliability practice',
		short:
			'A change that makes existing clients fail without them changing anything: removing or renaming a field, changing a type (number → string), making an optional input required, changing an error code or default. Adding optional fields is usually safe. Old mobile apps and partners can call your API for years, so breaking changes need a new version or an expand-then-contract migration.',
		related: ['api-versioning', 'expand-contract-migration', 'schema-evolution']
	},
	{
		id: 'statement-timeout',
		term: 'statement_timeout / lock_timeout',
		aliases: ['statement_timeout', 'lock_timeout'],
		category: 'databases',
		short:
			'Postgres settings that cap how long one statement may run (`statement_timeout`) or wait for a lock (`lock_timeout`). In migrations, a short `lock_timeout` turns "this ALTER waits behind a long query and blocks every request queued after it" into "this ALTER fails fast and we retry".',
		related: ['lock-queue', 'lock-timeout', 'expand-contract-migration']
	},
	{
		id: 'unbounded-cache',
		term: 'Unbounded in-process cache',
		aliases: ['memory-leak cache', 'module-level Map'],
		category: 'caching',
		short:
			'A dictionary or `Map` used as a cache with no size limit and no expiry. Every distinct key stays forever, so memory grows with traffic until the process is OOM-killed. Keys derived from user input (URLs, search terms) make it grow fastest. Use an LRU with a max size and a TTL.',
		related: ['lru', 'memory-leak', 'ttl', 'cardinality']
	},
	{
		id: 'build-secrets',
		term: 'Secrets in image layers',
		aliases: ['ARG secret', 'Docker build secret', 'BuildKit secret mount'],
		category: 'security & compliance',
		short:
			'Passing a token into `docker build` with `ARG`/`ENV` or copying a `.npmrc` writes it into an image layer. Deleting it in a later step does not help: earlier layers are still in the image and anyone who can pull it can read them. Use BuildKit secret mounts (`RUN --mount=type=secret`), which never land in a layer.',
		related: ['least-privilege', 'secret-rotation']
	},
	{
		id: 'blocking-comment',
		term: 'Blocking vs non-blocking review comments',
		aliases: ['nit', 'conventional comments', 'request changes'],
		category: 'reliability practice',
		short:
			'A blocking comment says "this must change before merge": correctness, security, data loss, an unsafe migration. A non-blocking comment ("nit:", "suggestion:", "question:") can be taken or left. Labelling them stops reviews stalling on style while making sure real problems are not mistaken for preference.',
		related: ['postmortem']
	}
];

export default terms;
