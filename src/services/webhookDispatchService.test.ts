import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../types/task';
import type {
	WebhookDeliveryRecord,
	WebhookDomainEvent,
	WebhookErrorCode,
	WebhookPlatform,
} from '../types/webhook';
import type { WebhookOutboxService } from './webhookOutboxService';
import { createWebhookDispatchService } from './webhookDispatchService';

type TaskOverrides = Partial<Omit<Task, 'dueDate' | 'dueStart' | 'dueEnd'>> & {
	dueDate?: number | undefined;
	dueStart?: number | undefined;
	dueEnd?: number | undefined;
};

const makeTask = (overrides: TaskOverrides = {}): Task => {
	const { dueDate, dueStart, dueEnd, ...fields } = overrides;
	const task: Task = {
		id: 'task-1',
		title: '提交报告',
		status: 'todo',
		dueEnd: 2_000,
		priority: 'high',
		tags: ['工作'],
		group: '项目 A',
		description: '说明',
		subtasks: [],
		createdAt: 100,
		updatedAt: 200,
		...fields,
	};
	if ('dueDate' in overrides) {
		if (dueDate === undefined) delete task.dueDate;
		else task.dueDate = dueDate;
	}
	if ('dueStart' in overrides) {
		if (dueStart === undefined) delete task.dueStart;
		else task.dueStart = dueStart;
	}
	if ('dueEnd' in overrides) {
		if (dueEnd === undefined) delete task.dueEnd;
		else task.dueEnd = dueEnd;
	}
	return task;
};

const makeDelivery = (
	overrides: Partial<WebhookDeliveryRecord> = {},
): WebhookDeliveryRecord => ({
	id: 'delivery-1',
	eventId: 'task.due:task-1:2000:1500',
	platform: 'feishu',
	dedupeKey: 'feishu:task.due:task-1:2000:1500',
	status: 'pending',
	attempts: 0,
	createdAt: 1_500,
	updatedAt: 1_500,
	nextAttemptAt: 1_500,
	...overrides,
});

const makeDueEvent = (): WebhookDomainEvent => ({
	id: 'task.due:task-1:2000:1500',
	type: 'task.due',
	occurredAt: 1_500,
	payload: {
		task: {
			id: 'task-1',
			title: '提交报告',
			description: '说明',
			priority: 'high',
			tags: ['工作'],
			group: '项目 A',
			dueAt: 2_000,
		},
		reminderAt: 1_500,
	},
});

const createOutboxMock = (): WebhookOutboxService => ({
	enqueue: vi.fn(() => []),
	getEvent: vi.fn(() => null),
	listDeliveries: vi.fn(() => []),
	listReady: vi.fn(() => []),
	claim: vi.fn(() => null),
	succeed: vi.fn(() => null),
	fail: vi.fn(() => null),
	retryBlocked: vi.fn(() => 0),
	cleanup: vi.fn(() => ({ events: 0, deliveries: 0 })),
});

