import { describe, expect, it, vi } from 'vitest';
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

describe('filter title keyword', () => {
	it('保留标题命中的任务，即使描述不相关', () => {
		const titleMatch = createTask({
			id: 'title-match',
			title: '修复登录问题',
			description: '发布说明待补充',
		});
		const descriptionOnlyMatch = createTask({
			id: 'description-only-match',
			title: '准备发布',
			description: '登录功能待修复',
		});

		const result = searchAndSortTasks([titleMatch, descriptionOnlyMatch], { titleKeyword: ' 登录 ' });

		expect(result.map((item) => item.id)).toEqual(['title-match']);
	});

	it('排除仅描述命中的任务', () => {
		const task = createTask({
			id: 'description-only',
			title: '准备发布',
			description: '修复登录问题',
		});

		const result = searchAndSortTasks([task], { titleKeyword: '登录' });

		expect(result).toEqual([]);
	});

	it('同时使用 keyword 和 titleKeyword 时要求两个条件都匹配', () => {
		const titleOnlyMatch = createTask({
			id: 'title-only-match',
			title: '修复登录问题',
			description: '等待排期',
		});
		const keywordOnlyMatch = createTask({
			id: 'keyword-only-match',
			title: '准备发布',
			description: '登录功能已修复',
		});
		const bothMatch = createTask({
			id: 'both-match',
			title: '修复登录问题',
			description: '发布前验证',
		});

		const result = searchAndSortTasks(
			[titleOnlyMatch, keywordOnlyMatch, bothMatch],
			{ keyword: '发布', titleKeyword: '登录' },
		);

		expect(result.map((item) => item.id)).toEqual(['both-match']);
	});
});

describe('sort by deadline uses getTaskDeadline', () => {
	it('resolves a relative date rule at filtering time', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0, 0));
		const todayTask = createTask({ id: 'today', dueEnd: new Date(2026, 6, 15, 18, 0, 0, 0).getTime() });
		const tomorrowTask = createTask({ id: 'tomorrow', dueEnd: new Date(2026, 6, 16, 18, 0, 0, 0).getTime() });

		const result = searchAndSortTasks([todayTask, tomorrowTask], {
			dateRule: { preset: 'today' },
		});

		expect(result.map((task) => task.id)).toEqual(['today']);
		vi.useRealTimers();
	});

	it('orders by dueEnd when dueStart missing', () => {
		const a = createTask({ id: 'a', dueEnd: 500 });
		const b = createTask({ id: 'b', dueEnd: 100 });
		const result = searchAndSortTasks([a, b], {}, { field: 'dueDate', order: 'asc' });
		expect(result.map((t) => t.id)).toEqual(['b', 'a']);
	});
	it('orders deadlines from latest to earliest and keeps undated tasks last', () => {
		const late = createTask({ id: 'late', dueEnd: 500 });
		const early = createTask({ id: 'early', dueEnd: 100 });
		const undated = createTask({ id: 'undated' });
		const result = searchAndSortTasks([undated, early, late], {}, { field: 'dueDate', order: 'desc' });
		expect(result.map((t) => t.id)).toEqual(['late', 'early', 'undated']);
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

	it('includes a dueEnd-only deadline in its matching date range', () => {
		const dueEnd = new Date('2026-06-22T19:00:00+08:00').getTime();
		const result = searchAndSortTasks([createTask({ dueEnd })], {
			dateRange: { start: dueEnd - 1, end: dueEnd + 1 },
		});

		expect(result.map((task) => task.id)).toEqual(['task-1']);
	});

	it('compares multiple rules in order and preserves stable input order', () => {
		const tasks = [
			createTask({ id: 'same-first', priority: 'high', dueEnd: 200, status: 'todo' }),
			createTask({ id: 'second-rule', priority: 'high', dueEnd: 100, status: 'doing' }),
			createTask({ id: 'third-rule', priority: 'high', dueEnd: 100, status: 'todo' }),
			createTask({ id: 'first-rule', priority: 'urgent', dueEnd: 500, status: 'done' }),
		];

		const result = searchAndSortTasks(tasks, { showCompleted: true }, [
			{ field: 'priority', order: 'desc' },
			{ field: 'dueDate', order: 'asc' },
			{ field: 'status', order: 'asc' },
		]);

		expect(result.map((task) => task.id)).toEqual([
			'first-rule',
			'third-rule',
			'second-rule',
			'same-first',
		]);
	});

	it('sorts group and tags alphabetically with empty values last', () => {
		const tasks = [
			createTask({ id: 'empty', group: '', tags: [] }),
			createTask({ id: 'beta', group: 'Beta', tags: ['z', 'Alpha'] }),
			createTask({ id: 'alpha', group: 'Alpha', tags: ['Beta'] }),
		];

		expect(searchAndSortTasks(tasks, {}, [{ field: 'group', order: 'asc' }]).map((task) => task.id))
			.toEqual(['alpha', 'beta', 'empty']);
		expect(searchAndSortTasks(tasks, {}, [{ field: 'tags', order: 'asc' }]).map((task) => task.id))
			.toEqual(['beta', 'alpha', 'empty']);
	});
});
