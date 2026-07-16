import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import { buildSmartOrganizationPlan } from './smartTaskOrganizerService';

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

describe('smartTaskOrganizerService', () => {
	it('suggests priority, tags, group and due date without overwriting existing metadata', () => {
		const now = new Date('2026-07-08T09:00:00+08:00').getTime();
		const plan = buildSmartOrganizationPlan([
			makeTask({ id: 'urgent', title: '紧急 修复线上 bug 今天' }),
			makeTask({ id: 'kept', title: '阅读一本书', priority: 'high', group: '已有', tags: ['保留'] }),
		], { now });

		expect(plan.changes).toHaveLength(1);
		expect(plan.changes[0]).toMatchObject({
			taskId: 'urgent',
			patch: {
				priority: 'urgent',
				group: '工作',
				tags: ['开发', '缺陷'],
				allDay: true,
			},
		});
		expect(plan.changes[0]!.patch.dueEnd).toBe(new Date('2026-07-08T00:00:00+08:00').getTime());
		expect(plan.changes[0]!.patch).not.toHaveProperty('dueStart');
		expect(plan.skipped).toBe(1);
	});
});
