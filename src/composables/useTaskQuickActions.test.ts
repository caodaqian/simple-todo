import { beforeEach, describe, expect, it } from 'vitest';
import { taskService } from '../services/taskService';
import type { Task } from '../types/task';
import { useTaskQuickActions } from './useTaskQuickActions';

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

describe('useTaskQuickActions', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage } as typeof window.utools;
	});

	it('cycles a task through the three statuses and refreshes after each change', () => {
		const task = makeTask();
		taskService.replaceAll([task]);
		let refreshCount = 0;
		const actions = useTaskQuickActions(() => { refreshCount += 1; });

		expect(actions.cycleStatus(task)?.status).toBe('doing');
		expect(actions.cycleStatus(taskService.getById(task.id)!)?.status).toBe('done');
		expect(actions.cycleStatus(taskService.getById(task.id)!)?.status).toBe('todo');
		expect(refreshCount).toBe(3);
	});

	it('keeps a parent task unchanged and exposes blocking details when completion is prevented', () => {
		const parent = makeTask({ id: 'parent' });
		const child = makeTask({ id: 'child', parentTaskId: parent.id });
		taskService.replaceAll([parent, child]);
		let refreshCount = 0;
		const actions = useTaskQuickActions(() => { refreshCount += 1; });

		expect(actions.setStatus(parent, 'done')).toBeNull();
		expect(taskService.getById(parent.id)?.status).toBe('todo');
		expect(actions.blockedInfo.value?.parent.id).toBe(parent.id);
		expect(refreshCount).toBe(0);
	});

	it('updates priority and refreshes once', () => {
		const task = makeTask();
		taskService.replaceAll([task]);
		let refreshCount = 0;
		const actions = useTaskQuickActions(() => { refreshCount += 1; });

		expect(actions.setPriority(task, 'urgent')?.priority).toBe('urgent');
		expect(taskService.getById(task.id)?.priority).toBe('urgent');
		expect(refreshCount).toBe(1);
	});

	it('archives and restores a task', () => {
		const task = makeTask();
		taskService.replaceAll([task]);
		let refreshCount = 0;
		const actions = useTaskQuickActions(() => { refreshCount += 1; });

		expect(actions.toggleArchive(task)?.archivedAt).toBeTypeOf('number');
		expect(actions.toggleArchive(taskService.getById(task.id)!)?.archivedAt).toBeUndefined();
		expect(refreshCount).toBe(2);
	});
});
