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
