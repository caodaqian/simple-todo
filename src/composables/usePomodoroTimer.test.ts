import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pomodoroService } from '../services/pomodoroService';
import { settingsService } from '../services/settingsService';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { Task } from '../types/task';
import { notifyExpiredPomodoro } from './usePomodoroTimer';

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

const makeTask = (): Task => ({
	id: 'task-1',
	title: '写实现',
	status: 'doing',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
});

describe('notifyExpiredPomodoro', () => {
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

	it('notifies once when a running pomodoro expires', () => {
		const session = pomodoroService.startForTask(makeTask(), 40, 1_000);

		expect(notifyExpiredPomodoro(session.endsAt)).toBe(true);
		expect(showNotification).toHaveBeenCalledWith('番茄钟结束：写实现', 'todo');
		expect(notifyExpiredPomodoro(session.endsAt + 1_000)).toBe(false);
		expect(showNotification).toHaveBeenCalledTimes(1);
	});

	it('includes subtask title in expired pomodoro notification', () => {
		const task = makeTask();
		task.subtasks = [{ id: 'sub-1', title: '写测试', completed: false, createdAt: 1, updatedAt: 1 }];
		const session = pomodoroService.startForSubtask(task, task.subtasks[0]!, 40, 1_000);

		expect(notifyExpiredPomodoro(session.endsAt)).toBe(true);
		expect(showNotification).toHaveBeenCalledWith('番茄钟结束：写实现 / 写测试', 'todo');
	});
});
