import type { Assessment } from '../types';
import { timeAxis, dayAxis, shape, step, ramp, bump, wave, periodic } from '../series';
import pacsLab from '../labs/a12-pacs-migration';
import hl7Lab from '../labs/a12-hl7-replay';

// ── shared chart data ──────────────────────────────────────────

// Glucose by site (daily mean of the "GLU" result feed), Sep 01 – Oct 12
const gluX = dayAxis('Sep 01', 42);
const gluA = shape(42, { base: 112, noise: 0.03, seed: 11 });
const gluB = shape(42, { base: 108, noise: 0.03, seed: 12 });
const gluC = shape(42, { base: 116, noise: 0.03, seed: 13, round: 1 }, step(29, 6.6));
const hypoAlerts = shape(42, { base: 14, noise: 0.25, seed: 14 }, step(29, 410));

// AI pneumothorax flag: alerts vs confirmed per day, before/after outpatient rollout on day 20
const ptxX = dayAxis('Aug 18', 40);
const ptxAlerts = shape(40, { base: 31, noise: 0.15, seed: 21 }, step(20, 152));
const ptxConfirmed = shape(40, { base: 19, noise: 0.18, seed: 22 }, step(20, 29));
const ptxStudies = shape(40, { base: 380, noise: 0.06, seed: 23 }, step(20, 3600));

// Bedside vitals: ward Wi-Fi outage 02:10–02:40, then buffered uploads
const vX = timeAxis('01:50', 70);
const vLag = shape(70, { base: 2, noise: 0.3, seed: 31, round: 1 }, ramp(20, 50, 2, 1800), step(50, 40), ramp(52, 58, 40, 3));
const vIngest = shape(70, { base: 210, noise: 0.08, seed: 32 }, step(20, 0), step(50, 3900), step(53, 1200), step(56, 210));
const vNews = shape(70, { base: 3, noise: 0.05, seed: 33, round: 1 }, step(20, 0), step(50, 3), bump(55, 70, 4));
const vFuture = shape(70, { base: 4, noise: 0, seed: 34 }, step(20, 0), step(50, 21), step(54, 4));

// STOW uploads
const stX = timeAxis('09:00', 60);
const stowOk = shape(60, { base: 140, noise: 0.1, seed: 41 }, wave(30, 0.2));
const stow413 = shape(60, { base: 0, noise: 0, seed: 42 }, periodic(12, 1, 1, 5));
const stowDur = shape(60, { base: 900, noise: 0.15, seed: 43 }, periodic(12, 1, 59000, 5));

