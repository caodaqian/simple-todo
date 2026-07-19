import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskTemplate } from '../types/task';
import { STORAGE_KEYS } from './storageKeys';
import { taskService } from './taskService';
import { templateService } from './templateService';

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

	get(id: string): UtoolsDbDocument | null { return this.documents.get(id) ?? null; }
	put(document: UtoolsDbDocument): UtoolsDbResult {
		const current = this.documents.get(document._id);
		if (current !== undefined && current._rev !== document._rev) return { ok: false, error: true, name: 'conflict' };
		const rev = `rev-${++this.revision}`;
		this.documents.set(document._id, { ...document, _rev: rev });
		return { ok: true, rev };
	}
	remove(document: UtoolsDbDocument): UtoolsDbResult {
		const current = this.documents.get(document._id);
		if (current === undefined) return { ok: false, error: true, name: 'not_found' };
		if (current._rev !== document._rev) return { ok: false, error: true, name: 'conflict' };
		this.documents.delete(document._id);
		return { ok: true, rev: `rev-${++this.revision}` };
	}
	bulkDocs(documents: UtoolsDbDocument[]): UtoolsDbResult[] { return documents.map((document) => this.put(document)); }
	allDocs(prefix?: string): UtoolsDbDocument[] { return [...this.documents.values()].filter((document) => prefix === undefined || document._id.startsWith(prefix)); }
}

const createTemplateFixture = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
	id: 'tpl-1',
	name: '模板 1',
	title: '预设标题',
	priority: 'high',
	tags: ['work'],
	group: 'g1',
	description: 'desc',
	childTasks: [],
	subtasks: [],
	createdAt: 100,
	updatedAt: 200,
	...overrides,
});

