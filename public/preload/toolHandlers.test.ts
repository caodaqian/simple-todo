import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// toolHandlers.js is a CommonJS module (preload folder has type:commonjs).
// Default import gives us its module.exports via vitest's CJS interop.
import toolHandlers from './toolHandlers.js';

const {
	STORAGE_KEYS,
	STORAGE_KEY,
	SETTINGS_STORAGE_KEY,
	TEMPLATES_STORAGE_KEY,
	SETTINGS_DEFAULTS,
	BULK_UPDATE_MAX,
	readTasksFromDb,
	writeTasksToDb,
	createTaskHandler,
	listTasksHandler,
	completeTaskHandler,
	updateTaskHandler,
	deleteTaskHandler,
	addSubtaskHandler,
	updateSubtaskHandler,
	deleteSubtaskHandler,
	searchTasksHandler,
	taskOverviewHandler,
	listTagsHandler,
	listGroupsHandler,
	exportTasksHandler,
	importTasksHandler,
	getTaskHandler,
	getSettingsHandler,
	renderMarkdownHandler,
	bulkUpdateHandler,
	getReviewHandler,
	notifyHandler,
	createTemplateHandler,
	listTemplatesHandler,
	deleteTemplateHandler,
	applyTemplateHandler,
	setReminderHandler,
	snoozeReminderHandler,
	dismissReminderHandler,
	listDueRemindersHandler,
	normalizeRepeatRule,
	shouldSpawnNextPure,
	buildNextInstancePure,
} = toolHandlers as {
		STORAGE_KEYS: { TASKS: string; SETTINGS: string; TEMPLATES: string; UI_STATE: string; POMODORO: string; STICKY_NOTE: string };
	STORAGE_KEY: string;
	SETTINGS_STORAGE_KEY: string;
	TEMPLATES_STORAGE_KEY: string;
	SETTINGS_DEFAULTS: Record<string, unknown>;
	BULK_UPDATE_MAX: number;
	readTasksFromDb: (db: DbStorage) => unknown[];
	writeTasksToDb: (db: DbStorage, tasks: unknown[]) => void;
	createTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	listTasksHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	completeTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	updateTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	deleteTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	addSubtaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	updateSubtaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	deleteSubtaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	searchTasksHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	taskOverviewHandler: (db: DbStorage, params?: Record<string, unknown>) => unknown;
	listTagsHandler: (db: DbStorage) => unknown;
	listGroupsHandler: (db: DbStorage) => unknown;
	exportTasksHandler: (params: Record<string, unknown>, deps: ExportImportDeps) => unknown;
	importTasksHandler: (params: Record<string, unknown>, deps: ExportImportDeps) => unknown;
	getTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	getSettingsHandler: (settingsDb: DbStorage) => unknown;
	renderMarkdownHandler: (params: Record<string, unknown>, deps: { render: (src: string) => string }) => unknown;
	bulkUpdateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		getReviewHandler: (db: DbStorage) => unknown;
	notifyHandler: (params: Record<string, unknown>, deps: NotifyDeps) => unknown;
	createTemplateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	listTemplatesHandler: (db: DbStorage) => unknown;
	deleteTemplateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	applyTemplateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	setReminderHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	snoozeReminderHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	dismissReminderHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
	listDueRemindersHandler: (db: DbStorage, params?: Record<string, unknown>) => unknown;
	normalizeRepeatRule: (value: unknown) => unknown;
	shouldSpawnNextPure: (task: Record<string, unknown>, now?: number) => boolean;
	buildNextInstancePure: (task: Record<string, unknown>, now?: number) => Record<string, unknown>;
};

interface ExportImportDeps {
	fs: {
		writeFileSync(filePath: string, content: string, opts?: { encoding?: string }): void;
		readFileSync(filePath: string, opts?: { encoding?: string }): string;
	};
	path: { join(...segments: string[]): string };
	downloadsDir?: string;
	readTasks: () => unknown[];
	saveTasks?: (tasks: unknown[]) => void;
}

interface NotifyDeps {
	showNotification: (body: string, featureName?: string) => void;
	settingsDb: DbStorage;
}

interface DbStorage {
	getItem(key: string): unknown;
	setItem(key: string, value: string): void;
}

function createDb(): DbStorage & { snapshot: () => unknown[] } {
	const store = new Map<string, string>();
	const db: DbStorage = {
		getItem(key: string) {
			return store.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			store.set(key, value);
		},
	};
	return Object.assign(db, {
		snapshot() {
			return readTasksFromDb(db);
		},
	});
}

