import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import type { Task, UpdateTaskInput } from '../types/task';
import { getTaskDeadline } from '../types/task';
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

class MockDocumentDb implements UtoolsDb {
	private readonly documents = new Map<string, UtoolsDbDocument>();

	private revision = 0;

	private nextPutConflict = false;

	private nextRemoveConflict = false;

	get(id: string): UtoolsDbDocument | null {
		return this.documents.get(id) ?? null;
	}

	put(document: UtoolsDbDocument): UtoolsDbResult {
		if (this.nextPutConflict) {
			this.nextPutConflict = false;
			return { ok: false, error: true, name: 'conflict' };
		}

		const current = this.documents.get(document._id);
		if (current !== undefined && document._rev !== current._rev) {
			return { ok: false, error: true, name: 'conflict' };
		}

		this.revision += 1;
		const rev = `rev-${this.revision}`;
		this.documents.set(document._id, { ...document, _rev: rev });
		return { ok: true, rev };
	}

	remove(document: UtoolsDbDocument): UtoolsDbResult {
		if (this.nextRemoveConflict) {
			this.nextRemoveConflict = false;
			return { ok: false, error: true, name: 'conflict' };
		}
		const current = this.documents.get(document._id);
		if (current === undefined) {
			return { ok: false, error: true, name: 'not_found' };
		}
		if (document._rev !== current._rev) {
			return { ok: false, error: true, name: 'conflict' };
		}
		this.documents.delete(document._id);
		return { ok: true, rev: `rev-${this.revision}` };
	}

	bulkDocs(documents: UtoolsDbDocument[]): UtoolsDbResult[] {
		return documents.map((document) => this.put(document));
	}

	allDocs(prefix?: string): UtoolsDbDocument[] {
		return [...this.documents.values()].filter((document) => prefix === undefined || document._id.startsWith(prefix));
	}

	forceNextPutConflict(): void {
		this.nextPutConflict = true;
	}

