import { beforeEach, describe, expect, it } from 'vitest';
import { taskService } from '../services/taskService';
import type { Task } from '../types/task';
import { useCompletionBlockedModal } from './useCompletionBlockedModal';

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
	title: '任务',
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

describe('useCompletionBlockedModal', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage } as typeof window.utools;
	});

	it('fills blockedInfo when completion is blocked by active children', () => {
		const parent = makeTask({ id: 'parent', title: '整理计划', status: 'doing' });
		const child = makeTask({ id: 'child', parentTaskId: parent.id, status: 'todo' });
		taskService.replaceAll([parent, child]);

		const { blockedInfo, guardedChangeStatus } = useCompletionBlockedModal();

		expect(guardedChangeStatus(parent.id, 'done')).toBeNull();
		expect(blockedInfo.value).toEqual({ parent, doingCount: 0, todoCount: 1 });
	});

	it('leaves blockedInfo null when the status change succeeds', () => {
		const task = makeTask({ id: 'solo', status: 'doing' });
		taskService.replaceAll([task]);

		const { blockedInfo, guardedChangeStatus } = useCompletionBlockedModal();

		expect(guardedChangeStatus(task.id, 'done')?.status).toBe('done');
		expect(blockedInfo.value).toBeNull();
	});

	it('dismissBlockedModal clears the current blocked info', () => {
		const parent = makeTask({ id: 'parent', status: 'doing' });
		const child = makeTask({ id: 'child', parentTaskId: parent.id, status: 'todo' });
		taskService.replaceAll([parent, child]);

		const { blockedInfo, guardedChangeStatus, dismissBlockedModal } = useCompletionBlockedModal();
		guardedChangeStatus(parent.id, 'done');
		expect(blockedInfo.value).not.toBeNull();

		dismissBlockedModal();

		expect(blockedInfo.value).toBeNull();
	});
});
