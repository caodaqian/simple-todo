import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { Task } from '../types/task';
import { settingsService } from './settingsService';
import { taskService } from './taskService';
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
		dbStorage.clear();
		showNotification.mockReset();
		window.utools = {
			...(window.utools ?? {}),
			dbStorage,
			showNotification,
		} as typeof window.utools;
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, notifyEnabled: true });
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
