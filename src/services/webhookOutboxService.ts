import {
	createDocumentStore,
	type DocumentRecord,
	type DocumentStore,
	type DocumentWriteResult,
} from './documentStore';
import { STORAGE_KEYS } from './storageKeys';
import type {
	WebhookDeliveryRecord,
	WebhookDomainEvent,
	WebhookEventEnvelope,
	WebhookErrorCode,
	WebhookPlatform,
} from '../types/webhook';

type WebhookEventDocumentData = WebhookDomainEvent | WebhookEventEnvelope;

interface WebhookOutboxDependencies {
	eventStore?: DocumentStore<WebhookEventDocumentData>;
	deliveryStore?: DocumentStore<WebhookDeliveryRecord>;
	clock?: () => number;
	idFactory?: () => string;
	leaseTokenFactory?: () => string;
}

const LEASE_DURATION = 60_000;
const INITIAL_RETRY_DELAY = 30_000;
const MAX_RETRY_DELAY = 30 * 60_000;
const SUCCESS_RETENTION = 30 * 24 * 60 * 60_000;
const STORAGE_ERROR_MESSAGE = 'Webhook outbox storage operation failed.';

const retryableErrorCodes = new Set<WebhookErrorCode>([
	'network_error',
	'timeout',
	'rate_limited',
	'server_error',
]);

const defaultIdFactory = (): string => {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const defaultLeaseTokenFactory = (): string => {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	if (typeof globalThis.crypto?.getRandomValues === 'function') {
		const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
		return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
	}
	throw new Error('Secure random generation is unavailable.');
};

const toStableDocumentSuffix = (platform: WebhookPlatform, eventId: string): string => {
	const encodedEventId = [...eventId]
		.map((character) => character.codePointAt(0)?.toString(16) ?? '')
		.join('_');
	return `${platform}_${encodedEventId}`;
};

const deliveryDocumentId = (platform: WebhookPlatform, eventId: string): string => {
	return `${STORAGE_KEYS.WEBHOOK_DELIVERY_DOCUMENT_PREFIX}${toStableDocumentSuffix(platform, eventId)}`;
};

const eventDocumentId = (eventId: string): string => `${STORAGE_KEYS.WEBHOOK_EVENT_DOCUMENT_PREFIX}${eventId}`;

const assertWriteSucceeded = (result: DocumentWriteResult): void => {
	if (result.status !== 'ok') {
		throw new Error(STORAGE_ERROR_MESSAGE);
	}
};

const withoutTransientFields = (delivery: WebhookDeliveryRecord): WebhookDeliveryRecord => {
	const { nextAttemptAt: _, leaseExpiresAt: __, leaseToken: ___, errorCode: ____, ...rest } = delivery;
	return rest;
};

const normalizeJsonValue = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(normalizeJsonValue);
	}
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
				.map(([key, child]) => [key, normalizeJsonValue(child)]),
		);
	}
	return value;
};

const eventsMatch = (stored: WebhookDomainEvent, input: WebhookDomainEvent): boolean => {
	return stored.type === input.type
		&& JSON.stringify(normalizeJsonValue(stored.payload)) === JSON.stringify(normalizeJsonValue(input.payload));
};

const isEventEnvelope = (data: WebhookEventDocumentData): data is WebhookEventEnvelope => {
	return Object.hasOwn(data, 'event') && Object.hasOwn(data, 'targetPlatforms');
};

const readEventEnvelope = (data: WebhookEventDocumentData): WebhookEventEnvelope => {
	return isEventEnvelope(data) ? data : { event: data, targetPlatforms: [] };
};

export interface WebhookOutboxService {
	enqueue(event: WebhookDomainEvent, platforms: WebhookPlatform[]): WebhookDeliveryRecord[];
	getEvent(eventId: string): WebhookDomainEvent | null;
	listDeliveries(): WebhookDeliveryRecord[];
	listReady(now?: number): WebhookDeliveryRecord[];
	claim(deliveryId: string, now?: number): WebhookDeliveryRecord | null;
	succeed(deliveryId: string, leaseToken: string, now?: number): WebhookDeliveryRecord | null;
	fail(deliveryId: string, leaseToken: string, errorCode: WebhookErrorCode, now?: number): WebhookDeliveryRecord | null;
	retryBlocked(platform?: WebhookPlatform, now?: number): number;
	cleanup(now?: number): { events: number; deliveries: number };
}

