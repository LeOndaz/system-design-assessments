import type { GlossaryTerm } from '../types';

const terms: GlossaryTerm[] = [
	{
		id: 'phi',
		term: 'PHI (protected health information)',
		aliases: ['protected health information', 'ePHI'],
		category: 'healthcare',
		short:
			'Health information that can be tied to a specific person: a diagnosis plus a name, an MRN, a date of birth, a face, even a ZIP code. The "can be tied" part is what matters: a lab value alone is not PHI, the same value next to an MRN is. Engineers leak PHI less through databases than through the edges: logs, traces, error messages, analytics events, LLM prompts and search indexes.',
		analogy: 'A blood test result is a number. Staple a patient sticker to it and it becomes a secret.',
		related: ['hipaa', 'de-identification', 'pii-redaction', 'quasi-identifier']
	},
	{
		id: 'hipaa',
		term: 'HIPAA',
		aliases: ['Privacy Rule', 'Security Rule', 'Safe Harbor'],
		category: 'healthcare',
		short:
			'The US law governing health data. For engineers, the parts that bite are: the **minimum necessary** rule (systems should only see the PHI they need), audit controls (who accessed which record), breach notification, and the two routes to de-identification: **Safe Harbor** (remove 18 listed identifiers, e.g. ZIP truncated to 3 digits, dates reduced to year, ages over 89 grouped) or **Expert Determination** (a statistician certifies the re-identification risk is very small). GDPR treats health data as a "special category" with similar weight in the EU.',
		related: ['phi', 'de-identification', 'k-anonymity', 'audit-trail']
	},
	{
		id: 'dicom',
		term: 'DICOM',
		aliases: ['Digital Imaging and Communications in Medicine', '.dcm'],
		category: 'healthcare',
		short:
			'The standard for medical images: both a **file format** (pixel data plus hundreds of tagged attributes such as patient name, study date, modality, scanner settings) and a **network protocol** for sending, querying and retrieving images between scanners, archives and viewers. One CT scan is not one file: it is hundreds of separate DICOM *instances* (one per slice) that share study and series identifiers.',
		analogy: 'Each slice is a photo with a very long, standardized sticky note on the back. The sticky note says whose photo it is, which album it belongs to, and how the camera was set.',
		related: ['dicom-uid', 'pacs', 'dicomweb', 'transfer-syntax', 'burned-in-phi'],
		page: [
			{ type: 'heading', text: 'The hierarchy: patient → study → series → instance' },
			{
				type: 'table',
				head: ['Level', 'Identifier tag', 'What it is', 'Typical count'],
				rows: [
					['Patient', '`(0010,0020)` PatientID', 'Whatever the hospital calls the person (usually the MRN). **Not globally unique**: two hospitals can issue the same ID.', '1'],
					['Study', '`(0020,000D)` StudyInstanceUID', 'One imaging exam ordered for a reason, e.g. "CT chest with contrast". Linked to the order by `AccessionNumber`.', '1 per exam'],
					['Series', '`(0020,000E)` SeriesInstanceUID', 'One acquisition or reconstruction within the study: the arterial phase, a 1 mm reconstruction, a radiologist\'s key images.', '2–20 per study'],
					['Instance', '`(0008,0018)` SOPInstanceUID', 'One object: usually one image slice, but also a multi-frame cine, a structured report, or a PDF.', '1–3,000 per series']
				]
			},
			{
				type: 'p',
				text: 'Every UID is meant to be **globally unique forever**: generated once by the scanner, never reused. That is why routing, deduplication and sync can key on them. It is also why software that *regenerates* UIDs (a de-identification step, a "fix-up" script) quietly breaks every system that relied on them.'
			},
			{ type: 'heading', text: 'What a single instance carries' },
			{
				type: 'code',
				lang: 'text',
				code: `(0008,0060) Modality                 CT
(0008,0020) StudyDate                20260311
(0008,0050) AccessionNumber          ACC0049213
(0010,0010) PatientName              DOE^JANE
(0010,0020) PatientID                MRN-0081123
(0010,0030) PatientBirthDate         19580214
(0018,0050) SliceThickness           1.25
(0020,000D) StudyInstanceUID         1.2.840.113619.2.55.3.604688119.971.1710145
(0020,000E) SeriesInstanceUID        1.2.840.113619.2.55.3.604688119.971.1710145.3
(0008,0018) SOPInstanceUID           1.2.840.113619.2.55.3.604688119.971.1710145.3.118
(0002,0010) TransferSyntaxUID        1.2.840.10008.1.2.4.90   (JPEG 2000 lossless)
(7FE0,0010) PixelData                <512×512×16-bit>`,
				caption: 'Abridged tag dump. Names and dates sit right next to the pixels, and private vendor tags (odd group numbers) can hold anything.'
			},
			{ type: 'heading', text: 'Why engineers get hurt by it' },
			{
				type: 'list',
				items: [
					'**Size and count:** a CT study is 300–3,000 instances of ~0.5 MB; a breast tomosynthesis study can be 1–3 GB. Per-instance overhead (one HTTP request, one DB row, one queue message each) dominates.',
					'**Completeness is implicit:** nothing in the protocol says "the study is finished". Receivers wait for a quiet period, so late slices create a "new" study unless you merge by UID.',
					'**PHI lives in three places:** standard tags, private tags, and the pixels themselves ([[burned-in-phi]]).',
					'**Two network stacks:** classic DIMSE over TCP and [[dicomweb]] over HTTP. Most hospitals run both.'
				]
			}
		]
	},
	{
		id: 'dicom-uid',
		term: 'DICOM UID',
		aliases: ['StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID', '2.25 UID'],
		category: 'healthcare',
		short:
			'A dotted-decimal identifier (digits and dots only, at most 64 characters, no leading zeros in a component) meant to be globally unique. Organisations normally prefix UIDs with their own registered root. The `2.25.` root lets anyone build a UID from a 128-bit number written in decimal, so you can derive a UID deterministically from a hash, e.g. `2.25.` + decimal(HMAC(key, original UID) truncated to 128 bits). That is the standard trick for de-identifying UIDs consistently.',
		related: ['dicom', 'pseudonymization', 'de-identification']
	},
	{
		id: 'pacs',
		term: 'PACS',
		aliases: ['picture archiving and communication system', 'VNA', 'vendor neutral archive'],
		category: 'healthcare',
		short:
			'The hospital system that stores medical images and serves them to radiologists\' viewers. It receives images from the scanners (modalities), indexes them by patient, study and series, and answers queries and retrieves. A **VNA** (vendor-neutral archive) is the long-term store behind one or more PACS. Most integration work is sync between PACS, VNA, cloud, and AI systems, and every hop can rename, recompress or duplicate studies.',
		related: ['dicom', 'dicomweb', 'dicom-uid']
	},
	{
		id: 'dicomweb',
		term: 'DICOMweb',
		aliases: ['STOW-RS', 'QIDO-RS', 'WADO-RS', 'DIMSE', 'C-STORE', 'C-FIND', 'C-MOVE'],
		category: 'healthcare',
		short:
			'The HTTP/REST flavour of DICOM networking: **STOW-RS** to store, **QIDO-RS** to query, **WADO-RS** to retrieve. The older **DIMSE** protocol uses long-lived TCP associations between "application entities" (AE titles): C-STORE sends an object, C-FIND queries, and **C-MOVE** retrieves by asking the archive to *open a new connection back* to a destination AE it already knows by IP and port. That callback is why C-MOVE breaks behind NAT, firewalls and Kubernetes services. C-GET and WADO-RS return data on the same connection.',
		related: ['dicom', 'pacs']
	},
	{
		id: 'transfer-syntax',
		term: 'Transfer syntax',
		aliases: ['TransferSyntaxUID', 'JPEG 2000 lossless', 'implicit VR little endian'],
		category: 'healthcare',
		short:
			'The DICOM tag that says how an object is encoded: byte order, whether each attribute declares its value type ("explicit VR"), and how the pixels are compressed (uncompressed, JPEG lossless, JPEG 2000 lossless or lossy, RLE…). Sender and receiver negotiate which syntaxes they accept. Transcoding between them is expensive, and transcoding to a **lossy** syntax silently changes diagnostic pixels. Many archives forbid that for primary reads.',
		related: ['dicom', 'pacs']
	},
	{
		id: 'burned-in-phi',
		term: 'Burned-in PHI',
		aliases: ['burned-in annotation', 'BurnedInAnnotation', 'pixel PHI'],
		category: 'healthcare',
		short:
			'Patient details drawn *into the image pixels* rather than stored in tags: an ultrasound machine printing the name in the corner, a screenshot (secondary capture), a scanned consent form, a 3D reconstruction exported with an overlay. Tag-based de-identification cannot see it. The `BurnedInAnnotation (0028,0301)` flag is often missing or wrong. The practical defence is a modality- and source-aware rule set plus OCR on the risky categories, with human review of hits.',
		related: ['de-identification', 'dicom', 'phi', 'pii-redaction']
	},
	{
		id: 'de-identification',
		term: 'De-identification',
		aliases: ['anonymization', 'deidentification', 'Basic Application Confidentiality Profile'],
		category: 'healthcare',
		short:
			'Transforming data so it can no longer reasonably be linked to a person: removing direct identifiers (name, MRN), generalising quasi-identifiers (date of birth to year, ZIP to 3 digits), and replacing IDs with pseudonyms. It is not one operation but a policy with trade-offs. Remove too little and people can be re-identified; remove too much and the data loses research value (no follow-up scans can be linked, no intervals between dates).',
		related: ['pseudonymization', 'date-shifting', 'k-anonymity', 'quasi-identifier', 'burned-in-phi', 'hipaa'],
		page: [
			{ type: 'heading', text: 'Four layers, four different failure modes' },
			{
				type: 'table',
				head: ['Layer', 'Technique', 'How it fails'],
				rows: [
					['Direct identifiers', 'Remove or replace name, MRN, accession number, device serials', 'Private tags and free-text fields (`StudyDescription: "f/u Jane Doe nodule"`) slip through.'],
					['Identifiers you need to link', '[[pseudonymization|Keyed pseudonyms]] (HMAC), deterministic UID remapping', 'Random replacement breaks longitudinal linkage. Unkeyed hashes are reversible by brute force.'],
					['Dates', '[[date-shifting|Per-patient date shift]]', 'Per-record shifts destroy intervals; a fixed global shift is undone from one known date.'],
					['Quasi-identifiers', 'Generalise (age bands, ZIP3), suppress rare values', 'Combinations single people out ([[k-anonymity]]); rare diagnoses act as identifiers.'],
					['Pixels', 'OCR + masking for risky modalities; face-defacing for head MR/CT', '[[burned-in-phi|Burned-in text]]; a 3D render of a head scan is a recognisable face.']
				]
			},
			{ type: 'heading', text: 'The longitudinal trap, worked through' },
			{
				type: 'p',
				text: 'A research project needs every chest CT for each patient over five years, to measure nodule growth. Version 1 replaced `PatientID` with a random UUID **per study**. Every study looks like a different person, so growth can\'t be measured. Version 2 used `sha256(MRN)`. MRNs are 7–8 digits, so an attacker hashes all 10⁸ candidates in about a minute on a laptop and gets every MRN back. Version 3 uses `HMAC(secret_key, issuer + MRN)`. It is consistent across studies, can\'t be reversed without the key, and the key lives in a KMS that only the de-id service can call.'
			},
			{
				type: 'code',
				lang: 'python',
				code: `def pseudonym(issuer: str, mrn: str) -> str:
    # issuer scopes the ID: MRN 0012345 at Hospital A ≠ MRN 0012345 at Hospital B
    mac = hmac.new(KEY, f"{issuer}|{mrn}".encode(), hashlib.sha256).digest()
    return "P" + base64.b32encode(mac[:15]).decode().rstrip("=")

def remap_uid(original_uid: str) -> str:
    mac = hmac.new(KEY, original_uid.encode(), hashlib.sha256).digest()
    return "2.25." + str(int.from_bytes(mac[:16], "big"))   # ≤ 44 chars, digits only`,
				caption: 'Deterministic, keyed and scoped. Re-sending the same study yields the same pseudonyms and UIDs, so duplicates merge instead of multiplying.'
			},
			{
				type: 'callout',
				tone: 'warn',
				title: 'Key management is the whole game',
				text: 'Whoever holds the HMAC key can re-identify everyone, by hashing candidate MRNs and comparing. Rotating the key breaks linkage with everything produced before. Decide up front: one key per project (projects can\'t be cross-linked), or one global key (they can).'
			}
		]
	},
	{
		id: 'pseudonymization',
		term: 'Pseudonymization',
		aliases: ['pseudonymisation', 'keyed hash', 'tokenization'],
		category: 'healthcare',
		short:
			'Replacing an identifier with a stable stand-in so records about the same person still link, while the stand-in alone reveals nothing. The stand-in must be **keyed** (HMAC or a lookup vault), because identifiers like MRNs, phone numbers and dates of birth come from a small space that is trivial to brute-force through a plain hash. Under GDPR, pseudonymized data is **still personal data**: whoever holds the key can reverse it.',
		related: ['de-identification', 'dicom-uid', 'k-anonymity']
	},
	{
		id: 'date-shifting',
		term: 'Date shifting',
		aliases: ['date offset', 'temporal de-identification'],
		category: 'healthcare',
		short:
			'Moving every date for a patient by the same secret random offset (for example −1 to −365 days). Intervals stay correct ("biopsy 12 days after scan"), but real calendar dates are hidden. Shifting each record separately destroys intervals. One global shift for everyone is broken as soon as a single real date is known. Side effects to plan for: day-of-week and season change, and ages computed across the shift must use the shifted birth date too.',
		related: ['de-identification', 'pseudonymization']
	},
	{
		id: 'hl7-v2',
		term: 'HL7 v2',
		aliases: ['HL7', 'MLLP', 'pipe-delimited HL7', 'interface engine'],
		category: 'healthcare',
		short:
			'The decades-old message format most hospital systems still use to talk to each other: pipe-delimited text segments (`MSH`, `PID`, `PV1`, `OBX`…) sent over a thin TCP framing called MLLP, with an ACK per message. Delivery is effectively at-least-once, and ordering matters a lot: an update for a patient processed before their admission is rejected or misfiled. An **interface engine** sits in the middle, routing, transforming and queueing messages between systems.',
		related: ['adt-message', 'mrn-merge', 'out-of-order-delivery', 'at-least-once'],
		page: [
			{ type: 'heading', text: 'A real message, decoded' },
			{
				type: 'code',
				lang: 'text',
				code: `MSH|^~\\&|EHR|GENHOSP|PHARM|GENHOSP|20260311091502||ADT^A08|MSG000981|P|2.5.1
EVN|A08|20260311091500
PID|1||MRN0081123^^^GENHOSP^MR||DOE^JANE||19580214|F|||12 ELM ST^^SPRINGFIELD
PV1|1|I|4B^412^1|||||||MED||||||||V00049213`,
				caption: '`MSH-9` = message type (ADT^A08: update patient info). `MSH-10` = control ID for the ACK. `PID-3` = patient identifiers. `PV1-19` = visit (encounter) number.'
			},
			{ type: 'heading', text: 'Why ordering breaks' },
			{
				type: 'flow',
				steps: [
					{ label: 'EHR', note: 'emits A01 then A08' },
					{ label: 'Interface engine', note: 'one queue per message type, or N threads', tone: 'warn' },
					{ label: 'Pharmacy', note: 'receives A08 first → "patient not found" (AE)', tone: 'crit' }
				]
			},
			{
				type: 'list',
				items: [
					'**Parallelism without a key**: round-robin threads, per-type queues, or a "retry later" lane all reorder messages. Order only needs to hold **per patient**, so partition by `PID-3` (or by encounter) and parallelise across patients.',
					'**Merges cross partitions**: `A40` (merge) names two patients (`PID-3` survivor, `MRG-1` prior). Route it to the survivor\'s partition **and** block until the prior patient\'s in-flight messages have drained, or a late update to the retired MRN recreates it.',
					'**Retries reorder too**: if message 5 gets an AE and is retried after 6 and 7 succeed, you have reordered. Original-mode ACK channels usually *block* the queue on error for exactly this reason. That is safe, but one bad message stalls everyone, which is the operational pain.',
					'**Timestamps lie**: `MSH-7` is the sender\'s clock when it created the message, not when the event happened (`EVN-6`). Neither is a sequence number.'
				]
			}
		]
	},
	{
		id: 'adt-message',
		term: 'ADT message',
		aliases: ['A01', 'A03', 'A04', 'A08', 'A40', 'admit discharge transfer'],
		category: 'healthcare',
		short:
			'The HL7 v2 messages that announce **A**dmissions, **D**ischarges and **T**ransfers, plus patient updates and merges. Common ones: A01 admit, A02 transfer, A03 discharge, A04 register an outpatient, A08 update patient information, A11 cancel admit, A40 merge two patient records. Nearly every downstream system (lab, pharmacy, radiology, billing) keeps its own copy of the patient list in sync from this feed, so a dropped or reordered ADT message ends up as a different bug in five systems.',
		related: ['hl7-v2', 'mrn-merge']
	},
	{
		id: 'mrn-merge',
		term: 'MRN merge',
		aliases: ['patient merge', 'unmerge', 'duplicate patient record', 'EMPI'],
		category: 'healthcare',
		short:
			'When a hospital discovers two records are the same person (registered twice in the emergency department, say), it merges them: one MRN survives and the other is retired. Every downstream copy must re-point the retired MRN\'s data to the survivor, including images, results, and pseudonyms already derived from it. Merges are sometimes **wrong**, and an unmerge has to split data that has been mixed since. An **EMPI** (enterprise master patient index) maintains the cross-reference across facilities.',
		related: ['adt-message', 'pseudonymization', 'hl7-v2']
	},
	{
		id: 'fhir',
		term: 'FHIR',
		aliases: ['Fast Healthcare Interoperability Resources', 'FHIR R4'],
		category: 'healthcare',
		short:
			'The modern REST/JSON standard for health data: resources such as `Patient`, `Encounter`, `Observation` and `MedicationRequest` with standard search parameters. Every resource has a version (`meta.versionId`, exposed as an ETag). Correct clients do conditional updates with `If-Match: W/"3"` and get `412 Precondition Failed` if someone else updated it first. Subscriptions push change notifications, typically at least once and not necessarily in order.',
		related: ['optimistic-locking', 'conditional-update', 'hl7-v2', 'loinc']
	},
	{
		id: 'loinc',
		term: 'LOINC',
		aliases: ['LOINC code'],
		category: 'healthcare',
		short:
			'The code system that names lab tests and clinical measurements precisely, down to the unit *kind*. For example, `2345-7` is glucose as a **mass concentration** (mg/dL) in serum or plasma, while `14749-6` is glucose as a **molar concentration** (mmol/L). Mapping a local test code to the wrong LOINC, or sending a value in units that don\'t match the code, produces values that are numerically valid and clinically wrong.',
		related: ['snomed-ct', 'fhir', 'terminology-mapping']
	},
	{
		id: 'snomed-ct',
		term: 'SNOMED CT',
		aliases: ['SNOMED', 'ICD-10', 'ICD-10-CM'],
		category: 'healthcare',
		short:
			'A very large clinical terminology (hundreds of thousands of concepts with "is-a" relationships) used to record diagnoses, findings and procedures in detail. **ICD-10** is a coarser classification used mostly for billing and statistics. Mapping SNOMED to ICD-10 is many-to-one and context-dependent, so round-tripping loses information. Both are versioned: codes get retired and re-parented, so analytics that group by code drift silently between releases.',
		related: ['loinc', 'terminology-mapping']
	},
	{
		id: 'terminology-mapping',
		term: 'Terminology mapping drift',
		aliases: ['code mapping', 'concept map'],
		category: 'healthcare',
		short:
			'Local codes ("GLU-S" at Hospital A) are mapped to standard ones (LOINC, SNOMED) in a table maintained by people. When a site adds a new analyser, changes units or re-uses a local code, the mapping goes stale. No error is raised: data keeps flowing under the wrong meaning. Detect it with distribution checks per (site, code): a sudden shift in mean, range or unit string is usually a mapping change, not a medical event.',
		related: ['loinc', 'snomed-ct', 'data-drift']
	},
	{
		id: 'k-anonymity',
		term: 'k-anonymity',
		aliases: ['re-identification risk', 'l-diversity'],
		category: 'healthcare',
		short:
			'A dataset is k-anonymous if every combination of quasi-identifiers (age band, sex, ZIP3…) is shared by at least *k* records. Then no row can be narrowed to fewer than *k* people using those columns. It fails against attributes that are the same for everyone in a group (all *k* people have the same diagnosis, so knowing the group reveals it; **l-diversity** addresses this) and against linkage with outside data you didn\'t model.',
		related: ['quasi-identifier', 'de-identification', 'hipaa']
	},
	{
		id: 'quasi-identifier',
		term: 'Quasi-identifier',
		aliases: ['indirect identifier'],
		category: 'healthcare',
		short:
			'A field that isn\'t an identifier by itself but singles people out in combination. Classic result: ZIP code + full date of birth + sex uniquely identifies the large majority of US residents. Rough reasoning: ~40,000 ZIPs × ~29,000 birth dates in an 80-year span × 2 sexes ≈ 2.3 billion combinations for ~330 million people, so most combinations hold zero or one person. Rare diagnoses, admission dates and device serials act the same way.',
		related: ['k-anonymity', 'de-identification', 'phi']
	},
	{
		id: 'audit-trail',
		term: 'PHI access audit trail',
		aliases: ['access log', 'audit log', 'append-only log'],
		category: 'healthcare',
		short:
			'A record of who viewed or changed which patient\'s data, when, from where and why. It is required by health regulations and used to investigate snooping (staff looking up a celebrity or an ex). It must be **append-only and tamper-evident** (write-once storage, hash chaining), must cover reads and not only writes, and must include access via exports, APIs and support tools. The audit log itself contains PHI (the patient ID), so it needs the same protection as the data.',
		related: ['break-glass', 'phi', 'least-privilege-default']
	},
	{
		id: 'break-glass',
		term: 'Break-glass access',
		aliases: ['emergency access', 'break the glass'],
		category: 'healthcare',
		short:
			'An emergency override that lets a clinician open a record they normally can\'t (a patient in another department, a restricted VIP record) after stating a reason. Access is granted immediately and **reviewed afterwards**, because blocking care is worse than a late review. Engineering requirements: it must work when the policy service is down (fail open for clinical reads only), and it must alert and audit loudly.',
		related: ['audit-trail', 'least-privilege-default']
	},
	{
		id: 'legal-hold',
		term: 'Legal hold',
		aliases: ['litigation hold', 'retention policy'],
		category: 'healthcare',
		short:
			'An instruction to preserve specific data because of litigation or an investigation. It **overrides** retention-based deletion and, in many interpretations, erasure requests. Systems must model holds explicitly: a deletion job that ignores holds destroys evidence, and one that ignores retention keeps data it should have deleted. Medical record retention periods are long (often 7–10+ years, longer for minors), so "delete after 90 days" policies rarely apply to the clinical record itself.',
		related: ['gdpr-erasure', 'consent-revocation']
	},
	{
		id: 'consent-revocation',
		term: 'Consent revocation propagation',
		aliases: ['opt-out propagation', 'consent withdrawal'],
		category: 'healthcare',
		short:
			'When a patient withdraws consent (for research, data sharing or an app), every copy must stop being *used*: the primary store, replicas, caches, search indexes, feature stores, embeddings, analytics extracts, exported research datasets, and model training sets. It is a distributed-deletion problem with a legal deadline. The robust design checks consent **at use time** against an authoritative service (with a short cache TTL) instead of trusting each copy to have been cleaned.',
		related: ['gdpr-erasure', 'eventual-consistency', 'cache-invalidation', 'legal-hold']
	},
	{
		id: 'recall-precision',
		term: 'Recall vs precision (for redaction)',
		aliases: ['recall', 'precision', 'sensitivity', 'false negative rate'],
		category: 'healthcare',
		short:
			'**Recall** = share of the real PHI that the redactor caught. **Precision** = share of what it redacted that really was PHI. In redaction, a recall miss is a leak and a precision miss is lost information (a redacted drug name or "Parkinson"). Recall is measured **per entity**, but harm counts **per document**: with 99% recall and 20 PHI mentions per document, only 0.99²⁰ ≈ 82% of documents come out fully clean.',
		related: ['pii-redaction', 'positive-predictive-value', 'golden-eval-set']
	},
	{
		id: 'positive-predictive-value',
		term: 'Positive predictive value (PPV)',
		aliases: ['PPV', 'base rate fallacy', 'specificity', 'sensitivity'],
		category: 'healthcare',
		short:
			'Of everything a test or model flags as positive, the share that really is positive. It depends heavily on how common the condition is (the **base rate**), not only on the model\'s accuracy. A 99%-sensitive, 95%-specific detector for something present in 1% of cases has a PPV of only about 17%: five of every six alerts are false. That is the mathematical root of **alarm fatigue**.',
		related: ['recall-precision', 'alarm-fatigue'],
		page: [
			{ type: 'heading', text: 'Work it out with 10,000 cases' },
			{
				type: 'p',
				text: 'Sensitivity 99% (catches 99% of real positives), specificity 95% (correctly clears 95% of negatives), prevalence 1%.'
			},
			{
				type: 'table',
				head: ['', 'Condition present (100)', 'Condition absent (9,900)', 'Total'],
				numeric: [1, 2, 3],
				rows: [
					['Flagged', '99', '495', '594'],
					['Not flagged', '1', '9,405', '9,406']
				]
			},
			{
				type: 'p',
				text: 'PPV = 99 / 594 = **16.7%**. NPV (a negative result is truly negative) = 9,405 / 9,406 = 99.99%. The same model at 20% prevalence (a specialist clinic) has PPV = 1,980 / (1,980 + 400) = **83.2%**. Nothing about the model changed; the population did.'
			},
			{ type: 'heading', text: 'Why engineers should care' },
			{
				type: 'list',
				items: [
					'An AI triage flag validated in a referral centre (high prevalence) collapses in PPV when deployed to screening (low prevalence).',
					'A PHI detector tuned on clinical notes (PHI everywhere) floods reviewers with false hits on de-identified research text, where PHI is rare.',
					'Bedside monitor alarms: arrhythmia is rare at any given minute, so even good detectors produce mostly false alarms. Clinicians learn to ignore them ([[alarm-fatigue]]).',
					'Fix it by changing the base rate the model sees (pre-filter), by adding a second, independent test (PPVs compound), or by tuning the threshold for the deployment population. Retraining for "accuracy" alone doesn\'t help.'
				]
			}
		]
	},
	{
		id: 'alarm-fatigue',
		term: 'Alarm fatigue',
		aliases: ['alert fatigue'],
		category: 'healthcare',
		short:
			'When most alarms are false or not actionable, people stop responding to all of them, including the real ones. In hospitals it is a documented patient-safety hazard: monitors can raise hundreds of alarms per patient per day. The engineering lesson matches on-call paging: measure the actionable share of alerts, raise PPV (delays, de-duplication, smarter thresholds), and treat "too many alerts" as a defect, not a cost of safety.',
		related: ['positive-predictive-value', 'burn-rate']
	},
	{
		id: 'phi-in-telemetry',
		term: 'PHI in telemetry',
		aliases: ['PHI in logs', 'PHI in traces', 'prompt logging'],
		category: 'healthcare',
		short:
			'The most common PHI leak in modern systems: identifiers and clinical text copied into logs, traces, error trackers, analytics events, LLM prompt/response logs and vendor dashboards, which have weaker access controls, longer retention and third-party processors. Defences: structured logging with an allow-list of fields, redaction at the logging library (not per call site), no request or response bodies in traces, and contracts (BAAs) with any vendor that might receive PHI.',
		related: ['phi', 'pii-redaction', 'prompt-injection']
	},
	{
		id: 'embedding-leakage',
		term: 'Embeddings as PHI',
		aliases: ['embedding inversion', 'vector leakage'],
		category: 'healthcare',
		short:
			'An embedding of a clinical note is derived from PHI, and it is not one-way. Inversion attacks can reconstruct a good part of the source text, and nearest-neighbour search over the embeddings can link records. Treat a vector index built from PHI as PHI: same access controls, the same deletion obligations when consent is withdrawn, and the same residency rules. Deleting the note but keeping its vector keeps the data.',
		related: ['embedding', 'vector-index', 'phi', 'consent-revocation']
	},
	{
		id: 'data-residency',
		term: 'Data residency',
		aliases: ['data sovereignty', 'data localisation'],
		category: 'healthcare',
		short:
			'A requirement that certain data be stored or processed only in specific jurisdictions (an EU country, a province, a national health cloud). It covers more than the main database: backups, replicas, logs, CDN caches, support tooling, and third-party AI APIs that process the data elsewhere. A cross-region disaster-recovery replica can itself be the violation.',
		related: ['phi', 'phi-in-telemetry']
	}
];

export default terms;
