import { describe, expect, it } from 'vitest';
import type { StickyNoteSource } from '../types/stickyNote';
import type { Task } from '../types/task';
import { buildStickyTaskGroups } from './stickyViewProjection';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-' + Math.random().toString(36).slice(2, 8),
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

const makeSource = (overrides: Partial<StickyNoteSource> = {}): StickyNoteSource => ({
	sourceKind: 'current',
	title: '便签',
	view: 'list',
	section: 'inbox',
	filter: { showCompleted: true },
	updatedAt: 1,
	...overrides,
});

describe('buildStickyTaskGroups', () => {
	it('orders list tasks by parent then child and counts direct child tasks', () => {
		const tasks = [makeTask({
			id: 'child-done',
			title: '完成子任务',
			status: 'done',
			parentTaskId: 'parent',
		}), makeTask({
			id: 'orphan',
			title: '孤儿子任务',
			parentTaskId: 'missing-parent',
		}), makeTask({
			id: 'parent',
			title: '父任务',
			description: '**详情**',
		}), makeTask({
			id: 'child-todo',
			title: '待办子任务',
			parentTaskId: 'parent',
		})];

		const groups = buildStickyTaskGroups(tasks, makeSource());

		expect(groups).toHaveLength(1);
		expect(groups[0]!.title).toBe('便签');
		expect(groups[0]!.tasks.map((item) => item.task.id)).toEqual(['parent', 'child-done', 'child-todo', 'orphan']);

		const parent = groups[0]!.tasks[0]!;
		expect(parent.subtaskTotal).toBe(2);
		expect(parent.subtaskCompleted).toBe(1);
		expect(parent.depth).toBe(0);
		expect(parent.parentTitle).toBeUndefined();
		expect(parent.children.map((item) => item.task.id)).toEqual(['child-done', 'child-todo']);

		const child = groups[0]!.tasks[1]!;
		expect(child.subtaskTotal).toBe(0);
		expect(child.subtaskCompleted).toBe(0);
		expect(child.depth).toBe(1);
		expect(child.parentTitle).toBe('父任务');
		expect(child.task.description).toBe('');

		const orphan = groups[0]!.tasks[3]!;
		expect(orphan.depth).toBe(1);
		expect(orphan.parentTitle).toBeUndefined();
	});

	it('adds parent title to child items in non-list groups while grouping by own fields', () => {
		const groups = buildStickyTaskGroups([
			makeTask({ id: 'parent', title: '父任务', status: 'todo', priority: 'low' }),
			makeTask({ id: 'child', title: '子任务', status: 'doing', priority: 'urgent', parentTaskId: 'parent' }),
		], makeSource({ view: 'kanban' }));

		expect(groups.map((group) => group.key)).toEqual(['todo', 'doing']);
		expect(groups[1]!.tasks[0]!.task.id).toBe('child');
		expect(groups[1]!.tasks[0]!.parentTitle).toBe('父任务');
		expect(groups[1]!.tasks[0]!.depth).toBe(1);
	});

	it('groups kanban tasks by status', () => {
		const groups = buildStickyTaskGroups([
			makeTask({ id: 'todo', status: 'todo' }),
			makeTask({ id: 'doing', status: 'doing' }),
			makeTask({ id: 'done', status: 'done' }),
		], makeSource({ view: 'kanban' }));

		expect(groups.map((group) => group.title)).toEqual(['待办', '进行中', '已完成']);
		expect(groups.map((group) => group.tasks.length)).toEqual([1, 1, 1]);
	});

	it('groups eisenhower tasks by priority quadrant', () => {
		const groups = buildStickyTaskGroups([
			makeTask({ id: 'u', priority: 'urgent' }),
			makeTask({ id: 'h', priority: 'high' }),
			makeTask({ id: 'm', priority: 'medium' }),
			makeTask({ id: 'l', priority: 'low' }),
		], makeSource({ view: 'eisenhower' }));

		expect(groups.map((group) => group.title)).toEqual(['重要且紧急', '重要不紧急', '紧急不重要', '不重要不紧急']);
		expect(groups.map((group) => group.tasks.length)).toEqual([1, 1, 1, 1]);
	});

	it('sorts eisenhower groups by deadline regardless of source sort', () => {
		const groups = buildStickyTaskGroups([
			makeTask({ id: 'undated', priority: 'urgent', createdAt: 1 }),
			makeTask({ id: 'early', priority: 'urgent', dueEnd: 100, createdAt: 2 }),
			makeTask({ id: 'late', priority: 'urgent', dueEnd: 500, createdAt: 3 }),
		], makeSource({
			view: 'eisenhower',
			sort: { field: 'createdAt', order: 'asc' },
		}));

		expect(groups[0]!.tasks.map((item) => item.task.id)).toEqual(['late', 'early', 'undated']);
	});

	it('groups calendar tasks by due date', () => {
		const groups = buildStickyTaskGroups([
			makeTask({ id: 'a', dueStart: new Date('2026-07-05T10:00:00+08:00').getTime() }),
			makeTask({ id: 'b', dueStart: new Date('2026-07-06T10:00:00+08:00').getTime() }),
		], makeSource({ view: 'calendar' }));

		expect(groups.map((group) => group.title)).toEqual(['2026/7/5', '2026/7/6']);
	});

	it('applies filter and sort from source', () => {
		const groups = buildStickyTaskGroups([
			makeTask({ id: 'low', priority: 'low', tags: ['work'] }),
			makeTask({ id: 'urgent', priority: 'urgent', tags: ['work'] }),
			makeTask({ id: 'hidden', priority: 'high', tags: ['life'] }),
		], makeSource({ filter: { tags: ['work'] }, sort: { field: 'priority', order: 'desc' } }));

		expect(groups[0]!.tasks.map((item) => item.task.id)).toEqual(['urgent', 'low']);
	});
});
