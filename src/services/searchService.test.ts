import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import {
	getTaskDateRules,
	isTaskDueToday,
	isTaskInRecentDays,
	isTaskOverdue,
	isTaskUrgent,
	searchAndSortTasks,
} from './searchService';

const createTask = (overrides: Partial<Task> = {}): Task => ({
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

describe('task date rules', () => {
	it('uses one shared window for today, recent 7 days, overdue and urgent', () => {
		const now = new Date('2026-06-22T10:00:00+08:00').getTime();
		const rules = getTaskDateRules(now, 7);

		const todayTask = createTask({ dueDate: new Date('2026-06-22T20:00:00+08:00').getTime() });
		const weekTask = createTask({ dueDate: new Date('2026-06-28T20:00:00+08:00').getTime() });
		const overdueTask = createTask({ dueDate: new Date('2026-06-21T20:00:00+08:00').getTime() });
		const laterTask = createTask({ dueDate: new Date('2026-06-30T20:00:00+08:00').getTime() });

		expect(isTaskDueToday(todayTask, rules)).toBe(true);
		expect(isTaskInRecentDays(todayTask, rules)).toBe(true);
		expect(isTaskInRecentDays(weekTask, rules)).toBe(true);
		expect(isTaskUrgent(todayTask, rules)).toBe(true);
		expect(isTaskUrgent(overdueTask, rules)).toBe(true);
		expect(isTaskOverdue(overdueTask, rules)).toBe(true);
		expect(isTaskInRecentDays(laterTask, rules)).toBe(false);
		expect(isTaskUrgent(laterTask, rules)).toBe(false);
	});

	it('ignores done tasks for overdue and urgent checks', () => {
		const now = new Date('2026-06-22T10:00:00+08:00').getTime();
		const rules = getTaskDateRules(now, 7);
		const doneTask = createTask({
			status: 'done',
			dueDate: new Date('2026-06-21T20:00:00+08:00').getTime(),
		});

		expect(isTaskOverdue(doneTask, rules)).toBe(false);
		expect(isTaskUrgent(doneTask, rules)).toBe(false);
	});
});

describe('sortTasks by priority', () => {
	it('按优先级 desc 排序：urgent > high > medium > low', () => {
		const tasks = [
			createTask({ priority: 'low' }),
			createTask({ priority: 'urgent' }),
			createTask({ priority: 'medium' }),
			createTask({ priority: 'high' }),
		];
		const result = searchAndSortTasks(tasks, {}, { field: 'priority', order: 'desc' });
		expect(result.map((t) => t.priority)).toEqual(['urgent', 'high', 'medium', 'low']);
	});
});

describe('filter archived tasks', () => {
	it('默认隐藏已归档任务', () => {
		const active = createTask({ id: 'active' });
		const archived = createTask({ id: 'archived', archivedAt: 1000 } as Partial<Task>);

		const result = searchAndSortTasks([active, archived], {});

		expect(result.map((task) => task.id)).toEqual(['active']);
	});

	it('archived=true 时仅显示已归档任务', () => {
		const active = createTask({ id: 'active' });
		const archived = createTask({ id: 'archived', archivedAt: 1000 } as Partial<Task>);

		const result = searchAndSortTasks([active, archived], { archived: true });

		expect(result.map((task) => task.id)).toEqual(['archived']);
	});
});

describe('sort by deadline uses getTaskDeadline', () => {
	it('orders by dueEnd when dueStart missing', () => {
		const a = createTask({ id: 'a', dueEnd: 500 });
		const b = createTask({ id: 'b', dueEnd: 100 });
		const result = searchAndSortTasks([a, b], {}, { field: 'dueDate', order: 'asc' });
		expect(result.map((t) => t.id)).toEqual(['b', 'a']);
	});
	it('range filter overlaps when start beyond rangeStart but deadline before rangeEnd', () => {
		const rules = getTaskDateRules(new Date('2026-06-22T10:00:00+08:00').getTime(), 7);
		void rules;
		const t = createTask({
			dueStart: new Date('2026-06-22T18:00:00+08:00').getTime(),
			dueEnd: new Date('2026-06-22T19:30:00+08:00').getTime(),
		});
		const inRange = searchAndSortTasks([t], {
			dateRange: {
				start: new Date('2026-06-22T19:00:00+08:00').getTime(),
				end: new Date('2026-06-22T19:15:00+08:00').getTime(),
			},
		});
		expect(inRange.map((task) => task.id)).toEqual(['task-1']);
	});
});