describe('webhookDispatchService', () => {
	it('creates a stable detached due event from the task deadline', () => {
		const service = createWebhookDispatchService({
			outbox: createOutboxMock(),
			clock: () => 1_500,
			sendEvent: vi.fn(),
			getKeyword: vi.fn(),
		});
		const task = makeTask();

		const first = service.createDueEvent(task, 1_500);
		task.title = '已修改';
		task.tags.push('新标签');
		const second = service.createDueEvent(makeTask(), 1_500);

		expect(first).toEqual(makeDueEvent());
		expect(second.id).toBe(first.id);
		expect(first.payload.task.title).toBe('提交报告');
		expect(first.payload.task.tags).toEqual(['工作']);
	});

	it('includes the effective deadline in the stable event identity and honors deadline precedence', () => {
		const service = createWebhookDispatchService({
			outbox: createOutboxMock(),
			clock: () => 1_500,
			sendEvent: vi.fn(),
			getKeyword: vi.fn(),
		});

		const ranged = service.createDueEvent(makeTask({ dueDate: 500, dueStart: 1_000, dueEnd: 2_000 }), 1_500);
		const point = service.createDueEvent(makeTask({ dueEnd: undefined, dueStart: 1_800 }), 1_500);
		const legacy = service.createDueEvent(makeTask({ dueEnd: undefined, dueStart: undefined, dueDate: 1_700 }), 1_500);
		const changedDeadline = service.createDueEvent(makeTask({ dueEnd: 2_500 }), 1_500);

		expect(ranged.id).toBe('task.due:task-1:2000:1500');
		expect(point.payload.task.dueAt).toBe(1_800);
		expect(legacy.payload.task.dueAt).toBe(1_700);
		expect(changedDeadline.id).toBe('task.due:task-1:2500:1500');
		expect(() => service.createDueEvent(makeTask({ dueEnd: undefined }), 1_500)).toThrow(
			'Cannot create a due webhook event without a task deadline.',
		);
	});

	it('delegates enqueue without duplicating outbox behavior', () => {
		const outbox = createOutboxMock();
		const event = makeDueEvent();
		const deliveries = [makeDelivery()];
		vi.mocked(outbox.enqueue).mockReturnValue(deliveries);
		const service = createWebhookDispatchService({
			outbox,
			clock: () => 1_500,
			sendEvent: vi.fn(),
			getKeyword: vi.fn(),
		});

		expect(service.enqueue(event, ['feishu', 'feishu'])).toBe(deliveries);
		expect(outbox.enqueue).toHaveBeenCalledWith(event, ['feishu', 'feishu']);
	});

	it('drains ready deliveries and fences every outcome with the claimed lease token', async () => {
		const outbox = createOutboxMock();
		const event = makeDueEvent();
		const ready = [
			makeDelivery(),
			makeDelivery({ id: 'delivery-2', platform: 'dingtalk', dedupeKey: 'dingtalk:event' }),
			makeDelivery({ id: 'delivery-3', eventId: 'missing', dedupeKey: 'feishu:missing' }),
		];
		vi.mocked(outbox.listReady).mockReturnValue(ready);
		vi.mocked(outbox.claim)
			.mockReturnValueOnce({ ...ready[0]!, status: 'sending', attempts: 1, leaseToken: 'lease-a', leaseExpiresAt: 61_500 })
			.mockReturnValueOnce({ ...ready[1]!, status: 'sending', attempts: 1, leaseToken: 'lease-b', leaseExpiresAt: 61_500 })
			.mockReturnValueOnce({ ...ready[2]!, status: 'sending', attempts: 1, leaseToken: 'lease-c', leaseExpiresAt: 61_500 });
		vi.mocked(outbox.getEvent)
			.mockReturnValueOnce(event)
			.mockReturnValueOnce(event)
			.mockReturnValueOnce(null);
		vi.mocked(outbox.succeed).mockImplementation((id, token) => makeDelivery({ id, status: 'succeeded', leaseToken: token }));
		vi.mocked(outbox.fail).mockImplementation((id, token, errorCode) => makeDelivery({ id, status: 'pending', leaseToken: token, errorCode }));
		const sendEvent = vi.fn()
			.mockResolvedValueOnce({ ok: true, status: 200 })
			.mockResolvedValueOnce({ ok: false, errorCode: 'rate_limited' as WebhookErrorCode });
		const getKeyword = vi.fn((platform: WebhookPlatform) => platform === 'feishu' ? '飞书词' : undefined);
		const service = createWebhookDispatchService({ outbox, clock: () => 1_500, sendEvent, getKeyword });

		const result = await service.drain();

		expect(result).toEqual({ claimed: 3, succeeded: 1, failed: 2, skipped: 0 });
		expect(sendEvent).toHaveBeenNthCalledWith(1, 'feishu', event, '飞书词');
		expect(sendEvent).toHaveBeenNthCalledWith(2, 'dingtalk', event, undefined);
		expect(outbox.succeed).toHaveBeenCalledWith('delivery-1', 'lease-a', 1_500);
		expect(outbox.fail).toHaveBeenCalledWith('delivery-2', 'lease-b', 'rate_limited', 1_500);
		expect(outbox.fail).toHaveBeenCalledWith('delivery-3', 'lease-c', 'unknown', 1_500);
	});

	it('continues after a rejected send and skips claims or outcomes whose lease was lost', async () => {
		const outbox = createOutboxMock();
		const event = makeDueEvent();
		const ready = [makeDelivery(), makeDelivery({ id: 'delivery-2' }), makeDelivery({ id: 'delivery-3' })];
		vi.mocked(outbox.listReady).mockReturnValue(ready);
		vi.mocked(outbox.claim)
			.mockReturnValueOnce(null)
			.mockReturnValueOnce({ ...ready[1]!, status: 'sending', leaseToken: 'lease-b' })
			.mockReturnValueOnce({ ...ready[2]!, status: 'sending', leaseToken: 'lease-c' });
		vi.mocked(outbox.getEvent).mockReturnValue(event);
		vi.mocked(outbox.fail).mockReturnValueOnce(null);
		vi.mocked(outbox.succeed).mockReturnValueOnce(null);
		const sendEvent = vi.fn()
			.mockRejectedValueOnce(new Error('secret network detail'))
			.mockResolvedValueOnce({ ok: true, status: 200 });
		const service = createWebhookDispatchService({
			outbox,
			clock: () => 2_000,
			sendEvent,
			getKeyword: vi.fn(),
		});

		const result = await service.drain();

		expect(result).toEqual({ claimed: 2, succeeded: 0, failed: 0, skipped: 3 });
		expect(outbox.fail).toHaveBeenCalledWith('delivery-2', 'lease-b', 'network_error', 2_000);
		expect(outbox.succeed).toHaveBeenCalledWith('delivery-3', 'lease-c', 2_000);
		expect(sendEvent).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent drain calls so each delivery is claimed once', async () => {
		const outbox = createOutboxMock();
		const event = makeDueEvent();
		const delivery = makeDelivery();
		vi.mocked(outbox.listReady).mockReturnValue([delivery]);
		vi.mocked(outbox.claim).mockReturnValue({ ...delivery, status: 'sending', leaseToken: 'lease-a' });
		vi.mocked(outbox.getEvent).mockReturnValue(event);
		vi.mocked(outbox.succeed).mockReturnValue({ ...delivery, status: 'succeeded' });
		let resolveSend: ((value: { ok: boolean; status: number }) => void) | undefined;
		const sendEvent = vi.fn(() => new Promise<{ ok: boolean; status: number }>((resolve) => {
			resolveSend = resolve;
		}));
		const service = createWebhookDispatchService({
			outbox,
			clock: () => 2_000,
			sendEvent,
			getKeyword: vi.fn(),
		});

		const first = service.drain();
		const second = service.drain();
		expect(outbox.claim).toHaveBeenCalledTimes(1);
		resolveSend?.({ ok: true, status: 200 });

		await expect(first).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 0, skipped: 0 });
		await expect(second).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 0, skipped: 0 });
		expect(sendEvent).toHaveBeenCalledTimes(1);
	});

	it('releases the drain lock after completion so a later opportunity can retry', async () => {
		const outbox = createOutboxMock();
		vi.mocked(outbox.listReady).mockReturnValue([]);
		const service = createWebhookDispatchService({
			outbox,
			clock: () => 2_000,
			sendEvent: vi.fn(),
			getKeyword: vi.fn(),
		});

		await service.drain();
		await service.drain();

		expect(outbox.listReady).toHaveBeenCalledTimes(2);
	});
});
