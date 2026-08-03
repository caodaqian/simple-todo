import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentReference, DocumentStore, DocumentWriteResult } from './documentStore';
import { STORAGE_KEYS } from './storageKeys';
import { createWebhookOutboxService } from './webhookOutboxService';
import type { WebhookDeliveryRecord, WebhookDomainEvent } from '../types/webhook';

class TestDocumentStore<T> implements DocumentStore<T> {
	private readonly documents = new Map<string, DocumentRecord<T>>();
	private revision = 0;

	nextWriteResult: DocumentWriteResult | null = null;
	nextRemoveResult: DocumentWriteResult | null = null;
	writeCount = 0;

	get(id: string): DocumentRecord<T> | null {
		const document = this.documents.get(id);
		return document === undefined ? null : structuredClone(document);
	}

	list(prefix: string): DocumentRecord<T>[] {
		return [...this.documents.values()]
			.filter((document) => document._id.startsWith(prefix))
			.map((document) => structuredClone(document));
	}

	write(document: DocumentRecord<T>): DocumentWriteResult {
		this.writeCount += 1;
		if (this.nextWriteResult !== null) {
			const result = this.nextWriteResult;
			this.nextWriteResult = null;
			return result;
		}
		const current = this.documents.get(document._id);
		if (current !== undefined && document._rev !== current._rev) {
			return { status: 'conflict' };
		}
		this.revision += 1;
		const rev = `rev-${this.revision}`;
		this.documents.set(document._id, structuredClone({ ...document, _rev: rev }));
		return { status: 'ok', rev };
	}

	remove(document: DocumentReference): DocumentWriteResult {
		if (this.nextRemoveResult !== null) {
			const result = this.nextRemoveResult;
			this.nextRemoveResult = null;
			return result;
		}
		const current = this.documents.get(document._id);
		if (current === undefined) return { status: 'not-found' };
		if (document._rev !== current._rev) return { status: 'conflict' };
		this.documents.delete(document._id);
		return { status: 'ok' };
	}

	bulkWrite(documents: DocumentRecord<T>[]): DocumentWriteResult[] {
		return documents.map((document) => this.write(document));
	}
}

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const taskSnapshot = {
	id: 'task-1',
	title: '发送周报',
	description: '整理本周进度',
	priority: 'high' as const,
	tags: ['工作'],
	group: '项目 A',
	dueAt: NOW + DAY,
};

const event = (id = 'event-1', occurredAt = NOW - MINUTE): WebhookDomainEvent => ({
	id,
	type: 'task.due',
	occurredAt,
	payload: { task: { ...taskSnapshot }, reminderAt: NOW },
});

const createHarness = (initialNow = NOW) => {
	const eventStore = new TestDocumentStore<WebhookDomainEvent>();
	const deliveryStore = new TestDocumentStore<WebhookDeliveryRecord>();
	let currentTime = initialNow;
	let nextId = 0;
	const service = createWebhookOutboxService({
		eventStore,
		deliveryStore,
		clock: () => currentTime,
		idFactory: () => `delivery-${++nextId}`,
	});
	return {
		service,
		eventStore,
		deliveryStore,
		setNow: (value: number) => { currentTime = value; },
	};
};

