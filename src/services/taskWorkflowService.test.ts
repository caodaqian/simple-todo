import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { Task } from '../types/task';
import { settingsService } from './settingsService';
import { taskService } from './taskService';
import { webhookDispatchService } from './webhookDispatchService';
import { taskWorkflowService } from './taskWorkflowService';

class MockDbStorage {
	private store = new Map<string, string>();

	getItem<T = unknown>(key: string): T {
		return (this.store.get(key) ?? null) as T;
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: '写实现',
	status: 'todo',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe('taskWorkflowService', () => {
	const dbStorage = new MockDbStorage();
	const showNotification = vi.fn();

	beforeEach(() => {
		vi.restoreAllMocks();
		dbStorage.clear();
		showNotification.mockReset();
		window.utools = {
			...(window.utools ?? {}),
			dbStorage,
			showNotification,
		} as typeof window.utools;
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, notifyEnabled: true });
		vi.spyOn(webhookDispatchService, 'enqueue').mockReturnValue([]);
		vi.spyOn(webhookDispatchService, 'drain').mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0, skipped: 0 });
	});

	it('enqueues a completed event once for enabled subscribed targets', async () => {
		settingsService.saveSettings({
			...DEFAULT_SETTINGS,
			webhooks: {
				feishu: { enabled: true, events: ['task.completed'] },
				dingtalk: { enabled: true, events: ['task.due'] },
				dailyDigest: { enabled: false, time: '09:00', timezone: 'Asia/Shanghai' },
			},
		});
		taskService.replaceAll([makeTask({ id: 't1', title: '提交版本', status: 'doing' })]);
		const createEvent = vi.spyOn(webhookDispatchService, 'createCompletedEvent');

		taskWorkflowService.changeStatus('t1', 'done');
		await Promise.resolve();

		expect(createEvent).toHaveBeenCalledOnce();
		expect(webhookDispatchService.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.completed' }), ['feishu']);
		expect(webhookDispatchService.drain).toHaveBeenCalledOnce();
	});

	it('does not enqueue repeated completion but enqueues again after reopening', async () => {
		settingsService.saveSettings({
			...DEFAULT_SETTINGS,
			webhooks: {
				feishu: { enabled: true, events: ['task.completed'] },
				dingtalk: { enabled: false, events: [] },
				dailyDigest: { enabled: false, time: '09:00', timezone: 'Asia/Shanghai' },
			},
		});
		taskService.replaceAll([makeTask({ id: 't1', status: 'done', completedAt: 1 })]);

		taskWorkflowService.changeStatus('t1', 'done');
		taskWorkflowService.changeStatus('t1', 'todo');
		taskWorkflowService.changeStatus('t1', 'done');
		await Promise.resolve();

		expect(webhookDispatchService.enqueue).toHaveBeenCalledTimes(1);
	});

	it('notifies when task changes from active status to done', () => {
		taskService.replaceAll([makeTask({ id: 't1', title: '提交版本', status: 'doing' })]);

		const updated = taskWorkflowService.changeStatus('t1', 'done');

		expect(updated?.status).toBe('done');
		expect(showNotification).toHaveBeenCalledWith('任务已完成：提交版本', 'todo');
	});

	it('does not notify when an already done task remains done', () => {
		taskService.replaceAll([makeTask({ id: 't1', title: '提交版本', status: 'done' })]);

		taskWorkflowService.changeStatus('t1', 'done');

		expect(showNotification).not.toHaveBeenCalled();
	});

	it('does not notify when task is restored to active status', () => {
		taskService.replaceAll([makeTask({ id: 't1', title: '提交版本', status: 'done' })]);

		taskWorkflowService.changeStatus('t1', 'todo');

		expect(showNotification).not.toHaveBeenCalled();
	});

	it('blocks completion of a parent with active children without a text notification', () => {
		const parent = makeTask({ id: 'parent', title: '整理计划', status: 'doing' });
		const child = makeTask({ id: 'child', parentTaskId: parent.id, status: 'todo' });
		taskService.replaceAll([parent, child]);

		expect(taskWorkflowService.changeStatus(parent.id, 'done')).toBeNull();
		expect(showNotification).not.toHaveBeenCalled();
	});

	describe('getBlockedCompletionInfo', () => {
		it('returns parent and counts of doing/todo direct children', () => {
			const parent = makeTask({ id: 'parent', title: '整理计划', status: 'doing' });
			const doingChild = makeTask({ id: 'child-doing', parentTaskId: parent.id, status: 'doing' });
			const todoChildA = makeTask({ id: 'child-todo-a', parentTaskId: parent.id, status: 'todo' });
			const todoChildB = makeTask({ id: 'child-todo-b', parentTaskId: parent.id, status: 'todo' });
			const doneChild = makeTask({ id: 'child-done', parentTaskId: parent.id, status: 'done' });
			taskService.replaceAll([parent, doingChild, todoChildA, todoChildB, doneChild]);

			expect(taskWorkflowService.getBlockedCompletionInfo(parent.id)).toEqual({
				parent,
				doingCount: 1,
				todoCount: 2,
			});
		});

		it('returns null when the parent has no active children', () => {
			const parent = makeTask({ id: 'parent', status: 'doing' });
			const doneChild = makeTask({ id: 'child', parentTaskId: parent.id, status: 'done' });
			taskService.replaceAll([parent, doneChild]);

			expect(taskWorkflowService.getBlockedCompletionInfo(parent.id)).toBeNull();
		});

		it('returns null when the task does not exist', () => {
			taskService.replaceAll([]);

			expect(taskWorkflowService.getBlockedCompletionInfo('missing')).toBeNull();
		});
	});

	it('sends a summary notification for bulk completion', () => {
		taskService.replaceAll([
			makeTask({ id: 't1', title: '一', status: 'todo' }),
			makeTask({ id: 't2', title: '二', status: 'doing' }),
			makeTask({ id: 't3', title: '三', status: 'done' }),
		]);

		const updated = taskWorkflowService.bulkUpdateStatus(['t1', 't2', 't3'], 'done');

		expect(updated).toBe(3);
		expect(showNotification).toHaveBeenCalledWith('任务已完成：已完成 2 项任务', 'todo');
	});
});
