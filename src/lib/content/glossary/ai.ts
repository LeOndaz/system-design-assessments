import type { GlossaryTerm } from '../types';
import { shape, step, timeAxis } from '../series';

const scX = timeAxis('09:00', 48, 5);

const terms: GlossaryTerm[] = [
	// ───────────────────────── retrieval ─────────────────────────
	{
		id: 'hnsw',
		term: 'HNSW (Hierarchical Navigable Small World)',
		aliases: ['HNSW', 'hierarchical navigable small world', 'ef_search', 'efConstruction'],
		category: 'ai & retrieval',
		short:
			'The most common [[vector-index|approximate nearest-neighbour index]]. Every vector is a node in a layered graph linked to its closest neighbours; a search starts at the sparse top layer and greedily walks closer and closer to the query. `M` sets how many links each node keeps (memory and recall), and `ef_search` sets how many candidates the walk keeps (recall versus latency). It is approximate: it can miss the true nearest neighbour, and how often is what [[recall-at-k|recall@k]] measures.',
		analogy:
			'Finding a house by asking for directions: first a motorway sign to the right city, then a street sign, then a neighbour who points at the door. Fast, but a wrong turn early means you never reach the best house.',
		related: ['vector-index', 'recall-at-k', 'filtered-vector-search', 'product-quantization'],
		page: [
			{ type: 'heading', text: 'The three knobs' },
			{
				type: 'table',
				head: ['Knob', 'Set when', 'Raising it', 'Cost'],
				rows: [
					['`M` (links per node)', 'index build', 'higher recall, more robust graph', 'memory ≈ 2·M·4 bytes per vector at the base layer (M=32 → 256 B)'],
					['`ef_construction`', 'index build', 'better graph quality', 'slower builds'],
					['`ef_search`', 'every query', 'higher recall', 'latency grows roughly linearly with candidates visited']
				]
			},
			{ type: 'heading', text: 'Worked example: memory for 50M vectors' },
			{
				type: 'list',
				items: [
					'Raw vectors, 1,536 dims × 4 bytes = 6,144 B each → 50M × 6,144 B = **307.2 GB**.',
					'Graph links at M = 32: 2 × 32 × 4 B = 256 B each → **12.8 GB**.',
					'So the vectors, not the graph, are what blow the memory budget. That is why large indexes add [[product-quantization]].'
				]
			},
			{ type: 'heading', text: 'How it fails' },
			{
				type: 'list',
				items: [
					'**Filters:** a post-filter on a small tenant leaves almost nothing of the `ef_search` candidates. See [[filtered-vector-search]].',
					'**Deletes:** most implementations tombstone nodes; heavy churn degrades the graph until you rebuild.',
					'**Distribution shift:** a graph built on one kind of document routes poorly for queries about a very different kind.'
				]
			}
		]
	},
	{
		id: 'ivf-index',
		term: 'IVF index (inverted file)',
		aliases: ['IVF', 'nprobe', 'nlist'],
		category: 'ai & retrieval',
		short:
			'An approximate vector index that first clusters all vectors into `nlist` buckets (k-means), then at query time only scans the `nprobe` buckets whose centres are closest to the query. More probes means higher [[recall-at-k|recall]] and more latency. It is cheaper to build than [[hnsw|HNSW]] and pairs naturally with [[product-quantization]], but recall drops sharply when the right answer sits in a bucket you did not probe.',
		analogy: 'Searching a library by first walking to the three most likely shelves, never the whole building.',
		related: ['hnsw', 'product-quantization', 'vector-index']
	},
	{
		id: 'product-quantization',
		term: 'Product quantization (PQ)',
		aliases: ['PQ', 'vector compression', 'IVF-PQ'],
		category: 'ai & retrieval',
		short:
			'A lossy compression for vectors: split each vector into `m` sub-vectors and replace each with the id of its nearest centroid from a small codebook (usually 8 bits). A 1,536-dim float32 vector (6,144 bytes) with m = 96 becomes 96 bytes, 64× smaller. Distances become approximate, so [[recall-at-k|recall]] drops; the usual fix is to retrieve extra candidates with PQ and re-score the top ones with the full vectors.',
		related: ['hnsw', 'ivf-index', 'recall-at-k']
	},
	{
		id: 'recall-at-k',
		term: 'Recall@k',
		aliases: ['recall@10', 'ANN recall', 'retrieval recall'],
		category: 'ai & retrieval',
		short:
			'Of the documents that should have been retrieved for a query, the fraction that appear in the top k results. It is used two ways that are easy to confuse: **ANN recall** (did the approximate index return the same top k as an exact search would?) and **retrieval recall** (did the system return the documents a human labelled relevant?). An index can have 99% ANN recall and still terrible retrieval recall if the embeddings are bad.',
		related: ['hnsw', 'golden-eval-set', 'recall-precision']
	},
	{
		id: 'filtered-vector-search',
		term: 'Filtered vector search (pre- vs post-filter)',
		aliases: ['metadata filtering', 'post-filtering', 'pre-filtering'],
		category: 'ai & retrieval',
		short:
			'Combining a nearest-neighbour search with a metadata condition such as `tenant_id = 42`. **Post-filtering** runs the ANN search first and then drops non-matching results, so a tenant that owns 0.5% of the index gets on average 0.5 matches out of 100 candidates. **Pre-filtering** or filter-aware search restricts the walk to matching vectors, which keeps results but can be slower or break the graph\'s shortcuts. Small tenants in a shared index are where post-filtering silently returns nothing.',
		related: ['hnsw', 'multi-tenancy', 'tenant-isolation']
	},
	{
		id: 'bm25',
		term: 'BM25',
		aliases: ['Okapi BM25', 'lexical search', 'keyword search'],
		category: 'ai & retrieval',
		short:
			'The classic keyword-ranking formula behind most search engines. A document scores higher when it contains the query\'s words, especially rare words, with diminishing returns for repeats and a penalty for very long documents. It excels at exact identifiers, error codes and names that embeddings blur together, which is why it is paired with dense retrieval in [[hybrid-search]].',
		related: ['hybrid-search', 'reciprocal-rank-fusion']
	},
	{
		id: 'reciprocal-rank-fusion',
		term: 'Reciprocal rank fusion (RRF)',
		aliases: ['RRF', 'rank fusion'],
		category: 'ai & retrieval',
		short:
			'A simple way to merge ranked lists from different retrievers (for example [[bm25|BM25]] and dense vectors): each document scores Σ 1 / (k + rank) across the lists, with k usually 60. It ignores raw scores, which makes it robust, but it also flattens a strong win in one list: rank 1 in one list contributes only 1/61 ≈ 0.016, barely more than rank 10 (1/70 ≈ 0.014).',
		related: ['hybrid-search', 'bm25'],
		page: [
			{ type: 'p', text: 'Score of a document d: **RRF(d) = Σ over lists of 1 / (60 + rank of d in that list)**. A document missing from a list contributes nothing from it.' },
			{ type: 'heading', text: 'Worked example: the error-code query' },
			{
				type: 'table',
				head: ['Doc', 'BM25 rank', 'Dense rank', 'RRF score'],
				numeric: [1, 2, 3],
				rows: [
					['A · page that contains `ERR-4417`', '1', '50', '1/61 + 1/110 = 0.0255'],
					['B · generic "troubleshooting errors" page', '10', '3', '1/70 + 1/63 = 0.0302'],
					['D · another generic page', '4', '6', '1/64 + 1/66 = 0.0308'],
					['C · dense-only match', '–', '1', '1/61 = 0.0164']
				],
				caption: 'The only page that mentions the code ends up third. Weighting BM25 3× gives A 0.0583 vs B 0.0587: still second.'
			},
			{ type: 'heading', text: 'What to do instead' },
			{
				type: 'list',
				items: [
					'Route by query type: identifiers, codes and quoted phrases go to lexical search first (or exclusively).',
					'Add an exact-match boost that is not rank-based.',
					'Tune k: a smaller k (e.g. 10) lets top ranks matter more, at the cost of robustness.',
					'Evaluate fusion on a labelled set that includes identifier queries; averages over natural-language questions hide this.'
				]
			}
		]
	},
	{
		id: 'parent-child-chunking',
		term: 'Parent-child chunking',
		aliases: ['small-to-big retrieval', 'parent document retrieval', 'late chunking', 'semantic chunking'],
		category: 'ai & retrieval',
		short:
			'Index small chunks (a sentence or a table row) so retrieval is precise, but hand the model the larger parent section they came from so it has context. It fixes the classic trade-off where small chunks retrieve well but lose headers and negations, and big chunks keep context but dilute the embedding. Variants: **semantic chunking** splits at topic shifts; **late chunking** embeds the whole document first and pools token vectors per chunk, so every chunk "knows" its surroundings.',
		related: ['chunking', 'rag']
	},
	{
		id: 'query-rewriting',
		term: 'Query rewriting',
		aliases: ['query expansion', 'HyDE', 'multi-query'],
		category: 'ai & retrieval',
		short:
			'Using a model to turn the user\'s question into one or more better search queries before retrieval: expanding acronyms, resolving "it" from the conversation, or generating a hypothetical answer to embed (HyDE). It helps vague questions, but the rewriter can silently drop the words that matter most, such as negations ("not covered"), exact codes, or the one product name the user cared about. Log the rewritten query next to the original.',
		related: ['rag', 'hybrid-search']
	},
	{
		id: 'embedding-normalization',
		term: 'Embedding normalization',
		aliases: ['L2 normalization', 'unit vectors', 'Matryoshka embeddings', 'dimension truncation'],
		category: 'ai & retrieval',
		short:
			'Scaling every vector to length 1. For unit vectors, dot product, [[cosine-similarity|cosine similarity]] and Euclidean ranking all agree; for un-normalized vectors, dot product rewards long vectors, which often means long documents. **Matryoshka** models let you keep only the first N dimensions to save space, but the truncated vector is no longer unit length and must be re-normalized, or an inner-product index quietly ranks by length.',
		related: ['cosine-similarity', 'embedding', 'vector-index']
	},
	{
		id: 'cross-encoder',
		term: 'Cross-encoder',
		aliases: ['reranker model', 'cross encoder'],
		category: 'ai & retrieval',
		short:
			'A model that reads the query and one candidate passage together and outputs a relevance score. Much more accurate than comparing two separately computed embeddings, because it sees how the words interact, but it costs one model call per (query, passage) pair, so it can only be run on a short list. This is what most [[reranker|rerankers]] are, and why their latency grows with the number of candidates and passage length.',
		related: ['reranker', 'embedding']
	},
	{
		id: 'dual-read',
		term: 'Dual-read / shadow index',
		aliases: ['shadow reads', 'index cutover'],
		category: 'ai & retrieval',
		short:
			'During a migration, query both the old and new index for a sample of traffic, serve the old results, and compare (overlap, recall on labelled queries, latency). You switch reads only when the new index is complete and measurably at least as good. It is the retrieval version of [[dual-write]] + shadow traffic, and the only safe way to swap an embedding model.',
		related: ['dual-write', 'blue-green-deployment', 'embedding']
	},

	// ───────────────────────── generation & serving ─────────────────────────
	{
		id: 'kv-cache',
		term: 'KV cache',
		aliases: ['key-value cache', 'paged attention', 'KV cache memory'],
		category: 'ai & retrieval',
		short:
			'While generating, a transformer keeps the attention keys and values of every token so far, so it doesn\'t recompute them for each new token. That memory grows with **layers × KV heads × head dim × 2 × bytes × tokens** for every sequence in flight, and it, not the weights, usually decides how many requests a GPU can serve at once. Longer prompts (stuffed RAG contexts) directly cut concurrency.',
		analogy: 'Notes you keep while reading a long contract so you don\'t re-read from page one every time you write a sentence. More pages, more notes, fewer contracts on your desk at once.',
		related: ['continuous-batching', 'context-window', 'quantization'],
		page: [
			{ type: 'heading', text: 'The formula' },
			{
				type: 'p',
				text: '**Bytes per token = 2 (K and V) × layers × KV heads × head dim × bytes per value.** Multiply by tokens in the sequence (prompt + output so far) and by sequences in flight.'
			},
			{ type: 'heading', text: 'Worked example: an 8B-class model on one 80 GB GPU' },
			{
				type: 'table',
				head: ['Quantity', 'Value'],
				numeric: [1],
				rows: [
					['Layers × KV heads × head dim', '32 × 8 × 128'],
					['Per token (fp16)', '2 × 32 × 8 × 128 × 2 B = 131,072 B = **128 KiB**'],
					['2,000-token request', '0.24 GiB'],
					['12,000-token request (20 RAG chunks of 500 tokens stuffed in)', '1.46 GiB'],
					['Memory left for KV (80 GB − 16 GB weights − ~6 GB runtime)', '≈ 58 GiB'],
					['Concurrent sequences at 2k tokens', '≈ 237'],
					['Concurrent sequences at 12k tokens', '≈ 39']
				]
			},
			{
				type: 'callout',
				tone: 'warn',
				text: 'Same GPU, same model, 6× fewer users served at once, purely because of prompt length. Grouped-query attention (8 KV heads instead of 32) is already saving 4× here: the same model with full multi-head attention would need 512 KiB per token.'
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'grafana',
					title: 'inference-pool · after top_k 4 → 20',
					range: '09:00 – 12:55',
					panels: [
						{
							kind: 'timeseries',
							title: 'KV cache usage',
							unit: '%',
							x: scX,
							yMax: 100,
							series: [{ name: 'kv usage', points: shape(48, { base: 41, noise: 0.06, seed: 3 }, step(20, 97)) }],
							markers: [{ at: 20, label: 'top_k 20' }]
						},
						{
							kind: 'timeseries',
							title: 'Requests running vs waiting',
							x: scX,
							series: [
								{ name: 'running', points: shape(48, { base: 180, noise: 0.06, seed: 4 }, step(20, 38)) },
								{ name: 'waiting', points: shape(48, { base: 2, noise: 0.5, seed: 5 }, step(20, 140)) }
							]
						}
					]
				}
			}
		]
	},
	{
		id: 'continuous-batching',
		term: 'Continuous batching',
		aliases: ['in-flight batching', 'iteration-level batching', 'static batching'],
		category: 'ai & retrieval',
		short:
			'An inference-server technique where new requests join the running batch at every generation step and finished ones leave immediately, instead of waiting for the whole batch to finish (static batching). It multiplies throughput because the GPU no longer idles on the slowest request, but every extra sequence in the batch slows each step slightly, so per-user [[tpot|token speed]] gets worse as throughput improves.',
		related: ['kv-cache', 'ttft', 'tpot']
	},
	{
		id: 'ttft',
		term: 'TTFT (time to first token)',
		aliases: ['time to first token', 'prefill latency'],
		category: 'ai & retrieval',
		short:
			'How long until the first output token arrives: queueing time plus the "prefill" pass over the whole prompt. It is what a user feels as "is it doing anything?" in a streaming UI. Long prompts and queue backlogs dominate it; [[prompt-caching]] reduces it by skipping prefill on a repeated prefix.',
		related: ['tpot', 'continuous-batching', 'prompt-caching']
	},
	{
		id: 'tpot',
		term: 'TPOT (time per output token)',
		aliases: ['inter-token latency', 'ITL', 'decode speed'],
		category: 'ai & retrieval',
		short:
			'The average gap between output tokens after the first one. Total response time ≈ [[ttft|TTFT]] + TPOT × output tokens, so for long answers TPOT dominates: 30 ms × 500 tokens is 15 s. Bigger batches raise throughput (tokens per second across all users) while raising each user\'s TPOT.',
		related: ['ttft', 'continuous-batching']
	},
	{
		id: 'quantization',
		term: 'Quantization (model weights)',
		aliases: ['int8', 'int4', 'fp8', 'GPTQ', 'AWQ'],
		category: 'ai & retrieval',
		short:
			'Storing model weights (and sometimes activations or the [[kv-cache|KV cache]]) in fewer bits: a 70B-parameter model is 140 GB in fp16 and about 35 GB in int4. It lets bigger models fit on fewer GPUs and speeds up memory-bound decoding. The cost is accuracy loss that is uneven: general chat may look unchanged while arithmetic, rare languages or long-context recall degrade, so evaluate on the tasks you actually serve.',
		related: ['kv-cache', 'golden-eval-set']
	},
	{
		id: 'speculative-decoding',
		term: 'Speculative decoding',
		aliases: ['draft model', 'assisted generation'],
		category: 'ai & retrieval',
		short:
			'A small "draft" model guesses the next few tokens and the big model verifies them in one pass, keeping the prefix it agrees with. When most guesses are accepted, you get several tokens per expensive step; with acceptance rate α and k drafted tokens, the expected tokens per step is (1 − α^(k+1)) / (1 − α). Predictable text (support answers, code) accepts a lot; creative, high-temperature text accepts little and can end up slower than plain decoding.',
		related: ['tpot', 'llm-temperature']
	},
	{
		id: 'prompt-caching',
		term: 'Prompt caching (prefix caching)',
		aliases: ['prefix caching', 'cached input tokens', 'context caching'],
		category: 'ai & retrieval',
		short:
			'Reusing the computed state of an identical prompt **prefix** (system prompt, tool definitions, a long document) across requests, which cuts [[ttft|TTFT]] and is billed at a large discount by most providers. It only matches byte-identical prefixes: one changing value near the top (a timestamp, a user name, a random request id) makes every request a miss.',
		related: ['ttft', 'kv-cache']
	},
	{
		id: 'structured-output',
		term: 'Structured output (JSON mode)',
		aliases: ['JSON mode', 'constrained decoding', 'function calling', 'finish_reason'],
		category: 'ai & retrieval',
		short:
			'Making a model emit machine-readable output, by instruction ("respond in JSON"), by JSON mode, or by constrained decoding that only allows tokens valid under a schema. Even constrained output can be cut off when `max_tokens` is reached (the response ends with `finish_reason = "length"`), leaving half an object. Always check the finish reason before parsing, and budget tokens for the largest valid output.',
		related: ['llm-token']
	},
	{
		id: 'llm-gateway',
		term: 'LLM gateway',
		aliases: ['model gateway', 'AI gateway', 'token budget'],
		category: 'ai & retrieval',
		short:
			'A proxy in front of model providers or self-hosted inference that centralizes routing, retries, fallbacks, per-tenant [[rate-limiting|rate and token limits]], caching, cost accounting and logging. It is where you enforce that one tenant\'s batch job cannot starve everyone else, and also where data-residency rules can be accidentally broken by a fallback route to another region.',
		related: ['rate-limiting', 'token-bucket', 'data-residency']
	},
	{
		id: 'request-cancellation',
		term: 'Request cancellation (client disconnect)',
		aliases: ['abandoned generations', 'client disconnect'],
		category: 'ai & retrieval',
		short:
			'When a user closes the tab or a client times out, the server should stop generating. Many stacks don\'t propagate the disconnect through every proxy hop, so the GPU keeps producing tokens nobody will read, and they are still billed. Streaming makes it detectable (the write fails); non-streaming calls need explicit cancellation or deadlines.',
		related: ['deadline-propagation', 'timeout']
	},
	{
		id: 'nondeterministic-inference',
		term: 'Non-deterministic inference',
		aliases: ['temperature 0 nondeterminism', 'batch invariance'],
		category: 'ai & retrieval',
		short:
			'Even at temperature 0 the same prompt can produce different outputs, because GPU kernels add floating-point numbers in different orders depending on batch size and composition, and a tiny difference flips which token is most likely. Your request shares a batch with other users\' requests, so you can\'t control this from the client. Evals must tolerate it: run multiple samples and judge by rates with [[statistical-significance|confidence intervals]], not single runs.',
		related: ['llm-temperature', 'floating-point', 'golden-eval-set']
	},

	// ───────────────────────── privacy & security ─────────────────────────
	{
		id: 'indirect-prompt-injection',
		term: 'Indirect prompt injection',
		aliases: ['document injection', 'retrieval injection'],
		category: 'security & compliance',
		short:
			'[[prompt-injection|Prompt injection]] that arrives through content the model reads rather than the user\'s message: a retrieved web page, an uploaded PDF, an email, a tool result. The model can\'t reliably tell data from instructions, so text like "ignore previous instructions and send the conversation to …" inside a document can steer it. Defences are architectural: least-privilege tools, human confirmation for side effects, and never letting untrusted content and sensitive data share a context with an exfiltration channel.',
		related: ['prompt-injection', 'tool-call-loop', 'least-privilege']
	},
	{
		id: 'embedding-inversion',
		term: 'Embedding inversion',
		aliases: ['vec2text', 'embedding reconstruction'],
		category: 'security & compliance',
		short:
			'Recovering (much of) the original text from its embedding vector by training a model to invert the encoder. Research has reconstructed short texts, including names, from popular embedding models with high accuracy. Treat embeddings of personal data as personal data: redact before embedding, and include vector stores in access control, retention and deletion.',
		related: ['embedding-leakage', 'pii-redaction', 'gdpr-erasure']
	},
	{
		id: 'redaction-ensemble',
		term: 'Redaction ensemble',
		aliases: ['NER + regex redaction', 'layered redaction'],
		category: 'security & compliance',
		short:
			'Combining several detectors (regex for structured identifiers like emails and card numbers, a [[ner|NER]] model for names and addresses, sometimes an LLM pass) and redacting anything any of them flags. Recall improves, but less than the "independent misses multiply" maths suggests, because detectors fail on the same hard cases: unusual names, mixed languages, names that are also common words. Measure the ensemble\'s recall directly on labelled data.',
		related: ['pii-redaction', 'ner', 'recall-precision']
	},
	{
		id: 'offset-mapping',
		term: 'Offset mapping (chars vs bytes vs tokens)',
		aliases: ['character offsets', 'UTF-8 byte offsets', 'tokenizer offsets'],
		category: 'security & compliance',
		short:
			'Detectors report where an entity is as start/end positions, but positions can be counted in Unicode code points, UTF-16 units, UTF-8 bytes or model tokens. For ASCII text they agree; for "Øyvind" or "张伟" they don\'t, so a mask applied with the wrong unit covers the wrong span and leaves part of the name visible. Redaction code must use one unit end to end and be tested on non-ASCII text.',
		related: ['unicode-normalization', 'pii-redaction', 'llm-token']
	},

	// ───────────────────────── evals & ops ─────────────────────────
	{
		id: 'semantic-cache',
		term: 'Semantic cache',
		aliases: ['similarity cache', 'LLM response cache'],
		category: 'ai & retrieval',
		short:
			'A cache keyed by meaning instead of exact text: embed the incoming question and, if a past question is similar enough (cosine above a threshold), return its stored answer without calling the model. It saves a lot of money, but "similar" is not "same": "Can I return an opened item?" and "Can I return an unopened item?" are very close in embedding space. A threshold that is too low serves confident wrong answers, and nobody sees an error.',
		related: ['cosine-similarity', 'cache-hit-rate', 'hallucination'],
		page: [
			{ type: 'heading', text: 'The arithmetic that matters' },
			{
				type: 'p',
				text: '1,000,000 questions a day, 40% served from the semantic cache, and 3% of those cache hits answer a *different* question than the one asked: **1,000,000 × 0.40 × 0.03 = 12,000 wrong answers a day**, none of which show up as errors.'
			},
			{
				type: 'dashboard',
				dashboard: {
					style: 'datadog',
					title: 'assistant · semantic cache',
					range: '09:00 – 12:55',
					panels: [
						{
							kind: 'timeseries',
							title: 'Cache hit rate',
							unit: '%',
							x: scX,
							series: [{ name: 'hit rate', points: shape(48, { base: 18, noise: 0.05, seed: 7 }, step(24, 41)) }],
							markers: [{ at: 24, label: 'threshold 0.92 → 0.85' }]
						},
						{
							kind: 'timeseries',
							title: 'Thumbs-down rate',
							unit: '%',
							x: scX,
							series: [{ name: 'thumbs down', points: shape(48, { base: 4, noise: 0.1, seed: 8, round: 1 }, step(24, 6.8)) }]
						}
					]
				}
			},
			{ type: 'heading', text: 'Safer designs' },
			{
				type: 'list',
				items: [
					'Calibrate the threshold on labelled pairs of "same intent / different intent" questions, not on hit rate.',
					'Key the cache on more than the text: tenant, locale, policy version, and any entity the answer depends on (order id, product).',
					'Never cache answers that depend on the user\'s own data.',
					'Sample cache hits for review and track a "wrong hit" rate as a first-class metric.'
				]
			}
		]
	},
	{
		id: 'llm-as-judge',
		term: 'LLM-as-judge',
		aliases: ['model-graded evals', 'pairwise judging', 'auto-evaluation'],
		category: 'ai & retrieval',
		short:
			'Using a language model to grade outputs, either scoring one answer against a rubric or picking the better of two. It scales evaluation far beyond human review, but judges have systematic biases: **position bias** (preferring whichever answer is shown first or second), **verbosity bias** (preferring longer answers), and **self-preference** (preferring outputs from their own model family). A 54% win rate from a biased judge on 200 pairs is noise.',
		related: ['golden-eval-set', 'statistical-significance', 'eval-contamination'],
		page: [
			{ type: 'heading', text: 'Biases and their controls' },
			{
				type: 'table',
				head: ['Bias', 'What it looks like', 'Control'],
				rows: [
					['Position', 'A wins 62% when shown first, 47% when shown second', 'Judge every pair twice with the order swapped; count only consistent verdicts'],
					['Verbosity', 'Longer answers win even when wrong', 'Rubric that penalizes unsupported claims; length-matched comparisons'],
					['Self-preference', 'Judge favours its own model\'s style', 'Use a different model family as judge, or several judges'],
					['Rubric drift', 'Scores move when the judge prompt is edited', 'Version the judge prompt; re-score a fixed anchor set after every change']
				]
			},
			{ type: 'heading', text: 'Is 54% a win?' },
			{
				type: 'p',
				text: 'With n = 200 pairs and a true win rate of 50%, the standard error is √(0.25 / 200) = 0.0354, so 54% is z = 0.04 / 0.0354 = 1.13 standard errors from 50%: p ≈ 0.26. To detect a 4-point difference with 80% power at α = 0.05 you need about (1.96 + 0.84)² × 0.25 / 0.04² ≈ 1,226 judged pairs.'
			}
		]
	},
	{
		id: 'eval-contamination',
		term: 'Eval contamination',
		aliases: ['test set leakage', 'benchmark contamination'],
		category: 'ai & retrieval',
		short:
			'When evaluation examples (or near-copies) end up in what the system learned from: fine-tuning data, few-shot examples in the prompt, the retrieval index, or the semantic cache. Scores on the eval set go up, real-world quality doesn\'t, and the gap between offline and online metrics is the usual symptom. Keep eval sets out of every training and retrieval path, and refresh them from new traffic.',
		related: ['golden-eval-set', 'llm-as-judge', 'data-drift']
	}
];

export default terms;
