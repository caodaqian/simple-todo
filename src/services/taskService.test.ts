import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import type { Task } from '../types/task';
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
	subtasks: [
		{
			id: 'sub-1',
			title: '子任务',
			completed: false,
			createdAt: 100,
			updatedAt: 100,
		},
	],
	createdAt: 100,
	updatedAt: 200,
	dueDate: 300,
	...overrides,
});

describe('taskService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage };
		vi.restoreAllMocks();
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
});