describe('webhookOutboxService', () => {
	it('enqueues independent platform deliveries and persists the event snapshot', () => {
		const { service, eventStore, deliveryStore } = createHarness();
		const domainEvent = event();

		const deliveries = service.enqueue(domainEvent, ['feishu', 'dingtalk']);

		expect(deliveries).toHaveLength(2);
		expect(deliveries).toEqual(expect.arrayContaining([
			expect.objectContaining({
				platform: 'feishu',
				dedupeKey: 'feishu:event-1',
				status: 'pending',
				attempts: 0,
				nextAttemptAt: NOW,
			}),
			expect.objectContaining({
				platform: 'dingtalk',
				dedupeKey: 'dingtalk:event-1',
				status: 'pending',
				attempts: 0,
				nextAttemptAt: NOW,
			}),
		]));
		expect(deliveryStore.list(STORAGE_KEYS.WEBHOOK_DELIVERY_DOCUMENT_PREFIX).map((document) => document._id)).toEqual([
			`${STORAGE_KEYS.WEBHOOK_DELIVERY_DOCUMENT_PREFIX}feishu_65_76_65_6e_74_2d_31`,
			`${STORAGE_KEYS.WEBHOOK_DELIVERY_DOCUMENT_PREFIX}dingtalk_65_76_65_6e_74_2d_31`,
		]);
		expect(eventStore.get(`${STORAGE_KEYS.WEBHOOK_EVENT_DOCUMENT_PREFIX}event-1`)?.data).toEqual(domainEvent);
		expect(service.getEvent('event-1')).toEqual(domainEvent);
	});

	it('returns existing deliveries without duplicate writes when enqueue is repeated', () => {
		const { service, eventStore, deliveryStore } = createHarness();
		const first = service.enqueue(event(), ['feishu', 'dingtalk']);
		const eventWrites = eventStore.writeCount;
		const deliveryWrites = deliveryStore.writeCount;

		const second = service.enqueue(event(), ['feishu', 'dingtalk']);

		expect(second).toEqual(first);
		expect(eventStore.writeCount).toBe(eventWrites);
		expect(deliveryStore.writeCount).toBe(deliveryWrites);
		expect(service.listDeliveries()).toHaveLength(2);
	});

	it('lists ready deliveries in schedule order and skips future retries', () => {
		const { service, setNow } = createHarness();
		service.enqueue(event('later', NOW - 5 * MINUTE), ['feishu']);
		setNow(NOW + MINUTE);
		service.enqueue(event('first', NOW - 10 * MINUTE), ['feishu']);
		setNow(NOW + 2 * MINUTE);
		service.enqueue(event('future', NOW - 20 * MINUTE), ['feishu']);
		const future = service.listDeliveries().find((delivery) => delivery.eventId === 'future');
		if (future === undefined) throw new Error('Expected future delivery.');
		service.claim(future.id, NOW + 2 * MINUTE);
		service.fail(future.id, 'network_error', NOW + 2 * MINUTE);

		expect(service.listReady(NOW + 2 * MINUTE).map((delivery) => delivery.eventId)).toEqual(['later', 'first']);
	});

	it('claims ready work with a lease and recovers an expired lease', () => {
		const { service } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');

		const claimed = service.claim(delivery.id, NOW);

		expect(claimed).toMatchObject({ status: 'sending', attempts: 1, leaseExpiresAt: NOW + MINUTE });
		expect(claimed?.nextAttemptAt).toBeUndefined();
		expect(service.claim(delivery.id, NOW + MINUTE - 1)).toBeNull();
		expect(service.listReady(NOW + MINUTE).map((record) => record.id)).toEqual([delivery.id]);
		expect(service.claim(delivery.id, NOW + MINUTE)).toMatchObject({
			status: 'sending',
			attempts: 2,
			leaseExpiresAt: NOW + 2 * MINUTE,
		});
	});

	it('marks a claimed delivery succeeded and clears transient state', () => {
		const { service } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		service.claim(delivery.id, NOW);

		const succeeded = service.succeed(delivery.id, NOW + 5_000);

		expect(succeeded).toMatchObject({ status: 'succeeded', succeededAt: NOW + 5_000 });
		expect(succeeded?.leaseExpiresAt).toBeUndefined();
		expect(succeeded?.nextAttemptAt).toBeUndefined();
		expect(succeeded?.errorCode).toBeUndefined();
		expect(service.listReady(NOW + DAY)).toEqual([]);
	});

	it('applies deterministic exponential backoff for retryable failures', () => {
		const { service } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		service.claim(delivery.id, NOW);

		const firstFailure = service.fail(delivery.id, 'network_error', NOW + 1_000);
		expect(firstFailure).toMatchObject({
			status: 'pending',
			attempts: 1,
			errorCode: 'network_error',
			nextAttemptAt: NOW + 31_000,
		});
		expect(firstFailure?.leaseExpiresAt).toBeUndefined();

		service.claim(delivery.id, NOW + 31_000);
		const secondFailure = service.fail(delivery.id, 'timeout', NOW + 32_000);
		expect(secondFailure).toMatchObject({ attempts: 2, nextAttemptAt: NOW + 92_000 });

		let failed = secondFailure;
		for (let attempt = 3; attempt <= 8; attempt += 1) {
			if (failed?.nextAttemptAt === undefined) throw new Error('Expected retry schedule.');
			service.claim(delivery.id, failed.nextAttemptAt);
			failed = service.fail(delivery.id, 'server_error', failed.nextAttemptAt);
		}
		expect((failed?.nextAttemptAt ?? 0) - (failed?.updatedAt ?? 0)).toBe(30 * MINUTE);
	});

	it('blocks permanent failures and retries only the selected platform', () => {
		const { service } = createHarness();
		const deliveries = service.enqueue(event(), ['feishu', 'dingtalk']);
		for (const delivery of deliveries) {
			service.claim(delivery.id, NOW);
			service.fail(delivery.id, delivery.platform === 'feishu' ? 'invalid_credentials' : 'unknown', NOW + 1_000);
		}

		const blocked = service.listDeliveries();
		expect(blocked.every((delivery) => delivery.status === 'blocked')).toBe(true);
		expect(blocked.every((delivery) => delivery.leaseExpiresAt === undefined && delivery.nextAttemptAt === undefined)).toBe(true);
		expect(service.retryBlocked('feishu', NOW + MINUTE)).toBe(1);
		expect(service.listDeliveries().find((delivery) => delivery.platform === 'feishu')).toMatchObject({
			status: 'pending',
			attempts: 1,
			nextAttemptAt: NOW + MINUTE,
		});
		expect(service.listDeliveries().find((delivery) => delivery.platform === 'dingtalk')?.status).toBe('blocked');
		expect(service.retryBlocked(undefined, NOW + 2 * MINUTE)).toBe(1);
	});

	it('keeps the other platform pending when one platform succeeds', () => {
		const { service } = createHarness();
		const deliveries = service.enqueue(event(), ['feishu', 'dingtalk']);
		const feishu = deliveries.find((delivery) => delivery.platform === 'feishu');
		if (feishu === undefined) throw new Error('Expected Feishu delivery.');
		service.claim(feishu.id, NOW);
		service.succeed(feishu.id, NOW + 1_000);

		expect(service.listDeliveries().find((delivery) => delivery.platform === 'feishu')?.status).toBe('succeeded');
		expect(service.listDeliveries().find((delivery) => delivery.platform === 'dingtalk')).toMatchObject({
			status: 'pending',
			attempts: 0,
		});
	});

	it('cleans deliveries after 30 days only when resolved and retains unresolved events', () => {
		const { service } = createHarness();
		const resolved = service.enqueue(event('resolved'), ['feishu', 'dingtalk']);
		for (const delivery of resolved) {
			service.claim(delivery.id, NOW);
			service.succeed(delivery.id, NOW + 1_000);
		}
		const partial = service.enqueue(event('partial'), ['feishu', 'dingtalk']);
		const partialSuccess = partial.find((delivery) => delivery.platform === 'feishu');
		if (partialSuccess === undefined) throw new Error('Expected partial delivery.');
		service.claim(partialSuccess.id, NOW);
		service.succeed(partialSuccess.id, NOW + 1_000);
		const [blocked] = service.enqueue(event('blocked'), ['feishu']);
		if (blocked === undefined) throw new Error('Expected blocked delivery.');
		service.claim(blocked.id, NOW);
		service.fail(blocked.id, 'invalid_request', NOW + 1_000);

		expect(service.cleanup(NOW + 30 * DAY)).toEqual({ events: 0, deliveries: 0 });
		expect(service.cleanup(NOW + 30 * DAY + 1_001)).toEqual({ events: 1, deliveries: 3 });
		expect(service.getEvent('resolved')).toBeNull();
		expect(service.getEvent('partial')).not.toBeNull();
		expect(service.getEvent('blocked')).not.toBeNull();
		expect(service.listDeliveries()).toEqual(expect.arrayContaining([
			expect.objectContaining({ eventId: 'partial', platform: 'dingtalk', status: 'pending' }),
			expect.objectContaining({ eventId: 'blocked', status: 'blocked' }),
		]));
	});

	it('throws generic errors for storage conflicts and failures', () => {
		const conflictHarness = createHarness();
		conflictHarness.eventStore.nextWriteResult = { status: 'conflict', message: 'secret token leaked here' };
		expect(() => conflictHarness.service.enqueue(event(), ['feishu'])).toThrow('Webhook outbox storage operation failed.');
		expect(() => conflictHarness.service.enqueue(event(), ['feishu'])).not.toThrow('secret token leaked here');

		const errorHarness = createHarness();
		errorHarness.deliveryStore.nextWriteResult = { status: 'error', message: 'https://secret.example/token' };
		expect(() => errorHarness.service.enqueue(event(), ['feishu'])).toThrow('Webhook outbox storage operation failed.');
	});
});