	forceNextRemoveConflict(): void {
		this.nextRemoveConflict = true;
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

const dbStorage = new MockDbStorage();

describe('taskService', () => {
	beforeEach(() => {
		dbStorage.clear();
		Reflect.set(taskService, 'memoryBackup', null);
		Reflect.set(window, 'utools', { dbStorage });
		vi.restoreAllMocks();
	});

	it('stores a created task in its own native document without document metadata in the payload', () => {
		const db = new MockDocumentDb();
		Reflect.set(window, 'utools', { db, dbStorage });

		const task = taskService.create({
			title: '原生任务',
			status: 'todo',
			priority: 'medium',
			tags: ['native'],
			group: '收件箱',
			description: '',
			subtasks: [],
		});

		const document = db.get(`jianyue/task/${task.id}`);
		expect(document).toMatchObject({ _id: `jianyue/task/${task.id}`, data: task });
		expect(document?.data).not.toHaveProperty('_id');
		expect(document?.data).not.toHaveProperty('_rev');
	});

	it('migrates valid legacy arrays into native documents and clears the legacy key', () => {
		const db = new MockDocumentDb();
		const legacy = createTaskFixture({ id: 'legacy-native' });
		const rawLegacy = JSON.stringify([legacy]);
		Reflect.set(window, 'utools', { db, dbStorage });
		dbStorage.setItem(STORAGE_KEYS.TASKS, rawLegacy);

		expect(taskService.getAll()).toEqual([legacy]);
		expect(db.get(`jianyue/task/${legacy.id}`)).toMatchObject({ data: legacy });
		expect(dbStorage.getItem(STORAGE_KEYS.TASKS)).toBeNull();
	});

	it('completes a partial native migration without overwriting existing native tasks', () => {
		const db = new MockDocumentDb();
		const legacyExisting = createTaskFixture({ id: 'legacy-existing', title: '旧标题' });
		const nativeExisting = createTaskFixture({ id: legacyExisting.id, title: '原生标题' });
		const missing = createTaskFixture({ id: 'legacy-missing' });
		const rawLegacy = JSON.stringify([legacyExisting, missing]);
		Reflect.set(window, 'utools', { db, dbStorage });
		dbStorage.setItem(STORAGE_KEYS.TASKS, rawLegacy);
		db.put({ _id: `jianyue/task/${nativeExisting.id}`, data: nativeExisting });

		expect(taskService.getAll()).toEqual([nativeExisting, missing]);
		expect(db.get(`jianyue/task/${nativeExisting.id}`)).toMatchObject({ data: nativeExisting });
		expect(db.get(`jianyue/task/${missing.id}`)).toMatchObject({ data: missing });
		expect(dbStorage.getItem(STORAGE_KEYS.TASKS)).toBeNull();
	});

	it('stores separate native documents for separate tasks', () => {
		const db = new MockDocumentDb();
		Reflect.set(window, 'utools', { db, dbStorage });

		const first = taskService.create({
			title: '第一项', status: 'todo', priority: 'low', tags: [], group: '', description: '', subtasks: [],
		});
		const second = taskService.create({
			title: '第二项', status: 'todo', priority: 'high', tags: [], group: '', description: '', subtasks: [],
		});

		expect(db.allDocs('jianyue/task/').map((document) => document._id)).toEqual([
			`jianyue/task/${first.id}`,
			`jianyue/task/${second.id}`,
		]);
	});

	it('does not silently overwrite a native document when its revision conflicts', () => {
		const db = new MockDocumentDb();
		const task = createTaskFixture({ id: 'native-conflict', title: '原始标题' });
		Reflect.set(window, 'utools', { db, dbStorage });
		db.put({ _id: `jianyue/task/${task.id}`, data: task });
		db.forceNextPutConflict();

		expect(taskService.getById(task.id)).toEqual(task);
		expect(taskService.update(task.id, { title: '本地修改' })).toBeNull();
		expect(db.get(`jianyue/task/${task.id}`)).toMatchObject({ data: task });
	});

	it('preserves remote tasks added after the local native snapshot is saved', () => {
		const db = new MockDocumentDb();
		const local = createTaskFixture({ id: 'local-task', title: '本地任务' });
		const remotelyCreated = createTaskFixture({ id: 'remote-task', title: '远端任务' });
		Reflect.set(window, 'utools', { db, dbStorage });
		db.put({ _id: `jianyue/task/${local.id}`, data: local });

		expect(taskService.getAll()).toEqual([local]);
		db.put({ _id: `jianyue/task/${remotelyCreated.id}`, data: remotelyCreated });

		const locallyUpdated = { ...local, title: '本地已更新' };
		taskService.replaceAll([locallyUpdated]);

		expect(db.get(`jianyue/task/${local.id}`)).toMatchObject({ data: locallyUpdated });
		expect(db.get(`jianyue/task/${remotelyCreated.id}`)).toMatchObject({ data: remotelyCreated });
	});

	it('returns a conflict without overwriting a task updated after the local native snapshot', () => {
		const db = new MockDocumentDb();
		const task = createTaskFixture({ id: 'concurrent-task', title: '初始标题' });
		const remotelyUpdated = { ...task, title: '远端标题' };
		Reflect.set(window, 'utools', { db, dbStorage });
		db.put({ _id: `jianyue/task/${task.id}`, data: task });

		expect(taskService.getAll()).toEqual([task]);
		const current = db.get(`jianyue/task/${task.id}`)!;
		db.put({ ...current, data: remotelyUpdated });

		expect(taskService.update(task.id, { title: '本地标题' })).toBeNull();
		expect(db.get(`jianyue/task/${task.id}`)).toMatchObject({ data: remotelyUpdated });
	});

	it('returns false and preserves the document when a native delete conflicts', () => {
		const db = new MockDocumentDb();
		const task = createTaskFixture({ id: 'native-delete-conflict' });
		Reflect.set(window, 'utools', { db, dbStorage });
		db.put({ _id: `jianyue/task/${task.id}`, data: task });
		db.forceNextRemoveConflict();

		expect(taskService.delete(task.id)).toBe(false);
		expect(db.get(`jianyue/task/${task.id}`)).toMatchObject({ data: task });
	});

	it('saves a backup before delete and restores it', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1000);
		const a = createTaskFixture({ id: 'a' });
		const b = createTaskFixture({ id: 'b' });
		taskService.replaceAll([a, b]);

		expect(taskService.delete('a')).toBe(true);

		expect(taskService.getAll()).toEqual([b]);
		expect(taskServiceWithBackup.hasBackup()).toBe(true);
		expect(dbStorage.getItem(storageKeysWithBackup.TASKS_BACKUP)).toBeNull();
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

		expect(updated.dueEnd).toBe(existing.dueDate);
		expect(updated).not.toHaveProperty('dueDate');
		expect(taskService.getById(existing.id)?.dueEnd).toBe(existing.dueDate);
		expect(taskService.getById(existing.id)).not.toHaveProperty('dueDate');
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

		expect(updated).not.toHaveProperty('dueEnd');
		expect(updated).not.toHaveProperty('dueDate');
		expect(taskService.getById(existing.id)).not.toHaveProperty('dueEnd');
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

	it('addSubtask applies explicitly provided metadata instead of inheriting it', () => {
		const parent = createTaskFixture({
			id: 'parent',
			priority: 'urgent',
			tags: ['work'],
			group: 'project-a',
		});
		taskService.replaceAll([parent]);

		const child = taskService.addSubtask(parent.id, '独立属性子任务', {
			priority: 'low',
			tags: ['personal'],
			group: 'inbox',
			dueStart: 10_000,
			allDay: true,
		})!;

		expect(child).toMatchObject({
			priority: 'low',
			tags: ['personal'],
			group: 'inbox',
			dueEnd: 10_000,
			allDay: true,
		});
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

	it('records completion time only when a task enters done and clears it when reopened', () => {
		vi.spyOn(Date, 'now').mockReturnValue(5_000);
		const task = createTaskFixture({ id: 'completion-time', status: 'todo' });
		taskService.replaceAll([task]);

		expect(taskService.changeStatus(task.id, 'done')).toMatchObject({ status: 'done', completedAt: 5_000 });

		vi.spyOn(Date, 'now').mockReturnValue(6_000);
		expect(taskService.update(task.id, { title: '编辑后的任务' })).toMatchObject({ completedAt: 5_000 });
		expect(taskService.changeStatus(task.id, 'doing')).not.toHaveProperty('completedAt');
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
		it('spawns the next instance when completing a repeating task', () => {
			vi.spyOn(Date, 'now').mockReturnValue(10_000);
			const repeating = createTaskFixture({
				id: 'repeat-bulk',
				status: 'todo',
				dueStart: 1_000,
				repeat: { type: 'daily', interval: 1 },
			});
			taskService.replaceAll([repeating]);

			expect(taskService.bulkUpdate([repeating.id], { status: 'done' })).toBe(1);

			const tasks = taskService.getAll();
			expect(tasks).toHaveLength(2);
			expect(tasks.find((task) => task.id === repeating.id)).toMatchObject({
				status: 'done',
				repeat: { generatedCount: 1 },
			});
			expect(tasks.find((task) => task.id !== repeating.id)).toMatchObject({
				status: 'todo',
				dueEnd: 1_000 + 24 * 60 * 60 * 1_000,
			});
			expect(tasks.find((task) => task.id !== repeating.id)).not.toHaveProperty('dueStart');
		});

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

		it('records and clears completion time for bulk status changes', () => {
			vi.spyOn(Date, 'now').mockReturnValue(5_000);
			const task = createTaskFixture({ id: 'bulk-completion', status: 'todo' });
			taskService.replaceAll([task]);

			expect(taskService.bulkUpdate([task.id], { status: 'done' })).toBe(1);
			expect(taskService.getById(task.id)).toMatchObject({ status: 'done', completedAt: 5_000 });

			vi.spyOn(Date, 'now').mockReturnValue(6_000);
			expect(taskService.bulkUpdate([task.id], { status: 'todo' })).toBe(1);
			expect(taskService.getById(task.id)).not.toHaveProperty('completedAt');
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
		it('archives and restores direct child tasks with their parent', () => {
			vi.spyOn(Date, 'now').mockReturnValue(12_000);
			const parent = createTaskFixture({ id: 'parent' });
			const todoChild = createTaskFixture({ id: 'todo-child', parentTaskId: parent.id, status: 'todo' });
			const doneChild = createTaskFixture({
				id: 'done-child',
				parentTaskId: parent.id,
				status: 'done',
				completedAt: 10_000,
			});
			const unrelated = createTaskFixture({ id: 'unrelated' });
			taskService.replaceAll([parent, todoChild, doneChild, unrelated]);

			expect(taskServiceWithArchive.archive(parent.id)).toMatchObject({ archivedAt: 12_000 });
			expect(taskService.getById(todoChild.id)).toMatchObject({ archivedAt: 12_000, updatedAt: 12_000 });
			expect(taskService.getById(doneChild.id)).toMatchObject({
			archivedAt: 12_000,
			updatedAt: 12_000,
			status: 'done',
			completedAt: 10_000,
		});
		expect(taskService.getById(unrelated.id)).not.toHaveProperty('archivedAt');

			vi.spyOn(Date, 'now').mockReturnValue(13_000);
			expect(taskServiceWithArchive.unarchive(parent.id)).not.toHaveProperty('archivedAt');
			expect(taskService.getById(todoChild.id)).toMatchObject({ updatedAt: 13_000 });
			expect(taskService.getById(todoChild.id)).not.toHaveProperty('archivedAt');
			expect(taskService.getById(doneChild.id)).toMatchObject({ status: 'done', completedAt: 10_000, updatedAt: 13_000 });
			expect(taskService.getById(doneChild.id)).not.toHaveProperty('archivedAt');
		});

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

	describe('parent completion', () => {
		it('does not complete a parent while a direct child remains active', () => {
			vi.spyOn(Date, 'now').mockReturnValue(12_000);
			const parent = createTaskFixture({ id: 'parent', status: 'doing', updatedAt: 100 });
			const activeChild = createTaskFixture({ id: 'child', parentTaskId: parent.id, status: 'todo' });
			taskService.replaceAll([parent, activeChild]);

			expect(taskService.changeStatus(parent.id, 'done')).toBeNull();
			expect(taskService.getById(parent.id)).toMatchObject({ status: 'doing', updatedAt: 100 });
			expect(taskService.getById(parent.id)).not.toHaveProperty('completedAt');
		});

		it('completes a parent after all direct children are done', () => {
			vi.spyOn(Date, 'now').mockReturnValue(12_000);
			const parent = createTaskFixture({ id: 'parent', status: 'doing' });
			const child = createTaskFixture({ id: 'child', parentTaskId: parent.id, status: 'done', completedAt: 10_000 });
			taskService.replaceAll([parent, child]);

			expect(taskService.changeStatus(parent.id, 'done')).toMatchObject({ status: 'done', completedAt: 12_000 });
		});
	});

	describe('parent auto-promotion when a child starts', () => {
		it('promotes a todo parent to doing when a direct child changes to doing', () => {
			vi.spyOn(Date, 'now').mockReturnValue(20_000);
			const parent = createTaskFixture({ id: 'parent', status: 'todo', updatedAt: 100 });
			const child = createTaskFixture({ id: 'child', parentTaskId: parent.id, status: 'todo' });
			taskService.replaceAll([parent, child]);

			expect(taskService.changeStatus(child.id, 'doing')).toMatchObject({ status: 'doing' });
			expect(taskService.getById(parent.id)).toMatchObject({ status: 'doing', updatedAt: 20_000 });
		});

		it('does not touch a parent that is already doing or done', () => {
			vi.spyOn(Date, 'now').mockReturnValue(20_000);
			const doingParent = createTaskFixture({ id: 'doing-parent', status: 'doing', updatedAt: 100 });
			const doneParent = createTaskFixture({ id: 'done-parent', status: 'done', updatedAt: 200 });
			const childOfDoing = createTaskFixture({ id: 'child-a', parentTaskId: doingParent.id, status: 'todo' });
			const childOfDone = createTaskFixture({ id: 'child-b', parentTaskId: doneParent.id, status: 'todo' });
			taskService.replaceAll([doingParent, doneParent, childOfDoing, childOfDone]);

			taskService.changeStatus(childOfDoing.id, 'doing');
			taskService.changeStatus(childOfDone.id, 'doing');

			expect(taskService.getById(doingParent.id)).toMatchObject({ updatedAt: 100 });
			expect(taskService.getById(doneParent.id)).toMatchObject({ status: 'done', updatedAt: 200 });
		});

		it('does nothing when the task has no parent', () => {
			vi.spyOn(Date, 'now').mockReturnValue(20_000);
			const task = createTaskFixture({ id: 'solo', status: 'todo' });
			taskService.replaceAll([task]);

			expect(taskService.changeStatus(task.id, 'doing')).toMatchObject({ status: 'doing' });
		});

		it('promotes multiple distinct todo parents during a bulk update', () => {
			vi.spyOn(Date, 'now').mockReturnValue(20_000);
			const parentA = createTaskFixture({ id: 'parent-a', status: 'todo' });
			const parentB = createTaskFixture({ id: 'parent-b', status: 'todo' });
			const childA = createTaskFixture({ id: 'child-a', parentTaskId: parentA.id, status: 'todo' });
			const childB = createTaskFixture({ id: 'child-b', parentTaskId: parentB.id, status: 'todo' });
			taskService.replaceAll([parentA, parentB, childA, childB]);

			expect(taskService.bulkUpdate([childA.id, childB.id], { status: 'doing' })).toBe(2);

			expect(taskService.getById(parentA.id)).toMatchObject({ status: 'doing' });
			expect(taskService.getById(parentB.id)).toMatchObject({ status: 'doing' });
		});
	});
});

describe('unified time range semantics', () => {
  beforeEach(() => {
    dbStorage.clear();
  });

  it('migrates a legacy dueDate-only task to dueEnd on create', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const created = taskService.create({
      title: '旧单点', status: 'todo', priority: 'medium', tags: [], group: '', description: '', subtasks: [], dueDate: 555,
    });
    expect(created).not.toHaveProperty('dueDate');
    expect(created.dueEnd).toBe(555);
    expect(getTaskDeadline(created)).toBe(555);
  });

  it('migrates a single dueStart-only task to dueEnd on create', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const created = taskService.create({
      title: '旧起点', status: 'todo', priority: 'medium', tags: [], group: '', description: '', subtasks: [], dueStart: 999,
    });
    expect(created).not.toHaveProperty('dueStart');
    expect(created.dueEnd).toBe(999);
  });

  it('normalizes reversed range on create and keeps interval', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const created = taskService.create({
      title: '倒序区间', status: 'todo', priority: 'medium', tags: [], group: '', description: '', subtasks: [], dueStart: 300, dueEnd: 100,
    });
    expect(created.dueStart).toBe(100);
    expect(created.dueEnd).toBe(300);
  });

  it('update preserves existing dueEnd when only dueStart changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const task = createTaskFixture({ id: 'range-task', dueStart: 100, dueEnd: 300 });
    delete (task as Partial<Task>).dueDate;
    taskService.replaceAll([task]);
    const updated = taskService.update(task.id, { dueStart: 150 })!;
    expect(updated.dueStart).toBe(150);
    expect(updated.dueEnd).toBe(300);
  });

  it('update swaps endpoints when new start exceeds existing end', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const task = createTaskFixture({ id: 'range-task', dueStart: 100, dueEnd: 300 });
    delete (task as Partial<Task>).dueDate;
    taskService.replaceAll([task]);
    const updated = taskService.update(task.id, { dueStart: 500 })!;
    expect(updated.dueStart).toBe(300);
    expect(updated.dueEnd).toBe(500);
  });

  it('migrates a legacy dueDate task read from storage into dueEnd', () => {
    dbStorage.setItem(
      STORAGE_KEYS.TASKS,
      JSON.stringify([{ id: 'legacy', title: '旧', status: 'todo', priority: 'medium', tags: [], group: '', description: '', subtasks: [], createdAt: 1, updatedAt: 1, dueDate: 4242 }]),
    );
    const tasks = taskService.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).not.toHaveProperty('dueDate');
    expect(tasks[0]?.dueEnd).toBe(4242);
  });
});
