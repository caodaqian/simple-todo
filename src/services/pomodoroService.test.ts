import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../types/task';
import { pomodoroService } from './pomodoroService';

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
	status: 'doing',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe('pomodoroService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage } as typeof window.utools;
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-05T10:00:00+08:00'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts a pomodoro session for a task with duration snapshot', () => {
		const session = pomodoroService.startForTask(makeTask(), 40);

		expect(session.taskId).toBe('task-1');
		expect(session.taskTitle).toBe('写实现');
		expect(session.durationMinutes).toBe(40);
		expect(session.status).toBe('running');
		expect(session.endsAt - session.startedAt).toBe(40 * 60 * 1000);
		expect(pomodoroService.getSession()).toEqual(session);
	});

	it('starts a pomodoro session for a subtask with parent task snapshot', () => {
		const task = makeTask({
			subtasks: [{ id: 'sub-1', title: '写测试', completed: false, createdAt: 1, updatedAt: 1 }],
		});

		const session = pomodoroService.startForSubtask(task, task.subtasks[0]!, 25);

		expect(session.taskId).toBe('task-1');
		expect(session.taskTitle).toBe('写实现');
		expect(session.subtaskId).toBe('sub-1');
		expect(session.subtaskTitle).toBe('写测试');
		expect(session.durationMinutes).toBe(25);
		expect(session.status).toBe('running');
		expect(session.endsAt - session.startedAt).toBe(25 * 60 * 1000);
		expect(pomodoroService.getSession()).toEqual(session);
	});

	it('prevents starting a second running session', () => {
		pomodoroService.startForTask(makeTask({ id: 'task-1', title: '任务一' }), 40);

		expect(() => pomodoroService.startForTask(makeTask({ id: 'task-2', title: '任务二' }), 25)).toThrow('已有番茄钟进行中');
	});

	it('prevents starting another subtask session while one is running', () => {
		const task = makeTask({
			subtasks: [
				{ id: 'sub-1', title: '写测试', completed: false, createdAt: 1, updatedAt: 1 },
				{ id: 'sub-2', title: '写实现', completed: false, createdAt: 1, updatedAt: 1 },
			],
		});
		pomodoroService.startForSubtask(task, task.subtasks[0]!, 40);

		expect(() => pomodoroService.startForSubtask(task, task.subtasks[1]!, 25)).toThrow('已有番茄钟进行中');
	});

	it('computes remaining milliseconds without going below zero', () => {
		const session = pomodoroService.startForTask(makeTask(), 40);
		expect(pomodoroService.getRemainingMs(session, session.startedAt + 10 * 60 * 1000)).toBe(30 * 60 * 1000);
		expect(pomodoroService.getRemainingMs(session, session.endsAt + 1)).toBe(0);
	});

	it('marks expired sessions once and only once', () => {
		const session = pomodoroService.startForTask(makeTask(), 40);

		expect(pomodoroService.markExpired(session.endsAt - 1)).toBeNull();
		const expired = pomodoroService.markExpired(session.endsAt);
		expect(expired?.status).toBe('finished');
		expect(expired?.notifiedAt).toBe(session.endsAt);
		expect(pomodoroService.markExpired(session.endsAt + 1000)).toBeNull();
	});

	it('records finished sessions in history for review metrics', () => {
		const session = pomodoroService.startForTask(makeTask({ id: 'focus-1', title: '专注任务' }), 25);

		const expired = pomodoroService.markExpired(session.endsAt);

		expect(expired?.status).toBe('finished');
		expect(pomodoroService.getHistory()).toEqual([expired]);
	});

	it('stops the current session', () => {
		pomodoroService.startForTask(makeTask(), 40);
		pomodoroService.stop();
		expect(pomodoroService.getSession()).toBeNull();
	});

	it('returns null for invalid stored JSON', () => {
		dbStorage.setItem('jianyue.pomodoro', '{bad json');
		expect(pomodoroService.getSession()).toBeNull();
	});
});
