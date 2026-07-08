import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import type { Task, UpdateTaskInput } from '../types/task';
import { STORAGE_KEYS } from './storageKeys';
import { taskService } from './taskService';

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

const createTaskFixture = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: '任务 1',
	status: 'todo',
	priority: 'high',
	tags: ['a'],
	group: 'g1',
	description: 'desc',
	subtasks: [],
	createdAt: 100,
	updatedAt: 200,
	dueDate: 300,
	...overrides,
});

type TaskServiceWithBackup = typeof taskService & {
	hasBackup(): boolean;
	restoreLatestBackup(): boolean;
};

type TaskServiceWithArchive = typeof taskService & {
	archive(taskId: string): Task | null;
	unarchive(taskId: string): Task | null;
	bulkArchive(taskIds: string[]): number;
};

type StorageKeysWithBackup = typeof STORAGE_KEYS & {
	TASKS_BACKUP: string;
};

const taskServiceWithBackup = taskService as TaskServiceWithBackup;
const taskServiceWithArchive = taskService as TaskServiceWithArchive;
const storageKeysWithBackup = STORAGE_KEYS as StorageKeysWithBackup;

describe('taskService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage };
		vi.restoreAllMocks();
	});

	it('saves a backup before delete and restores it', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1000);
		const a = createTaskFixture({ id: 'a' });
		const b = createTaskFixture({ id: 'b' });
		taskService.replaceAll([a, b]);

		expect(taskService.delete('a')).toBe(true);

		expect(taskService.getAll()).toEqual([b]);
		expect(taskServiceWithBackup.hasBackup()).toBe(true);
		expect(JSON.parse(dbStorage.getItem<string>(storageKeysWithBackup.TASKS_BACKUP)!)).toEqual({
			createdAt: 1000,
			tasks: [a, b],
		});
		expect(taskServiceWithBackup.restoreLatestBackup()).toBe(true);
		expect(taskService.getAll()).toEqual([a, b]);
	});

	it('saves a backup before bulkDelete and restores it', () => {
		vi.spyOn(Date, 'now').mockReturnValue(2000);
		const a = createTaskFixture({ id: 'a' });
		const b = createTaskFixture({ id: 'b' });
		const c = createTaskFixture({ id: 'c' });
		taskService.replaceAll([a, b, c]);

		expect(taskService.bulkDelete(['a', 'c'])).toBe(2);

		expect(taskService.getAll()).toEqual([b]);
		expect(taskServiceWithBackup.hasBackup()).toBe(true);
		expect(taskServiceWithBackup.restoreLatestBackup()).toBe(true);
		expect(taskService.getAll()).toEqual([a, b, c]);
	});

	it('saves a backup before successful import and restores pre-import tasks', () => {
		vi.spyOn(Date, 'now').mockReturnValue(3000);
		const existing = createTaskFixture({ id: 'existing' });
		const incoming = createTaskFixture({ id: 'incoming', title: '导入任务' });
		taskService.replaceAll([existing]);

		const result = taskService.importTasks(JSON.stringify([incoming]));

		expect(result).toEqual({ importedCount: 1, duplicateCount: 0, invalidCount: 0 });
		expect(taskService.getAll()).toEqual([existing, incoming]);
		expect(taskServiceWithBackup.hasBackup()).toBe(true);
		expect(taskServiceWithBackup.restoreLatestBackup()).toBe(true);
		expect(taskService.getAll()).toEqual([existing]);
	});

	it('returns false when restoring without a backup', () => {
		expect(taskServiceWithBackup.hasBackup()).toBe(false);
		expect(taskServiceWithBackup.restoreLatestBackup()).toBe(false);
	});

	it('exports and imports tasks without losing key fields', () => {
		const source = createTaskFixture();
		taskService.replaceAll([source]);

		const exported = taskService.exportTasks();
		taskService.replaceAll([]);

		const result = taskService.importTasks(exported);
		const imported = taskService.getById(source.id);

		expect(result.importedCount).toBe(1);
		expect(result.duplicateCount).toBe(0);
		expect(result.invalidCount).toBe(0);
		expect(imported).toEqual(source);
	});

	it('keeps urgent priority tasks when reading persisted storage', () => {
		const urgent = createTaskFixture({ id: 'urgent-read', priority: 'urgent' });
		taskService.replaceAll([urgent]);

		expect(taskService.getAll()).toEqual([urgent]);
	});

	it('imports urgent priority tasks as valid tasks', () => {
		const urgent = createTaskFixture({ id: 'urgent-import', priority: 'urgent' });

		const result = taskService.importTasks(JSON.stringify([urgent]));

		expect(result).toEqual({ importedCount: 1, duplicateCount: 0, invalidCount: 0 });
		expect(taskService.getById(urgent.id)).toEqual(urgent);
	});

	it('skips duplicate ids during import and keeps existing task', () => {
		const existing = createTaskFixture({ title: '原任务' });
		const incoming = createTaskFixture({ title: '新任务' });
		taskService.replaceAll([existing]);

		const result = taskService.importTasks(JSON.stringify([incoming]));

		expect(result.importedCount).toBe(0);
		expect(result.duplicateCount).toBe(1);
		expect(taskService.getAll()).toEqual([existing]);
	});

	it('does not modify existing data for invalid json', () => {
		const existing = createTaskFixture();
		taskService.replaceAll([existing]);

		const result = taskService.importTasks('{bad json');

		expect(result.importedCount).toBe(0);
		expect(result.invalidCount).toBe(1);
		expect(taskService.getAll()).toEqual([existing]);
	});

	it('does not modify existing data for invalid task payloads', () => {
		const existing = createTaskFixture();
		taskService.replaceAll([existing]);

		const result = taskService.importTasks(JSON.stringify([{ id: '', title: 123 }]));

		expect(result.importedCount).toBe(0);
		expect(result.invalidCount).toBe(1);
		expect(taskService.getAll()).toEqual([existing]);
	});

	it('uses unified saveTask for create and update', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1000);

		const created = taskService.saveTask({
			title: '新任务',
			status: 'todo',
			priority: 'medium',
			tags: [],
			group: '',
			description: '',
		});

		expect(created.createdAt).toBe(1000);
		expect(created.updatedAt).toBe(1000);

		vi.spyOn(Date, 'now').mockReturnValue(2000);
		const updated = taskService.saveTask({
			id: created.id,
			title: '已更新',
			status: created.status,
			priority: created.priority,
			tags: created.tags,
			group: created.group,
			description: created.description,
			subtasks: created.subtasks,
			...(created.dueDate === undefined ? {} : { dueDate: created.dueDate }),
		});

		expect(updated.id).toBe(created.id);
		expect(updated.createdAt).toBe(created.createdAt);
		expect(updated.updatedAt).toBe(2000);
		expect(updated.title).toBe('已更新');
	});

	it('keeps dueDate unchanged when updating without touching it', () => {
		const existing = createTaskFixture({
			id: 'task-keep-due-date',
			dueDate: 123456789,
		});
		taskService.replaceAll([existing]);

		const updated = taskService.saveTask({
			id: existing.id,
			title: '仅更新标题',
			status: existing.status,
			priority: existing.priority,
			tags: existing.tags,
			group: existing.group,
			description: existing.description,
			subtasks: existing.subtasks,
			createdAt: existing.createdAt,
			updatedAt: existing.updatedAt,
		});

		expect(updated.dueDate).toBe(existing.dueDate);
		expect(taskService.getById(existing.id)?.dueDate).toBe(existing.dueDate);
	});

	it('clears dueDate only when update explicitly sets it to undefined', () => {
		const existing = createTaskFixture({
			id: 'task-clear-due-date',
			dueDate: 987654321,
		});
		taskService.replaceAll([existing]);

		const updated = taskService.saveTask({
			id: existing.id,
			title: existing.title,
			status: existing.status,
			priority: existing.priority,
			tags: existing.tags,
			group: existing.group,
			description: existing.description,
			subtasks: existing.subtasks,
			createdAt: existing.createdAt,
			updatedAt: existing.updatedAt,
			dueDate: undefined,
		});

		expect(updated).not.toHaveProperty('dueDate');
		expect(taskService.getById(existing.id)).not.toHaveProperty('dueDate');
	});

	it('clears repeat only when update explicitly sets it to undefined', () => {
		const existing = createTaskFixture({
			id: 'task-clear-repeat',
			repeat: { type: 'weekly', interval: 1 },
		});
		taskService.replaceAll([existing]);
		const updates = { repeat: undefined } as unknown as UpdateTaskInput;

		const updated = taskService.update(existing.id, updates)!;

		expect(updated).not.toHaveProperty('repeat');
		expect(taskService.getById(existing.id)).not.toHaveProperty('repeat');
	});

	it('persists and explicitly clears parentTaskId', () => {
		const parent = createTaskFixture({ id: 'parent' });
		taskService.replaceAll([parent]);

		const child = taskService.create({
			title: '子任务',
			status: 'todo',
			priority: 'medium',
			tags: ['child'],
			group: 'child-group',
			description: '',
			parentTaskId: parent.id,
		});

		expect(taskService.getById(child.id)?.parentTaskId).toBe(parent.id);

		const updated = taskService.update(child.id, { parentTaskId: undefined } as UpdateTaskInput)!;

		expect(updated).not.toHaveProperty('parentTaskId');
		expect(taskService.getById(child.id)).not.toHaveProperty('parentTaskId');
	});

	it('migrates legacy nested subtasks once when reading storage', () => {
		const legacyParent = createTaskFixture({
			id: 'parent',
			priority: 'urgent',
			tags: ['work', 'urgent'],
			group: 'project-a',
			subtasks: [
				{ id: 'sub-1', title: '旧子任务 1', completed: true, createdAt: 101, updatedAt: 201 },
				{ id: 'sub-2', title: '旧子任务 2', completed: false, createdAt: 102, updatedAt: 202 },
			],
		});
		dbStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify([legacyParent]));

		const firstRead = taskService.getAll();

		expect(firstRead.map((task) => task.id)).toEqual(['parent', 'sub-1', 'sub-2']);
		expect(firstRead.find((task) => task.id === 'parent')?.subtasks).toEqual([]);
		expect(firstRead.find((task) => task.id === 'sub-1')).toMatchObject({
			parentTaskId: 'parent',
			title: '旧子任务 1',
			status: 'done',
			priority: 'urgent',
			tags: ['work', 'urgent'],
			group: 'project-a',
			description: '',
			subtasks: [],
			createdAt: 101,
			updatedAt: 201,
		});
		expect(firstRead.find((task) => task.id === 'sub-2')?.status).toBe('todo');

		const secondRead = taskService.getAll();

		expect(secondRead.map((task) => task.id)).toEqual(['parent', 'sub-1', 'sub-2']);
		expect(secondRead.filter((task) => task.parentTaskId === 'parent')).toHaveLength(2);
		expect(JSON.parse(dbStorage.getItem<string>(STORAGE_KEYS.TASKS)!).find((task: Task) => task.id === 'parent').subtasks).toEqual([]);
	});

	it('addSubtask creates a full child task inheriting parent metadata', () => {
		vi.spyOn(Date, 'now').mockReturnValue(5000);
		const parent = createTaskFixture({
			id: 'parent',
			priority: 'urgent',
			tags: ['work'],
			group: 'project-a',
		});
		taskService.replaceAll([parent]);

		const child = taskService.addSubtask(parent.id, '完整子任务')!;

		expect(child).toMatchObject({
			title: '完整子任务',
			parentTaskId: parent.id,
			status: 'todo',
			priority: 'urgent',
			tags: ['work'],
			group: 'project-a',
			description: '',
			subtasks: [],
			completed: false,
			createdAt: 5000,
			updatedAt: 5000,
		});
		expect(taskService.getById(child.id)).toMatchObject({
			parentTaskId: parent.id,
			priority: 'urgent',
			tags: ['work'],
			group: 'project-a',
		});
		expect(taskService.getById(parent.id)?.subtasks).toEqual([]);
	});

	it('updateSubtask maps completed to child task status', () => {
		const parent = createTaskFixture({ id: 'parent' });
		const child = createTaskFixture({ id: 'child', parentTaskId: parent.id, status: 'todo' });
		taskService.replaceAll([parent, child]);

		expect(taskService.updateSubtask(parent.id, child.id, true)).toBe(true);
		expect(taskService.getById(child.id)?.status).toBe('done');

		expect(taskService.updateSubtask(parent.id, child.id, false)).toBe(true);
		expect(taskService.getById(child.id)?.status).toBe('todo');
	});

	it('deletes direct child tasks when deleting parent task', () => {
		const parent = createTaskFixture({ id: 'parent' });
		const child = createTaskFixture({ id: 'child', parentTaskId: parent.id });
		const other = createTaskFixture({ id: 'other' });
		taskService.replaceAll([parent, child, other]);

		expect(taskService.delete(parent.id)).toBe(true);

		expect(taskService.getAll().map((task) => task.id)).toEqual(['other']);
	});

	it('orders child tasks immediately after their parent task', () => {
		const parentA = createTaskFixture({ id: 'parent-a' });
		const parentB = createTaskFixture({ id: 'parent-b' });
		const childA1 = createTaskFixture({ id: 'child-a-1', parentTaskId: parentA.id });
		const childA2 = createTaskFixture({ id: 'child-a-2', parentTaskId: parentA.id });
		const orphan = createTaskFixture({ id: 'orphan', parentTaskId: 'missing-parent' });

		const ordered = taskService.getTasksInParentOrder([childA1, parentB, orphan, parentA, childA2]);

		expect(ordered.map((task) => task.id)).toEqual(['parent-b', 'parent-a', 'child-a-1', 'child-a-2', 'orphan']);
	});

	it('exposes npm test script for vitest workflow', () => {
		expect(packageJson.scripts.test).toBe('vitest run');
	});

	describe('bulkUpdate', () => {
		it('updates only matched ids and refreshes updatedAt', () => {
			vi.spyOn(Date, 'now').mockReturnValue(5000);
			const a = createTaskFixture({ id: 'a', status: 'todo', priority: 'low', group: 'g1', updatedAt: 100 });
			const b = createTaskFixture({ id: 'b', status: 'doing', priority: 'medium', group: 'g2', updatedAt: 200 });
			const c = createTaskFixture({ id: 'c', status: 'done', priority: 'high', group: 'g3', updatedAt: 300 });
			taskService.replaceAll([a, b, c]);

			const affected = taskService.bulkUpdate(['a', 'b'], { status: 'done', priority: 'high', group: 'gX' });

			expect(affected).toBe(2);
			const all = taskService.getAll();
			const getById = (id: string) => all.find((t) => t.id === id)!;

			expect(getById('a')).toMatchObject({ status: 'done', priority: 'high', group: 'gX', updatedAt: 5000 });
			expect(getById('b')).toMatchObject({ status: 'done', priority: 'high', group: 'gX', updatedAt: 5000 });
			expect(getById('c')).toMatchObject({ status: 'done', priority: 'high', group: 'g3', updatedAt: 300 });
		});

		it('applies partial fields only when provided', () => {
			vi.spyOn(Date, 'now').mockReturnValue(7000);
			const a = createTaskFixture({ id: 'a', status: 'todo', priority: 'low', group: 'g1' });
			taskService.replaceAll([a]);

			taskService.bulkUpdate(['a'], { status: 'doing' });

			const got = taskService.getById('a')!;
			expect(got).toMatchObject({ status: 'doing', priority: 'low', group: 'g1' });
			expect(got.updatedAt).toBe(7000);
		});

		it('returns 0 for empty array without touching storage', () => {
			const a = createTaskFixture({ id: 'a' });
			taskService.replaceAll([a]);
			expect(taskService.bulkUpdate([], { status: 'done' })).toBe(0);
			expect(taskService.getById('a')).toEqual(a);
		});

		it('returns 0 when no id matches', () => {
			vi.spyOn(Date, 'now').mockReturnValue(9000);
			const a = createTaskFixture({ id: 'a', updatedAt: 100 });
			taskService.replaceAll([a]);
			expect(taskService.bulkUpdate(['nonexistent'], { status: 'done' })).toBe(0);
			expect(taskService.getById('a')!.updatedAt).toBe(100);
		});
	});

	describe('bulkDelete', () => {
		it('removes only matched ids and returns count', () => {
			const a = createTaskFixture({ id: 'a' });
			const b = createTaskFixture({ id: 'b' });
			const c = createTaskFixture({ id: 'c' });
			taskService.replaceAll([a, b, c]);

			const removed = taskService.bulkDelete(['a', 'c']);

			expect(removed).toBe(2);
			expect(taskService.getAll().map((t) => t.id)).toEqual(['b']);
		});

		it('returns 0 for empty array', () => {
			const a = createTaskFixture({ id: 'a' });
			taskService.replaceAll([a]);
			expect(taskService.bulkDelete([])).toBe(0);
			expect(taskService.getAll()).toHaveLength(1);
		});

		it('returns 0 when no id matches', () => {
			const a = createTaskFixture({ id: 'a' });
			taskService.replaceAll([a]);
			expect(taskService.bulkDelete(['nonexistent'])).toBe(0);
			expect(taskService.getAll()).toHaveLength(1);
		});
	});

	describe('archive', () => {
		it('archives and restores a task without deleting it', () => {
			vi.spyOn(Date, 'now').mockReturnValue(12_000);
			const task = createTaskFixture({ id: 'archive-me', updatedAt: 100 });
			taskService.replaceAll([task]);

			const archived = taskServiceWithArchive.archive(task.id)!;

			expect(archived).toMatchObject({ id: task.id, archivedAt: 12_000, updatedAt: 12_000 });
			expect(taskService.getById(task.id)).toMatchObject({ archivedAt: 12_000 });

			vi.spyOn(Date, 'now').mockReturnValue(13_000);
			const restored = taskServiceWithArchive.unarchive(task.id)!;

			expect(restored).not.toHaveProperty('archivedAt');
			expect(restored.updatedAt).toBe(13_000);
			expect(taskService.getById(task.id)).not.toHaveProperty('archivedAt');
		});

		it('bulk archives matched tasks only', () => {
			vi.spyOn(Date, 'now').mockReturnValue(14_000);
			const a = createTaskFixture({ id: 'a' });
			const b = createTaskFixture({ id: 'b' });
			const c = createTaskFixture({ id: 'c' });
			taskService.replaceAll([a, b, c]);

			const affected = taskServiceWithArchive.bulkArchive(['a', 'c', 'missing']);

			expect(affected).toBe(2);
			expect(taskService.getById('a')).toMatchObject({ archivedAt: 14_000, updatedAt: 14_000 });
			expect(taskService.getById('b')).not.toHaveProperty('archivedAt');
			expect(taskService.getById('c')).toMatchObject({ archivedAt: 14_000, updatedAt: 14_000 });
		});

		it('returns null or 0 when archive target is missing', () => {
			const task = createTaskFixture({ id: 'existing' });
			taskService.replaceAll([task]);

			expect(taskServiceWithArchive.archive('missing')).toBeNull();
			expect(taskServiceWithArchive.unarchive('missing')).toBeNull();
			expect(taskServiceWithArchive.bulkArchive(['missing'])).toBe(0);
			expect(taskService.getAll()).toEqual([task]);
		});
	});
});
