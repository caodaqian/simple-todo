import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import { buildCompletedListRows } from './listViewProjection';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task',
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

describe('buildCompletedListRows', () => {
	it('groups completed children beneath an unfinished read-only parent context', () => {
		const parent = makeTask({ id: 'parent', title: '整理年度计划', status: 'doing' });
		const childA = makeTask({ id: 'child-a', title: '收集资料', status: 'done', parentTaskId: parent.id });
		const childB = makeTask({ id: 'child-b', title: '拟定大纲', status: 'done', parentTaskId: parent.id });
		const standalone = makeTask({ id: 'standalone', title: '独立完成任务', status: 'done' });

		const rows = buildCompletedListRows([parent, childA, childB, standalone], [childA, standalone, childB]);

		expect(rows).toEqual([
			{
				kind: 'parent-context',
				parent,
				children: [
					{ task: childA, depth: 1, parentTitle: parent.title },
					{ task: childB, depth: 1, parentTitle: parent.title },
				],
			},
			{ kind: 'task', item: { task: standalone, depth: 0 } },
		]);
	});

	it('keeps completed parent and orphaned children as regular task rows', () => {
		const completedParent = makeTask({ id: 'parent', title: '已完成父任务', status: 'done' });
		const completedChild = makeTask({ id: 'child', title: '已完成子任务', status: 'done', parentTaskId: completedParent.id });
		const orphan = makeTask({ id: 'orphan', title: '孤儿子任务', status: 'done', parentTaskId: 'missing' });

		const rows = buildCompletedListRows(
			[completedParent, completedChild, orphan],
			[completedParent, completedChild, orphan],
		);

		expect(rows).toEqual([
			{ kind: 'task', item: { task: completedParent, depth: 0 } },
			{ kind: 'task', item: { task: completedChild, depth: 1, parentTitle: completedParent.title } },
			{ kind: 'task', item: { task: orphan, depth: 0, parentTitle: '原父任务已不存在' } },
		]);
	});
});