describe('templateService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		// 显式写入空数组，避免单例 memoryTemplates 缓存干扰跨用例断言
		dbStorage.setItem(STORAGE_KEYS.TEMPLATES, '[]');
		dbStorage.setItem(STORAGE_KEYS.TASKS, '[]');
		Reflect.set(window, 'utools', { dbStorage });
	});

	describe('list / create', () => {
		it('returns empty when no templates stored', () => {
			expect(templateService.list()).toEqual([]);
		});

		it('creates a template and persists it', () => {
			const tpl = templateService.create({
				name: '站会', title: '每日站会', priority: 'high', tags: ['work'], group: 'team',
			});
			expect(tpl.id).toBeTruthy();
			expect(tpl.name).toBe('站会');
			const list = templateService.list();
			expect(list).toHaveLength(1);
			expect(list[0]!.title).toBe('每日站会');
		});

		it('create defaults tags/group/description/subtasks', () => {
			const tpl = templateService.create({ name: 'n', title: 't', priority: 'low' });
			expect(tpl.tags).toEqual([]);
			expect(tpl.group).toBe('');
			expect(tpl.description).toBe('');
			expect(tpl.subtasks).toEqual([]);
		});

		it('uses the template name when the task title is empty', () => {
			const template = templateService.create({ name: '验收任务模板', title: '', priority: 'medium' });
			expect(template.title).toBe('验收任务模板');
		});

		it('creates rich child tasks and omits repeat rules', () => {
			const tpl = templateService.create({
				name: 'n', title: 't', priority: 'low',
				reminderOffset: 20,
				children: ['准备资料'],
				repeat: { type: 'weekly', interval: 1 },
			});
			expect(tpl.reminderOffset).toBe(20);
			expect(tpl).not.toHaveProperty('repeat');
			expect(tpl.childTasks).toEqual([{
				title: '准备资料', priority: 'low', tags: [], group: '', description: '',
			}]);
		});
	});

	describe('update', () => {
		it('updates fields and bumps updatedAt', () => {
			const tpl = templateService.create({ name: 'n', title: 't', priority: 'low' });
			const updated = templateService.update(tpl.id, { name: 'n2', title: 't2' });
			expect(updated?.name).toBe('n2');
			expect(updated?.title).toBe('t2');
			expect(updated?.updatedAt).toBeGreaterThanOrEqual(tpl.updatedAt);
		});

		it('returns null for missing id', () => {
			expect(templateService.update('ghost', { name: 'x' })).toBeNull();
		});

		it('clears reminder offset when explicitly set to null', () => {
			const template = templateService.create({ name: 'n', title: 't', priority: 'low', reminderOffset: 15 });
			const updated = templateService.update(template.id, { reminderOffset: null });
			expect(updated).not.toHaveProperty('reminderOffset');
		});
	});

	describe('delete', () => {
		it('deletes and returns true', () => {
			const tpl = templateService.create({ name: 'n', title: 't', priority: 'low' });
			expect(templateService.delete(tpl.id)).toBe(true);
			expect(templateService.list()).toEqual([]);
		});

		it('returns false for missing id', () => {
			expect(templateService.delete('ghost')).toBe(false);
		});
	});

	describe('applyTemplate', () => {
		it('creates a task from template defaults', () => {
			const tpl = templateService.create({
				name: 'n', title: '原标题', priority: 'high', tags: ['a'], group: 'g',
				description: 'd', reminderOffset: 10,
			});
			const task = templateService.applyTemplate(tpl.id);
			expect(task.title).toBe('原标题');
			expect(task.priority).toBe('high');
			expect(task.tags).toEqual(['a']);
			expect(task.group).toBe('g');
			expect(task.reminderOffset).toBe(10);
			expect(taskService.getById(task.id)?.title).toBe('原标题');
		});

		it('overrides title/dueDate/tags/group', () => {
			const tpl = templateService.create({ name: 'n', title: 'orig', priority: 'low' });
			const created = templateService.applyTemplate(tpl.id, {
				title: 'new', dueDate: 9999, tags: ['x'], group: 'Y',
			});
			expect(created.title).toBe('new');
			expect(created.dueEnd).toBe(9999);
			expect(created).not.toHaveProperty('dueStart');
			expect(created).not.toHaveProperty('dueDate');
			expect(created.tags).toEqual(['x']);
			expect(created.group).toBe('Y');
		});

		it('throws on missing template', () => {
			expect(() => templateService.applyTemplate('ghost')).toThrow('未找到模板: ghost');
		});

		it('creates flat child tasks with new ids and todo state', () => {
			const tpl = templateService.create({
				name: 'n', title: 't', priority: 'low',
				subtasks: [{ id: 's1', title: '子', completed: true, createdAt: 1, updatedAt: 1 }],
			});
			const task = templateService.applyTemplate(tpl.id);
			expect(task.subtasks).toEqual([]);
			const child = taskService.getAll().find((candidate) => candidate.parentTaskId === task.id)!;
			expect(child.id).not.toBe('s1');
			expect(child.title).toBe('子');
			expect(child.status).toBe('todo');
		});
	});

	describe('rich child drafts and native documents', () => {
		it('clears legacy storage after migrating templates into native documents', () => {
			const db = new MockDocumentDb();
			const legacy = createTemplateFixture({ id: 'legacy-template' });
			dbStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify([legacy]));
			Reflect.set(window, 'utools', { db, dbStorage });

			expect(templateService.list()).toMatchObject([legacy]);
			expect(db.get(`jianyue/template/${legacy.id}`)).toMatchObject({ data: legacy });
			expect(dbStorage.getItem(STORAGE_KEYS.TEMPLATES)).toBeNull();
		});

		it('stores templates in isolated native documents without metadata in the payload', () => {
			const db = new MockDocumentDb();
			Reflect.set(window, 'utools', { db, dbStorage });
			const template = templateService.create({ name: '原生', title: '发布', priority: 'high' });
			const document = db.get(`jianyue/template/${template.id}`);
			expect(document).toMatchObject({ data: template });
			expect(document?.data).not.toHaveProperty('_id');
		});

		it('builds todo drafts with rich child content and no repeat or dates', () => {
			const template = templateService.create({
				name: '发布', title: '发布版本', priority: 'high',
				childTasks: [{ title: '验收', priority: 'medium', tags: ['qa'], group: '研发', description: '执行回归' }],
				repeat: { type: 'daily', interval: 1 },
			});
			const draft = templateService.buildDraft(template.id);
			expect(draft.task).toMatchObject({ title: '发布版本', status: 'todo' });
			expect(draft.task).not.toHaveProperty('repeat');
			expect(draft.task).not.toHaveProperty('dueDate');
			expect(draft.children).toEqual([{
				title: '验收', status: 'todo', priority: 'medium', tags: ['qa'], group: '研发', description: '执行回归', subtasks: [],
			}]);
		});

		it('creates a rich template from a task and its direct children', () => {
			const parent = taskService.create({ title: '发布', status: 'doing', priority: 'high', tags: ['release'], group: '研发', description: '主任务', subtasks: [] });
			const child = taskService.create({ title: '验收', status: 'done', priority: 'medium', tags: ['qa'], group: '测试', description: '回归', subtasks: [], parentTaskId: parent.id });
			const template = templateService.createFromTask('发布流程', parent, [child]);
			expect(template.childTasks).toEqual([{ title: '验收', priority: 'medium', tags: ['qa'], group: '测试', description: '回归' }]);
			expect(template).not.toHaveProperty('repeat');
		});
	});

	describe('persistence round-trip', () => {
		it('reads MCP templates that store children instead of legacy subtasks', () => {
			dbStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify([{
				...createTemplateFixture(),
				subtasks: undefined,
				childTasks: undefined,
				children: ['准备材料'],
			}]));

			expect(templateService.list()[0]).toMatchObject({ children: ['准备材料'], subtasks: [] });
		});

		it('survives re-read while dropping legacy repeat rules', () => {
			templateService.create({
				name: 'n', title: 't', priority: 'medium', tags: ['a', 'b'], group: 'g',
				description: 'd', reminderOffset: 5, repeat: { type: 'daily', interval: 2 },
			});
			// Simulate new instance reading same storage
			const list = templateService.list();
			expect(list).toHaveLength(1);
			expect(list[0]).not.toHaveProperty('repeat');
			expect(list[0]!.reminderOffset).toBe(5);
		});

		it('drops malformed templates on load', () => {
			dbStorage.setItem('jianyue.templates', JSON.stringify([
				{ id: 'bad', name: 'x' }, // missing title/priority
				createTemplateFixture(),
			]));
			expect(templateService.list()).toHaveLength(1);
		});
	});
});
