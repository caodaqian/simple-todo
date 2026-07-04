import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { Task } from '../types/task';
import { notifyService, summarizeOnEnter } from './notifyService';
import { settingsService } from './settingsService';

interface ShowNotificationOpts {
	title: string;
	body: string;
}

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

const baseTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: '任务',
	status: 'todo',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: Date.now(),
	updatedAt: Date.now(),
	...overrides,
});

const startOfToday = (): number => {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

const buildTaskDueToday = (): Task => {
	const today = startOfToday();
	return baseTask({ id: 'today-1', dueDate: today + 12 * 60 * 60 * 1000 });
};

describe('notifyService.summarizeOnEnter', () => {
	const dbStorage = new MockDbStorage();
	const showNotification = vi.fn();

	beforeEach(() => {
		dbStorage.clear();
		showNotification.mockReset();
		window.utools = {
			...(window.utools ?? {}),
			dbStorage,
			showNotification,
		} as unknown as typeof window.utools;
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, notifyEnabled: true });
	});

	it('does not notify when no today/overdue tasks', () => {
		const tasks: Task[] = [baseTask({ id: 'no-due' })];
		summarizeOnEnter(tasks);
		expect(showNotification).not.toHaveBeenCalled();
	});

	it('notifies with today count when only today tasks exist', () => {
		const tasks: Task[] = [buildTaskDueToday(), baseTask({ id: 'no-due' })];
		summarizeOnEnter(tasks);
		expect(showNotification).toHaveBeenCalledTimes(1);
		const firstCall = showNotification.mock.calls[0];
		expect(firstCall).toBeDefined();
		const call = firstCall?.[0] as ShowNotificationOpts;
		expect(call.title).toBe('简悦清单');
		expect(call.body).toContain('今天 1 项');
		expect(call.body).toContain('已过期 0 项');
	});

	it('notifies with overdue count when overdue tasks exist', () => {
		const today = startOfToday();
		const tasks: Task[] = [
			baseTask({ id: 'overdue-1', dueDate: today - 24 * 60 * 60 * 1000 }),
			baseTask({ id: 'overdue-2', dueDate: today - 48 * 60 * 60 * 1000 }),
		];
		summarizeOnEnter(tasks);
		expect(showNotification).toHaveBeenCalledTimes(1);
		const firstCall = showNotification.mock.calls[0];
		expect(firstCall).toBeDefined();
		const call = firstCall?.[0] as ShowNotificationOpts;
		expect(call.body).toContain('已过期 2 项');
	});

	it('excludes done tasks from today count', () => {
		const today = startOfToday();
		const doneToday = baseTask({ id: 'today-done', dueDate: today + 12 * 60 * 60 * 1000, status: 'done' });
		summarizeOnEnter([doneToday]);
		expect(showNotification).not.toHaveBeenCalled();
	});

	it('does not throw when showNotification fails', () => {
		showNotification.mockImplementation(() => {
			throw new Error('notification failed');
		});
		expect(() => summarizeOnEnter([buildTaskDueToday()])).not.toThrow();
	});

	it('respects notifyEnabled = false', () => {
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, notifyEnabled: false });
		summarizeOnEnter([buildTaskDueToday()]);
		expect(showNotification).not.toHaveBeenCalled();
	});

	it('exposes summarizeOnEnter on notifyService', () => {
		expect(typeof notifyService.summarizeOnEnter).toBe('function');
	});
});
