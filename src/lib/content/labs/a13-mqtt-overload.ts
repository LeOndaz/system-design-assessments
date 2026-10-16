import type { Lab, LabState } from '../types';

/**
 * Plant telemetry broker overload. Someone halved the publish interval "for better data".
 * Tempting: raise QoS to 2 "so we stop losing messages" — doubles broker work and drops more.
 * Fix: batch readings per message at the gateways (or restore the interval); keep QoS 1 for alarms.
 */

const MACHINES = 2000;
const BROKER_CAP: Record<string, number> = { 'mq.m5.large': 6000, 'mq.m5.2xlarge': 14000 };
const QOS_COST: Record<string, number> = { '0': 1, '1': 2, '2': 4 };
const BATCH = 20;

const n = (s: LabState, k: string) => Number(s[k]);

/** MQTT messages per second arriving at the broker. */
function msgs(s: LabState) {
	const perMachine = 1 / n(s, 'interval');
	return (MACHINES * perMachine) / (s.batching ? BATCH : 1);
}
/** Broker work units per second (packets weighted by QoS handshake). */
const load = (s: LabState) => msgs(s) * QOS_COST[String(s.qos)] * (n(s, '_reconnect') > 0 ? 3 : 1);
const cap = (s: LabState) => (n(s, '_resizing') > 0 ? 0 : BROKER_CAP[String(s.brokerSize)]);
const cpu = (s: LabState) => Math.min(100, (load(s) / Math.max(1, cap(s))) * 100);
/** Fraction of messages the broker can't take: they back up in gateway buffers, then drop. */
const overflow = (s: LabState) => Math.max(0, 1 - cap(s) / Math.max(1, load(s)));

const lab: Lab = {
	title: 'Plant telemetry: broker at 100%',
	console: 'cloud',
	scope: 'plant-ostrava · MQTT',
	brief:
		'2,000 machines publish readings through edge gateways to one MQTT broker. Yesterday a data scientist asked for "twice the resolution" and the gateway publish interval was changed from 1 s to 0.5 s. Since then the historian shows gaps and the **gateway buffers are filling**. When a buffer is full, readings are dropped, including over-temperature alarms. Quality wants every alarm delivered.',
	resources: [
		{
			id: 'gateways',
			service: 'Edge',
			name: 'gateway-fleet (40)',
			type: 'Edge gateway config',
			applySeconds: 25,
			details: (s) => [
				['Machines', `${MACHINES}`],
				['Messages/s to broker', `${Math.round(msgs(s))}`],
				['Buffer used', `${Math.round(n(s, '_buffer'))}%`],
				['Session', 'persistent (cleanSession=false)']
			],
			status: (s) =>
				n(s, '_buffer') >= 100 ? { label: 'Dropping', tone: 'crit' } : n(s, '_buffer') > 30 ? { label: 'Buffering', tone: 'warn' } : { label: 'Online', tone: 'ok' },
			fields: [
				{ key: 'interval', label: 'Publish interval', kind: 'number', min: 0.1, max: 5, step: 0.1, unit: 's' },
				{ key: 'qos', label: 'MQTT QoS', kind: 'select', options: ['0', '1', '2'], help: 'Applies to telemetry and alarms alike on this gateway image.' },
				{ key: 'batching', label: 'Batch readings (20 per message)', kind: 'toggle', help: 'One JSON array per publish instead of one message per reading. Timestamps are kept per reading.' }
			]
		},
		{
			id: 'broker',
			service: 'Broker',
			name: 'mqtt-prod',
			type: 'Managed MQTT broker',
			applySeconds: 90,
			details: (s) => [
				['Instance', String(s.brokerSize)],
				['Capacity (work units/s)', `${BROKER_CAP[String(s.brokerSize)]}`],
				['Connected clients', n(s, '_resizing') > 0 ? '0 (maintenance)' : '40'],
				['Deployment', 'single instance, sessions not replicated']
			],
			status: (s) => (n(s, '_resizing') > 0 ? { label: 'Rebooting', tone: 'crit' } : cpu(s) > 90 ? { label: 'Saturated', tone: 'crit' } : { label: 'Running', tone: 'ok' }),
			fields: [{ key: 'brokerSize', label: 'Instance type', kind: 'select', options: ['mq.m5.large', 'mq.m5.2xlarge'], help: 'Resizing reboots the broker (~90 s offline). Non-replicated sessions are lost.' }]
		}
	],
	initial: { interval: 0.5, qos: '1', batching: false, brokerSize: 'mq.m5.large', _buffer: 35, _dropped: 0, _resizing: 0, _reconnect: 0, _lastSize: 'mq.m5.large' },
	step: (s, { rand }): LabState => {
		if (s.brokerSize !== s._lastSize) return { _lastSize: s.brokerSize, _resizing: 90 };
		const resizing = n(s, '_resizing');
		const of = overflow(s);
		// Buffers fill with overflow, drain when there's headroom.
		const buffer = Math.max(0, Math.min(100, n(s, '_buffer') + (of > 0 ? of * 6 : -4)));
		const dropping = buffer >= 100 ? of : 0;
		// Over-temperature alarms happen ~1 every 3 s across the plant; a dropped one is lost.
		const alarmLost = dropping > 0 && rand() < 0.33 * dropping ? 1 : 0;
		// QoS 0 has no ack: alarms published during the gateways' routine WAN blips simply vanish.
		const qos0Lost = s.qos === '0' && rand() < 0.05 ? 1 : 0;
		return {
			_buffer: buffer,
			_dropped: n(s, '_dropped') + alarmLost + qos0Lost,
			_resizing: Math.max(0, resizing - 1),
			// When a resize finishes, every client reconnects and resubscribes at once.
			_reconnect: resizing === 1 ? 40 : Math.max(0, n(s, '_reconnect') - 1)
		};
	},
	metrics: [
		{ id: 'cpu', label: 'Broker load', unit: '%', get: (s) => cpu(s), alarm: 85, max: 100 },
		{ id: 'msgs', label: 'Publishes /s', get: (s) => msgs(s) },
		{ id: 'buffer', label: 'Gateway buffer', unit: '%', get: (s) => n(s, '_buffer'), alarm: 90, max: 100 },
		{ id: 'dropped', label: 'Alarms lost', get: (s) => n(s, '_dropped'), alarm: 0 }
	],
	win: {
		text: 'Broker under 70%, gateway buffers drained below 5%, no alarm lost, held for 30 s.',
		check: (s, m) => m.cpu < 70 && m.buffer < 5 && m.dropped === 0,
		hold: 30
	},
	lose: [
		{ text: 'Three over-temperature alarms were dropped. One was a real furnace excursion; the batch was scrapped.', check: (_s, m) => m.dropped >= 3 }
	],
	timeLimit: 600,
	speed: 5,
	solution: [{ at: 5, set: { batching: true } }],
	trap: [{ at: 5, set: { qos: '2' } }]
};

export default lab;
