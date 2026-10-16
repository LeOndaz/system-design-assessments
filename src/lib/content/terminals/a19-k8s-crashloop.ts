import type { TerminalScenario, TermCtx } from '../types';
import { oneOf, table } from '$lib/terminal/scenario';
import { err, kubeArgs } from './a19-util';

/**
 * payments v2.14 crash-loops after deploy. `logs` (current container) only shows the boot banner;
 * `logs --previous` shows the KeyError for LEDGER_URL, which exists in staging's ConfigMap but not prod's.
 * Decoys: an OOMKilled event for reports-worker, failing liveness probes (a consequence), and the
 * Secret (which is fine). `rollout undo` restores v2.13 and later `get pods` reflects it.
 */

const CM_PROD = `apiVersion: v1
kind: ConfigMap
metadata:
  name: payments-config
  namespace: prod
data:
  LOG_LEVEL: info
  PSP_BASE_URL: https://psp.internal.example
  LEDGER_HOST: ledger.prod.svc.cluster.local
  LEDGER_PORT: "8080"
  FEATURE_SPLIT_CAPTURE: "false"
`;
const CM_STAGING = CM_PROD.replace('namespace: prod', 'namespace: staging')
	.replace('LEDGER_HOST: ledger.prod.svc.cluster.local\n  LEDGER_PORT: "8080"', 'LEDGER_URL: http://ledger.staging.svc.cluster.local:8080')
	.replace('"false"', '"true"');

const rolledBack = (ctx: TermCtx) => !!ctx.state.undone;

function pods(ctx: TermCtx, ns: string) {
	if (ns !== 'prod' && ns !== '*') return ns === 'staging' ? table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], [['payments-6c4f9d7b8-lq2xw', '1/1', 'Running', '0', '2d']]) : `No resources found in ${ns} namespace.`;
	const rows = rolledBack(ctx)
		? [
				['payments-5b8d6c9f4-7hx2k', '1/1', 'Running', '0', '38s'],
				['payments-5b8d6c9f4-c91pz', '1/1', 'Running', '0', '31s'],
				['payments-5b8d6c9f4-tq8mn', '1/1', 'Running', '0', '24s']
			]
		: [
				['payments-7d9f8b6c5-4kq2r', '0/1', 'CrashLoopBackOff', '7 (2m11s ago)', '14m'],
				['payments-5b8d6c9f4-c91pz', '1/1', 'Running', '0', '3d'],
				['payments-5b8d6c9f4-tq8mn', '1/1', 'Running', '0', '3d']
			];
	rows.push(['reports-worker-84b7c6d9-mm2tz', '1/1', 'Running', '3 (41m ago)', '6d'], ['ledger-7f6d5c4b3-9wq8e', '1/1', 'Running', '0', '9d']);
	return table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], rows);
}

const DESCRIBE = `Name:             payments-7d9f8b6c5-4kq2r
Namespace:        prod
Labels:           app=payments
                  pod-template-hash=7d9f8b6c5
Containers:
  payments:
    Image:          registry.internal/payments:2.14.0
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
    Ready:          False
    Restart Count:  7
    Liveness:       http-get http://:8080/healthz delay=10s timeout=1s period=10s #failure=3
    Environment Variables from:
      payments-config   ConfigMap  Optional: false
      payments-secrets  Secret     Optional: false
Events:
  Type     Reason     Age                  From     Message
  ----     ------     ----                 ----     -------
  Normal   Pulled     14m                  kubelet  Successfully pulled image "registry.internal/payments:2.14.0"
  Warning  Unhealthy  13m (x3 over 13m)    kubelet  Liveness probe failed: Get "http://10.42.3.17:8080/healthz": connect: connection refused
  Warning  BackOff    2m11s (x41 over 13m) kubelet  Back-off restarting failed container payments in pod payments-7d9f8b6c5-4kq2r
`;

const EVENTS = table(
	['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'],
	[
		['41m', 'Warning', 'OOMKilling', 'pod/reports-worker-84b7c6d9-mm2tz', 'Memory cgroup out of memory: Killed process 2211 (python)'],
		['14m', 'Normal', 'ScalingReplicaSet', 'deployment/payments', 'Scaled up replica set payments-7d9f8b6c5 to 1'],
		['13m', 'Warning', 'Unhealthy', 'pod/payments-7d9f8b6c5-4kq2r', 'Liveness probe failed: connection refused'],
		['2m', 'Warning', 'BackOff', 'pod/payments-7d9f8b6c5-4kq2r', 'Back-off restarting failed container payments']
	]
);

