import type { TerminalScenario, TermCtx } from '../types';
import { oneOf, pgTable } from '$lib/terminal/scenario';
import { err } from './a19-util';

/**
 * Checkout hangs. An `ALTER TABLE orders` (pid 32010) waits for AccessExclusiveLock and every app
 * query queues behind it. The ALTER looks guilty, but the root blocker is pid 31877: a session from
 * an engineer's laptop, idle in transaction for 47 minutes, holding a lock on orders.
 * The sandbox psql routes on what the SQL mentions (pg_stat_activity, pg_locks, pg_blocking_pids…).
 */

const now = '2026-10-14 09:49:10+00';

function activity(ctx: TermCtx, cols: 'full' | 'short') {
	const killed = !!ctx.state.killed31877;
	const cancelled = !!ctx.state.cancelled32010;
	const rows: (string | number)[][] = [];
	if (!killed) rows.push([31877, 'mk', 'psql', '10.8.0.37', 'idle in transaction', '2026-10-14 09:02:11+00', 'Client', 'ClientRead', 'UPDATE orders SET status = \'cancelled\' WHERE id = 991204;']);
	if (!cancelled && !killed) rows.push([32010, 'migrator', 'alembic', '10.0.5.9', 'active', '2026-10-14 09:31:40+00', 'Lock', 'relation', 'ALTER TABLE orders ADD COLUMN refund_reason text;']);
	if (!killed && !cancelled)
		for (let i = 0; i < 6; i++) rows.push([32101 + i * 3, 'app', 'checkout-api', `10.0.3.${21 + i}`, 'active', `2026-10-14 09:3${2 + i}:0${i}+00`, 'Lock', 'relation', i % 2 ? 'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20' : 'INSERT INTO orders (customer_id, total_cents, status) VALUES ($1, $2, $3)']);
	rows.push([30544, 'app', 'reports', '10.0.6.4', 'active', '2026-10-14 09:48:51+00', '', '', 'SELECT date_trunc(\'day\', created_at), sum(total_cents) FROM payments GROUP BY 1']);
	rows.push([29001, 'replicator', 'walreceiver', '10.0.5.12', 'active', '2026-10-12 06:11:02+00', 'Activity', 'WalSenderMain', 'START_REPLICATION SLOT standby1 0/9A000000']);
	if (cols === 'short') return pgTable(['pid', 'usename', 'state', 'wait_event_type', 'query'], rows.map((r) => [r[0], r[1], r[4], r[6], String(r[8]).slice(0, 60)]));
	return pgTable(['pid', 'usename', 'application_name', 'client_addr', 'state', 'xact_start', 'wait_event_type', 'wait_event', 'query'], rows);
}

function blocking(ctx: TermCtx) {
	if (ctx.state.killed31877 || ctx.state.cancelled32010) return pgTable(['pid', 'blocked_by', 'query'], []);
	const rows: (string | number)[][] = [[32010, '{31877}', 'ALTER TABLE orders ADD COLUMN refund_reason text;']];
	for (let i = 0; i < 6; i++) rows.push([32101 + i * 3, '{32010}', i % 2 ? 'SELECT * FROM orders WHERE customer_id = $1 ORDER BY…' : 'INSERT INTO orders (customer_id, total_cents, status)…']);
	return pgTable(['pid', 'blocked_by', 'query'], rows);
}

function locks(ctx: TermCtx) {
	if (ctx.state.killed31877) return pgTable(['pid', 'relation', 'mode', 'granted'], [[30544, 'payments', 'AccessShareLock', 't']]);
	const rows: (string | number)[][] = [
		[31877, 'orders', 'RowExclusiveLock', 't'],
		[31877, 'orders_pkey', 'RowExclusiveLock', 't']
	];
	if (!ctx.state.cancelled32010) {
		rows.push([32010, 'orders', 'AccessExclusiveLock', 'f']);
		for (let i = 0; i < 6; i++) rows.push([32101 + i * 3, 'orders', i % 2 ? 'AccessShareLock' : 'RowExclusiveLock', 'f']);
	}
	rows.push([30544, 'payments', 'AccessShareLock', 't']);
	return pgTable(['pid', 'relation', 'mode', 'granted'], rows);
}

