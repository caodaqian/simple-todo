import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyService } from '../services/notifyService';
import { settingsService } from '../services/settingsService';
import { taskService } from '../services/taskService';
import { webhookDispatchService } from '../services/webhookDispatchService';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { Task } from '../types/task';
import { catchUpReminders } from './useReminderScheduler';

const makeTask = (index: number): Task => ({
	id: `task-${index}`,
	title: `任务 ${index}`,
	status: 'todo',
	dueEnd: 1_000 + index,
	reminderOffset: 0,
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
});

const webhookSettings = (feishuEnabled: boolean, dingtalkEnabled: boolean) => ({
	...DEFAULT_SETTINGS,
	webhooks: {
		feishu: { enabled: feishuEnabled, events: ['task.due' as const], keyword: '飞书词' },
		dingtalk: { enabled: dingtalkEnabled, events: ['task.completed' as const] },
		dailyDigest: { enabled: false, time: '09:00', timezone: 'Asia/Shanghai' },
	},
});

describe('useReminderScheduler webhook integration', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(Date, 'now').mockReturnValue(2_000);
		vi.spyOn(taskService, 'update').mockImplementation((id) => makeTask(Number(id.split('-')[1])));
		vi.spyOn(notifyService, 'notify').mockImplementation(() => undefined);
		vi.spyOn(webhookDispatchService, 'createDueEvent').mockImplementation((task, reminderAt) => ({
			id: `due:${task.id}:${reminderAt}`,
			type: 'task.due',
			occurredAt: 2_000,
			payload: {
				task: {
					id: task.id,
					title: task.title,
					description: task.description,
					priority: task.priority,
					tags: [...task.tags],
					group: task.group,
					dueAt: task.dueEnd!,
				},
				reminderAt,
			},
		}));
		vi.spyOn(webhookDispatchService, 'enqueue').mockReturnValue([]);
		vi.spyOn(webhookDispatchService, 'hasEvent').mockReturnValue(false);
		vi.spyOn(webhookDispatchService, 'drain').mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, skipped: 0 });
	});

	it('persists one due event per task only for enabled subscribed targets', async () => {
		const tasks = [makeTask(1), makeTask(2)];
		vi.spyOn(taskService, 'getAll').mockReturnValue(tasks);
		settingsService.saveSettings(webhookSettings(true, false));
		const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

		catchUpReminders();
		await Promise.resolve();

		expect(webhookDispatchService.createDueEvent).toHaveBeenCalledTimes(2);
		expect(webhookDispatchService.createDueEvent).toHaveBeenNthCalledWith(1, tasks[0], 1_001);
		expect(webhookDispatchService.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'due:task-1:1001' }), ['feishu']);
		expect(webhookDispatchService.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'due:task-2:1002' }), ['feishu']);
		expect(webhookDispatchService.drain).toHaveBeenCalledOnce();
		expect(notifyService.notify).toHaveBeenCalledTimes(2);
		expect(taskService.update).toHaveBeenCalledTimes(2);
		expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'jianyue:tasks-changed' }));
	});

	it('keeps local catch-up summarized while external events remain task-granular', async () => {
		const tasks = Array.from({ length: 6 }, (_, index) => makeTask(index));
		vi.spyOn(taskService, 'getAll').mockReturnValue(tasks);
		settingsService.saveSettings({
			...webhookSettings(true, true),
			webhooks: {
				...webhookSettings(true, true).webhooks,
				dingtalk: { enabled: true, events: ['task.due'] },
			},
		});

		catchUpReminders();
		await Promise.resolve();

		expect(notifyService.notify).toHaveBeenCalledOnce();
		expect(notifyService.notify).toHaveBeenCalledWith('简悦清单', '你有 6 条漏掉的提醒');
		expect(webhookDispatchService.enqueue).toHaveBeenCalledTimes(6);
		expect(webhookDispatchService.enqueue).toHaveBeenCalledWith(expect.any(Object), ['feishu', 'dingtalk']);
		expect(taskService.update).toHaveBeenCalledTimes(6);
	});

	it('does not let enqueue or drain failures block local notification and remindedAt', async () => {
		const task = makeTask(1);
		vi.spyOn(taskService, 'getAll').mockReturnValue([task]);
		settingsService.saveSettings(webhookSettings(true, false));
		vi.mocked(webhookDispatchService.enqueue).mockImplementation(() => {
			throw new Error('Webhook outbox storage operation failed.');
		});
		vi.mocked(webhookDispatchService.drain).mockRejectedValue(new Error('secret transport detail'));

		expect(() => catchUpReminders()).not.toThrow();
		await Promise.resolve();

		expect(notifyService.notify).toHaveBeenCalledWith('简悦清单提醒', task.title);
		expect(taskService.update).toHaveBeenCalledWith(task.id, { remindedAt: 2_000 });
	});

	it('enqueues the due daily digest once for enabled subscribed targets', async () => {
		vi.spyOn(taskService, 'getAll').mockReturnValue([]);
		settingsService.saveSettings({
			...webhookSettings(true, false),
			webhooks: {
				...webhookSettings(true, false).webhooks,
				feishu: { enabled: true, events: ['digest.daily'] },
				dailyDigest: { enabled: true, time: '08:00', timezone: 'Asia/Shanghai' },
			},
		});
		vi.spyOn(webhookDispatchService, 'createDailyDigestEvent').mockReturnValue({
			id: 'digest.daily:Asia/Shanghai:1970-01-01', type: 'digest.daily', occurredAt: 2_000,
			payload: { digest: { periodStart: 0, periodEnd: 1, timezone: 'Asia/Shanghai', completed: [], due: [], overdue: [], activeCount: 0 } },
		});

		catchUpReminders();
		await Promise.resolve();

		expect(webhookDispatchService.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'digest.daily' }), ['feishu']);
	});
});
