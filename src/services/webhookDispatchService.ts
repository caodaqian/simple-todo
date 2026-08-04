import { settingsService } from './settingsService';
import { webhookOutboxService, type WebhookOutboxService } from './webhookOutboxService';
import { getTaskDeadline, type Task } from '../types/task';
import type {
	WebhookDeliveryRecord,
	WebhookDomainEvent,
	WebhookErrorCode,
	WebhookPlatform,
} from '../types/webhook';

type DueWebhookEvent = Extract<WebhookDomainEvent, { type: 'task.due' }>;

interface WebhookSendResult {
	ok: boolean;
	status?: number;
	errorCode?: WebhookErrorCode;
}

interface WebhookDispatchDependencies {
	outbox?: WebhookOutboxService;
	sendEvent?: (
		platform: WebhookPlatform,
		event: WebhookDomainEvent,
		keyword?: string,
	) => Promise<WebhookSendResult>;
	getKeyword?: (platform: WebhookPlatform) => string | undefined;
	clock?: () => number;
}

export interface WebhookDrainResult {
	claimed: number;
	succeeded: number;
	failed: number;
	skipped: number;
}

export interface WebhookDispatchService {
	createDueEvent(task: Task, reminderAt: number, occurredAt?: number): DueWebhookEvent;
	enqueue(event: WebhookDomainEvent, platforms: WebhookPlatform[]): WebhookDeliveryRecord[];
	drain(now?: number): Promise<WebhookDrainResult>;
}

const defaultSendEvent = (
	platform: WebhookPlatform,
	event: WebhookDomainEvent,
	keyword?: string,
): Promise<WebhookSendResult> => window.services.webhooks.sendEvent(platform, event, keyword);

const defaultGetKeyword = (platform: WebhookPlatform): string | undefined => {
	return settingsService.getSettings().webhooks[platform].keyword;
};

const emptyDrainResult = (): WebhookDrainResult => ({
	claimed: 0,
	succeeded: 0,
	failed: 0,
	skipped: 0,
});

export const createWebhookDispatchService = (
	deps: WebhookDispatchDependencies = {},
): WebhookDispatchService => {
	const outbox = deps.outbox ?? webhookOutboxService;
	const sendEvent = deps.sendEvent ?? defaultSendEvent;
	const getKeyword = deps.getKeyword ?? defaultGetKeyword;
	const clock = deps.clock ?? Date.now;
	let drainInFlight: Promise<WebhookDrainResult> | null = null;

	const createDueEvent = (
		task: Task,
		reminderAt: number,
		occurredAt = clock(),
	): DueWebhookEvent => {
		const dueAt = getTaskDeadline(task);
		if (dueAt === undefined) {
			throw new Error('Cannot create a due webhook event without a task deadline.');
		}
		return {
			id: `task.due:${task.id}:${dueAt}:${reminderAt}`,
			type: 'task.due',
			occurredAt,
			payload: {
				task: {
					id: task.id,
					title: task.title,
					description: task.description,
					priority: task.priority,
					tags: [...task.tags],
					group: task.group,
					dueAt,
				},
				reminderAt,
			},
		};
	};

	const runDrain = async (now: number): Promise<WebhookDrainResult> => {
		const result = emptyDrainResult();
		for (const ready of outbox.listReady(now)) {
			const claimed = outbox.claim(ready.id, now);
			if (claimed === null || claimed.leaseToken === undefined) {
				result.skipped += 1;
				continue;
			}
			result.claimed += 1;

			const event = outbox.getEvent(claimed.eventId);
			if (event === null) {
				const failed = outbox.fail(claimed.id, claimed.leaseToken, 'unknown', clock());
				if (failed === null) result.skipped += 1;
				else result.failed += 1;
				continue;
			}

			try {
				const sendResult = await sendEvent(claimed.platform, event, getKeyword(claimed.platform));
				if (sendResult.ok) {
					const succeeded = outbox.succeed(claimed.id, claimed.leaseToken, clock());
					if (succeeded === null) result.skipped += 1;
					else result.succeeded += 1;
				} else {
					const failed = outbox.fail(
						claimed.id,
						claimed.leaseToken,
						sendResult.errorCode ?? 'unknown',
						clock(),
					);
					if (failed === null) result.skipped += 1;
					else result.failed += 1;
				}
			} catch {
				const failed = outbox.fail(claimed.id, claimed.leaseToken, 'network_error', clock());
				if (failed === null) result.skipped += 1;
				else result.failed += 1;
			}
		}
		return result;
	};

	return {
		createDueEvent,
		enqueue: (event, platforms) => outbox.enqueue(event, platforms),
		drain: (now = clock()) => {
			if (drainInFlight !== null) return drainInFlight;
			drainInFlight = runDrain(now).finally(() => {
				drainInFlight = null;
			});
			return drainInFlight;
		},
	};
};

export const webhookDispatchService = createWebhookDispatchService();