function seedTask(db: DbStorage, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = Date.now();
	const task = {
		id: 'seed-' + Math.random().toString(36).slice(2, 8),
		title: '种子任务',
		status: 'todo',
		priority: 'medium',
		tags: [] as string[],
		group: '',
		description: '',
		subtasks: [],
		visible: true,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
	const tasks = readTasksFromDb(db);
	tasks.push(task);
	writeTasksToDb(db, tasks);
	return task;
}

describe('toolHandlers – pure logic', () => {
	let db: ReturnType<typeof createDb>;

	beforeEach(() => {
		db = createDb();
	});

	describe('readTasksFromDb / writeTasksToDb', () => {
		it('returns empty array when storage empty', () => {
			expect(readTasksFromDb(db)).toEqual([]);
		});

		it('returns empty array when storage does not contain an array', () => {
			db.setItem(STORAGE_KEY, JSON.stringify({ id: 'not-an-array' }));
			expect(readTasksFromDb(db)).toEqual([]);
		});

		it('returns empty array when storage contains invalid JSON', () => {
			db.setItem(STORAGE_KEY, '{not json');
			expect(readTasksFromDb(db)).toEqual([]);
		});

		it('round-trips tasks through storage', () => {
			writeTasksToDb(db, [{ id: 'x', title: 'X' }]);
			expect(readTasksFromDb(db)).toEqual([{ id: 'x', title: 'X' }]);
		});
	});

	describe('todo_create_task', () => {
		it('throws on empty title', () => {
			expect(() => createTaskHandler(db, { title: '' })).toThrow('任务标题不能为空');
			expect(() => createTaskHandler(db, { title: '   ' })).toThrow('任务标题不能为空');
			expect(() => createTaskHandler(db, {})).toThrow('任务标题不能为空');
		});

		it('creates a task and writes to dbStorage', () => {
			const result = createTaskHandler(db, {
				title: '买牛奶',
				priority: 'high',
				tags: ['生活'],
				group: '购物',
				description: '描述',
				due_date: '2026-06-10T18:00:00+08:00',
			}) as { id: string; title: string; status: string };

			expect(result.title).toBe('买牛奶');
			expect(result.status).toBe('todo');
			expect(result.id).toBeTruthy();

			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored).toHaveLength(1);
			expect(stored[0]!.title).toBe('买牛奶');
			expect(stored[0]!.priority).toBe('high');
			expect(stored[0]!.tags).toEqual(['生活']);
			expect(stored[0]!.dueEnd).toBe(new Date('2026-06-10T18:00:00+08:00').getTime());
			expect(stored[0]).not.toHaveProperty('dueStart');
			expect(stored[0]).not.toHaveProperty('dueDate');
		});

		it('omits dueStart when not provided', () => {
			createTaskHandler(db, { title: '无截止' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored[0]).not.toHaveProperty('dueStart');
		});

		it('treats null optional schedule fields as omitted', () => {
			createTaskHandler(db, {
				title: '无时间任务',
				due_start: null,
				due_end: null,
				all_day: null,
				repeat: null,
			} as Record<string, unknown>);

			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored[0]).not.toHaveProperty('dueStart');
			expect(stored[0]).not.toHaveProperty('dueEnd');
			expect(stored[0]).not.toHaveProperty('allDay');
			expect(stored[0]).not.toHaveProperty('repeat');
		});

		it('defaults priority to medium and tags to empty array', () => {
			createTaskHandler(db, { title: '默认值' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored[0]!.priority).toBe('medium');
			expect(stored[0]!.tags).toEqual([]);
		});

		it('creates a child task when parent_task_id is provided', () => {
			seedTask(db, { id: 'parent', title: '父任务' });
			const result = createTaskHandler(db, { title: '子任务', parent_task_id: 'parent' }) as { parent_task_id?: string };

			expect(result.parent_task_id).toBe('parent');
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored.find(t => t.title === '子任务')!.parentTaskId).toBe('parent');
		});

		it('throws when parent_task_id does not exist', () => {
			expect(() => createTaskHandler(db, { title: '子任务', parent_task_id: 'missing' })).toThrow('未找到父任务: missing');
		});
	});

	describe('todo_list_tasks', () => {
		beforeEach(() => {
			seedTask(db, { id: 't1', title: '写文档', status: 'todo', priority: 'high', tags: ['work'] });
			seedTask(db, { id: 't2', title: '跑步', status: 'doing', priority: 'low', tags: ['health'] });
			seedTask(db, { id: 't3', title: '买菜', status: 'done', priority: 'medium', tags: ['life'] });
			seedTask(db, { id: 't4', title: 'review PR', status: 'todo', priority: 'medium', tags: ['work'], description: '描述' });
		});

		it('returns all by default limited to 20', () => {
			const result = listTasksHandler(db, {}) as { tasks: unknown[]; total: number };
			expect(result.total).toBe(4);
			expect(result.tasks).toHaveLength(4);
		});

		it('filters by status', () => {
			const result = listTasksHandler(db, { status: 'todo' }) as { tasks: Array<Record<string, unknown>>; total: number };
			expect(result.total).toBe(2);
			expect(result.tasks.every(t => t.status === 'todo')).toBe(true);
		});

		it('filters by priority', () => {
			const result = listTasksHandler(db, { priority: 'high' }) as { tasks: Array<Record<string, unknown>>; total: number };
			expect(result.total).toBe(1);
			expect(result.tasks[0]!.id).toBe('t1');
		});

		it('filters by tag', () => {
			const result = listTasksHandler(db, { tag: 'work' }) as { tasks: Array<Record<string, unknown>>; total: number };
			expect(result.total).toBe(2);
		});

		it('filters by keyword (title and description)', () => {
			const byTitle = listTasksHandler(db, { keyword: '文档' }) as { total: number };
			expect(byTitle.total).toBe(1);
			const byDesc = listTasksHandler(db, { keyword: '描述' }) as { total: number };
			expect(byDesc.total).toBe(1);
		});

		it('respects limit', () => {
			const result = listTasksHandler(db, { limit: 2 }) as { tasks: unknown[]; total: number };
			expect(result.tasks).toHaveLength(2);
			expect(result.total).toBe(4);
		});

		it('falls back to default limit 20 when limit invalid', () => {
			const result = listTasksHandler(db, { limit: -1 }) as { tasks: unknown[]; total: number };
			expect(result.tasks).toHaveLength(4);
		});

		it('formats due_date as ISO string', () => {
			const ts = new Date('2026-07-01T10:00:00Z').getTime();
			seedTask(db, { id: 'with-due', title: '带截止', dueDate: ts, parentTaskId: 'p1' });
			const result = listTasksHandler(db, { keyword: '带截止' }) as { tasks: Array<Record<string, unknown>> };
			expect(result.tasks[0]!.due_date).toBe(new Date(ts).toISOString());
			expect(result.tasks[0]!.parent_task_id).toBe('p1');
		});
	});

	describe('todo_complete_task', () => {
		it('throws when task_id missing', () => {
			expect(() => completeTaskHandler(db, {})).toThrow('task_id 不能为空');
		});

		it('throws when task not found', () => {
			expect(() => completeTaskHandler(db, { task_id: 'nope' })).toThrow('未找到任务: nope');
		});

		it('marks status=done and records completion time', () => {
			vi.spyOn(Date, 'now').mockReturnValue(5_000);
			const task = seedTask(db, { id: 'c1', title: '完成我', status: 'todo' });
			const result = completeTaskHandler(db, { task_id: 'c1' }) as { id: string; status: string };
			expect(result.id).toBe('c1');
			expect(result.status).toBe('done');
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const updated = stored.find(t => t.id === task.id);
			expect(updated!.status).toBe('done');
			expect(updated!.completedAt).toBe(5_000);
		});
	});

	describe('todo_get_review', () => {
		it('uses completedAt even when its timestamp is zero', () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));
			seedTask(db, {
				id: 'legacy-completion',
				status: 'done',
				completedAt: 0,
				updatedAt: new Date('2026-07-08T10:00:00Z').getTime(),
			});

			const review = getReviewHandler(db) as { completion_trend: Array<{ date: string; count: number }> };

			expect(review.completion_trend.at(-1)).toEqual({ date: '07-08', count: 0 });
			vi.useRealTimers();
		});
	});

	describe('todo_update_task', () => {
		it('throws when task_id missing', () => {
			expect(() => updateTaskHandler(db, {})).toThrow('task_id 不能为空');
		});

		it('throws when task not found', () => {
			expect(() => updateTaskHandler(db, { task_id: 'missing' })).toThrow('未找到任务: missing');
		});

		it('updates only provided fields', () => {
			seedTask(db, {
				id: 'u1',
				title: '原标题',
				status: 'todo',
				priority: 'low',
				tags: ['a'],
				description: '原描述',
			});
			updateTaskHandler(db, { task_id: 'u1', title: '新标题', priority: 'high' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === 'u1')!;
			expect(t.title).toBe('新标题');
			expect(t.priority).toBe('high');
			expect(t.status).toBe('todo');
			expect(t.tags).toEqual(['a']);
			expect(t.description).toBe('原描述');
		});

		it('ignores null for optional fields without a clear semantic', () => {
			seedTask(db, {
				id: 'u-null',
				title: '原标题',
				status: 'doing',
				priority: 'high',
				tags: ['工作'],
				group: '项目 A',
				description: '原描述',
			});

			updateTaskHandler(db, {
				task_id: 'u-null',
				title: null,
				status: null,
				priority: null,
				tags: null,
				group: null,
				description: null,
			} as Record<string, unknown>);

			const task = (db.snapshot() as Array<Record<string, unknown>>).find((item) => item.id === 'u-null')!;
			expect(task).toMatchObject({
				title: '原标题',
				status: 'doing',
				priority: 'high',
				tags: ['工作'],
				group: '项目 A',
				description: '原描述',
			});
		});

		it('clears completion time when a completed task is reopened', () => {
			seedTask(db, { id: 'reopen', title: '恢复任务', status: 'done', completedAt: 4_000 });
			updateTaskHandler(db, { task_id: 'reopen', status: 'doing' });
			const task = (db.snapshot() as Array<Record<string, unknown>>).find(item => item.id === 'reopen')!;
			expect(task).not.toHaveProperty('completedAt');
		});

		it('rejects invalid status, priority, and tags updates', () => {
			seedTask(db, { id: 'u-invalid', title: '校验' });

			expect(() => updateTaskHandler(db, { task_id: 'u-invalid', status: 'blocked' })).toThrow('任务状态无效');
			expect(() => updateTaskHandler(db, { task_id: 'u-invalid', priority: 'critical' })).toThrow('任务优先级无效');
			expect(() => updateTaskHandler(db, { task_id: 'u-invalid', tags: ['ok', 1] })).toThrow('tags 必须为字符串数组');
		});

		it('migrates due_date input into dueEnd (single-point deadline)', () => {
			seedTask(db, { id: 'u2', title: 't' });
			updateTaskHandler(db, { task_id: 'u2', due_date: '2026-08-01T09:00:00+08:00' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === 'u2')!;
			expect(t.dueEnd).toBe(new Date('2026-08-01T09:00:00+08:00').getTime());
			expect(t).not.toHaveProperty('dueStart');
			expect(t).not.toHaveProperty('dueDate');
		});

		it('removes dueDate when due_date is unparseable', () => {
			seedTask(db, { id: 'u3', title: 't', dueDate: 123 });
			updateTaskHandler(db, { task_id: 'u3', due_date: 'not-a-date' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === 'u3')!;
			expect(t).not.toHaveProperty('dueDate');
		});

		it('migrates a legacy dueDate without clearing it during an unrelated update', () => {
			seedTask(db, { id: 'legacy-deadline', title: '旧任务', dueDate: 123 });
			updateTaskHandler(db, { task_id: 'legacy-deadline', title: '新标题' });
			const task = (db.snapshot() as Array<Record<string, unknown>>).find((item) => item.id === 'legacy-deadline')!;
			expect(task.dueEnd).toBe(123);
			expect(task).not.toHaveProperty('dueStart');
			expect(task).not.toHaveProperty('dueDate');
		});

		it('sets and clears parent_task_id', () => {
			seedTask(db, { id: 'parent', title: '父' });
			seedTask(db, { id: 'child', title: '子' });

			const set = updateTaskHandler(db, { task_id: 'child', parent_task_id: 'parent' }) as { parent_task_id?: string };
			expect(set.parent_task_id).toBe('parent');
			expect((db.snapshot() as Array<Record<string, unknown>>).find(t => t.id === 'child')!.parentTaskId).toBe('parent');

			const cleared = updateTaskHandler(db, { task_id: 'child', parent_task_id: null }) as { parent_task_id?: string };
			expect(cleared.parent_task_id).toBeUndefined();
			expect((db.snapshot() as Array<Record<string, unknown>>).find(t => t.id === 'child')).not.toHaveProperty('parentTaskId');
		});

		it('rejects invalid parent_task_id updates', () => {
			seedTask(db, { id: 'parent', title: '父' });
			seedTask(db, { id: 'child', title: '子', parentTaskId: 'parent' });

			expect(() => updateTaskHandler(db, { task_id: 'parent', parent_task_id: 'parent' })).toThrow('任务不能设置自己为父任务');
			expect(() => updateTaskHandler(db, { task_id: 'parent', parent_task_id: 'child' })).toThrow('循环');
			expect(() => updateTaskHandler(db, { task_id: 'child', parent_task_id: 'missing' })).toThrow('未找到父任务: missing');
		});
	});

	describe('todo_delete_task', () => {
		it('throws when task_id missing', () => {
			expect(() => deleteTaskHandler(db, {})).toThrow('task_id 不能为空');
		});

		it('throws when task not found', () => {
			expect(() => deleteTaskHandler(db, { task_id: 'ghost' })).toThrow('未找到任务: ghost');
		});

		it('deletes the matching task and returns deleted: true', () => {
			seedTask(db, { id: 'd1', title: '删我' });
			seedTask(db, { id: 'd2', title: '保留' });
			const result = deleteTaskHandler(db, { task_id: 'd1' }) as { deleted: boolean };
			expect(result.deleted).toBe(true);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored.map(t => t.id)).toEqual(['d2']);
		});

		it('deletes direct child tasks when deleting a parent task', () => {
			seedTask(db, { id: 'parent', title: '父' });
			seedTask(db, { id: 'child', title: '子', parentTaskId: 'parent' });
			seedTask(db, { id: 'other', title: '其它' });

			deleteTaskHandler(db, { task_id: 'parent' });

			expect((db.snapshot() as Array<Record<string, unknown>>).map(t => t.id)).toEqual(['other']);
		});
	});

	describe('todo_add_subtask', () => {
		it('throws when task_id missing', () => {
			expect(() => addSubtaskHandler(db, { title: 'x' })).toThrow('task_id 不能为空');
		});

		it('throws when title empty', () => {
			seedTask(db, { id: 'p1', title: '父' });
			expect(() => addSubtaskHandler(db, { task_id: 'p1', title: '' })).toThrow('子任务标题不能为空');
			expect(() => addSubtaskHandler(db, { task_id: 'p1', title: '   ' })).toThrow('子任务标题不能为空');
		});

		it('throws when parent task not found', () => {
			expect(() => addSubtaskHandler(db, { task_id: 'nope', title: '子' })).toThrow('未找到任务: nope');
		});

		it('creates a full child task with completed=false compatibility fields', () => {
			seedTask(db, { id: 'p1', title: '父', subtasks: [] });
			const result = addSubtaskHandler(db, { task_id: 'p1', title: '买牛奶' }) as {
				task_id: string; subtask_id: string; title: string; completed: boolean; status: string; parent_task_id: string;
			};
			expect(result.task_id).toBe('p1');
			expect(result.subtask_id).toBeTruthy();
			expect(result.title).toBe('买牛奶');
			expect(result.completed).toBe(false);
			expect(result.status).toBe('todo');
			expect(result.parent_task_id).toBe('p1');
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored).toHaveLength(2);
			const child = stored.find(t => t.id === result.subtask_id)!;
			expect(child.title).toBe('买牛奶');
			expect(child.status).toBe('todo');
			expect(child.parentTaskId).toBe('p1');
		});
	});

	describe('todo_update_subtask', () => {
		beforeEach(() => {
			seedTask(db, { id: 'p1', title: '父', subtasks: [] });
			seedTask(db, { id: 's1', title: '旧标题', status: 'todo', priority: 'medium', parentTaskId: 'p1' });
		});

		it('throws when task_id or subtask_id missing', () => {
			expect(() => updateSubtaskHandler(db, { subtask_id: 's1', completed: true })).toThrow('task_id 不能为空');
			expect(() => updateSubtaskHandler(db, { task_id: 'p1', completed: true })).toThrow('subtask_id 不能为空');
		});

		it('throws when neither completed nor title provided', () => {
			expect(() => updateSubtaskHandler(db, { task_id: 'p1', subtask_id: 's1' })).toThrow('至少需要提供');
		});

		it('throws when subtask not found', () => {
			expect(() => updateSubtaskHandler(db, { task_id: 'p1', subtask_id: 'ghost', completed: true })).toThrow('未找到子任务: ghost');
		});

		it('toggles completed', () => {
			const r = updateSubtaskHandler(db, { task_id: 'p1', subtask_id: 's1', completed: true }) as {
				completed: boolean; title: string; status: string;
			};
			expect(r.completed).toBe(true);
			expect(r.status).toBe('done');
			expect(r.title).toBe('旧标题');
		});

		it('renames title', () => {
			const r = updateSubtaskHandler(db, { task_id: 'p1', subtask_id: 's1', title: '新标题' }) as {
				completed: boolean; title: string;
			};
			expect(r.title).toBe('新标题');
			expect(r.completed).toBe(false);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const sub = stored.find(t => t.id === 's1')!;
			expect(sub.title).toBe('新标题');
		});

		it('updates full child task fields', () => {
			const due = '2026-07-10T10:00:00Z';
			const r = updateSubtaskHandler(db, {
				task_id: 'p1',
				subtask_id: 's1',
				status: 'doing',
				priority: 'urgent',
				due_date: due,
				tags: ['work'],
				group: 'G',
				description: '详情',
			}) as { status: string; priority: string };

			expect(r.status).toBe('doing');
			expect(r.priority).toBe('urgent');
			const sub = (db.snapshot() as Array<Record<string, unknown>>).find(t => t.id === 's1')!;
			expect(sub.dueDate).toBe(new Date(due).getTime());
			expect(sub.tags).toEqual(['work']);
			expect(sub.group).toBe('G');
			expect(sub.description).toBe('详情');
		});

		it('throws when title is empty string', () => {
			expect(() => updateSubtaskHandler(db, { task_id: 'p1', subtask_id: 's1', title: '  ' })).toThrow('子任务标题不能为空');
		});
	});

	describe('todo_delete_subtask', () => {
		beforeEach(() => {
			seedTask(db, { id: 'p1', title: '父', subtasks: [] });
			seedTask(db, { id: 's1', title: 'a', parentTaskId: 'p1' });
			seedTask(db, { id: 's2', title: 'b', parentTaskId: 'p1' });
		});

		it('throws when ids missing', () => {
			expect(() => deleteSubtaskHandler(db, { subtask_id: 's1' })).toThrow('task_id 不能为空');
			expect(() => deleteSubtaskHandler(db, { task_id: 'p1' })).toThrow('subtask_id 不能为空');
		});

		it('throws when subtask not found', () => {
			expect(() => deleteSubtaskHandler(db, { task_id: 'p1', subtask_id: 'ghost' })).toThrow('未找到子任务: ghost');
		});

		it('removes the subtask and returns deleted: true', () => {
			const r = deleteSubtaskHandler(db, { task_id: 'p1', subtask_id: 's1' }) as { deleted: boolean };
			expect(r.deleted).toBe(true);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored.map(s => s.id)).toEqual(['p1', 's2']);
		});
	});

	describe('todo_search_tasks', () => {
		beforeEach(() => {
			seedTask(db, { id: 't1', title: '写文档', status: 'todo', priority: 'high', tags: ['work', 'doc'], group: 'A', dueDate: new Date('2026-07-01T10:00:00Z').getTime() });
			seedTask(db, { id: 't2', title: '跑步', status: 'doing', priority: 'low', tags: ['health'], group: 'B' });
			seedTask(db, { id: 't3', title: 'review', status: 'done', priority: 'medium', tags: ['work'], group: 'A', description: 'desc here' });
		});

		it('returns all with default limit 50 and offset 0', () => {
			const r = searchTasksHandler(db, {}) as { tasks: unknown[]; total: number; limit: number; offset: number };
			expect(r.total).toBe(3);
			expect(r.tasks).toHaveLength(3);
			expect(r.limit).toBe(50);
			expect(r.offset).toBe(0);
		});

		it('filters by status array', () => {
			const r = searchTasksHandler(db, { status: ['todo', 'doing'] }) as { total: number };
			expect(r.total).toBe(2);
		});

		it('filters by priority array', () => {
			const r = searchTasksHandler(db, { priority: ['high', 'low'] }) as { total: number };
			expect(r.total).toBe(2);
		});

		it('excludes completed when show_completed=false', () => {
			const r = searchTasksHandler(db, { show_completed: false }) as { tasks: Array<Record<string, unknown>> };
			expect(r.tasks.map(t => t.status)).not.toContain('done');
			expect(r).toMatchObject({ total: 2 });
		});

		it('filters by group', () => {
			const r = searchTasksHandler(db, { group: 'A' }) as { total: number };
			expect(r.total).toBe(2);
		});

		it('tag_match_mode=any matches any tag', () => {
			const r = searchTasksHandler(db, { tags: ['work', 'health'], tag_match_mode: 'any' }) as { total: number };
			expect(r.total).toBe(3);
		});

		it('tag_match_mode=all requires all tags', () => {
			const r = searchTasksHandler(db, { tags: ['work', 'doc'], tag_match_mode: 'all' }) as { total: number };
			expect(r.total).toBe(1);
			const r2 = searchTasksHandler(db, { tags: ['work'], tag_match_mode: 'all' }) as { total: number };
			expect(r2.total).toBe(2);
		});

		it('filters by keyword in title or description', () => {
			const r1 = searchTasksHandler(db, { keyword: '文档' }) as { total: number };
			expect(r1.total).toBe(1);
			const r2 = searchTasksHandler(db, { keyword: 'desc' }) as { total: number };
			expect(r2.total).toBe(1);
		});

		it('filters by due_after and due_before', () => {
			const after = '2026-06-01T00:00:00Z';
			const before = '2026-08-01T00:00:00Z';
			const r = searchTasksHandler(db, { due_after: after, due_before: before }) as { total: number };
			expect(r.total).toBe(1);
		});

		it('include_no_due includes tasks without dueDate in date filter', () => {
			const after = '2026-06-01T00:00:00Z';
			const r1 = searchTasksHandler(db, { due_after: after }) as { total: number };
			expect(r1.total).toBe(1);
			const r2 = searchTasksHandler(db, { due_after: after, include_no_due: true }) as { total: number };
			expect(r2.total).toBe(3);
		});

		it('sorts by priority desc (high first)', () => {
			const r = searchTasksHandler(db, { sort_by: 'priority', sort_order: 'desc' }) as { tasks: Array<Record<string, unknown>> };
			expect(r.tasks[0]!.priority).toBe('high');
		});

		it('paginates with limit and offset', () => {
			const page1 = searchTasksHandler(db, { limit: 2, offset: 0, sort_by: 'createdAt', sort_order: 'asc' }) as { tasks: Array<Record<string, unknown>>; total: number };
			const page2 = searchTasksHandler(db, { limit: 2, offset: 2, sort_by: 'createdAt', sort_order: 'asc' }) as { tasks: Array<Record<string, unknown>>; total: number };
			expect(page1.tasks).toHaveLength(2);
			expect(page2.tasks).toHaveLength(1);
			expect(page1.tasks[0]!.id).not.toBe(page2.tasks[0]!.id);
		});

		it('includes group and description in returned task shape', () => {
			const r = searchTasksHandler(db, { keyword: 'review' }) as { tasks: Array<Record<string, unknown>> };
			expect(r.tasks[0]!.group).toBe('A');
			expect(r.tasks[0]!.description).toBe('desc here');
		});

		it('includes direct child task summaries with IDs on parent results', () => {
			seedTask(db, { id: 'parent', title: '父任务' });
			seedTask(db, { id: 'child', title: '子任务', status: 'doing', priority: 'high', parentTaskId: 'parent' });

			const result = searchTasksHandler(db, { keyword: '父任务' }) as {
				tasks: Array<{ id: string; subtasks: Array<Record<string, unknown>> }>;
			};

			expect(result.tasks).toEqual([
				expect.objectContaining({
					id: 'parent',
					subtasks: [expect.objectContaining({ id: 'child', title: '子任务', status: 'doing', priority: 'high' })],
				}),
			]);
		});
	});

	describe('todo_get_overview', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-05T12:00:00+08:00'));
			const now = Date.now();
			const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
			// 明日凌晨，确保晚于当前时间避免被算作逾期
			const tomorrowStart = todayStart.getTime() + 24 * 3600 * 1000;
			seedTask(db, { id: 'o1', title: '逾期', status: 'todo', priority: 'high', dueDate: now - 100000 });
			seedTask(db, { id: 'o2', title: '明日', status: 'doing', priority: 'medium', dueDate: tomorrowStart });
			seedTask(db, { id: 'o3', title: '无截止', status: 'done', priority: 'low' });
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('returns total and distributions', () => {
			const r = taskOverviewHandler(db) as {
				total: number; byStatus: Record<string, number>; byPriority: Record<string, number>;
				overdue: number; dueToday: number; noDueDate: number;
			};
			expect(r.total).toBe(3);
			expect(r.byStatus).toEqual({ todo: 1, doing: 1, done: 1 });
			expect(r.byPriority).toEqual({ low: 1, medium: 1, high: 1, urgent: 0 });
			// 产品逾期口径为结束时间早于今日开始；同日已过时不算跨日逾期。
			expect(r.overdue).toBe(0);
			expect(r.dueToday).toBe(1);
			expect(r.noDueDate).toBe(1);
		});

		it('scopes by group when provided', () => {
			seedTask(db, { id: 'g1', title: 'A组任务', status: 'todo', priority: 'high', group: 'A' });
			const r = taskOverviewHandler(db, { group: 'A' }) as { total: number };
			expect(r.total).toBe(1);
		});

		it('counts overdue only for non-done tasks', () => {
			const now = Date.now();
			seedTask(db, { id: 'done-late', title: '已完成但逾期', status: 'done', priority: 'low', dueDate: now - 100000 });
			const r = taskOverviewHandler(db) as { overdue: number };
			expect(r.overdue).toBe(0);
		});

		it('returns zeros on empty store', () => {
			const r = taskOverviewHandler(db) as { total: number; overdue: number };
			// re-create empty db
			const empty = createDb();
			const e = taskOverviewHandler(empty) as { total: number; overdue: number };
			expect(e.total).toBe(0);
			expect(e.overdue).toBe(0);
			void r;
		});
	});

	describe('todo_list_tags', () => {
		it('aggregates tags with counts sorted desc', () => {
			seedTask(db, { id: 'a', title: 'a', tags: ['work', 'x'] });
			seedTask(db, { id: 'b', title: 'b', tags: ['work'] });
			seedTask(db, { id: 'c', title: 'c', tags: ['health'] });
			const r = listTagsHandler(db) as { tags: Array<{ name: string; count: number }> };
			// count desc; ties broken by name asc (health < x)
			expect(r.tags.map(t => t.name)).toEqual(['work', 'health', 'x']);
			expect(r.tags[0]!.count).toBe(2);
			expect(r.tags[1]!.count).toBe(1);
		});

		it('returns empty on empty store', () => {
			const r = listTagsHandler(db) as { tags: unknown[] };
			expect(r.tags).toEqual([]);
		});
	});

	describe('todo_list_groups', () => {
		it('aggregates non-empty groups with counts sorted desc', () => {
			seedTask(db, { id: 'a', title: 'a', group: 'A' });
			seedTask(db, { id: 'b', title: 'b', group: 'A' });
			seedTask(db, { id: 'c', title: 'c', group: 'B' });
			seedTask(db, { id: 'd', title: 'd', group: '' });
			const r = listGroupsHandler(db) as { groups: Array<{ name: string; count: number }> };
			expect(r.groups.map(g => g.name)).toEqual(['A', 'B']);
			expect(r.groups[0]!.count).toBe(2);
		});
	});

	describe('todo_export_tasks', () => {
		it('writes JSON to downloads dir and returns filePath and count', () => {
			seedTask(db, { id: 'e1', title: '导出' });
			seedTask(db, { id: 'e2', title: '我' });
			let writtenPath: string | null = null;
			let writtenContent: string | null = null;
			const deps: ExportImportDeps = {
				fs: {
					writeFileSync(filePath: string, content: string, opts?: { encoding?: string }) {
						writtenPath = filePath;
						writtenContent = content;
						void opts;
					},
					readFileSync() { return ''; },
				},
				path: { join(...segs: string[]) { return segs.join('/'); } },
				downloadsDir: '/tmp/dl',
				readTasks() { return readTasksFromDb(db); },
			};
			const r = exportTasksHandler({ file_name: 'my.json' }, deps) as { filePath: string; count: number };
			expect(r.count).toBe(2);
			expect(writtenPath).toBe('/tmp/dl/my.json');
			expect(writtenContent).toContain('导出');
		});

		it('uses default timestamped filename when not provided', () => {
			let writtenPath = '';
			const deps: ExportImportDeps = {
				fs: {
					writeFileSync(filePath: string) { writtenPath = filePath; },
					readFileSync() { return ''; },
				},
				path: { join(...segs: string[]) { return segs.join('/'); } },
				downloadsDir: '/tmp/dl',
				readTasks() { return readTasksFromDb(db); },
			};
			exportTasksHandler({}, deps);
			expect(writtenPath).toMatch(/^\/tmp\/dl\/jianyue-tasks-\d+\.json$/);
		});
	});

	describe('todo_import_tasks', () => {
		it('throws when file_path missing', () => {
			const deps: ExportImportDeps = {
				fs: { writeFileSync() { }, readFileSync() { return '[]'; } },
				path: { join: () => '' },
				readTasks() { return []; },
				saveTasks() { },
			};
			expect(() => importTasksHandler({}, deps)).toThrow('file_path 不能为空');
		});

		it('throws on read failure', () => {
			const deps: ExportImportDeps = {
				fs: {
					writeFileSync() { },
					readFileSync() { throw new Error('ENOENT'); },
				},
				path: { join: () => '' },
				readTasks() { return []; },
				saveTasks() { },
			};
			expect(() => importTasksHandler({ file_path: '/x.json' }, deps)).toThrow('读取文件失败');
		});

		it('throws on invalid JSON', () => {
			const deps: ExportImportDeps = {
				fs: { writeFileSync() { }, readFileSync() { return '{not json'; } },
				path: { join: () => '' },
				readTasks() { return []; },
				saveTasks() { },
			};
			expect(() => importTasksHandler({ file_path: '/x.json' }, deps)).toThrow('合法 JSON');
		});

		it('throws when payload is not an array', () => {
			const deps: ExportImportDeps = {
				fs: { writeFileSync() { }, readFileSync() { return '{"a":1}'; } },
				path: { join: () => '' },
				readTasks() { return []; },
				saveTasks() { },
			};
			expect(() => importTasksHandler({ file_path: '/x.json' }, deps)).toThrow('JSON 数组');
		});

		it('merges by id, skips duplicates, counts invalid', () => {
			seedTask(db, { id: 'exist', title: '已存在' });
			let saved: unknown[] | null = null;
			const deps: ExportImportDeps = {
				fs: {
					writeFileSync() { },
					readFileSync() {
						return JSON.stringify([
							{ id: 'new1', title: '新' },
							{ id: 'exist', title: '重复' },
							{ id: '', title: '空id' },
							{ not_id: 'x' },
						]);
					},
				},
				path: { join: () => '' },
				readTasks() { return readTasksFromDb(db); },
				saveTasks(tasks: unknown[]) { saved = tasks; },
			};
			const r = importTasksHandler({ file_path: '/x.json' }, deps) as { added: number; total: number; invalid: number };
			expect(r.added).toBe(1);
			expect(r.total).toBe(2);
			expect(r.invalid).toBe(2);
			expect((saved as unknown[])).toHaveLength(2);
		});
	});

	describe('todo_get_task', () => {
		it('throws when task_id missing', () => {
			expect(() => getTaskHandler(db, {})).toThrow('task_id 不能为空');
		});

		it('throws when not found', () => {
			expect(() => getTaskHandler(db, { task_id: 'ghost' })).toThrow('未找到任务: ghost');
		});

		it('returns full detail with timestamps while omitting legacy nested subtasks', () => {
			seedTask(db, {
				id: 'full', title: '完整', status: 'doing', priority: 'high',
				tags: ['t1'], group: 'G', description: '# 标题',
				subtasks: [{ id: 's1', title: '子', completed: true, createdAt: 1000, updatedAt: 2000 }],
				createdAt: 1000, updatedAt: 2000,
			});
			const r = getTaskHandler(db, { task_id: 'full' }) as Record<string, unknown>;
			expect(r.id).toBe('full');
			expect(r.description).toBe('# 标题');
			expect(r.group).toBe('G');
			expect(r.tags).toEqual(['t1']);
			expect(r).not.toHaveProperty('subtasks');
			expect(r.created_at).toBe(new Date(1000).toISOString());
		});

		it('returns parent_task_id and direct children', () => {
			seedTask(db, { id: 'parent', title: '父', status: 'todo', priority: 'high' });
			seedTask(db, { id: 'child', title: '子', status: 'doing', priority: 'urgent', parentTaskId: 'parent' });

			const parent = getTaskHandler(db, { task_id: 'parent' }) as Record<string, unknown>;
			const children = parent.children as Array<Record<string, unknown>>;
			expect(children).toHaveLength(1);
			expect(children[0]).toMatchObject({ id: 'child', title: '子', status: 'doing', priority: 'urgent' });

			const child = getTaskHandler(db, { task_id: 'child' }) as Record<string, unknown>;
			expect(child.parent_task_id).toBe('parent');
		});
	});

	describe('todo_get_settings', () => {
		it('returns defaults when settings empty', () => {
			const r = getSettingsHandler(db) as Record<string, unknown>;
			expect(r).toMatchObject(SETTINGS_DEFAULTS);
		});

		it('returns saved settings with fallback for invalid values', () => {
			db.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
				appearanceMode: 'dark',
				accentColor: 'red',
				showCompleted: true,
				defaultView: 'kanban',
				notifyEnabled: false,
				pomodoroMinutes: 55,
			}));
			const r = getSettingsHandler(db) as Record<string, unknown>;
			expect(r.appearanceMode).toBe('dark');
			expect(r.defaultView).toBe('kanban');
			expect(r.notifyEnabled).toBe(false);
			expect(r.pomodoroMinutes).toBe(55);
		});

		it('falls back to defaults for invalid enum values', () => {
			db.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
				appearanceMode: 'neon',
				defaultView: 'inbox',
				notifyEnabled: 'yes',
			}));
			const r = getSettingsHandler(db) as Record<string, unknown>;
			expect(r.appearanceMode).toBe(SETTINGS_DEFAULTS.appearanceMode);
			expect(r.defaultView).toBe(SETTINGS_DEFAULTS.defaultView);
			expect(r.notifyEnabled).toBe(SETTINGS_DEFAULTS.notifyEnabled);
			expect(r.pomodoroMinutes).toBe(SETTINGS_DEFAULTS.pomodoroMinutes);
		});

		it('falls back to default pomodoro duration when invalid', () => {
			db.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ pomodoroMinutes: 0 }));
			expect((getSettingsHandler(db) as Record<string, unknown>).pomodoroMinutes).toBe(SETTINGS_DEFAULTS.pomodoroMinutes);

			db.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ pomodoroMinutes: 241 }));
			expect((getSettingsHandler(db) as Record<string, unknown>).pomodoroMinutes).toBe(SETTINGS_DEFAULTS.pomodoroMinutes);
		});
	});

	describe('todo_render_markdown', () => {
		it('throws when markdown missing', () => {
			expect(() => renderMarkdownHandler({}, { render: () => '' })).toThrow('markdown 不能为空');
		});

		it('throws when render not injected', () => {
			expect(() => renderMarkdownHandler({ markdown: '# hi' }, {} as { render: (s: string) => string })).toThrow('marked 渲染器未注入');
		});

		it('returns html from injected renderer', () => {
			const deps = { render: (src: string) => '<h1>' + src + '</h1>' };
			const r = renderMarkdownHandler({ markdown: '# hi' }, deps) as { html: string };
			expect(r.html).toBe('<h1># hi</h1>');
		});
	});

	describe('todo_bulk_update', () => {
		beforeEach(() => {
			seedTask(db, { id: 'b1', title: 'a', status: 'todo', priority: 'low', group: 'X' });
			seedTask(db, { id: 'b2', title: 'b', status: 'todo', priority: 'low', group: 'X' });
			seedTask(db, { id: 'b3', title: 'c', status: 'todo', priority: 'low', group: 'Y' });
		});

		it('throws when task_ids empty', () => {
			expect(() => bulkUpdateHandler(db, { task_ids: [] })).toThrow('task_ids 不能为空');
		});

		it('throws when no update field provided', () => {
			expect(() => bulkUpdateHandler(db, { task_ids: ['b1'] })).toThrow('至少需要提供');
		});

		it('throws when exceeding max', () => {
			const ids = Array.from({ length: BULK_UPDATE_MAX + 1 }, (_, i) => 'id' + i);
			expect(() => bulkUpdateHandler(db, { task_ids: ids, status: 'done' })).toThrow('单次最多更新 ' + BULK_UPDATE_MAX);
		});

		it('updates matching tasks and reports not_found', () => {
			const r = bulkUpdateHandler(db, { task_ids: ['b1', 'b2', 'ghost'], status: 'doing', group: 'Z' }) as { updated: number; not_found: string[] };
			expect(r.updated).toBe(2);
			expect(r.not_found).toEqual(['ghost']);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const b1 = stored.find(t => t.id === 'b1')!;
			expect(b1.status).toBe('doing');
			expect(b1.group).toBe('Z');
		});

		it('does not write when no matching tasks', () => {
			const r = bulkUpdateHandler(db, { task_ids: ['ghost1', 'ghost2'], status: 'done' }) as { updated: number; not_found: string[] };
			expect(r.updated).toBe(0);
			expect(r.not_found).toEqual(['ghost1', 'ghost2']);
		});
	});

	describe('todo_notify', () => {
		it('throws when title empty', () => {
			const deps: NotifyDeps = { showNotification: () => { }, settingsDb: db };
			expect(() => notifyHandler({ title: '' }, deps)).toThrow('title 不能为空');
		});

		it('returns notified:false when notifyEnabled is false', () => {
			db.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ notifyEnabled: false }));
			let called = false;
			const deps: NotifyDeps = {
				showNotification() { called = true; },
				settingsDb: db,
			};
			const r = notifyHandler({ title: 'hi' }, deps) as { notified: boolean; reason?: string };
			expect(r.notified).toBe(false);
			expect(r.reason).toBe('通知已关闭');
			expect(called).toBe(false);
		});

		it('calls showNotification when notifyEnabled is true', () => {
			db.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ notifyEnabled: true }));
			let payload: { body: string; featureName?: string } | null = null;
			const deps: NotifyDeps = {
				showNotification(body, featureName) { payload = { body, featureName }; },
				settingsDb: db,
			};
			const r = notifyHandler({ title: '提醒', body: '正文' }, deps) as { notified: boolean };
			expect(r.notified).toBe(true);
			expect(payload!.body).toBe('提醒：正文');
			expect(payload!.featureName).toBe('todo');
		});

		it('defaults to notifyEnabled=true when settings missing', () => {
			let called = false;
			const deps: NotifyDeps = {
				showNotification() { called = true; },
				settingsDb: db,
			};
			const r = notifyHandler({ title: 'x' }, deps) as { notified: boolean };
			expect(r.notified).toBe(true);
			expect(called).toBe(true);
		});
	});

	describe('todo_create_task with reminder/repeat', () => {
		it('stores reminderOffset when due_date present', () => {
			const r = createTaskHandler(db, {
				title: '提醒任务', due_date: '2026-07-01T10:00:00+08:00', reminder_offset: 30,
			}) as { id: string };
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === r.id)!;
			expect(t.reminderOffset).toBe(30);
		});

		it('throws when reminder_offset set without due_date', () => {
			expect(() => createTaskHandler(db, { title: 'x', reminder_offset: 10 })).toThrow('设置提醒需要先有截止日期');
		});

		it('stores repeat rule', () => {
			createTaskHandler(db, {
				title: '每日站会', due_date: '2026-07-01T09:00:00+08:00',
				repeat: { type: 'daily', interval: 1 },
			});
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored[0]!.repeat).toEqual({ type: 'daily', interval: 1 });
		});

		it('throws on invalid repeat.type', () => {
			expect(() => createTaskHandler(db, { title: 'x', repeat: { type: 'hourly', interval: 1 } })).toThrow('repeat.type');
		});

		it('throws on non-positive repeat.interval', () => {
			expect(() => createTaskHandler(db, { title: 'x', repeat: { type: 'daily', interval: 0 } })).toThrow('repeat.interval');
		});
	});

	describe('todo_complete_task with repeat', () => {
		it('spawns next instance on complete', () => {
			seedTask(db, {
				id: 'rep1', title: '每日站会', status: 'todo',
				dueDate: new Date('2026-07-01T09:00:00Z').getTime(),
				repeat: { type: 'daily', interval: 1, generatedCount: 0 },
			});
			const r = completeTaskHandler(db, { task_id: 'rep1' }) as { id: string; status: string };
			expect(r.status).toBe('done');
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored).toHaveLength(2);
			const next = stored.find(t => t.id !== 'rep1') as Record<string, unknown>;
			expect(next.status).toBe('todo');
			expect(next.dueEnd).toBe(new Date('2026-07-01T09:00:00Z').getTime() + 24 * 3600 * 1000);
			expect(next).not.toHaveProperty('dueStart');
			expect((next.repeat as Record<string, unknown>).generatedCount).toBe(1);
		});

		it('does not spawn when repeatCount reached', () => {
			seedTask(db, {
				id: 'rep2', title: '限次', status: 'todo',
				dueDate: 1000,
				repeat: { type: 'daily', interval: 1, repeatCount: 2, generatedCount: 2 },
			});
			completeTaskHandler(db, { task_id: 'rep2' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored).toHaveLength(1);
		});

		it('does not spawn when repeatUntil exceeded', () => {
			seedTask(db, {
				id: 'rep3', title: '到期停', status: 'todo',
				dueDate: new Date('2026-12-01T00:00:00Z').getTime(),
				repeat: { type: 'daily', interval: 1, repeatUntil: new Date('2026-12-01T12:00:00Z').getTime() },
			});
			completeTaskHandler(db, { task_id: 'rep3' });
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			expect(stored).toHaveLength(1);
		});
	});

	describe('todo_create_template / list / delete / apply', () => {
		it('creates a template and lists it', () => {
			const r = createTemplateHandler(db, {
				name: '站会模板', title: '每日站会', priority: 'high', tags: ['work'],
			}) as { template_id: string };
			expect(r.template_id).toBeTruthy();
			const list = listTemplatesHandler(db) as { templates: Array<Record<string, unknown>> };
			expect(list.templates).toHaveLength(1);
			expect(list.templates[0]!.name).toBe('站会模板');
		});

		it('stores rich child tasks and never persists repeat rules', () => {
			const created = createTemplateHandler(db, {
				name: '发布', title: '发布版本', priority: 'high', repeat: { type: 'weekly', interval: 1 },
				child_tasks: [{ title: '回归测试', priority: 'medium', tags: ['qa'], group: '测试', description: '执行回归' }],
			}) as { template_id: string };
			const template = (listTemplatesHandler(db) as { templates: Array<Record<string, unknown>> }).templates
				.find((item) => item.id === created.template_id)!;
			expect(template.repeat).toBeUndefined();
			expect(template.child_tasks).toEqual([{
				title: '回归测试', priority: 'medium', tags: ['qa'], group: '测试', description: '执行回归',
			}]);
		});

		it('throws on empty name or title', () => {
			expect(() => createTemplateHandler(db, { name: '', title: 'x' })).toThrow('模板名称不能为空');
			expect(() => createTemplateHandler(db, { name: 'n', title: '' })).toThrow('模板标题不能为空');
		});

		it('deletes a template', () => {
			createTemplateHandler(db, { name: 't', title: 'x' });
			const before = (listTemplatesHandler(db) as { templates: unknown[] }).templates.length;
			const list = listTemplatesHandler(db) as { templates: Array<Record<string, unknown>> };
			const id = list.templates[0]!.id as string;
			const r = deleteTemplateHandler(db, { template_id: id }) as { deleted: boolean };
			expect(r.deleted).toBe(true);
			const after = (listTemplatesHandler(db) as { templates: unknown[] }).templates.length;
			expect(after).toBe(before - 1);
		});

		it('throws when deleting missing template', () => {
			expect(() => deleteTemplateHandler(db, { template_id: 'ghost' })).toThrow('未找到模板: ghost');
		});

		it('applyTemplate creates a task from template with overrides', () => {
			const r = createTemplateHandler(db, {
				name: '任务模板', title: '原标题', priority: 'medium', tags: ['a'],
				reminder_offset: 15,
			}) as { template_id: string };
			const applied = applyTemplateHandler(db, {
				template_id: r.template_id,
				title: '新标题',
				due_date: '2026-08-01T10:00:00+08:00',
				tags: ['b', 'c'],
			}) as { task_id: string; title: string };
			expect(applied.title).toBe('新标题');
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const task = stored.find(t => t.id === applied.task_id) as Record<string, unknown>;
			expect(task.tags).toEqual(['b', 'c']);
			expect(task.reminderOffset).toBe(15);
		});

		it('inherits template description and supports overriding the task and child content', () => {
			const r = createTemplateHandler(db, {
				name: '发布模板', title: '发布版本', priority: 'medium', description: '模板说明',
				child_tasks: [{ title: '默认步骤', description: '默认步骤说明' }],
			}) as { template_id: string };

			const inherited = applyTemplateHandler(db, { template_id: r.template_id }) as { task_id: string };
			const overridden = applyTemplateHandler(db, {
				template_id: r.template_id,
				description: '本次发布说明',
				priority: 'high',
				child_tasks: [{ title: '定制步骤', priority: 'urgent', description: '本次执行说明' }],
			}) as { task_id: string };

			const tasks = db.snapshot() as Array<Record<string, unknown>>;
			const inheritedTask = tasks.find((task) => task.id === inherited.task_id)!;
			const overriddenTask = tasks.find((task) => task.id === overridden.task_id)!;
			expect(inheritedTask.description).toBe('模板说明');
			expect(inheritedTask.priority).toBe('medium');
			expect(overriddenTask.description).toBe('本次发布说明');
			expect(overriddenTask.priority).toBe('high');
			expect(tasks.filter((task) => task.parentTaskId === overridden.task_id)).toMatchObject([
				{ title: '定制步骤', priority: 'urgent', description: '本次执行说明', status: 'todo' },
			]);
		});

		it('allows an empty description override to clear the template description', () => {
			const r = createTemplateHandler(db, { name: '模板', title: '任务', description: '默认说明' }) as { template_id: string };
			const applied = applyTemplateHandler(db, { template_id: r.template_id, description: '' }) as { task_id: string };
			const task = (db.snapshot() as Array<Record<string, unknown>>).find((item) => item.id === applied.task_id)!;
			expect(task.description).toBe('');
		});

		it('treats null optional template schedule overrides as omitted', () => {
			const created = createTemplateHandler(db, { name: '无时间模板', title: '模板任务' }) as { template_id: string };

			applyTemplateHandler(db, {
				template_id: created.template_id,
				due_start: null,
				due_end: null,
				all_day: null,
			} as Record<string, unknown>);

			const task = (db.snapshot() as Array<Record<string, unknown>>)[0]!;
			expect(task).not.toHaveProperty('dueStart');
			expect(task).not.toHaveProperty('dueEnd');
			expect(task).not.toHaveProperty('allDay');
		});

		it('applyTemplate throws on missing template', () => {
			expect(() => applyTemplateHandler(db, { template_id: 'ghost' })).toThrow('未找到模板: ghost');
		});
	});

	describe('todo_set_reminder / snooze / dismiss', () => {
		beforeEach(() => {
			seedTask(db, { id: 'r1', title: '有截止', dueDate: new Date('2026-07-01T10:00:00Z').getTime() });
			seedTask(db, { id: 'r2', title: '无截止' });
		});

		it('set_reminder sets reminderOffset and clears remindedAt', () => {
			seedTask(db, { id: 'r3', title: '已提醒', dueDate: 1000, remindedAt: 2000 });
			const r = setReminderHandler(db, { task_id: 'r3', reminder_offset: 30 }) as { reminder_offset: number };
			expect(r.reminder_offset).toBe(30);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === 'r3')!;
			expect(t.remindedAt).toBeUndefined();
		});

		it('set_reminder throws without due_date', () => {
			expect(() => setReminderHandler(db, { task_id: 'r2', reminder_offset: 10 })).toThrow('设置提醒需要先有截止日期');
		});

		it('set_reminder throws on missing task', () => {
			expect(() => setReminderHandler(db, { task_id: 'ghost', reminder_offset: 0 })).toThrow('未找到任务: ghost');
		});

		it('snooze sets snoozedUntil in future and clears remindedAt', () => {
			seedTask(db, { id: 'r4', title: 's', dueDate: 1000, remindedAt: 2000 });
			const before = Date.now();
			const r = snoozeReminderHandler(db, { task_id: 'r4', minutes: 10 }) as { snoozed_until: string };
			const snoozedTs = new Date(r.snoozed_until).getTime();
			expect(snoozedTs).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 50);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === 'r4')!;
			expect(t.snoozedUntil).toBe(snoozedTs);
			expect(t.remindedAt).toBeUndefined();
		});

		it('snooze throws on non-positive minutes', () => {
			expect(() => snoozeReminderHandler(db, { task_id: 'r1', minutes: 0 })).toThrow('minutes 必须为正数');
		});

		it('dismiss clears reminderOffset/remindedAt/snoozedUntil', () => {
			seedTask(db, { id: 'r5', title: 'd', dueDate: 1000, reminderOffset: 10, remindedAt: 2000, snoozedUntil: 3000 });
			const r = dismissReminderHandler(db, { task_id: 'r5' }) as { dismissed: boolean };
			expect(r.dismissed).toBe(true);
			const stored = db.snapshot() as Array<Record<string, unknown>>;
			const t = stored.find(x => x.id === 'r5')!;
			expect(t.reminderOffset).toBeUndefined();
			expect(t.remindedAt).toBeUndefined();
			expect(t.snoozedUntil).toBeUndefined();
		});
	});

	describe('todo_list_due_reminders', () => {
		beforeEach(() => {
			const now = Date.now();
			seedTask(db, {
				id: 'due1', title: '已到期未提醒', status: 'todo',
				dueDate: now - 10000, reminderOffset: 0,
			});
			seedTask(db, {
				id: 'future1', title: '未来任务', status: 'todo',
				dueDate: now + 10 * 86400 * 1000, reminderOffset: 5,
			});
			seedTask(db, {
				id: 'reminded1', title: '已提醒过', status: 'todo',
				dueDate: now - 10000, reminderOffset: 0, remindedAt: now - 5000,
			});
			seedTask(db, {
				id: 'snoozed1', title: 'snoozed', status: 'todo',
				dueDate: now - 10000, reminderOffset: 0, snoozedUntil: now + 60000,
			});
			seedTask(db, {
				id: 'done1', title: '已完成', status: 'done',
				dueDate: now - 10000, reminderOffset: 0,
			});
		});

		it('returns due unreminded tasks excluding snoozed/done/reminded', () => {
			const r = listDueRemindersHandler(db, {}) as { reminders: Array<Record<string, unknown>>; total: number };
			const ids = r.reminders.map(x => x.id);
			expect(ids).toContain('due1');
			expect(ids).not.toContain('future1');
			expect(ids).not.toContain('reminded1');
			expect(ids).not.toContain('snoozed1');
			expect(ids).not.toContain('done1');
		});

		it('include_overdue=false excludes overdue without reminderAt due', () => {
			// due1 has reminderOffset=0 so reminderAt=dueDate which is past → dueReminder true, still included
			const r = listDueRemindersHandler(db, { include_overdue: false }) as { total: number };
			expect(r.total).toBeGreaterThanOrEqual(1);
		});

		it('respects limit', () => {
			const r = listDueRemindersHandler(db, { limit: 0 }) as { reminders: unknown[] };
			// limit=0 falls back to 50 (invalid), so returns all due
			expect(r.reminders.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('repeat pure helpers', () => {
		it('normalizeRepeatRule validates and normalizes', () => {
			expect(normalizeRepeatRule({ type: 'daily', interval: 2 })).toEqual({ type: 'daily', interval: 2 });
			expect(normalizeRepeatRule(null)).toBeUndefined();
			expect(() => normalizeRepeatRule({ type: 'bad', interval: 1 })).toThrow('repeat.type');
		});

		it('shouldSpawnNextPure respects status and rules', () => {
			const base = { status: 'done', dueDate: 1000, repeat: { type: 'daily', interval: 1, generatedCount: 0 } };
			expect(shouldSpawnNextPure(base)).toBe(true);
			expect(shouldSpawnNextPure({ ...base, status: 'todo' })).toBe(false);
			expect(shouldSpawnNextPure({ ...base, repeat: { type: 'daily', interval: 1, repeatCount: 1, generatedCount: 1 } })).toBe(false);
		});

		it('buildNextInstancePure migrates legacy dueDate into dueEnd and increments generatedCount', () => {
			const task = {
				id: 'p', title: 'T', status: 'done', priority: 'high',
				tags: ['a'], group: 'G', description: 'd', subtasks: [],
				createdAt: 1000, updatedAt: 1000, dueDate: 1000,
				repeat: { type: 'weekly', interval: 1, generatedCount: 0 },
			};
			const next = buildNextInstancePure(task, 2000) as Record<string, unknown>;
			expect(next.status).toBe('todo');
			expect(next.dueEnd).toBe(1000 + 7 * 86400 * 1000);
			expect(next).not.toHaveProperty('dueStart');
			expect(next).not.toHaveProperty('dueDate');
			expect((next.repeat as Record<string, unknown>).generatedCount).toBe(1);
			expect(next.id).not.toBe('p');
		});
	});
});

describe('MCP schema contract', () => {
	const plugin = JSON.parse(readFileSync(resolve(process.cwd(), 'public/plugin.json'), 'utf8')) as {
		tools: Record<string, { description: string; inputSchema: { properties: Record<string, { type?: string; anyOf?: Array<{ type: string }>; enum?: unknown[]; description?: string }> } }>;
	};

	it('does not document null for enum-constrained parameters', () => {
		for (const tool of Object.values(plugin.tools)) {
			for (const property of Object.values(tool.inputSchema.properties)) {
				if (property.enum !== undefined) expect(property.description).not.toContain('null');
			}
		}
	});

	it('uses scalar types for optional fields without nullable schemas', () => {
		for (const toolName of ['todo_create_task', 'todo_apply_template']) {
			const properties = plugin.tools[toolName]!.inputSchema.properties;
			expect(properties.due_start!.type).toBe('string');
			expect(properties.due_start!.anyOf).toBeUndefined();
			expect(properties.due_end!.type).toBe('string');
			expect(properties.due_end!.anyOf).toBeUndefined();
			expect(properties.all_day!.type).toBe('boolean');
			expect(properties.all_day!.anyOf).toBeUndefined();
		}
		expect(plugin.tools.todo_create_task!.inputSchema.properties.repeat!.type).toBe('object');
		expect(plugin.tools.todo_create_task!.inputSchema.properties.repeat!.anyOf).toBeUndefined();
		expect(plugin.tools.todo_create_template!.inputSchema.properties.child_tasks!.type).toBe('array');
		expect(plugin.tools.todo_create_template!.inputSchema.properties.child_tasks!.anyOf).toBeUndefined();
		expect(plugin.tools.todo_update_template!.inputSchema.properties.child_tasks!.type).toBe('array');
		expect(plugin.tools.todo_update_template!.inputSchema.properties.child_tasks!.anyOf).toBeUndefined();
		expect(plugin.tools.todo_create_template!.inputSchema.properties).not.toHaveProperty('repeat');
	});

	it('uses a single JSON type for every input property', () => {
		const assertScalarTypes = (schema: unknown): void => {
			if (Array.isArray(schema)) {
				schema.forEach(assertScalarTypes);
				return;
			}
			if (!schema || typeof schema !== 'object') return;
			const value = schema as Record<string, unknown>;
			if (typeof value.type === 'string' || Array.isArray(value.type)) expect(typeof value.type).toBe('string');
			expect(value).not.toHaveProperty('anyOf');
			Object.values(value).forEach(assertScalarTypes);
		};

		Object.values(plugin.tools).forEach((tool) => assertScalarTypes(tool.inputSchema));
	});
});

// 防止 preload 与 src 端键名漂移：与 src/services/storageKeys.ts 的 STORAGE_KEYS 一致。
describe('toolHandlers – storage key consistency', () => {
	it('exposes a unified STORAGE_KEYS object matching src/services/storageKeys.ts', () => {
		expect(STORAGE_KEYS.TASKS).toBe('jianyue.tasks');
		expect(STORAGE_KEYS.SETTINGS).toBe('jianyue.settings');
		expect(STORAGE_KEYS.TEMPLATES).toBe('jianyue.templates');
		expect(STORAGE_KEYS.UI_STATE).toBe('jianyue.uiState');
		expect(STORAGE_KEYS.POMODORO).toBe('jianyue.pomodoro');
		expect(STORAGE_KEYS.STICKY_NOTE).toBe('jianyue.stickyNote');
	});

	it('derives legacy single-key constants from STORAGE_KEYS', () => {
		expect(STORAGE_KEY).toBe(STORAGE_KEYS.TASKS);
		expect(SETTINGS_STORAGE_KEY).toBe(STORAGE_KEYS.SETTINGS);
		expect(TEMPLATES_STORAGE_KEY).toBe(STORAGE_KEYS.TEMPLATES);
	});
});

describe('unified MCP task contract', () => {
	const handlers = toolHandlers as unknown as {
		createTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		updateTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		searchTasksHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		bulkUpdateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		getTaskHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		taskOverviewHandler: (db: DbStorage, params?: Record<string, unknown>) => unknown;
		listDueRemindersHandler: (db: DbStorage, params?: Record<string, unknown>) => unknown;
		acknowledgeReminderHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		createTemplateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		updateTemplateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		applyTemplateHandler: (db: DbStorage, params: Record<string, unknown>) => unknown;
		getReviewHandler: (db: DbStorage) => unknown;
		suggestOrganizationHandler: (db: DbStorage, params?: Record<string, unknown>) => unknown;
	};
	let db: ReturnType<typeof createDb>;

	beforeEach(() => {
		db = createDb();
	});

	it('creates an all-day time-range task with only unified date fields', () => {
		handlers.createTaskHandler(db, {
			title: '团建',
			due_start: '2026-08-08',
			due_end: '2026-08-10',
			all_day: true,
		});

		const task = (db.snapshot() as Array<Record<string, unknown>>)[0]!;
		expect(task.dueStart).toBe(new Date(2026, 7, 8).getTime());
		expect(task.dueEnd).toBe(new Date(2026, 7, 10).getTime());
		expect(task.allDay).toBe(true);
		expect(task).not.toHaveProperty('dueDate');
	});

	it('matches a dueEnd-only deadline in a date range', () => {
		seedTask(db, {
			id: 'deadline-only',
			title: '单点截止',
			dueEnd: new Date('2026-08-08T10:00:00Z').getTime(),
		});

		const result = handlers.searchTasksHandler(db, {
			due_after: '2026-08-08T09:00:00Z',
			due_before: '2026-08-08T11:00:00Z',
		}) as { tasks: Array<Record<string, unknown>> };

		expect(result.tasks.map((task) => task.id)).toEqual(['deadline-only']);
	});

	it('rejects a parent cycle through any ancestor', () => {
		seedTask(db, { id: 'a', title: 'A' });
		seedTask(db, { id: 'b', title: 'B', parentTaskId: 'a' });
		seedTask(db, { id: 'c', title: 'C', parentTaskId: 'b' });

		expect(() => handlers.updateTaskHandler(db, { task_id: 'a', parent_task_id: 'c' })).toThrow('循环');
	});

	it('searches time ranges by interval overlap and supports hierarchy and archive filters', () => {
		seedTask(db, {
			id: 'parent', title: '父任务', dueStart: new Date('2026-07-10T09:00:00Z').getTime(),
			dueEnd: new Date('2026-07-10T11:00:00Z').getTime(),
		});
		seedTask(db, { id: 'child', title: '子任务', parentTaskId: 'parent' });
		seedTask(db, { id: 'archived', title: '归档', archivedAt: Date.now() });

		const overlap = handlers.searchTasksHandler(db, {
			due_after: '2026-07-10T10:30:00Z', due_before: '2026-07-10T12:00:00Z',
		}) as { tasks: Array<Record<string, unknown>> };
		expect(overlap.tasks.map((task) => task.id)).toEqual(['parent']);
		expect((handlers.searchTasksHandler(db, { parent_task_id: 'parent' }) as { tasks: Array<Record<string, unknown>> }).tasks.map((task) => task.id)).toEqual(['child']);
		expect((handlers.searchTasksHandler(db, { root_only: true }) as { tasks: Array<Record<string, unknown>> }).tasks.map((task) => task.id)).toEqual(['parent']);
		expect((handlers.searchTasksHandler(db, { archived: true }) as { tasks: Array<Record<string, unknown>> }).tasks.map((task) => task.id)).toEqual(['archived']);
	});

	it('uses deadline for overdue overview and reminders', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
		seedTask(db, {
			id: 'active-range', title: '进行中的时间段', status: 'todo',
			dueStart: new Date('2026-07-10T09:00:00Z').getTime(),
			dueEnd: new Date('2026-07-10T13:00:00Z').getTime(), reminderOffset: 0,
		});

		const overview = handlers.taskOverviewHandler(db) as { overdue: number; dueToday: number };
		expect(overview).toMatchObject({ overdue: 0, dueToday: 1 });
		// 提醒基于截止时间 (deadline=13:00Z)，now=12:00Z 时未触发
		expect((handlers.listDueRemindersHandler(db) as { reminders: Array<Record<string, unknown>> }).reminders).toEqual([]);
		vi.useRealTimers();
	});

	it('updates completion consistently and clears nullable fields', () => {
		seedTask(db, {
			id: 'repeating', title: '每日站会', status: 'todo', dueStart: 1_000,
			reminderOffset: 10, repeat: { type: 'daily', interval: 1 },
		});
		handlers.updateTaskHandler(db, { task_id: 'repeating', status: 'done', reminder_offset: null });
		handlers.updateTaskHandler(db, { task_id: 'repeating', repeat: null });

		const tasks = db.snapshot() as Array<Record<string, unknown>>;
		expect(tasks).toHaveLength(2);
		expect(tasks.find((task) => task.id === 'repeating')).not.toHaveProperty('reminderOffset');
		expect(tasks.find((task) => task.id === 'repeating')).not.toHaveProperty('repeat');
		// 旧单点 dueStart=1000 经重复推进后，下一实例同时写 dueStart 与 dueEnd（保持零时长区间）
		const next = tasks.find((task) => task.id !== 'repeating')!;
		expect(next.dueEnd).toBe(1_000 + 86_400_000);
	});

	it('bulk completion validates values and spawns repeat instances', () => {
		seedTask(db, { id: 'repeat-bulk', title: '周报', dueStart: 1_000, repeat: { type: 'weekly', interval: 1 } });
		expect(() => handlers.bulkUpdateHandler(db, { task_ids: ['repeat-bulk'], priority: 'invalid' })).toThrow('任务优先级无效');
		handlers.bulkUpdateHandler(db, { task_ids: ['repeat-bulk'], status: 'done', archived: true });
		const tasks = db.snapshot() as Array<Record<string, unknown>>;
		expect(tasks).toHaveLength(2);
		expect(tasks.find((task) => task.id === 'repeat-bulk')).toHaveProperty('archivedAt');
		expect(tasks.find((task) => task.id !== 'repeat-bulk')!.status).toBe('todo');
	});

	it('acknowledges a reminder without removing its configuration', () => {
		seedTask(db, { id: 'reminder', title: '缴费', dueStart: 1_000, reminderOffset: 30, snoozedUntil: 2_000 });
		handlers.acknowledgeReminderHandler(db, { task_id: 'reminder' });
		const task = (db.snapshot() as Array<Record<string, unknown>>)[0]!;
		expect(task.remindedAt).toEqual(expect.any(Number));
		expect(task.reminderOffset).toBe(30);
		expect(task.snoozedUntil).toBe(2_000);
	});

	it('updates templates and applies their children as flat tasks', () => {
		const created = handlers.createTemplateHandler(db, { name: '发布', title: '发布版本', children: ['检查', '通知'] }) as { template_id: string };
		handlers.updateTemplateHandler(db, { template_id: created.template_id, group: '工作', repeat: null });
		const applied = handlers.applyTemplateHandler(db, { template_id: created.template_id, due_start: '2026-08-01T10:00:00Z' }) as { task_id: string };
		const tasks = db.snapshot() as Array<Record<string, unknown>>;
		expect(tasks).toHaveLength(3);
		expect(tasks.filter((task) => task.parentTaskId === applied.task_id).map((task) => task.title)).toEqual(['检查', '通知']);
	});

	it('returns review metrics and non-mutating organization suggestions', () => {
		seedTask(db, { id: 'suggest', title: '明天完成项目评审', priority: 'medium', tags: [], group: '' });
		db.setItem('jianyue.pomodoro.history', JSON.stringify([{ id: 'p1', status: 'finished', durationMinutes: 25, endsAt: Date.now() }]));
		const review = handlers.getReviewHandler(db) as { total: number; focus_minutes: number };
		expect(review).toMatchObject({ total: 1, focus_minutes: 25 });
		const plan = handlers.suggestOrganizationHandler(db) as { changes: Array<{ task_id: string; reasons: string[] }> };
		expect(plan.changes).toEqual(expect.arrayContaining([expect.objectContaining({ task_id: 'suggest' })]));
		expect((db.snapshot() as Array<Record<string, unknown>>)[0]!.group).toBe('');
	});

	it('returns organization date suggestions that can be applied through task updates', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
		seedTask(db, { id: 'suggest-date', title: '明天完成项目评审', priority: 'medium', tags: [], group: '' });

		const suggestion = handlers.suggestOrganizationHandler(db) as {
			changes: Array<{ task_id: string; patch: Record<string, unknown> }>;
		};
		const change = suggestion.changes.find((item) => item.task_id === 'suggest-date')!;

		expect(change.patch).toMatchObject({ due_end: '2026-08-11', all_day: true });
		handlers.updateTaskHandler(db, { task_id: change.task_id, ...change.patch });

		const task = (db.snapshot() as Array<Record<string, unknown>>).find((item) => item.id === change.task_id)!;
		expect(task.dueEnd).toBe(new Date(2026, 7, 11).getTime());
		expect(task.allDay).toBe(true);
		vi.useRealTimers();
	});

	it('auto-sorts a reversed datetime range into ascending endpoints', () => {
		handlers.createTaskHandler(db, {
			title: '倒序区间',
			due_start: '2026-07-10T11:00:00Z',
			due_end: '2026-07-10T09:00:00Z',
		});
		const task = (db.snapshot() as Array<Record<string, unknown>>)[0]!;
		expect(task.dueStart).toBe(new Date('2026-07-10T09:00:00Z').getTime());
		expect(task.dueEnd).toBe(new Date('2026-07-10T11:00:00Z').getTime());
	});

	it('treats a single due_end as the deadline and stores no dueStart', () => {
		handlers.createTaskHandler(db, { title: '单点结束', due_end: '2026-07-10T10:00:00Z' });
		const task = (db.snapshot() as Array<Record<string, unknown>>)[0]!;
		expect(task).not.toHaveProperty('dueStart');
		expect(task.dueEnd).toBe(new Date('2026-07-10T10:00:00Z').getTime());
	});

	it('treats a single due_start (legacy) as a single-point deadline', () => {
		handlers.createTaskHandler(db, { title: '旧单点', due_start: '2026-07-10T10:00:00Z' });
		const task = (db.snapshot() as Array<Record<string, unknown>>)[0]!;
		expect(task).not.toHaveProperty('dueStart');
		expect(task.dueEnd).toBe(new Date('2026-07-10T10:00:00Z').getTime());
	});

	it('update swaps endpoints when new end is earlier than existing start', () => {
		seedTask(db, { id: 'r', title: 'R', dueStart: 100, dueEnd: 300 });
		// 现有 dueStart=100、dueEnd=300；调用者改 due_end=50，与 dueStart 形成倒序，自动升序化为 {50, 100}
		// 既有 dueEnd=300 被新 due_end=50 覆盖（其它字段未提供时不继承）
		handlers.updateTaskHandler(db, { task_id: 'r', due_end: 50 });
		const task = (db.snapshot() as Array<Record<string, unknown>>).find(t => t.id === 'r')!;
		expect(task.dueStart).toBe(50);
		expect(task.dueEnd).toBe(100);
	});

	it('update preserves existing dueEnd when only dueStart changes via MCP', () => {
		seedTask(db, { id: 'r2', title: 'R2', dueStart: 100, dueEnd: 300 });
		handlers.updateTaskHandler(db, { task_id: 'r2', due_start: 150 });
		const task = (db.snapshot() as Array<Record<string, unknown>>).find(t => t.id === 'r2')!;
		expect(task.dueStart).toBe(150);
		expect(task.dueEnd).toBe(300);
	});
});