function psql(args: string[], ctx: TermCtx) {
	const ci = args.indexOf('-c');
	const sql = ci >= 0 ? args.slice(ci + 1).join(' ') : '';
	if (ci < 0) return err('psql: interactive mode is not available in the sandbox. Use: psql -c "SELECT …"');
	const q = sql.toLowerCase();
	let m: RegExpMatchArray | null;
	if ((m = q.match(/pg_terminate_backend\(\s*(\d+)\s*\)/))) {
		if (m[1] === '31877') ctx.state.killed31877 = true;
		else if (m[1] === '32010') ctx.state.cancelled32010 = true;
		else if (!['30544', '29001'].includes(m[1]) && !/^321\d\d$/.test(m[1])) return pgTable(['pg_terminate_backend'], [['f']]);
		if (m[1] === '29001') ctx.state.killedReplication = true;
		return pgTable(['pg_terminate_backend'], [['t']]);
	}
	if ((m = q.match(/pg_cancel_backend\(\s*(\d+)\s*\)/))) {
		if (m[1] === '32010') ctx.state.cancelled32010 = true;
		return pgTable(['pg_cancel_backend'], [['t']]);
	}
	if (q.includes('pg_blocking_pids')) return blocking(ctx);
	if (q.includes('pg_locks')) return locks(ctx);
	if (q.includes('pg_stat_activity')) return activity(ctx, /select \*|xact_start|client_addr|application_name/.test(q) ? 'full' : 'short');
	if (q.includes('pg_stat_statements'))
		return pgTable(['calls', 'mean_ms', 'query'], [[812331, '2.1', 'SELECT * FROM orders WHERE customer_id = $1 …'], [91220, '4.8', 'INSERT INTO orders …'], [44, '9120.4', 'SELECT date_trunc($1, created_at), sum(total_cents) FROM payments …']]);
	if (/^\s*select\s+(now|1)/.test(q)) return pgTable(['now'], [[now]]);
	if (q.includes('show lock_timeout')) return pgTable(['lock_timeout'], [['0']]);
	return err('ERROR:  this sandbox only understands queries on pg_stat_activity, pg_locks, pg_blocking_pids(), pg_stat_statements, pg_cancel_backend() and pg_terminate_backend()');
}

const scenario: TerminalScenario = {
	title: 'ssh ops@db-admin · psql orders_prod',
	user: 'ops',
	host: 'db-admin',
	cwd: '/home/ops',
	motd: 'PGHOST=orders-db.prod PGDATABASE=orders_prod (read-write!). psql -c "…" only.',
	env: { PGHOST: 'orders-db.prod', PGDATABASE: 'orders_prod' },
	task: 'Alert: **checkout p99 > 30 s, connection pool exhausted.** A schema migration started 18 minutes ago. Find the PID at the *root* of the blocking chain and `submit` it. (Bonus: unblock prod with the least damage.)',
	files: {
		'/home/ops/sql/locks.sql':
			"-- who blocks whom\nSELECT pid, pg_blocking_pids(pid) AS blocked_by, left(query, 60) AS query\nFROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;\n",
		'/home/ops/migrations/2026_10_14_add_refund_reason.py': "def upgrade():\n    op.add_column('orders', sa.Column('refund_reason', sa.Text()))\n    # NOTE: no lock_timeout set\n"
	},
	commands: { psql },
	answer: {
		prompt: 'pid',
		check: (a) => (a.trim() === '31877' ? true : a.trim() === '32010' ? 'The ALTER is waiting too. What is *it* waiting for?' : 'Follow blocked_by until you reach a session that is not waiting.'),
		success: 'pid 31877 has been idle in transaction since 09:02, holding RowExclusiveLock on orders. The ALTER queues behind it, and everything else queues behind the ALTER.'
	},
	hints: ['cat ~/sql/locks.sql', 'psql -c "SELECT pid, state, wait_event_type, query FROM pg_stat_activity"', 'psql -c "SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity"', 'psql -c "SELECT * FROM pg_locks"'],
	solution: [
		'psql -c "SELECT pid, pg_blocking_pids(pid) AS blocked_by, query FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0"',
		'psql -c "SELECT * FROM pg_stat_activity"',
		'psql -c "SELECT pg_cancel_backend(32010)"',
		'submit 31877'
	]
};

export default scenario;