const a12: Assessment = {
	id: 'medical',
	number: 12,
	title: 'Medical data pipelines',
	tagline: 'DICOM sync, HL7 ordering, AI redaction and consent in distributed, regulated systems, with the maths behind them.',
	description:
		'Healthcare data is distributed systems with a patient on the other end. Images arrive in thousands of pieces, clinical messages arrive out of order, identifiers merge and split, and every copy of a record (cache, index, embedding, log line) carries legal weight. The obvious engineering fix is often the one that leaks [[phi|PHI]] or corrupts a record. Each scenario also has a version of the question **"how do you know it is safe?"**, and the answers usually need numbers.',
	minutes: 160,
	difficulty: 'advanced',
	track: 'core',
	topics: ['DICOM & PACS', 'HL7 v2 & FHIR', 'de-identification', 'AI redaction', 'consent & audit', 'clinical maths'],
	overview: [
		{
			type: 'budget',
			items: [
				{ label: '1 · Imaging & DICOM', minutes: 35 },
				{ label: '2 · Clinical data sync', minutes: 30 },
				{ label: '3 · Redaction & AI', minutes: 30 },
				{ label: '4 · Compliance at scale', minutes: 30 },
				{ label: '5 · Live labs', minutes: 25 },
				{ label: 'Rapid fire', minutes: 10 }
			]
		},
		{
			type: 'callout',
			tone: 'info',
			title: 'How these are graded',
			text: 'Same skeleton as every other assessment (evidence, ranked hypotheses, confirm, mitigate, fix) with two extra columns. **Safety:** could the fix harm a patient or misfile a record? **Privacy:** does the fix create a new copy of PHI somewhere? A technically correct answer that copies PHI into a debug log, or speeds up a feed by reordering it, loses most of its marks.'
		},
		{
			type: 'cards',
			items: [
				{
					title: 'Identifiers are not stable',
					items: ['MRNs merge and unmerge ([[mrn-merge]]).', 'Patient IDs are only unique per issuer.', 'UIDs are stable only until someone regenerates them.']
				},
				{
					title: 'Order is per patient',
					items: ['[[hl7-v2|HL7]] feeds need per-patient ordering, not global.', 'Parallelise across patients, never within one.', 'Merges touch two patients at once.']
				},
				{
					title: 'Every copy counts',
					items: ['Logs, traces, prompts, embeddings and backups are PHI too.', 'Consent and deletion must reach all of them.', 'Prefer checking at use time over cleaning every copy.']
				},
				{
					title: 'Do the arithmetic',
					items: ['Recall per entity ≠ clean documents.', 'PPV depends on prevalence ([[positive-predictive-value]]).', 'Unit conversions have exact factors: write them down.']
				}
			]
		}
	],
	parts: [
		// ───────────────────────── PART 1 ─────────────────────────
		{
			id: 'p1',
			nav: '1 · Imaging',
			eyebrow: 'Part 1 · 35 minutes · DICOM, PACS, sync',
			title: 'Imaging and [[dicom|DICOM]]',
			meta: 'UIDs · burned-in PHI · DIMSE vs DICOMweb · transfer syntaxes · completeness',
			minutes: 35,
			intro: [
				{
					type: 'flow',
					steps: [
						{ label: 'Modality', note: 'CT / MR / US scanner' },
						{ label: 'DICOM router', note: 'C-STORE, routing rules' },
						{ label: 'Clinical PACS', note: 'radiologist reads' },
						{ label: 'De-id service', note: 'tags, UIDs, pixels', tone: 'warn' },
						{ label: 'Research archive', note: 'cloud, DICOMweb' },
						{ label: 'AI inference', note: 'triggered per study' }
					],
					caption: 'The pipeline used throughout this part. Every arrow can reorder, duplicate or rename things.'
				}
			],
			questions: [
				{
					id: 'img-dup-studies',
					title: '"Every follow-up shows twice and one copy is missing slices"',
					tag: 'tricky',
					minutes: 7,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'support',
								from: 'Dr. Amara Okafor',
								role: 'Radiologist · Thoracic imaging',
								subject: 'Research archive: duplicate studies',
								time: 'Tue 08:41',
								body: `In the research viewer, about one in ten patients has their follow-up CT listed twice on the same date. One copy has the 1 mm lung reconstruction and the other doesn't. The nodule-growth tool then compares against the wrong one and reports a 40% growth that isn't real.

It seems to happen when the technologist fixes something after the scan, like a typo in the patient name, and re-sends.`
							}
						},
						{
							type: 'code',
							lang: 'python',
							caption: 'The de-identification step that runs before upload to the research archive.',
							code: `def deidentify(ds):
    ds.PatientName = ""
    ds.PatientID = pseudonym(ds.IssuerOfPatientID, ds.PatientID)
    ds.StudyInstanceUID = pydicom.uid.generate_uid()     # new UID: no PHI in UIDs
    ds.SeriesInstanceUID = series_map.setdefault(ds.SeriesInstanceUID, generate_uid())
    ds.SOPInstanceUID = generate_uid()
    shift_dates(ds, patient_offset(ds.PatientID))
    return ds`
						}
					],
					hints: [
						'What makes a study the same study for the archive? What does the de-id step do to that?',
						'`series_map` is a Python dict. Where does it live, and how long?'
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'StudyInstanceUID is regenerated randomly per instance.',
									body: 'Every instance gets a **fresh** `generate_uid()` for its study. The archive groups by StudyInstanceUID, so it should explode into one study per slice. It only looks like "two studies" because the archive\'s ingest layer re-groups by (pseudonymised PatientID, StudyDate, AccessionNumber) within an arrival window, which the vendor added as a "repair" feature. Re-sends after a correction arrive outside that window, so they land in a second group.',
									confirm: 'Count distinct StudyInstanceUIDs per AccessionNumber in the research archive vs the clinical PACS. The clinical side has 1; the research side has hundreds.'
								},
								{
									title: '`series_map` is in-process memory.',
									body: 'It maps original → new SeriesInstanceUID only within one worker\'s lifetime. A re-send handled by another worker, or after a restart, gets a **different** series UID. So the corrected re-send becomes a new series, and the 1 mm reconstruction (sent later, by a different worker) lands under a third.',
									confirm: 'Grep worker IDs in the ingest logs for the two copies: different workers or a restart in between.'
								},
								{
									title: 'Re-sends after correction are expected and must overwrite, not duplicate.',
									body: 'A PatientName fix keeps the original UIDs on the clinical side, so the PACS updates in place. The research side must do the same: **the same input UID must always map to the same output UID**.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** derive every UID deterministically with a [[hmac|keyed hash]]: `2.25.` + decimal(HMAC(key, original UID)) ([[dicom-uid]]). It is stable across workers, restarts and re-sends, and not reversible without the key. Then make the archive ingest an **upsert by SOPInstanceUID**, so re-sent instances replace older versions. Turn off the vendor\'s heuristic "repair" grouping: it hid the bug.'
						},
						{
							type: 'p',
							text: '**Remediation:** re-run de-identification for affected patients with the deterministic mapping, delete the orphaned copies, and flag the nodule-growth measurements computed since the bug shipped for re-review. That is a clinical-research data-quality notice, not just a cleanup job.'
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'The tempting answer, "the archive should deduplicate by PatientID + date", is wrong: patients do get two different CTs on the same day (a trauma scan, then a follow-up after surgery). Identity in [[dicom|DICOM]] is the UID; protect it instead of guessing around it.'
						}
					]
				},
				{
					id: 'img-burned-in',
					title: 'The privacy audit found names in a "fully de-identified" dataset',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Helen Marsh',
								role: 'Privacy Officer',
								subject: 'URGENT: identifiable images in research export RX-2026-14',
								time: 'Mon 16:05',
								body: `An external partner reported that some images in last week's research export show patient names and dates of birth. Your team told us the export was de-identified with the standard DICOM profile and that every tag was checked by an automated validator.

I need to know how this happened, how many images are affected, and whether other exports are affected too. We may have a 72-hour notification clock running.`
							}
						},
						{
							type: 'table',
							head: ['Modality', 'Instances exported', 'Tag validator', 'Partner finding'],
							numeric: [1],
							rows: [
								['CT', '1,240,511', 'pass', '—'],
								['MR', '402,118', 'pass', '—'],
								['US', '61,377', 'pass', '"name + DOB top-left on most frames"'],
								['SC (secondary capture)', '8,902', 'pass', '"screenshots of the EHR"'],
								['OT / DOC', '1,205', 'pass', '"scanned referral letters"'],
								['MR (head, 3D T1)', '9,880', 'pass', '"could reconstruct faces"']
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: '**The validator checked the wrong layer.** Tag-based [[de-identification]] can only see tags. Ultrasound machines print patient details into the pixels, secondary captures are screenshots, and scanned documents are pictures of text: [[burned-in-phi]]. The `BurnedInAnnotation` tag is unreliable (often absent or `NO` when it should say `YES`). Head MR and CT carry a fourth identifier: the face itself, recoverable by 3D rendering.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Scope the incident by modality and source, not by "export".',
									body: 'Every export since this pipeline started has the same exposure for US/SC/OT/DOC. That is ~71,500 instances in RX-2026-14 alone. Head MR/CT is a separate, lower-likelihood exposure (it needs effort to reconstruct a face).',
									confirm: 'Run [[ocr|OCR]] over the US/SC/OT/DOC instances of every past export and count text detections; sample 200 detections by hand to estimate how many contain names or DOB vs measurement labels ("Lt kidney 9.8 cm").'
								},
								{
									title: 'Contain: revoke and recall.',
									body: 'Ask the partner to quarantine the dataset (contractual data-use agreement), rotate their access credentials, and pause all exports that include the risky modalities until the pipeline is fixed.'
								},
								{
									title: 'Fix the pipeline in layers.',
									body: '(1) **Exclude by default** SC/OT/DOC unless a project explicitly needs them; (2) OCR plus masking for US with **human review** of detections; (3) [[defacing|defacing]] (removing or blurring the face in the volume) for head MR/CT; (4) validator rules that check pixels (OCR detection count must be 0 after masking) and free-text tags (`StudyDescription`, `ImageComments`, private groups).'
								}
							]
						},
						{
							type: 'code',
							lang: 'text',
							code: `Hi Helen,

We confirmed the cause. Our de-identification removed identifying information from the image
headers correctly, but some image types (ultrasound, screenshots and scanned letters) have names
printed inside the picture itself, which the header check cannot see.

Affected: about 71,500 of 1.72 million images in RX-2026-14, all ultrasound, screenshots or
scanned documents. Earlier exports used the same process, so we are checking all of them; the
full list will be with you by 18:00 tomorrow, inside the 72-hour window.

Done today: the partner has quarantined the dataset and their access is suspended. Exports
are paused for these image types.

Next: these image types are excluded from exports by default, and any that are needed will be
scanned and masked, with a person checking every image the scanner flags.`,
							caption: 'Reply to the privacy officer: scope, timeline, containment, prevention. No "PS3.15" or "OCR".'
						}
					]
				},
				{
					id: 'img-cmove',
					title: 'C-MOVE works from the reading room but not from the new cloud gateway',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'p',
							text: 'The AI team deployed a DICOM gateway on Kubernetes (`AE: AIGW`, Service type `LoadBalancer`, port 11112). It queries the hospital [[pacs]] for prior studies, then retrieves them. Queries work. Retrieves do not.'
						},
						{
							type: 'logs',
							logs: {
								style: 'terminal',
								title: 'aigw-0 · dicom gateway',
								lines: [
									{ ts: '10:02:11.204', level: 'INFO', source: 'scu', msg: 'A-ASSOCIATE-RQ AIGW → PACS01@10.40.2.15:104 accepted (Study Root Q/R FIND, MOVE)' },
									{ ts: '10:02:11.391', level: 'INFO', source: 'scu', msg: 'C-FIND rsp: 3 matches (StudyDate 2024..2026)' },
									{ ts: '10:02:11.402', level: 'INFO', source: 'scu', msg: 'C-MOVE rq dest=AIGW study=1.2.840.113619.2.55.3…145' },
									{ ts: '10:02:11.455', level: 'ERROR', source: 'scu', msg: 'C-MOVE rsp status=0xA801 (Refused: Move Destination unknown)' },
									{ ts: '10:41:03.118', level: 'INFO', source: 'ops', msg: '— PACS admin added AE "AIGW" → host 10.40.9.250 port 11112 —' },
									{ ts: '10:44:20.006', level: 'INFO', source: 'scu', msg: 'C-MOVE rq dest=AIGW study=1.2.840.113619.2.55.3…145' },
									{ ts: '10:44:20.071', level: 'INFO', source: 'scu', msg: 'C-MOVE rsp status=0xFF00 (Pending) remaining=412 completed=0 failed=0' },
									{ ts: '10:45:20.074', level: 'WARN', source: 'scu', msg: 'C-MOVE rsp status=0xFF00 (Pending) remaining=412 completed=0 failed=0' },
									{ ts: '10:47:20.090', level: 'ERROR', source: 'scu', msg: 'C-MOVE rsp status=0xA702 (Out of resources: sub-operations) completed=0 failed=412' },
									{ ts: '10:47:20.101', level: 'INFO', source: 'scp', msg: 'no inbound associations received on :11112 in last 300 s' }
								]
							}
						}
					],
					answer: [
						{
							type: 'p',
							text: '**[[dimse|C-MOVE]] is a callback.** The gateway asks the PACS to *push* the images to the destination AE named `AIGW`. The PACS looks up `AIGW` in **its own** AE table and opens a **new** association to that host and port. The first error (`0xA801`) means the PACS had never heard of `AIGW`. After the admin added it, the PACS tried to connect to `10.40.9.250:11112`, and nothing arrived: "no inbound associations".'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'The registered address is not reachable from the PACS.',
									body: '`10.40.9.250` is probably a node or pod IP, or a load-balancer IP in a VPC the hospital network can\'t route to. Hospital firewalls often allow PACS → *known* AE hosts only. A LoadBalancer that is internal-only from the cluster side, or a security group that only allows outbound, gives exactly this silence.',
									confirm: 'From the PACS network, `echoscu -aec AIGW 10.40.9.250 11112` (C-ECHO). A timeout means a network path problem.'
								},
								{
									title: 'Multiple replicas behind a load balancer.',
									body: 'Even when it connects, the push may land on `aigw-1` while `aigw-0` is waiting for the move to complete. The images arrive on a pod that didn\'t ask for them.'
								},
								{
									title: 'AE title / calling-AE checks.',
									body: 'Some PACS verify that the C-MOVE requester is allowed to send to that destination. That would be a refusal, not a pending-then-timeout, so it is less likely here.'
								}
							]
						},
						{
							type: 'p',
							text: '**Better fix: stop using C-MOVE from the cloud.** Use **C-GET** (images return on the same association the gateway opened, so no callback) or **WADO-RS** over HTTPS, if the PACS supports them. If C-MOVE is mandatory, give the gateway a single stable, routable receiving endpoint (one StatefulSet replica or a dedicated receiver Service), and correlate incoming instances by StudyInstanceUID rather than "the pod that asked".'
						}
					]
				},
				{
					id: 'img-lossy',
					title: '"The calcifications look different" after the archive migration',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'slack',
								from: 'Dr. Lena Brandt',
								role: 'Breast imaging lead',
								time: 'Thu 11:20',
								body: `Comparing today's mammo with priors from the new cloud archive: the prior microcalcifications look softer, a bit smeared. Not on every study. Is the viewer doing something? We can't read priors like this.`
							}
						},
						{
							type: 'table',
							head: ['Prior source', 'TransferSyntaxUID', 'Stored size', 'Since'],
							rows: [
								['Old PACS (on-prem)', '`1.2.840.10008.1.2.4.70` JPEG Lossless', '64 MB / study', '2014'],
								['Cloud archive, migrated', '`1.2.840.10008.1.2.4.91` JPEG 2000 (lossy allowed)', '9 MB / study', 'migration batch 3+'],
								['Cloud archive, migrated', '`1.2.840.10008.1.2.4.90` JPEG 2000 lossless', '38 MB / study', 'batches 1–2']
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Lossy re-compression during migration.** From batch 3 the ingest stored images with transfer syntax `.4.91` (JPEG 2000, lossy permitted), a 7× size win over the old PACS\'s JPEG Lossless (about 4× over the JPEG 2000 lossless batches 1–2). Lossy compression smooths exactly the tiny, high-frequency details mammography depends on, such as [[microcalcifications|microcalcifications]]. It is not a viewer issue: the pixel data itself changed. See [[transfer-syntax]].'
						},
						{
							type: 'list',
							items: [
								'**Confirm:** compare the pixel values of one instance from the old PACS and the cloud copy (checksum the decoded pixel arrays). Also check `LossyImageCompression (0028,2110) = 01` and `LossyImageCompressionRatio`, which a compliant encoder must set.',
								'**Why it slipped through:** someone optimised for storage cost with a setting that is legal in DICOM, and the radiologists weren\'t consulted. Lossy is acceptable for some uses (thumbnails, teaching), not for primary or comparison reads of mammography.',
								'**Fix:** stop the migration. Re-migrate batch 3+ from the source PACS (keep the source until verified). Store the original transfer syntax (or lossless) as the archive copy, and generate lossy *derivatives* separately if bandwidth matters. Add a migration check: decoded pixel hash equality on a sample from every batch.',
								'**Risk:** reads done on lossy priors since the migration may need review. Raise it with the breast imaging lead and clinical governance, not just within engineering.'
							]
						}
					]
				},
				{
					id: 'img-stow-413',
					title: 'Tomosynthesis uploads fail at "99%", every ~12 minutes',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'dicomweb-ingest · STOW-RS',
								range: '09:00 – 10:00',
								panels: [
									{ kind: 'timeseries', title: 'STOW requests OK /min', x: stX, series: [{ name: '200', points: stowOk }], span: 2 },
									{ kind: 'bars', title: 'HTTP 413 /min', x: stX, series: [{ name: '413', points: stow413, color: 4 }], span: 2 },
									{ kind: 'timeseries', title: 'Request duration p99', unit: 'ms', x: stX, series: [{ name: 'p99', points: stowDur, color: 3 }], log: true, span: 2 },
									{
										kind: 'table',
										title: 'Large requests (> 500 MB)',
										head: ['time', 'modality', 'instances', 'body size', 'status'],
										rows: [
											['09:05', 'MG (DBT)', '1', '2.41 GB', '413'],
											['09:17', 'MG (DBT)', '1', '1.96 GB', '413'],
											['09:29', 'MG (DBT)', '1', '2.77 GB', '413'],
											['09:36', 'CT', '1,204', '612 MB', '200'],
											['09:41', 'MG (DBT)', '1', '2.18 GB', '413'],
											['09:53', 'MG (DBT)', '1', '2.53 GB', '413']
										],
										numeric: [2],
										highlight: [0, 1, 2, 4, 5],
										span: 6
									}
								]
							}
						},
						{ type: 'p', text: 'The client is the modality vendor\'s [[dicomweb|STOW]] uploader, one HTTP request per study. The ingress controller has `proxy-body-size: 1g`.' }
					],
					answer: [
						{
							type: 'p',
							text: '**Body size limit, not a timeout.** Every failure is a breast [[digital-breast-tomosynthesis|tomosynthesis]] (DBT) study above 1 GB, sent as a **single** STOW request, and the ingress rejects it with 413 after the client has spent ~60 s uploading (hence "fails at 99%"). The 612 MB CT with 1,204 instances passes. Instance count isn\'t the issue; bytes per request is. A DBT instance is one enormous multi-frame object.'
						},
						{
							type: 'list',
							items: [
								'**Red herring:** the [[percentiles|p99]] duration spikes look like a slow backend. They are the uploads themselves; the rejection happens at the end because the proxy counts bytes as they stream in.',
								'**Wrong fix:** raise `proxy-body-size` to 10g. The next limits are proxy request buffering (nginx writes the body to disk or memory before forwarding), the app parsing multipart into memory (OOM), and the load balancer\'s idle timeout. You would move the failure, not remove it.',
								'**Right fix:** turn off request buffering for this path and stream the multipart body straight to object storage, parsing parts as they arrive. Accept large objects by **streaming upload with resumability** (or one instance per request), and return per-instance results (STOW returns a response listing failed [[dicom-uid|SOP instance]]s, so partial success is normal and must be retried, not treated as all-or-nothing).',
								'**Follow-up:** alert on 413 from ingest. A modality that silently drops a DBT study is a missing prior for the next screening read.'
							]
						}
					]
				},
				{
					id: 'img-partial-ai',
					title: 'The AI found nothing, because it read half the study',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'trace',
							trace: {
								title: 'study 1.2.840…7731 · CT head non-contrast · ED',
								spans: [
									{ id: 'a', service: 'router', name: 'C-STORE series 2 (5 mm axial, 32 inst)', start: 0, duration: 4000 },
									{ id: 'b', service: 'ingest', name: 'study-complete timer (30 s quiet)', start: 4000, duration: 30000, note: 'Fires when no new instance arrived for 30 s.' },
									{ id: 'c', service: 'ai', name: 'bleed-detector inference', start: 34000, duration: 9000, note: 'Input: series 2 only. Result: negative (score 0.08). Written to PACS as a structured report.' },
									{ id: 'd', service: 'router', name: 'C-STORE series 3 (0.625 mm thin recon, 412 inst)', start: 241000, duration: 22000, note: 'Reconstruction job on the scanner console finished 4 min later.' },
									{ id: 'e', service: 'ingest', name: 'study-complete timer', start: 263000, duration: 30000 },
									{ id: 'f', service: 'ai', name: 'skipped: result already exists for study', start: 293000, duration: 200, error: true }
								]
							}
						},
						{ type: 'p', text: 'The detector was validated on thin-slice reconstructions. The ED radiologist saw "AI: negative" and read the study later than they would have for a positive.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'Completeness was guessed from silence.',
									body: 'DICOM has no "study finished" message. A 30-second quiet timer fired between the scanner\'s first series and its thin reconstruction four minutes later. The model ran on the 5 mm series it was not validated on, and returned a confident negative.'
								},
								{
									title: 'Idempotency was keyed at the wrong level.',
									body: '"Result already exists for study" made the second, correct input a no-op. The dedup key must include **what the result was computed from** (series UIDs and instance counts), so new input invalidates the old result.'
								},
								{
									title: 'Input validation missing.',
									body: 'The model should **refuse** (no result, or "not assessable") when no series matches its validated protocol (slice thickness ≤ 1 mm, kernel, body part), rather than produce a score.'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** trigger per *series* that matches the model\'s protocol, using the order/protocol information (HL7 orders or MPPS, "modality performed procedure step", which tells you which series were acquired) as the expected set where available. Version every result with its input set, supersede on new input, and send the radiologist an *updated* result. A negative that later turns positive must be **pushed** to the worklist, not silently replaced.'
						},
						{
							type: 'callout',
							tone: 'crit',
							text: 'Severity: a wrong AI negative that changed reading priority is a patient-safety incident (report it through the clinical incident process), not just a bug ticket.'
						}
					]
				}
			]
		},

		// ───────────────────────── PART 2 ─────────────────────────
		{
			id: 'p2',
			nav: '2 · Clinical sync',
			eyebrow: 'Part 2 · 30 minutes · HL7 v2, FHIR, terminology',
			title: 'Clinical data sync',
			meta: 'ordering · merges · units · versioning · clinical time',
			minutes: 30,
			questions: [
				{
					id: 'hl7-order',
					title: 'Pharmacy says "patient not found" for patients who are obviously admitted',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								title: 'interface-engine · outbound to PHARM',
								query: 'channel:ADT_PHARM AND pid3:"MRN0093318"',
								lines: [
									{ ts: '14:02:07.118', level: 'INFO', source: 'q-A08', msg: 'SEND ADT^A08 MSG771203 PID-3=MRN0093318 (allergy update)', fields: { thread: 3, queue: 'A08' } },
									{ ts: '14:02:07.204', level: 'ERROR', source: 'q-A08', msg: 'ACK AE: "Patient not found" MSG771203 → moved to retry lane', fields: { thread: 3 } },
									{ ts: '14:02:07.310', level: 'INFO', source: 'q-ADMIT', msg: 'SEND ADT^A01 MSG771198 PID-3=MRN0093318 (admit to 4B)', fields: { thread: 1, queue: 'ADMIT' } },
									{ ts: '14:02:07.402', level: 'INFO', source: 'q-ADMIT', msg: 'ACK AA MSG771198', fields: { thread: 1 } },
									{ ts: '14:07:07.500', level: 'INFO', source: 'retry', msg: 'SEND ADT^A08 MSG771203 (retry 1)', fields: { thread: 5 } },
									{ ts: '14:07:07.588', level: 'INFO', source: 'retry', msg: 'ACK AA MSG771203', fields: { thread: 5 } },
									{ ts: '14:07:09.012', level: 'WARN', source: 'q-A08', msg: 'SEND ADT^A08 MSG771260 PID-3=MRN0093318 (allergy removed: entered in error)', fields: { thread: 2, note: 'sent at 14:05:40, ACK AA' } }
								]
							}
						},
						{ type: 'p', text: 'The engine was reconfigured last month: one queue per message type "so a burst of updates can\'t delay admissions".' }
					],
					answer: [
						{
							type: 'p',
							text: '**Per-type queues destroyed per-patient order.** The EHR sent [[adt-message|A01]] (control ID 771198) *before* A08 (771203), but they went into different queues on different threads, so the update arrived first and was rejected. The retry lane then created a worse bug: the allergy update (771203) was re-applied at 14:07, **after** the later message that removed the allergy as entered-in-error (771260, applied 14:05:40). Pharmacy now shows an allergy that was retracted. See [[hl7-v2]] and [[out-of-order-delivery]].'
						},
						{
							type: 'list',
							items: [
								'**Confirm:** for a sample of patients, compare the sequence of control IDs (MSH-10) sent by the EHR with the order of [[hl7-acknowledgements|ACK]]s at the pharmacy. Every inversion is a candidate data error.',
								'**Mitigate:** switch the channel back to a single ordered queue (slower but correct), and run a reconciliation of the pharmacy patient list and allergy lists against the EHR for every patient touched since the change.',
								'**Fix:** [[partition-key|partition by patient]] key (`PID-3` with issuer), with parallelism *across* partitions. Retries must block their own partition until resolved, never go to a side lane that reorders. Handle A40 merges by quiescing both patients\' partitions.',
								'**Why "AE then retry later" is unsafe:** HL7 receivers usually apply messages as state changes, not as versioned facts. An old message replayed late overwrites newer state. That is a lost update that looks like a successful delivery.'
							]
						}
					]
				},
				{
					id: 'glucose-units',
					title: 'Hypoglycaemia alerts jumped ~30× overnight at one site',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'results-feed · glucose (LOINC 2345-7)',
								range: 'Sep 01 – Oct 12',
								panels: [
									{
										kind: 'timeseries',
										title: 'Daily mean glucose by site',
										unit: '',
										x: gluX,
										series: [
											{ name: 'Site A', points: gluA },
											{ name: 'Site B', points: gluB },
											{ name: 'Site C', points: gluC, color: 4 }
										],
										markers: [{ at: 29, label: 'Site C analyser swap' }],
										span: 3
									},
									{ kind: 'bars', title: 'Hypoglycaemia alerts /day (value < 70)', x: gluX, series: [{ name: 'alerts', points: hypoAlerts, color: 3 }], markers: [{ at: 29, label: 'swap' }], span: 3 },
									{
										kind: 'table',
										title: 'Sample OBX segments, Site C, Sep 30',
										head: ['OBX-3 (code)', 'OBX-5 (value)', 'OBX-6 (units)', 'OBX-7 (range)'],
										rows: [
											['2345-7^Glucose SerPl-mCnc^LN', '6.9', 'mmol/L', '3.9-5.5'],
											['2345-7^Glucose SerPl-mCnc^LN', '11.2', 'mmol/L', '3.9-5.5'],
											['2345-7^Glucose SerPl-mCnc^LN', '4.4', 'mmol/L', '3.9-5.5']
										],
										span: 6
									}
								]
							}
						},
						{ type: 'p', text: 'The alert rule is `glucose < 70` on LOINC 2345-7, which the platform assumes is mg/dL.' }
					],
					hints: ['Read the units column, then read the LOINC name: "mCnc" vs "sCnc".', 'Glucose has a molar mass of 180.16 g/mol. Work out the conversion factor.'],
					answer: [
						{
							type: 'p',
							text: '**The new analyser reports in mmol/L, but the interface still labels results with the mg/dL LOINC code.** [[loinc|LOINC 2345-7]] is glucose **mass** concentration ("mCnc"). Molar concentration is **14749-6** ("SerPl-sCnc"). The platform trusts the code, reads 6.9 as 6.9 mg/dL, and every patient looks profoundly hypoglycaemic. This is [[terminology-mapping]] drift: no error is raised, and the values parse fine.'
						},
						{
							type: 'table',
							head: ['Step', 'Working'],
							rows: [
								['Molar mass of glucose', '180.16 g/mol → 1 mmol = 180.16 mg'],
								['1 mmol/L in mg/L', '180.16 mg/L'],
								['in mg/dL (÷10)', '**18.016 mg/dL**'],
								['6.9 mmol/L', '6.9 × 18.016 = **124.3 mg/dL** (above the 3.9-5.5 reference range, nowhere near hypoglycaemic)'],
								['Alert threshold 70 mg/dL', '70 ÷ 18.016 = **3.89 mmol/L**']
							]
						},
						{
							type: 'list',
							items: [
								'**Red herring:** the drop in Site C\'s mean looks like a sicker population or a broken analyser. A ~18× step in a mean on a single day is a units change; biology doesn\'t do that.',
								'**Mitigate:** suppress glucose alerts for Site C and route its results to manual verification. Notify the site lab: clinicians may have acted on false lows (dextrose given to normoglycaemic patients is a safety event to review).',
								'**Fix:** map by (site, local code, **unit string**), not by local code alone. Validate OBX-6 against the units allowed for each LOINC ([[ucum|UCUM]]), and **reject** mismatches rather than convert silently. Then add a distribution monitor per (site, code) that pages on a step change in mean or median.',
								'**Data remediation:** re-code every Site C glucose result since the swap to 14749-6 (or convert to mg/dL with the exact factor and record the provenance). Never multiply by "18" in one place and "18.016" in another: rounding differences break equality checks and trend lines.'
							]
						}
					]
				},
				{
					id: 'mrn-merge-research',
					title: 'After a patient merge, the research cohort has the same person twice, and later two people as one',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'list',
							items: [
								'Research pseudonyms are `HMAC(key, issuer|MRN)`, computed at export time.',
								'March: ED registered a trauma patient as `MRN-7731` ("Unknown, Male"). In April they were identified as existing patient `MRN-0420`, and an **A40** merged 7731 into 0420.',
								'The research dataset has both pseudonyms, `P7Q…` and `PK2…`. The cohort analysis counted them as two patients.',
								'June: a different A40 wrongly merged two real patients. It was **unmerged** two days later. In between, a nightly export ran.'
							]
						}
					],
					answer: [
						{
							type: 'p',
							text: '**Pseudonyms derived from a mutable identifier inherit its mutations.** An [[mrn|MRN]] is not a person: it can be retired by a merge or split by an unmerge ([[mrn-merge]]). A deterministic [[pseudonymization|pseudonym]] of the MRN faithfully reproduces both errors in the research world, where nobody sees the merge messages.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Key pseudonyms on the enterprise identity, not the MRN.',
									body: 'If the organisation runs an [[empi|EMPI]] (enterprise master patient index), pseudonymise its enterprise ID, which absorbs merges. If not, keep a **lineage table** in the de-id service: (old pseudonym → surviving pseudonym, effective time, source message).'
								},
								{
									title: 'Process A40 / A37 (unmerge) as events in the research pipeline.',
									body: 'A merge re-points history: emit an alias record so downstream datasets can collapse the two. An unmerge is harder. Data exported between merge and unmerge may combine two people, so every export in that window must be **re-derived from source**, not patched.'
								},
								{
									title: 'Release with a correction channel.',
									body: 'Research datasets need versioning and errata ("cohort v3 supersedes v2: 41 identity corrections"), just like any downstream copy of mutable truth.'
								}
							]
						},
						{
							type: 'callout',
							tone: 'warn',
							text: 'Tempting but wrong: "merge pseudonyms when demographics match". Twins, common names and data-entry errors make demographic matching a source of *new* false merges. In health data, that means one person\'s results attached to another\'s timeline.'
						}
					]
				},
				{
					id: 'fhir-412',
					title: 'Medication changes made by the pharmacy app keep disappearing',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'code',
							lang: 'typescript',
							code: `async function updateDose(id: string, dose: Dosage) {
  const res = await fhir.get(\`MedicationRequest/\${id}\`);
  const etag = res.headers.get("etag");               // 'W/"7"'
  const body = { ...res.data, dosageInstruction: [dose] };

  let put = await fhir.put(\`MedicationRequest/\${id}\`, body, {
    headers: { "If-Match": etag?.replace(/^W\\//, "") }  // strip weak marker: '"7"'
  });
  if (put.status === 412) {
    // "server keeps rejecting our ETag, fall back so the nurse isn't blocked"
    put = await fhir.put(\`MedicationRequest/\${id}\`, body);
  }
  return put;
}`
						},
						{ type: 'p', text: 'Ward pharmacists report that a dose change made by the prescriber a minute earlier is sometimes gone, replaced by the app\'s version.' }
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The 412 fallback is an unconditional overwrite: a lost update by design.',
									body: '[[fhir|FHIR]] uses `If-Match` for [[optimistic-locking]]: 412 *means* "someone changed this since you read it". Retrying without the header writes the app\'s stale copy over the prescriber\'s change. That is the reported symptom.'
								},
								{
									title: 'Stripping `W/` probably causes the constant 412s that motivated the fallback.',
									body: 'Many FHIR servers emit weak [[etag|ETag]]s and compare `If-Match` using exactly that form. Sending `"7"` instead of `W/"7"` never matches, so every update 412s, and the fallback runs every time. Two bugs combined into "it works, mostly".'
								}
							]
						},
						{
							type: 'p',
							text: '**Fix:** send the ETag back exactly as received. On 412, **re-read**, re-apply the user\'s *intent* (change dose X → Y) to the fresh resource, and if the field the user edited also changed, show the conflict to the human ("the prescriber changed this dose at 10:42: review"). Never auto-resolve clinical conflicts. Add an audit query: count PUTs without If-Match per client. It should be zero.'
						}
					]
				},
				{
					id: 'dst-mar',
					title: 'The medication record shows a dose given before it was prescribed',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'table',
							head: ['Event', 'Source', 'Timestamp as sent', 'Stored as (UTC)'],
							rows: [
								['Order: morphine 2 mg IV', 'EHR (FHIR)', '`2026-10-25T01:20:00+00:00` (the *second* 01:20, after clocks went back)', '01:20Z'],
								['Administered', 'Infusion pump gateway ([[hl7-v2|HL7]] v2 `OBX-14`)', '`202610250145` (no offset)', '00:45Z (receiver assumed the *first* 01:45, BST +01:00)'],
								['[[mar|MAR]] check', '', '', '**"Dose given 35 min before it was ordered"**']
							]
						},
						{ type: 'p', text: 'This happened on the night clocks went back (Europe/London, 25 Oct 2026, 02:00 BST → 01:00 GMT).' }
					],
					answer: [
						{
							type: 'p',
							text: 'On the night the clocks go back, **01:00–01:59 local time happens twice** (first BST, +01:00, then GMT, +00:00). The pump gateway sends HL7 timestamps **without an offset** (`YYYYMMDDHHMM` is legal in HL7 v2, and offset-less values are common). The receiver had to guess which 01:45 was meant, guessed differently from the EHR, and the record now shows an impossible sequence. See [[dst]] and [[iana-timezone]].'
						},
						{
							type: 'list',
							items: [
								'**Fix at the source:** configure the gateway to send `+ZZZZ` offsets (HL7 v2 TS/DTM allows `YYYYMMDDHHMMSS+ZZZZ`) or UTC. Store instants as UTC plus the IANA zone of the facility.',
								'**When the source can\'t be fixed:** resolve ambiguous local times using a monotonic signal (sequence numbers, receive time, the pump\'s own event order) and **flag** ambiguous ones for review instead of silently choosing.',
								'**Safety check that saved the day:** the "given before order" rule. Keep cross-checks that fail loudly on impossible clinical sequences; they catch clock bugs nothing else catches.',
								'**Also:** spring-forward makes 01:00–01:59 *not exist*, so a scheduled "every 4 hours" dose computed in local time can be skipped. Schedule in UTC and render in local time.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 3 ─────────────────────────
		{
			id: 'p3',
			nav: '3 · Redaction & AI',
			eyebrow: 'Part 3 · 30 minutes · PHI redaction, models, maths',
			title: 'Redaction pipelines and clinical AI',
			meta: 'recall maths · eponyms · telemetry leaks · re-identification · base rates',
			minutes: 30,
			questions: [
				{
					id: 'recall-math',
					title: '"Our redactor has 99% recall": should we release 1 million notes?',
					tag: 'core',
					minutes: 7,
					prompt: [
						{
							type: 'list',
							items: [
								'1,000,000 clinical notes for a research release.',
								'Evaluation on 2,000 annotated notes: **recall 99.0%**, precision 93% (per [[phi|PHI]] entity).',
								'Average **20 PHI mentions per note** (names, dates, MRNs, phone numbers, addresses).',
								'Leadership asks: "99% is great, can we ship?"'
							]
						}
					],
					hints: ['Recall is per mention. Harm is per note. What is the chance a note has zero misses?', 'How would you bound the leak rate from a QA sample that found zero leaks?'],
					answer: [
						{
							type: 'table',
							head: ['Quantity', 'Working', 'Result'],
							rows: [
								['PHI mentions in the release', '1,000,000 × 20', '20,000,000'],
								['Mentions missed (1% of them)', '20,000,000 × 0.01', '**200,000 leaked mentions**'],
								['P(note fully clean)', '0.99²⁰ = e^(20·ln 0.99)', '≈ **0.818**'],
								['Notes with ≥ 1 leak', '1,000,000 × (1 − 0.818)', '≈ **182,000 notes**']
							],
							caption: 'Assumes misses are independent. In practice they cluster (unusual formats, non-English names), which means fewer notes with more leaks each: not better.'
						},
						{
							type: 'p',
							text: '**So, no.** "99% recall" sounds like 1% of notes leak; it is closer to 18%. [[recall-precision]] must be reported **per document and per PHI type**: a missed date of birth and a missed full name are not the same risk.'
						},
						{
							type: 'list',
							items: [
								'**Layer defences:** structured-field removal first (headers, signatures, templates), then [[ner|NER]], then surrogate replacement (realistic fake names and shifted dates, "hiding in plain sight", so leftover real names are hard to tell from the fakes), then access controls on the release (data-use agreement, enclave, no download).',
								'**Measure what matters:** per-type recall with confidence intervals on a test set that represents the release (all note types and sites), not a convenience sample.',
								'**QA sampling with the rule of three:** if a random sample of *n* notes shows **zero** leaks, the 95% upper bound on the per-note leak rate is ≈ 3 / *n*. To claim < 0.1% of notes leak, you need ≈ **3,000** reviewed notes with zero misses. "We checked 100 and found nothing" only supports < 3%.'
							]
						}
					]
				},
				{
					id: 'eponyms',
					title: 'The redactor deleted "Parkinson" and kept "Mrs. Graves\'s daughter"',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{
							type: 'code',
							lang: 'text',
							caption: 'Before → after redaction (NER model fine-tuned on general web text, then on 300 notes).',
							code: `IN : "Hx of Parkinson's disease, on carbidopa. Graves disease in remission.
       Seen with Mrs. Graves's daughter Hope, who manages meds. Referred to Dr. Wilson
       for Wilson's disease work-up. Down syndrome noted. Lives in Reading."
OUT: "Hx of [NAME]'s disease, on carbidopa. [NAME] disease in remission.
       Seen with Mrs. Graves's daughter Hope, who manages meds. Referred to Dr. [NAME]
       for [NAME]'s disease work-up. [NAME] syndrome noted. Lives in Reading."`
						}
					],
					answer: [
						{
							type: 'p',
							text: 'Two failures with the same root: the model learned "capitalised word that is also a surname = name", without clinical context. It over-redacts **[[medical-eponym|eponyms]]** (Parkinson, Graves, Wilson, Down), which destroys research value (precision), and under-redacts the **actual** relative\'s name and a first name that is also a common word (Hope). "Reading" is a town (a location identifier) and also an English word. This is the [[recall-precision]] trade-off made concrete.'
						},
						{
							type: 'list',
							items: [
								'**Context features:** "X\'s disease / syndrome / sign" is an eponym pattern; "Mrs./Dr./daughter/son + Capitalised" is a person pattern. Clinical NER trained on annotated clinical notes learns these; general models don\'t.',
								'**Allow-lists with context, never bare:** an eponym list applied only in disease patterns. A bare allow-list for "Wilson" would leak Dr. Wilson.',
								'**Evaluate per category** (patient names, relatives, clinicians, eponyms, locations) and on hard cases deliberately added to the test set.',
								'**Surrogates help both ways:** replacing names with realistic fakes ("Mrs. Holt") means a missed real name is indistinguishable from the fakes, and a wrongly replaced eponym is at least visibly odd to the researcher.'
							]
						}
					]
				},
				{
					id: 'llm-telemetry',
					title: 'The AI summary feature passed its privacy review. The traces didn\'t.',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'logs',
							logs: {
								style: 'kibana',
								title: 'apm-vendor (us-east) · span attributes',
								query: 'service:discharge-summarizer AND span.name:llm.generate',
								lines: [
									{
										ts: '09:14:22.501',
										level: 'INFO',
										source: 'llm.generate',
										msg: 'gen_ai.prompt="Summarise for discharge. Patient: Jane DOE, MRN0081123, DOB 1958-02-14. Notes: …"',
										fields: { 'gen_ai.response.length': 812, 'http.status': 200, retention: '30d' }
									},
									{ ts: '09:14:22.913', level: 'INFO', source: 'redact', msg: 'redaction applied to output: 3 entities', fields: { stage: 'post-generation' } },
									{
										ts: '09:14:23.004',
										level: 'WARN',
										source: 'llm.generate',
										msg: 'retry 1/3 after 429 · request body attached to error event for debugging',
										fields: { 'error.tracker': 'sentry-saas', pii_scrubbing: 'default' }
									}
								]
							}
						},
						{ type: 'p', text: 'Privacy review approved the design: the LLM provider has a [[hipaa|BAA]] and no-retention terms, and outputs are redacted before display.' }
					],
					answer: [
						{
							type: 'p',
							text: '**The review covered the model, not the plumbing.** Auto-instrumentation records prompts as [[trace-span|span attributes]], so full PHI sits in an [[apm|APM]] vendor (US region, 30-day retention, probably no BAA for this data). The error tracker attaches request bodies to retries, and its default [[pii-redaction|scrubbing]] knows `password`, not `MRN`. Redaction runs **after** generation, so it protects the screen and none of the copies. This is the classic [[phi-in-telemetry]] leak.'
						},
						{
							type: 'ranked',
							items: [
								{ title: 'Contain', body: 'Disable prompt and response capture in the instrumentation now, purge the affected spans and error events at both vendors (request deletion in writing), and open a privacy incident: data residency and a processor without a contract are both in play ([[data-residency]]).' },
								{ title: 'Fix structurally', body: 'Allow-list telemetry attributes (model, token counts, latency, status), never bodies. Redact or pseudonymise **before** the prompt is built where the use case allows. Route LLM calls through one gateway that owns logging policy, instead of trusting every service\'s SDK defaults.' },
								{ title: 'Prove it', body: 'A CI test that runs the feature against a synthetic patient with canary identifiers ("ZZTESTPATIENT-7731") and then searches every telemetry sink for the canary. Ship only when it finds nothing.' }
							]
						}
					]
				},
				{
					id: 'k-anon-release',
					title: 'Is this extract safe to share with an external research partner?',
					tag: 'core',
					minutes: 6,
					prompt: [
						{
							type: 'table',
							head: ['Age band', 'Sex', 'ZIP3', 'Diagnosis', 'Records'],
							numeric: [4],
							rows: [
								['60–69', 'F', '021', 'Type 2 diabetes', '412'],
								['60–69', 'M', '021', 'Type 2 diabetes', '389'],
								['70–79', 'F', '036', 'Type 2 diabetes', '23'],
								['90+', 'M', '036', 'Type 2 diabetes', '6'],
								['30–39', 'F', '059', 'Erdheim–Chester disease', '1'],
								['40–49', 'M', '021', 'HIV', '7 (all on the same regimen, same clinic)'],
								['97', 'F', '021', 'Hip fracture', '1']
							]
						},
						{ type: 'p', text: 'Proposed policy: release if every row group has k ≥ 5 on (age band, sex, ZIP3).' }
					],
					answer: [
						{
							type: 'list',
							items: [
								'**Erdheim–Chester, k = 1:** a disease with only a few hundred known cases worldwide is an identifier in itself. Suppress the row, or generalise the diagnosis to its category.',
								'**Age 97:** exact ages over 89 are an identifier under [[hipaa]] Safe Harbor; they must be grouped as "90+". It is also k = 1. Generalise and re-check.',
								'**The 90+ / M / 036 group, k = 6:** it passes k ≥ 5, but ZIP3 "036" is a sparse area. Safe Harbor requires ZIP3s with fewer than 20,000 residents to be reported as "000". Check the census population, not just k.',
								'**HIV, k = 7 but not diverse:** everyone in the group shares the sensitive attribute (and regimen and clinic). Knowing that a 45-year-old man from 021 is in the dataset reveals his HIV status. k-anonymity holds; **l-diversity** fails ([[k-anonymity]]).',
								'**Linkage you didn\'t model:** the partner may hold other data (news reports, voter rolls). Combinations of [[quasi-identifier|quasi-identifiers]] beyond the three you checked (admission dates, rare procedures) can single people out.'
							]
						},
						{
							type: 'p',
							text: '**Answer:** not as proposed. Suppress or generalise the k = 1 rows, apply Safe Harbor\'s age and ZIP rules, assess sensitive-attribute diversity, and prefer a controlled environment (a secure enclave where the partner runs queries and only aggregates leave) over a file transfer for anything with HIV or rare diseases.'
						}
					]
				},
				{
					id: 'ptx-ppv',
					title: 'The pneumothorax AI "got worse" after rolling out to outpatient clinics',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'datadog',
								title: 'ai-triage · pneumothorax flag',
								range: 'Aug 18 – Sep 26',
								filters: ['model=ptx-v3.2', 'threshold=0.5'],
								panels: [
									{ kind: 'timeseries', title: 'Chest X-rays scored /day', x: ptxX, series: [{ name: 'studies', points: ptxStudies }], markers: [{ at: 20, label: 'outpatient rollout' }], span: 2 },
									{
										kind: 'timeseries',
										title: 'Flags vs radiologist-confirmed /day',
										x: ptxX,
										series: [
											{ name: 'flags', points: ptxAlerts, color: 3 },
											{ name: 'confirmed', points: ptxConfirmed, color: 4 }
										],
										markers: [{ at: 20, label: 'rollout' }],
										span: 4
									},
									{ kind: 'stat', title: 'Sensitivity (audit sample)', value: '90%', delta: 'unchanged', tone: 'ok' },
									{ kind: 'stat', title: 'Specificity (audit sample)', value: '95%', delta: 'unchanged', tone: 'ok' },
									{ kind: 'stat', title: 'Flag → confirmed', value: '19%', delta: 'was 61%', tone: 'crit' },
									{ kind: 'stat', title: 'Scanner firmware', value: 'v8.4', delta: 'updated Sep 01', tone: 'warn' }
								]
							}
						},
						{ type: 'p', text: 'Pneumothorax [[base-rate-fallacy|prevalence]]: ~8% of [[emergency-department|ED]] chest X-rays, ~0.5% of outpatient ones. Radiologists now ignore the flag.' }
					],
					answer: [
						{
							type: 'p',
							text: '**The model didn\'t change; the base rate did.** Sensitivity and specificity are unchanged in the audit. [[positive-predictive-value|PPV]] collapses when prevalence drops, so the flag became mostly noise and radiologists stopped trusting it: [[alarm-fatigue]].'
						},
						{
							type: 'table',
							head: ['Population', 'True positives', 'False positives', 'PPV'],
							rows: [
								['ED (8%)', '0.08 × 0.90 = 0.072', '0.92 × 0.05 = 0.046', '0.072 / 0.118 = **61%**'],
								['Outpatient (0.5%)', '0.005 × 0.90 = 0.0045', '0.995 × 0.05 = 0.0498', '0.0045 / 0.0543 = **8.3%**'],
								['Mixed after rollout (380 ED + 3,220 outpatient/day)', '380 × 0.072 + 3,220 × 0.0045 ≈ 41.9', '380 × 0.046 + 3,220 × 0.0498 ≈ 177.8', '41.9 / 219.7 ≈ **19%**, matching the dashboard']
							]
						},
						{
							type: 'list',
							items: [
								'**Red herring:** the firmware update (Sep 01) is six days before the change and touched every site, but the audit shows sensitivity and specificity unchanged. Population is the variable that moved.',
								'**Fix options:** per-setting thresholds (raise it for outpatients and accept lower sensitivity where the harm of a delay is lower), restrict the flag to settings where PPV is useful, or show a calibrated probability instead of a binary flag.',
								'**Governance:** deploying to a new population is a new validation, not a config change. Monitor PPV per setting continuously; sensitivity can only be audited with delayed ground truth.'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 4 ─────────────────────────
		{
			id: 'p4',
			nav: '4 · Compliance',
			eyebrow: 'Part 4 · 30 minutes · distributed compliance',
			title: 'Compliance at scale',
			meta: 'consent · audit · break-glass · retention · bedside devices',
			minutes: 30,
			questions: [
				{
					id: 'consent-propagation',
					title: 'Design: a patient withdraws research consent. Make it stick everywhere.',
					tag: 'design',
					minutes: 8,
					prompt: [
						{
							type: 'flow',
							steps: [
								{ label: 'Consent service', note: 'source of truth' },
								{ label: 'Postgres primary + 2 replicas' },
								{ label: 'Redis cohort cache', note: 'TTL 24 h' },
								{ label: 'Search index', note: 'notes, nightly rebuild' },
								{ label: 'Vector store', note: 'note embeddings for RAG' },
								{ label: 'Research extracts', note: 'parquet in partner buckets' },
								{ label: 'Trained models' }
							]
						},
						{ type: 'p', text: 'The law and the consent form promise that withdrawn data stops being used for research within 30 days. Today the only mechanism is a `DELETE` on the primary.' }
					],
					answer: [
						{
							type: 'p',
							text: 'Deleting from the primary reaches the replicas and nothing else. The cache serves the cohort for up to 24 h, the index until the next full rebuild (if that rebuild reads from the primary), the vector store forever ([[embedding-leakage]]), and the extracts were copied out of your control. This is [[consent-revocation]]: a distributed-deletion problem with a legal deadline.'
						},
						{
							type: 'ranked',
							items: [
								{
									title: 'Enforce at use time, not only by cleaning copies.',
									body: 'Every research query and every RAG retrieval filters through the consent service (or a short-TTL replica of the opt-out list, minutes not a day). Then a missed copy is inert. This is the only part you can make *immediately* correct.'
								},
								{
									title: 'Propagate deletion as an event, and confirm it.',
									body: 'Publish `consent.withdrawn` via the outbox. Each holder (index, vector store, feature store) deletes and **acknowledges**; a reconciler checks that every sink has acked within an SLA and pages if not. Rebuild jobs must read the opt-out list, or they resurrect deleted rows.'
								},
								{
									title: 'Extracts and models need contractual and versioned handling.',
									body: 'You can\'t delete from a partner\'s bucket: the data-use agreement must oblige them to, and new extract versions must exclude the patient. For trained models, decide (and document) whether withdrawal applies to future training only, which is the common position, and stop including the data in the next training run.'
								},
								{
									title: 'Respect conflicting obligations.',
									body: 'Withdrawal of research consent does not delete the clinical record ([[legal-hold]] and retention rules). The design must separate "stop using for research" from "erase", and keep an audit of the withdrawal itself.'
								}
							]
						}
					]
				},
				{
					id: 'audit-gaps',
					title: '"We can\'t prove who looked at the footballer\'s record"',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'ticket',
							ticket: {
								channel: 'email',
								from: 'Helen Marsh',
								role: 'Privacy Officer',
								subject: 'Access investigation: VIP admission',
								body: `A newspaper published details of a celebrity's admission. Our audit report shows 14 staff viewed the record, all with a clinical reason. But the article mentions a lab result none of those 14 opened.

Is the audit log complete? I need a yes or no and an explanation I can give the regulator.`
							}
						},
						{
							type: 'code',
							lang: 'python',
							code: `# web/views/patient.py
@login_required
def patient_chart(request, mrn):
    record = repo.load_chart(mrn)
    audit.log_async(user=request.user, mrn=mrn, action="view_chart")   # UDP to log shipper
    return render(request, "chart.html", record)

# api/fhir.py : used by the mobile app, the reporting tool and the lab portal
def get_observation(request, id):
    return json(repo.load_observation(id))`
						}
					],
					answer: [
						{
							type: 'p',
							text: '**No, the log is not complete, and the answer to the regulator has to say so.** Audit happens in one UI controller. The FHIR API (mobile app, reporting tool, lab portal) reads Observations without logging anything, so the lab result could have been read through any of them. Even the UI log is best-effort: UDP fire-and-forget drops events under load or when the shipper restarts. See [[audit-trail]].'
						},
						{
							type: 'list',
							items: [
								'**Investigate with what exists:** API gateway access logs, database statement logs, and reporting-tool query history can reconstruct some reads. Say clearly which channels were covered and which weren\'t.',
								'**Fix: audit at the data-access layer**, so every path that returns PHI (repository, FHIR server, export jobs, support tools) writes an audit event, and the event names the user, patient, resource, purpose and channel.',
								'**Durability:** write the audit record to a durable local buffer or transactional outbox before returning data. For clinical reads, fail *open* with a durable buffer rather than blocking care; for bulk exports, fail *closed*.',
								'**Tamper evidence:** append-only storage (object lock or WORM), hash chaining, and access to the audit log itself audited.',
								'**Proactive:** VIP flags and anomaly alerts (staff with no care relationship opening a flagged record) beat after-the-fact investigation.'
							]
						}
					]
				},
				{
					id: 'break-glass-outage',
					title: 'The authorisation service went down and the ICU couldn\'t open charts',
					tag: 'tricky',
					minutes: 5,
					prompt: [
						{ type: 'p', text: 'Every chart open calls `authz.check(user, patient)` (a central policy service, p99 40 ms). During a 25-minute outage of that service, clinicians got "Access denied". Someone proposes: "if authz is down, allow everything".' }
					],
					answer: [
						{
							type: 'p',
							text: 'Both extremes are wrong. Fail-closed blocked clinical care, a patient-safety risk. Fail-open for everything turns any outage (or any way an attacker can trigger one) into unrestricted PHI access. [[break-glass]] exists exactly for this middle ground.'
						},
						{
							type: 'list',
							items: [
								'**Degrade by request type:** clinical reads by authenticated clinicians fall back to a locally cached policy (care-team assignments replicated to each app node, minutes stale) and then to **break-glass with a stated reason**. Writes, exports and admin actions fail closed.',
								'**Audit everything taken in degraded mode**, mark it, and auto-queue it for review after recovery.',
								'**Take the dependency off the critical path:** evaluate common decisions locally (a policy engine running inside the app with pushed rules, e.g. OPA) and keep the central service for policy authoring and rare decisions.',
								'**Test it:** a game day where authz is unavailable, run with clinical staff, not only engineers.'
							]
						}
					]
				},
				{
					id: 'erasure-holds',
					title: 'A patient asks to "delete everything" from the patient app',
					tag: 'core',
					minutes: 5,
					prompt: [
						{
							type: 'list',
							items: [
								'App account data: profile, symptom diary, chat with the care team, app analytics.',
								'The chat was copied into the clinical record (EHR) as clinical correspondence.',
								'An open complaint (legal hold) covers the patient\'s last admission.',
								'Database backups are immutable for 35 days.'
							]
						}
					],
					answer: [
						{
							type: 'table',
							head: ['Data', 'What happens', 'Why'],
							rows: [
								['App profile, diary, analytics', 'Erase now (or within the statutory deadline)', 'No overriding obligation. [[gdpr-erasure]] applies.'],
								['Chat copied into the EHR', 'Keep', 'Medical records have a legal retention period; the right to erasure does not override it.'],
								['Records under the complaint', 'Keep, flagged', '[[legal-hold]] overrides both retention-based deletion and erasure.'],
								['Backups', 'Keep until they expire (35 days), with a **re-deletion list** applied on any restore', 'Rewriting immutable backups is not expected; restoring deleted data is not allowed.'],
								['Copies in logs, search, analytics exports', 'Erase or let expire within a documented window', 'They are copies of the erased data.']
							]
						},
						{
							type: 'p',
							text: '**The reply matters as much as the deletion:** tell the patient what was deleted, what was kept, under which obligation, and for how long. "Deleted everything" would be false, and "can\'t delete anything, it\'s medical" is also false.'
						}
					]
				},
				{
					id: 'bedside-sync',
					title: 'After the ward Wi-Fi came back, an early-warning alert fired 25 minutes late',
					tag: 'tricky',
					minutes: 6,
					prompt: [
						{
							type: 'dashboard',
							dashboard: {
								style: 'grafana',
								title: 'vitals-ingest · ward 6A',
								range: '01:50 – 02:59',
								panels: [
									{
										kind: 'timeseries',
										title: 'Ingest lag (receive − device time)',
										unit: 's',
										x: vX,
										series: [{ name: 'p50 lag', points: vLag }],
										markers: [{ at: 20, label: 'Wi-Fi down' }, { at: 50, label: 'Wi-Fi back' }],
										log: true,
										span: 3
									},
									{ kind: 'bars', title: 'Readings ingested /min', x: vX, series: [{ name: 'readings', points: vIngest }], span: 3 },
									{ kind: 'timeseries', title: 'Bed 12 early-warning score', x: vX, series: [{ name: 'score', points: vNews, color: 4 }], thresholds: [{ value: 5, label: 'escalate' }], span: 3 },
									{ kind: 'bars', title: 'Readings with device time in the future', x: vX, series: [{ name: 'future', points: vFuture, color: 3 }], span: 3 }
								]
							}
						},
						{
							type: 'p',
							text: 'Monitors buffer readings during outages and upload them on reconnect. The early-warning score is computed every minute over "readings with device time in the last 15 minutes". Bed 12\'s monitor clock is 7 minutes fast.'
						}
					],
					answer: [
						{
							type: 'ranked',
							items: [
								{
									title: 'The score was computed on a window that had no data, then on a window that ignored the backfill.',
									body: 'During the outage nothing arrived, so the score showed 0 (missing data drawn as zero, not as "unknown"). On reconnect, 30 minutes of buffered readings arrived at once, but the per-minute job only looks *forward*. It never recomputed past windows, so the deterioration that started during the outage first counted when *new* readings crossed the threshold.',
									confirm: 'Replay bed 12\'s readings ordered by device time: the score crosses 5 inside the outage window.'
								},
								{
									title: 'Clock skew put readings in the future.',
									body: 'Bed 12\'s monitor runs 7 minutes fast. Its readings carry future timestamps and fall outside "the last 15 minutes" for 7 minutes, which delays the score further. The "future" panel spikes as the backlog arrives.',
									confirm: 'Per-device offset = device time − receive time, measured on heartbeats.'
								}
							]
						},
						{
							type: 'list',
							items: [
								'**Fix the clocks:** NTP on devices (or PTP where needed), with a per-device offset estimated from heartbeats and corrected on ingest. Keep both the device time and the corrected time ([[clock-skew]], [[hybrid-logical-clock]]).',
								'**Treat missing data as missing:** show "no data since 02:10" on the dashboard and alert on a silent monitor. A blank score is not a normal score.',
								'**Recompute on late data:** treat it as [[late-arriving-data]] and use event-time windows with a watermark that re-evaluates and **alerts on retroactive threshold crossings**, explicitly marked ("deterioration detected at 02:20, reported late").',
								'**Alarm design:** a retroactive alert must reach a human differently from a live one, and not be added to the general noise ([[alarm-fatigue]]).'
							]
						}
					]
				}
			]
		},

		// ───────────────────────── PART 5 ─────────────────────────
		{
			id: 'p5',
			nav: '5 · Labs',
			eyebrow: 'Part 5 · 25 minutes · interactive',
			title: 'Live labs',
			meta: 'work the incident in the console, then read the debrief',
			minutes: 25,
			questions: [
				{
					id: 'lab-pacs',
					title: 'Lab: the PACS migration is filling the router spool',
					tag: 'tricky',
					minutes: 12,
					answerLabel: 'Show debrief',
					prompt: [{ type: 'lab', lab: pacsLab }],
					answer: [
						{
							type: 'p',
							text: '**Evidence:** de-id CPU is at ~75% and the de-id queue stays small, while the OCR queue grows by ~500 per second. The OCR node\'s detection stats show **0.00%** hits on CT and MR, which make up 83% of the volume. The bottleneck is OCR, and it is spending almost all its capacity on images that never contain burned-in text.'
						},
						{
							type: 'list',
							items: [
								'**Trap 1, scale de-id workers:** de-id isn\'t the bottleneck, so delivered stays at 90/s and the spool fills.',
								'**Trap 2, max out GPU nodes alone:** 6 × 45 = 270/s against 600/s arriving. Still filling, just slower (the spool fills around T+11 min instead of T+8).',
								'**Trap 3, switch OCR off:** instant loss. Ultrasound and secondary captures with burned-in names ship to research. Throughput never justifies a PHI leak.',
								'**Fix:** scope OCR to US, SC, OT and DOC (≈ 8% of instances, 48/s, well within 90/s), and add GPU nodes to drain the ~50k instances already queued for OCR under the old rule by the time the change lands. Scope alone also wins, but takes about 18 minutes to drain.',
								'**Afterwards:** make scope a reviewed policy (which sources can carry burned-in text: by modality, manufacturer and SOP class), alert on OCR queue age, and rate-limit migration replays so they can\'t starve live clinical routing. The scanners and the replay share one spool.'
							]
						}
					]
				},
				{
					id: 'lab-hl7',
					title: 'Lab: replay two hours of ADT without misfiling anyone',
					tag: 'tricky',
					minutes: 10,
					answerLabel: 'Show debrief',
					prompt: [{ type: 'lab', lab: hl7Lab }],
					answer: [
						{
							type: 'p',
							text: '**Evidence:** one thread delivers 40 msg/s against 30/s of live traffic, so the 50,000 backlog drains at about 10/s: over an hour. More threads is the obvious move.'
						},
						{
							type: 'list',
							items: [
								'**Trap, 16 round-robin threads:** throughput jumps to ~640/s, but messages for the same patient now run in parallel. A08 lands before A01, A40 before the duplicate exists. Misfiles pass 200 within about 30 seconds. Even 4 round-robin threads misfile ~150 records in two minutes.',
								'**Fix:** switch dispatch to **keyed by patient (PID-3)** first, wait for it to roll out, *then* raise threads. Each patient\'s messages stay in order on one thread, and parallelism comes from different patients. Hot keys cost ~12% throughput, which is fine.',
								'**Order of operations matters:** raising threads in the same change as the dispatch switch races the rollout. Change the safety property first, then the speed.',
								'**What the lab simplifies:** A40 merges span two patient keys. A real engine routes the merge to the surviving patient\'s partition and waits for the retired patient\'s partition to drain first. Retries must block their own partition, never jump to a side lane.'
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
			title: 'Clinical maths and quick judgement',
			questions: [
				{
					id: 't-ppv',
					title: 'PPV in your head',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Sensitivity 99%, specificity 95%, prevalence 1%. Of 10,000 people, how many positives are real?' }],
					answer: [
						{
							type: 'p',
							text: 'Real positives: 100 × 0.99 = 99. False positives: 9,900 × 0.05 = 495. PPV = 99 / 594 ≈ **16.7%**. Five out of six alarms are false ([[positive-predictive-value]]).'
						}
					]
				},
				{
					id: 't-glucose',
					title: 'Units, fast',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A fasting glucose of 5.5 mmol/L in mg/dL? And 200 mg/dL in mmol/L?' }],
					answer: [{ type: 'p', text: '5.5 × 18.016 = **99.1 mg/dL**. 200 ÷ 18.016 = **11.1 mmol/L**. The factor is molar mass 180.16 g/mol ÷ 10 (dL per L).' }]
				},
				{
					id: 't-hash-mrn',
					title: 'Is `sha256(mrn)` a pseudonym?',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'MRNs are 8-digit numbers. A laptop does ~10 million SHA-256 hashes per second per core.' }],
					answer: [
						{
							type: 'p',
							text: 'There are 10⁸ possible MRNs, so on one core you can hash all of them in **~10 seconds** and invert the whole dataset. An unkeyed hash of a small identifier space is not pseudonymisation. Use HMAC with a protected key ([[pseudonymization]]).'
						}
					]
				},
				{
					id: 't-rule-of-three',
					title: 'Zero leaks found in 300 sampled notes',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'What leak rate can you claim with 95% confidence?' }],
					answer: [
						{
							type: 'p',
							text: 'Rule of three: the upper bound ≈ 3 / 300 = **1% of notes**. "We found nothing" with 300 samples is compatible with 10,000 leaking notes in a million-note release.'
						}
					]
				},
				{
					id: 't-uid-uuid',
					title: 'Why not put a UUID in a DICOM UID?',
					tag: 'teaser',
					prompt: [],
					answer: [
						{
							type: 'p',
							text: 'DICOM UIDs allow **digits and dots only**, at most 64 characters, with no leading zeros in a component. The hex form of a UUID is invalid. The `2.25.` root takes the UUID\'s 128-bit value in **decimal**: at most 39 digits + 5 = 44 characters ([[dicom-uid]]).'
						}
					]
				},
				{
					id: 't-shift-weekday',
					title: 'Date shifting that keeps the weekend effect',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'Researchers study weekend-admission mortality. Your per-patient date shift is a random −1 to −365 days. What breaks, and how do you fix it cheaply?' }],
					answer: [
						{
							type: 'p',
							text: 'A random day offset scrambles the day of the week, so "admitted on a Saturday" becomes meaningless. Shift by a random **multiple of 7 days** (e.g. −7 × [1..52]): intervals and weekdays are preserved, at a small cost in privacy (the weekday is now a known attribute). Holidays still move, so document it ([[date-shifting]]).'
						}
					]
				},
				{
					id: 't-pdf-redact',
					title: 'The black boxes in the PDF',
					tag: 'teaser',
					prompt: [{ type: 'p', text: 'A scanned referral was "redacted" by drawing black rectangles over names, then exported as PDF. Safe?' }],
					answer: [
						{
							type: 'p',
							text: 'Often not. If the PDF has an OCR text layer, the text under the boxes is still there: select-all and copy reveals it. And drawing a box doesn\'t touch the original image layer in some tools. Redact by **removing** content (burn into a new raster, drop the text layer, strip metadata), then verify by extracting text from the output.'
						}
					]
				}
			]
		}
	]
};

export default a12;