function kubectl(args: string[], ctx: TermCtx) {
	const [ns, line] = kubeArgs(args);
	let m: RegExpMatchArray | null;
	if (/^get (pods?|po)( -o wide)?$/.test(line)) return pods(ctx, ns);
	if (/^get (deploy|deployments?)( payments)?$/.test(line))
		return table(['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'], [['payments', rolledBack(ctx) ? '3/3' : '2/3', rolledBack(ctx) ? '3' : '1', rolledBack(ctx) ? '3' : '2', '212d'], ['reports-worker', '1/1', '1', '1', '6d'], ['ledger', '1/1', '1', '1', '9d']]);
	if ((m = line.match(/^describe (?:pod|po|pods) (\S+)$/))) return m[1].startsWith('payments-7d9f') && !rolledBack(ctx) ? DESCRIBE : err(`Error from server (NotFound): pods "${m[1]}" not found`);
	if ((m = line.match(/^logs (?:pod\/)?(\S+)(.*)$/))) {
		const prev = /--previous|-p\b/.test(m[2]);
		if (m[1].startsWith('payments-7d9f') && !rolledBack(ctx))
			return prev
				? '2026-10-14T09:38:02Z INFO  payments 2.14.0 starting (python 3.12)\n2026-10-14T09:38:02Z INFO  loading settings from environment\nTraceback (most recent call last):\n  File "/app/payments/settings.py", line 41, in <module>\n    LEDGER_URL = os.environ["LEDGER_URL"]\n                 ~~~~~~~~~~^^^^^^^^^^^^^^\n  File "<frozen os>", line 714, in __getitem__\nKeyError: \'LEDGER_URL\'\n'
				: '2026-10-14T09:40:13Z INFO  payments 2.14.0 starting (python 3.12)\n2026-10-14T09:40:13Z INFO  loading settings from environment\n';
		if (m[1].startsWith('reports-worker')) return '2026-10-14T09:12:00Z INFO  building monthly report org=acme rows=4,812,331\n';
		if (m[1].startsWith('payments-5b8d')) return '2026-10-14T09:41:00Z INFO  POST /v1/charges 201 84ms\n';
		return err(`error: error from server (NotFound): pods "${m[1]}" not found in namespace "${ns}"`);
	}
	if ((m = line.match(/^get (?:configmap|cm) payments-config(?: -o (yaml|json))?$/))) return ns === 'staging' ? CM_STAGING : ns === 'prod' ? CM_PROD : err(`Error from server (NotFound): configmaps "payments-config" not found`);
	if (/^get (configmaps?|cm)$/.test(line)) return table(['NAME', 'DATA', 'AGE'], [['payments-config', '5', '212d'], ['kube-root-ca.crt', '1', '400d']]);
	if (/^get (secret|secrets) payments-secrets/.test(line)) return 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: payments-secrets\ntype: Opaque\ndata:\n  PSP_API_KEY: <redacted>\n  DB_PASSWORD: <redacted>\n';
	if (/^get events/.test(line)) return EVENTS;
	if (/^rollout history (deploy|deployment)\/payments$/.test(line)) return 'deployment.apps/payments\nREVISION  CHANGE-CAUSE\n12        payments 2.12.3\n13        payments 2.13.1\n14        payments 2.14.0: ledger client v2 (reads LEDGER_URL)\n';
	if (/^rollout undo (deploy|deployment)\/payments/.test(line)) {
		ctx.state.undone = true;
		return 'deployment.apps/payments rolled back';
	}
	if (/^rollout status/.test(line)) return rolledBack(ctx) ? 'deployment "payments" successfully rolled out' : 'Waiting for deployment "payments" rollout to finish: 1 out of 3 new replicas have been updated...';
	if (/^top pods?/.test(line)) return table(['NAME', 'CPU(cores)', 'MEMORY(bytes)'], [['payments-5b8d6c9f4-c91pz', '41m', '212Mi'], ['reports-worker-84b7c6d9-mm2tz', '930m', '1890Mi'], ['ledger-7f6d5c4b3-9wq8e', '120m', '640Mi']]);
	if (/^config current-context/.test(line)) return 'prod-eu';
	return err(`error: this sandbox's kubectl doesn't support "${line}". Try get/describe/logs/events/rollout.`);
}

const scenario: TerminalScenario = {
	title: 'ops@bastion · kubectl (context: prod-eu)',
	user: 'ops',
	host: 'bastion',
	cwd: '/home/ops',
	motd: 'kubectl context: prod-eu. Namespaces: prod, staging.',
	task: 'Deploy channel: **payments 2.14.0 rollout is stuck; one pod keeps restarting.** Find the environment variable the new version requires that prod does not provide, and `submit` its name. (Bonus: get prod healthy.)',
	files: {
		'/home/ops/deploy/payments/CHANGELOG.md': '## 2.14.0\n- Ledger client v2: single connection URL instead of host+port\n## 2.13.1\n- Fix idempotency key length\n',
		'/home/ops/deploy/payments/values-staging.yaml': 'env:\n  LEDGER_URL: http://ledger.staging.svc.cluster.local:8080\n',
		'/home/ops/deploy/payments/values-prod.yaml': 'env:\n  LEDGER_HOST: ledger.prod.svc.cluster.local\n  LEDGER_PORT: "8080"\n'
	},
	commands: { kubectl },
	answer: { prompt: 'env var name', check: oneOf('LEDGER_URL'), success: 'v2.14 reads LEDGER_URL; prod still provides LEDGER_HOST/LEDGER_PORT. Roll back or add the key, then roll forward.' },
	hints: ['kubectl get pods -n prod', 'kubectl describe pod payments-7d9f8b6c5-4kq2r -n prod', 'kubectl logs payments-7d9f8b6c5-4kq2r -n prod --previous', 'kubectl get cm payments-config -n prod -o yaml'],
	solution: ['kubectl get pods -n prod', 'kubectl logs payments-7d9f8b6c5-4kq2r -n prod', 'kubectl logs payments-7d9f8b6c5-4kq2r -n prod --previous', 'kubectl get configmap payments-config -n prod -o yaml', 'kubectl rollout undo deployment/payments -n prod', 'kubectl get pods -n prod', 'submit LEDGER_URL']
};

export default scenario;
