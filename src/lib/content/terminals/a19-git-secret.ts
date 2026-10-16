import type { TerminalScenario } from '../types';
import { oneOf } from '$lib/terminal/scenario';
import { err } from './a19-util';

/**
 * A secret scanner flagged a cloud access key in the public mirror. `grep -r` on the working tree
 * only finds the documentation placeholder key (decoy). The real key was committed in a3f9c21 and
 * "removed" in 7be0d44, so it's still in history and must be rotated regardless.
 */

const REPO = '/home/dev/billing-api';

const COMMITS = [
	{ sha: 'e41c0aa', date: '2026-10-12', author: 'Priya N', msg: 'Add invoice PDF retry', diff: 'diff --git a/app/pdf.py b/app/pdf.py\n+    for attempt in range(3):\n+        ...' },
	{ sha: '7be0d44', date: '2026-10-02', author: 'Sam K', msg: 'remove debug creds', diff: 'diff --git a/deploy/local.env b/deploy/local.env\ndeleted file mode 100644\n--- a/deploy/local.env\n+++ /dev/null\n-CLOUD_ACCESS_KEY_ID=AKIA2LEAKEDK3YDEMO01\n-CLOUD_SECRET_ACCESS_KEY=wJx9Q2leaked/notreal/Sx7Tq0aZ\n-DB_URL=postgres://billing@localhost/billing' },
	{ sha: '19dd2e8', date: '2026-09-30', author: 'Sam K', msg: 'docs: config examples', diff: 'diff --git a/docs/config.md b/docs/config.md\n+Example (placeholder from the cloud provider docs):\n+  CLOUD_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE' },
	{ sha: 'a3f9c21', date: '2026-09-29', author: 'Sam K', msg: 'wip: local s3 uploads', diff: 'diff --git a/deploy/local.env b/deploy/local.env\nnew file mode 100644\n--- /dev/null\n+++ b/deploy/local.env\n+CLOUD_ACCESS_KEY_ID=AKIA2LEAKEDK3YDEMO01\n+CLOUD_SECRET_ACCESS_KEY=wJx9Q2leaked/notreal/Sx7Tq0aZ\n+DB_URL=postgres://billing@localhost/billing' },
	{ sha: '5c02b7f', date: '2026-09-20', author: 'Priya N', msg: 'Initial import', diff: 'diff --git a/README.md b/README.md\n+# billing-api' }
];

function git(args: string[], ctx: { cwd: string }) {
	if (!ctx.cwd.startsWith(REPO)) return err('fatal: not a git repository (or any of the parent directories): .git', 128);
	const line = args.join(' ');
	const s = /-S\s*(\S+)|-G\s*(\S+)|--grep[= ](\S+)/.exec(line);
	const filter = (c: (typeof COMMITS)[number]) => (s ? (s[1] ? c.diff.includes(s[1]) : s[2] ? new RegExp(s[2]).test(c.diff) : c.msg.includes(s[3])) : true);
	if (args[0] === 'log') {
		const list = COMMITS.filter(filter).filter((c) => !line.includes('-- deploy/local.env') || c.diff.includes('deploy/local.env'));
		if (line.includes('--oneline')) return list.map((c) => `${c.sha} ${c.msg}`).join('\n');
		return list.map((c) => `commit ${c.sha}5d1e0b9a8c7f6e5d4c3b2a19087f6e5d4c3b2a1\nAuthor: ${c.author} <${c.author.split(' ')[0].toLowerCase()}@shop.example>\nDate:   ${c.date}\n\n    ${c.msg}\n${line.includes('-p') ? '\n' + c.diff + '\n' : ''}`).join('\n');
	}
	if (args[0] === 'show') {
		const c = COMMITS.find((x) => args[1] && x.sha.startsWith(args[1].slice(0, 7)));
		if (!c) return err(`fatal: bad object ${args[1] ?? ''}`, 128);
		return `commit ${c.sha}\nAuthor: ${c.author}\nDate:   ${c.date}\n\n    ${c.msg}\n\n${c.diff}`;
	}
	if (args[0] === 'grep') {
		const pat = args.filter((a) => !a.startsWith('-'))[1] ?? '';
		const rev = args.filter((a) => !a.startsWith('-'))[2];
		if (rev) {
			const c = COMMITS.find((x) => x.sha.startsWith(rev));
			return c ? c.diff.split('\n').filter((l) => l.startsWith('+') && l.includes(pat)).map((l) => `${rev}:deploy/local.env:${l.slice(1)}`).join('\n') : err(`fatal: bad revision '${rev}'`);
		}
		return 'docs/config.md:14:  CLOUD_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
	}
	if (args[0] === 'status') return 'On branch main\nYour branch is up to date with \'origin/main\'.\n\nnothing to commit, working tree clean';
	if (args[0] === 'branch') return '* main\n  feature/pdf-retry';
	return err(`git: '${args[0]}' is not available in this sandbox (try log, show, grep, status)`);
}

const scenario: TerminalScenario = {
	title: 'dev@workstation · billing-api',
	user: 'dev',
	host: 'workstation',
	cwd: REPO,
	motd: 'Repo: billing-api (public mirror: github.example/shop/billing-api)',
	task: 'Security bot: **"Cloud access key pattern `AKIA…` detected in public repository shop/billing-api."** Your teammate says "that\'s just the docs example". Find the commit that introduced a *real* key and `submit` its short SHA.',
	files: {
		[`${REPO}/README.md`]: '# billing-api\nSee docs/config.md for configuration.\n',
		[`${REPO}/docs/config.md`]:
			'# Configuration\n\nSet credentials through the environment, never in files.\n\n| Variable | Purpose |\n|---|---|\n| CLOUD_ACCESS_KEY_ID | uploads |\n| CLOUD_SECRET_ACCESS_KEY | uploads |\n\n\n\n\nExample (placeholder from the cloud provider docs):\n  CLOUD_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n',
		[`${REPO}/app/pdf.py`]: 'import os\nBUCKET = os.environ["INVOICE_BUCKET"]\n',
		[`${REPO}/app/settings.py`]: 'import os\nACCESS_KEY = os.environ.get("CLOUD_ACCESS_KEY_ID")\n',
		[`${REPO}/deploy/prod.env.example`]: 'CLOUD_ACCESS_KEY_ID=\nCLOUD_SECRET_ACCESS_KEY=\n',
		[`${REPO}/.gitignore`]: '__pycache__/\n*.pyc\n# local.env   <- added after 7be0d44\ndeploy/local.env\n',
		[`${REPO}/tests/fixtures/s3_response.json`]: '{"Owner":{"ID":"75aa57f09aa0c8caeab4f8c24e99d10f8e7faeebf76c078efc7c6caea54ba06a"},"Key":"invoices/2026/10/INV-8812.pdf"}\n'
	},
	commands: { git },
	answer: {
		prompt: 'short sha',
		check: (a) => (/^a3f9c21/.test(a.trim()) ? true : /^7be0d44/.test(a.trim()) ? 'That commit removed it. Which one added it?' : /^19dd2e8/.test(a.trim()) ? 'That is the documented placeholder key, not a live one.' : 'Search history, not the working tree.'),
		success: 'a3f9c21 committed a live key to deploy/local.env; 7be0d44 only removed it from the tree. It is still in every clone: rotate the key and check its usage logs.'
	},
	hints: ['grep -rn AKIA .', 'git log --oneline', 'git log -S AKIA --oneline', 'git show <sha>'],
	solution: ['grep -rn AKIA .', 'git log -S AKIA --oneline', 'git show a3f9c21', 'submit a3f9c21']
};

export default scenario;
