import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentReference, DocumentStore, DocumentWriteResult } from './documentStore';
import { STORAGE_KEYS } from './storageKeys';
import { createWebhookOutboxService } from './webhookOutboxService';
import type { WebhookDeliveryRecord, WebhookDomainEvent, WebhookEventEnvelope } from '../types/webhook';

type StoredWebhookEvent = WebhookDomainEvent | WebhookEventEnvelope;

class TestDocumentStore<T> implements DocumentStore<T> {
	private readonly documents = new Map<string, DocumentRecord<T>>();
	private revision = 0;

	nextWriteResult: DocumentWriteResult | null = null;
	nextRemoveResult: DocumentWriteResult | null = null;
	beforeWrite: ((document: DocumentRecord<T>) => void) | null = null;
	afterWrite: ((document: DocumentRecord<T>) => void) | null = null;
	beforeRemove: ((document: DocumentReference) => void) | null = null;
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
		this.beforeWrite?.(structuredClone(document));
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
		const stored = structuredClone({ ...document, _rev: rev });
		this.documents.set(document._id, stored);
		this.afterWrite?.(structuredClone(stored));
		return { status: 'ok', rev };
	}

	remove(document: DocumentReference): DocumentWriteResult {
		this.beforeRemove?.(structuredClone(document));
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

const event = (
	id = 'event-1',
	occurredAt = NOW - MINUTE,
): Extract<WebhookDomainEvent, { type: 'task.due' }> => ({
	id,
	type: 'task.due',
	occurredAt,
	payload: { task: { ...taskSnapshot }, reminderAt: NOW },
});

const reorderedEvent = (
	id = 'event-1',
	occurredAt = NOW - MINUTE,
): Extract<WebhookDomainEvent, { type: 'task.due' }> => ({
	payload: {
		reminderAt: NOW,
		task: {
		group: '项目 A',
		tags: ['工作'],
		priority: 'high',
		description: '整理本周进度',
		title: '发送周报',
		dueAt: NOW + DAY,
		id: 'task-1',
	},
	},
	occurredAt,
	type: 'task.due',
	id,
});

const createHarness = (initialNow = NOW) => {
	const eventStore = new TestDocumentStore<StoredWebhookEvent>();
	const deliveryStore = new TestDocumentStore<WebhookDeliveryRecord>();
	let currentTime = initialNow;
	let nextId = 0;
	let nextLeaseToken = 0;
	const service = createWebhookOutboxService({
		eventStore,
		deliveryStore,
		clock: () => currentTime,
		idFactory: () => `delivery-${++nextId}`,
		leaseTokenFactory: () => `lease-${++nextLeaseToken}`,
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
		expect(eventStore.get(`${STORAGE_KEYS.WEBHOOK_EVENT_DOCUMENT_PREFIX}event-1`)?.data).toEqual({
			event: domainEvent,
			targetPlatforms: ['feishu', 'dingtalk'],
		});
		expect(service.getEvent('event-1')).toEqual(domainEvent);
	});

	it('reads legacy raw event documents and upgrades them before creating deliveries', () => {
		const { service, eventStore } = createHarness();
		const domainEvent = event('legacy-event');
		eventStore.write({
			_id: `${STORAGE_KEYS.WEBHOOK_EVENT_DOCUMENT_PREFIX}${domainEvent.id}`,
			data: domainEvent,
		});

		service.enqueue(domainEvent, ['feishu']);

		expect(service.getEvent(domainEvent.id)).toEqual(domainEvent);
		expect(eventStore.get(`${STORAGE_KEYS.WEBHOOK_EVENT_DOCUMENT_PREFIX}${domainEvent.id}`)?.data).toEqual({
			event: domainEvent,
			targetPlatforms: ['feishu'],
		});
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

	it('treats payloads with different object key insertion order as equivalent on repeated enqueue', () => {
		const { service, eventStore, deliveryStore } = createHarness();
		const first = service.enqueue(event(), ['feishu']);
		const eventWrites = eventStore.writeCount;
		const deliveryWrites = deliveryStore.writeCount;

		const second = service.enqueue(reorderedEvent(), ['feishu']);

		expect(second).toEqual(first);
		expect(eventStore.writeCount).toBe(eventWrites);
		expect(deliveryStore.writeCount).toBe(deliveryWrites);
	});

	it('deduplicates repeated platform inputs', () => {
		const { service } = createHarness();

		const deliveries = service.enqueue(event(), ['feishu', 'feishu', 'dingtalk', 'feishu']);

		expect(deliveries.map((delivery) => delivery.platform)).toEqual(['feishu', 'dingtalk']);
		expect(service.listDeliveries()).toHaveLength(2);
	});

	it('treats concurrent event creation as idempotent after re-reading the winner', () => {
		const { service, eventStore } = createHarness();
		let concurrent: WebhookDeliveryRecord[] = [];
		eventStore.beforeWrite = () => {
			eventStore.beforeWrite = null;
			concurrent = service.enqueue(reorderedEvent(), ['feishu']);
		};

		const deliveries = service.enqueue(event(), ['feishu']);

		expect(deliveries).toEqual(concurrent);
		expect(service.listDeliveries()).toHaveLength(1);
	});

	it('treats concurrent delivery creation as idempotent after re-reading the winner', () => {
		const { service, deliveryStore } = createHarness();
		let concurrent: WebhookDeliveryRecord[] = [];
		deliveryStore.beforeWrite = () => {
			deliveryStore.beforeWrite = null;
			concurrent = service.enqueue(event(), ['feishu']);
		};

		const deliveries = service.enqueue(event(), ['feishu']);

		expect(deliveries).toEqual(concurrent);
		expect(service.listDeliveries()).toHaveLength(1);
	});

	it('retries an event touch conflict when concurrent enqueue adds another platform', () => {
		const { service, eventStore } = createHarness();
		service.enqueue(event(), []);
		let concurrent: WebhookDeliveryRecord[] = [];
		eventStore.beforeWrite = () => {
			eventStore.beforeWrite = null;
			concurrent = service.enqueue(event(), ['dingtalk']);
		};

		const deliveries = service.enqueue(event(), ['feishu']);

		expect(deliveries.map((delivery) => delivery.platform)).toEqual(['feishu']);
		expect(concurrent.map((delivery) => delivery.platform)).toEqual(['dingtalk']);
		expect(service.listDeliveries()).toHaveLength(2);
	});

	it('rejects an existing event with a different type or payload using a generic error', () => {
		const { service } = createHarness();
		service.enqueue(event(), ['feishu']);
		const mismatched = event();
		mismatched.payload.task.title = 'sensitive payload';

		expect(() => service.enqueue(mismatched, ['dingtalk'])).toThrow('Webhook outbox storage operation failed.');
		expect(service.listDeliveries()).toHaveLength(1);
	});

	it('preserves array order when comparing event payloads', () => {
		const { service } = createHarness();
		const stored = event('array-order');
		stored.payload.task.tags = ['工作', '紧急'];
		service.enqueue(stored, ['feishu']);
		const reordered = event('array-order');
		reordered.payload.task.tags = ['紧急', '工作'];

		expect(() => service.enqueue(reordered, ['dingtalk'])).toThrow('Webhook outbox storage operation failed.');
		expect(service.listDeliveries()).toHaveLength(1);
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
		const claimed = service.claim(future.id, NOW + 2 * MINUTE);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.fail(future.id, claimed.leaseToken, 'network_error', NOW + 2 * MINUTE);

		expect(service.listReady(NOW + 2 * MINUTE).map((delivery) => delivery.eventId)).toEqual(['later', 'first']);
	});

	it('claims ready work with a lease and recovers an expired lease', () => {
		const { service } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');

		const claimed = service.claim(delivery.id, NOW);

		expect(claimed).toMatchObject({
			status: 'sending',
			attempts: 1,
			leaseExpiresAt: NOW + MINUTE,
			leaseToken: 'lease-1',
		});
		expect(claimed?.nextAttemptAt).toBeUndefined();
		expect(service.claim(delivery.id, NOW + MINUTE - 1)).toBeNull();
		expect(service.listReady(NOW + MINUTE).map((record) => record.id)).toEqual([delivery.id]);
		expect(service.claim(delivery.id, NOW + MINUTE)).toMatchObject({
			status: 'sending',
			attempts: 2,
			leaseExpiresAt: NOW + 2 * MINUTE,
			leaseToken: 'lease-2',
		});
	});

	it('fences expired executors from failing or succeeding a newer lease', () => {
		const { service, deliveryStore } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		const firstClaim = service.claim(delivery.id, NOW);
		const secondClaim = service.claim(delivery.id, NOW + MINUTE);
		if (firstClaim?.leaseToken === undefined || secondClaim?.leaseToken === undefined) {
			throw new Error('Expected lease tokens.');
		}
		const writesBeforeStaleCompletion = deliveryStore.writeCount;

		expect(service.fail(delivery.id, firstClaim.leaseToken, 'timeout', NOW + MINUTE + 1)).toBeNull();
		expect(service.succeed(delivery.id, firstClaim.leaseToken, NOW + MINUTE + 2)).toBeNull();
		expect(deliveryStore.writeCount).toBe(writesBeforeStaleCompletion);
		expect(service.listDeliveries()[0]).toEqual(secondClaim);
		expect(service.succeed(delivery.id, secondClaim.leaseToken, NOW + MINUTE + 3)).toMatchObject({
			status: 'succeeded',
			succeededAt: NOW + MINUTE + 3,
		});
		expect(service.listDeliveries()[0]?.leaseToken).toBeUndefined();
		expect(service.fail(delivery.id, secondClaim.leaseToken, 'timeout', NOW + MINUTE + 4)).toBeNull();
	});

	it('marks a claimed delivery succeeded and clears transient state', () => {
		const { service } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		const claimed = service.claim(delivery.id, NOW);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');

		const succeeded = service.succeed(delivery.id, claimed.leaseToken, NOW + 5_000);

		expect(succeeded).toMatchObject({ status: 'succeeded', succeededAt: NOW + 5_000 });
		expect(succeeded?.leaseExpiresAt).toBeUndefined();
		expect(succeeded?.nextAttemptAt).toBeUndefined();
		expect(succeeded?.errorCode).toBeUndefined();
		expect(succeeded?.leaseToken).toBeUndefined();
		expect(service.listReady(NOW + DAY)).toEqual([]);
	});

	it('applies deterministic exponential backoff for retryable failures', () => {
		const { service } = createHarness();
		const [delivery] = service.enqueue(event(), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		let claimed = service.claim(delivery.id, NOW);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');

		const firstFailure = service.fail(delivery.id, claimed.leaseToken, 'network_error', NOW + 1_000);
		expect(firstFailure).toMatchObject({
			status: 'pending',
			attempts: 1,
			errorCode: 'network_error',
			nextAttemptAt: NOW + 31_000,
		});
		expect(firstFailure?.leaseExpiresAt).toBeUndefined();

		claimed = service.claim(delivery.id, NOW + 31_000);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
		const secondFailure = service.fail(delivery.id, claimed.leaseToken, 'timeout', NOW + 32_000);
		expect(secondFailure).toMatchObject({ attempts: 2, nextAttemptAt: NOW + 92_000 });

		let failed = secondFailure;
		for (let attempt = 3; attempt <= 8; attempt += 1) {
			if (failed?.nextAttemptAt === undefined) throw new Error('Expected retry schedule.');
			claimed = service.claim(delivery.id, failed.nextAttemptAt);
			if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
			failed = service.fail(delivery.id, claimed.leaseToken, 'server_error', failed.nextAttemptAt);
		}
		expect((failed?.nextAttemptAt ?? 0) - (failed?.updatedAt ?? 0)).toBe(30 * MINUTE);
	});

	it('blocks permanent failures and retries only the selected platform', () => {
		const { service } = createHarness();
		const deliveries = service.enqueue(event(), ['feishu', 'dingtalk']);
		for (const delivery of deliveries) {
			const claimed = service.claim(delivery.id, NOW);
			if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
			service.fail(
				delivery.id,
				claimed.leaseToken,
				delivery.platform === 'feishu' ? 'invalid_credentials' : 'unknown',
				NOW + 1_000,
			);
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
		const claimed = service.claim(feishu.id, NOW);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.succeed(feishu.id, claimed.leaseToken, NOW + 1_000);

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
			const claimed = service.claim(delivery.id, NOW);
			if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
			service.succeed(delivery.id, claimed.leaseToken, NOW + 1_000);
		}
		const partial = service.enqueue(event('partial'), ['feishu', 'dingtalk']);
		const partialSuccess = partial.find((delivery) => delivery.platform === 'feishu');
		if (partialSuccess === undefined) throw new Error('Expected partial delivery.');
		const partialClaim = service.claim(partialSuccess.id, NOW);
		if (partialClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.succeed(partialSuccess.id, partialClaim.leaseToken, NOW + 1_000);
		const [blocked] = service.enqueue(event('blocked'), ['feishu']);
		if (blocked === undefined) throw new Error('Expected blocked delivery.');
		const blockedClaim = service.claim(blocked.id, NOW);
		if (blockedClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.fail(blocked.id, blockedClaim.leaseToken, 'invalid_request', NOW + 1_000);

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

	it('keeps the event and new platform delivery when cleanup races with enqueue', () => {
		const { service, eventStore } = createHarness();
		const [delivery] = service.enqueue(event('cleanup-race'), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		const claimed = service.claim(delivery.id, NOW);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.succeed(delivery.id, claimed.leaseToken, NOW + 1_000);
		const [laterDelivery] = service.enqueue(event('cleanup-after-conflict'), ['feishu']);
		if (laterDelivery === undefined) throw new Error('Expected later delivery.');
		const laterClaim = service.claim(laterDelivery.id, NOW);
		if (laterClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.succeed(laterDelivery.id, laterClaim.leaseToken, NOW + 1_000);
		eventStore.beforeRemove = () => {
			eventStore.beforeRemove = null;
			service.enqueue(event('cleanup-race'), ['dingtalk']);
		};

		expect(() => service.cleanup(NOW + 30 * DAY + 1_001)).toThrow('Webhook outbox storage operation failed.');
		expect(service.getEvent('cleanup-race')).not.toBeNull();
		expect(service.getEvent('cleanup-after-conflict')).not.toBeNull();
		expect(service.listDeliveries()).toEqual([
			expect.objectContaining({ eventId: 'cleanup-race', platform: 'dingtalk', status: 'pending' }),
		]);
	});

	it('keeps an event when cleanup runs after target registration but before delivery creation', () => {
		const { service, eventStore } = createHarness();
		const [delivery] = service.enqueue(event('reverse-cleanup-race'), ['feishu']);
		if (delivery === undefined) throw new Error('Expected delivery.');
		const claimed = service.claim(delivery.id, NOW);
		if (claimed?.leaseToken === undefined) throw new Error('Expected lease token.');
		service.succeed(delivery.id, claimed.leaseToken, NOW + 1_000);
		let cleanupResult: { events: number; deliveries: number } | null = null;
		eventStore.afterWrite = () => {
			eventStore.afterWrite = null;
			cleanupResult = service.cleanup(NOW + 30 * DAY + 1_001);
		};

		const [laterDelivery] = service.enqueue(event('reverse-cleanup-race'), ['dingtalk']);

		expect(cleanupResult).toEqual({ events: 0, deliveries: 1 });
		expect(laterDelivery).toMatchObject({ platform: 'dingtalk', status: 'pending' });
		expect(service.getEvent('reverse-cleanup-race')).toEqual(event('reverse-cleanup-race'));
		expect(service.listDeliveries()).toEqual([
			expect.objectContaining({ eventId: 'reverse-cleanup-race', platform: 'dingtalk', status: 'pending' }),
		]);
	});

	it('surfaces revision conflicts from claim, succeed, fail, retryBlocked, and cleanup', () => {
		const claimHarness = createHarness();
		const [claimDelivery] = claimHarness.service.enqueue(event('claim-conflict'), ['feishu']);
		if (claimDelivery === undefined) throw new Error('Expected delivery.');
		claimHarness.deliveryStore.nextWriteResult = { status: 'conflict' };
		expect(() => claimHarness.service.claim(claimDelivery.id, NOW)).toThrow('Webhook outbox storage operation failed.');

		const succeedHarness = createHarness();
		const [succeedDelivery] = succeedHarness.service.enqueue(event('succeed-conflict'), ['feishu']);
		if (succeedDelivery === undefined) throw new Error('Expected delivery.');
		const succeedClaim = succeedHarness.service.claim(succeedDelivery.id, NOW);
		if (succeedClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		const succeedLeaseToken = succeedClaim.leaseToken;
		succeedHarness.deliveryStore.nextWriteResult = { status: 'conflict' };
		expect(() => succeedHarness.service.succeed(succeedDelivery.id, succeedLeaseToken, NOW + 1)).toThrow(
			'Webhook outbox storage operation failed.',
		);

		const failHarness = createHarness();
		const [failDelivery] = failHarness.service.enqueue(event('fail-conflict'), ['feishu']);
		if (failDelivery === undefined) throw new Error('Expected delivery.');
		const failClaim = failHarness.service.claim(failDelivery.id, NOW);
		if (failClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		const failLeaseToken = failClaim.leaseToken;
		failHarness.deliveryStore.nextWriteResult = { status: 'conflict' };
		expect(() => failHarness.service.fail(failDelivery.id, failLeaseToken, 'timeout', NOW + 1)).toThrow(
			'Webhook outbox storage operation failed.',
		);

		const retryHarness = createHarness();
		const [retryDelivery] = retryHarness.service.enqueue(event('retry-conflict'), ['feishu']);
		if (retryDelivery === undefined) throw new Error('Expected delivery.');
		const retryClaim = retryHarness.service.claim(retryDelivery.id, NOW);
		if (retryClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		retryHarness.service.fail(retryDelivery.id, retryClaim.leaseToken, 'unknown', NOW + 1);
		retryHarness.deliveryStore.nextWriteResult = { status: 'conflict' };
		expect(() => retryHarness.service.retryBlocked()).toThrow('Webhook outbox storage operation failed.');

		const cleanupHarness = createHarness();
		const [cleanupDelivery] = cleanupHarness.service.enqueue(event('cleanup-conflict'), ['feishu']);
		if (cleanupDelivery === undefined) throw new Error('Expected delivery.');
		const cleanupClaim = cleanupHarness.service.claim(cleanupDelivery.id, NOW);
		if (cleanupClaim?.leaseToken === undefined) throw new Error('Expected lease token.');
		cleanupHarness.service.succeed(cleanupDelivery.id, cleanupClaim.leaseToken, NOW + 1);
		cleanupHarness.deliveryStore.nextRemoveResult = { status: 'conflict' };
		expect(() => cleanupHarness.service.cleanup(NOW + 30 * DAY + 2)).toThrow(
			'Webhook outbox storage operation failed.',
		);
	});

	it('throws generic errors for storage conflicts and failures', () => {
		const conflictHarness = createHarness();
		conflictHarness.eventStore.nextWriteResult = { status: 'conflict', message: 'secret token leaked here' };
		let caught: unknown;
		try {
			conflictHarness.service.enqueue(event(), ['feishu']);
		} catch (error: unknown) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(Error);
		expect((caught as Error).message).toBe('Webhook outbox storage operation failed.');
		expect((caught as Error).message).not.toContain('secret token leaked here');

		const errorHarness = createHarness();
		errorHarness.deliveryStore.nextWriteResult = { status: 'error', message: 'https://secret.example/token' };
		expect(() => errorHarness.service.enqueue(event(), ['feishu'])).toThrow('Webhook outbox storage operation failed.');
	});
});