export const createWebhookOutboxService = (deps: WebhookOutboxDependencies = {}): WebhookOutboxService => {
	const eventStore = deps.eventStore ?? createDocumentStore<WebhookEventDocumentData>();
	const deliveryStore = deps.deliveryStore ?? createDocumentStore<WebhookDeliveryRecord>();
	const clock = deps.clock ?? Date.now;
	const idFactory = deps.idFactory ?? defaultIdFactory;
	const leaseTokenFactory = deps.leaseTokenFactory ?? defaultLeaseTokenFactory;

	const listDeliveryDocuments = (): DocumentRecord<WebhookDeliveryRecord>[] => {
		return deliveryStore.list(STORAGE_KEYS.WEBHOOK_DELIVERY_DOCUMENT_PREFIX);
	};

	const findDeliveryDocument = (deliveryId: string): DocumentRecord<WebhookDeliveryRecord> | null => {
		return listDeliveryDocuments().find((document) => document.data.id === deliveryId) ?? null;
	};

	const writeDelivery = (
		document: DocumentRecord<WebhookDeliveryRecord>,
		delivery: WebhookDeliveryRecord,
	): WebhookDeliveryRecord => {
		assertWriteSucceeded(deliveryStore.write({
			_id: document._id,
			...(document._rev === undefined ? {} : { _rev: document._rev }),
			data: delivery,
		}));
		return delivery;
	};

	const isReady = (delivery: WebhookDeliveryRecord, now: number): boolean => {
		if (delivery.status === 'pending') {
			return delivery.nextAttemptAt !== undefined && delivery.nextAttemptAt <= now;
		}
		return delivery.status === 'sending'
			&& delivery.leaseExpiresAt !== undefined
			&& delivery.leaseExpiresAt <= now;
	};

	const requireMatchingEvent = (
		document: DocumentRecord<WebhookEventDocumentData> | null,
		event: WebhookDomainEvent,
	): DocumentRecord<WebhookEventDocumentData> => {
		if (document === null || !eventsMatch(readEventEnvelope(document.data).event, event)) {
			throw new Error(STORAGE_ERROR_MESSAGE);
		}
		return document;
	};

	const registerEventTargets = (
		event: WebhookDomainEvent,
		platforms: WebhookPlatform[],
	): DocumentRecord<WebhookEventDocumentData> => {
		const documentId = eventDocumentId(event.id);
		let document = eventStore.get(documentId);
		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (document === null) {
				const envelope: WebhookEventEnvelope = { event, targetPlatforms: platforms };
				const result = eventStore.write({ _id: documentId, data: envelope });
				if (result.status === 'ok') {
					return { _id: documentId, ...(result.rev === undefined ? {} : { _rev: result.rev }), data: envelope };
				}
				if (result.status !== 'conflict') {
					throw new Error(STORAGE_ERROR_MESSAGE);
				}
				document = eventStore.get(documentId);
				if (document === null) {
					throw new Error(STORAGE_ERROR_MESSAGE);
				}
				continue;
			}

			document = requireMatchingEvent(document, event);
			const currentEnvelope = readEventEnvelope(document.data);
			const targetPlatforms = [...new Set([...currentEnvelope.targetPlatforms, ...platforms])];
			if (isEventEnvelope(document.data) && targetPlatforms.length === currentEnvelope.targetPlatforms.length) {
				return document;
			}
			const result = eventStore.write({
				_id: document._id,
				...(document._rev === undefined ? {} : { _rev: document._rev }),
				data: { event: currentEnvelope.event, targetPlatforms },
			});
			if (result.status === 'ok') {
				return requireMatchingEvent(eventStore.get(documentId), event);
			}
			if (result.status !== 'conflict') {
				throw new Error(STORAGE_ERROR_MESSAGE);
			}
			document = eventStore.get(documentId);
			if (document === null) {
				throw new Error(STORAGE_ERROR_MESSAGE);
			}
		}
		throw new Error(STORAGE_ERROR_MESSAGE);
	};

	return {
		enqueue: (event, platforms) => {
			const uniquePlatforms = [...new Set(platforms)];
			registerEventTargets(event, uniquePlatforms);

			const now = clock();
			return uniquePlatforms.map((platform) => {
				const documentId = deliveryDocumentId(platform, event.id);
				const existing = deliveryStore.get(documentId);
				if (existing !== null) {
					return existing.data;
				}
				const delivery: WebhookDeliveryRecord = {
					id: idFactory(),
					eventId: event.id,
					platform,
					dedupeKey: `${platform}:${event.id}`,
					status: 'pending',
					attempts: 0,
					createdAt: now,
					updatedAt: now,
					nextAttemptAt: now,
				};
				const result = deliveryStore.write({ _id: documentId, data: delivery });
				if (result.status === 'ok') {
					return delivery;
				}
				if (result.status === 'conflict') {
					const winner = deliveryStore.get(documentId);
					if (winner !== null) {
						return winner.data;
					}
				}
				throw new Error(STORAGE_ERROR_MESSAGE);
			});
		},
		getEvent: (eventId) => {
			const document = eventStore.get(eventDocumentId(eventId));
			return document === null ? null : readEventEnvelope(document.data).event;
		},
		listDeliveries: () => listDeliveryDocuments().map((document) => document.data),
		listReady: (now = clock()) => listDeliveryDocuments()
			.map((document) => document.data)
			.filter((delivery) => isReady(delivery, now))
			.sort((left, right) => {
				const scheduleDifference = (left.nextAttemptAt ?? left.createdAt) - (right.nextAttemptAt ?? right.createdAt);
				return scheduleDifference !== 0 ? scheduleDifference : left.createdAt - right.createdAt;
			}),
		claim: (deliveryId, now = clock()) => {
			const document = findDeliveryDocument(deliveryId);
			if (document === null || !isReady(document.data, now)) {
				return null;
			}
			const { nextAttemptAt: _, ...delivery } = document.data;
			return writeDelivery(document, {
				...delivery,
				status: 'sending',
				attempts: delivery.attempts + 1,
				updatedAt: now,
				leaseExpiresAt: now + LEASE_DURATION,
				leaseToken: leaseTokenFactory(),
			});
		},
		succeed: (deliveryId, leaseToken, now = clock()) => {
			const document = findDeliveryDocument(deliveryId);
			if (
				document === null
				|| document.data.status !== 'sending'
				|| document.data.leaseToken !== leaseToken
			) {
				return null;
			}
			return writeDelivery(document, {
				...withoutTransientFields(document.data),
				status: 'succeeded',
				updatedAt: now,
				succeededAt: now,
			});
		},
		fail: (deliveryId, leaseToken, errorCode, now = clock()) => {
			const document = findDeliveryDocument(deliveryId);
			if (
				document === null
				|| document.data.status !== 'sending'
				|| document.data.leaseToken !== leaseToken
			) {
				return null;
			}
			const { leaseExpiresAt: _, leaseToken: __, nextAttemptAt: ___, ...delivery } = document.data;
			if (retryableErrorCodes.has(errorCode)) {
				const delay = Math.min(
					INITIAL_RETRY_DELAY * (2 ** Math.max(0, delivery.attempts - 1)),
					MAX_RETRY_DELAY,
				);
				return writeDelivery(document, {
					...delivery,
					status: 'pending',
					updatedAt: now,
					errorCode,
					nextAttemptAt: now + delay,
				});
			}
			return writeDelivery(document, {
				...delivery,
				status: 'blocked',
				updatedAt: now,
				errorCode,
			});
		},
		retryBlocked: (platform, now = clock()) => {
			let retried = 0;
			for (const document of listDeliveryDocuments()) {
				if (document.data.status !== 'blocked' || (platform !== undefined && document.data.platform !== platform)) {
					continue;
				}
				const { errorCode: _, leaseExpiresAt: __, leaseToken: ___, ...delivery } = document.data;
				writeDelivery(document, {
					...delivery,
					status: 'pending',
					updatedAt: now,
					nextAttemptAt: now,
				});
				retried += 1;
			}
			return retried;
		},
		cleanup: (now = clock()) => {
			const cutoff = now - SUCCESS_RETENTION;
			const deliveryDocuments = listDeliveryDocuments();
			const eventDocuments = eventStore.list(STORAGE_KEYS.WEBHOOK_EVENT_DOCUMENT_PREFIX);
			const removableEventIds = new Set<string>();

			for (const eventDocument of eventDocuments) {
				const envelope = readEventEnvelope(eventDocument.data);
				const deliveries = deliveryDocuments.filter((document) => document.data.eventId === envelope.event.id);
				const allTargetsSucceeded = envelope.targetPlatforms.every((platform) => deliveries.some((document) => (
					document.data.platform === platform
					&& document.data.status === 'succeeded'
					&& document.data.succeededAt !== undefined
					&& document.data.succeededAt < cutoff
				)));
				if (allTargetsSucceeded) {
					removableEventIds.add(envelope.event.id);
				}
			}

			let deliveries = 0;
			for (const document of deliveryDocuments) {
				if (
					document.data.status !== 'succeeded'
					|| document.data.succeededAt === undefined
					|| document.data.succeededAt >= cutoff
				) {
					continue;
				}
				assertWriteSucceeded(deliveryStore.remove({
					_id: document._id,
					...(document._rev === undefined ? {} : { _rev: document._rev }),
				}));
				deliveries += 1;
			}

			let events = 0;
			for (const document of eventDocuments) {
				if (!removableEventIds.has(readEventEnvelope(document.data).event.id)) {
					continue;
				}
				assertWriteSucceeded(eventStore.remove({
					_id: document._id,
					...(document._rev === undefined ? {} : { _rev: document._rev }),
				}));
				events += 1;
			}
			return { events, deliveries };
		},
	};
};

export const webhookOutboxService = createWebhookOutboxService();