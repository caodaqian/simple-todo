import { describe, expect, it } from 'vitest';
import type { TaskDateRules, TaskSearchFilter } from '../types/task';
import {
	DEFAULT_TASK_SORT_CONFIG,
	getTaskDateRuleSummary,
	isSidebarFilterActive,
	isTaskDateRule,
	parseTaskDateRule,
	parseTaskSortConfig,
	resolveTaskDateRule,
	toggleSidebarFilter,
} from './filterUtils';

const rules: TaskDateRules = {
	now: 1_000,
	startOfToday: 100,
	endOfToday: 199,
	endOfRecentDays: 799,
	recentDays: 7,
};

const toggle = (filter: TaskSearchFilter, section: Parameters<typeof toggleSidebarFilter>[1]): TaskSearchFilter =>
	toggleSidebarFilter(filter, section, rules);

describe('toggleSidebarFilter', () => {
	it('重复点击已完成时只开启再关闭完成条件', () => {
		const active = toggle({ group: 'Personal' }, 'done');
		expect(active).toEqual({ group: 'Personal', status: 'done', showCompleted: true });
		expect(toggle(active, 'done')).toEqual({ group: 'Personal' });
	});

	it('重复点击分组时只开启再关闭该分组', () => {
		const active = toggle({ status: 'done', showCompleted: true }, 'group:Personal');
		expect(active).toEqual({ status: 'done', showCompleted: true, group: 'Personal' });
		expect(toggle(active, 'group:Personal')).toEqual({ status: 'done', showCompleted: true });
	});

	it('日期筛选彼此替换但不覆盖已完成条件', () => {
		const today = toggle({ status: 'done', showCompleted: true }, 'today');
		expect(today).toEqual({
			status: 'done',
			showCompleted: true,
			dateRule: { preset: 'today' },
		});

		expect(toggle(today, 'week')).toEqual({
			status: 'done',
			showCompleted: true,
			dateRule: { preset: 'thisWeek' },
		});
		expect(toggle(today, 'today')).toEqual({ status: 'done', showCompleted: true });
	});

	it('支持左侧多标签切换，并在移除最后一个标签时清除匹配模式', () => {
		const first = toggle({}, 'tag:work');
		const second = toggle(first, 'tag:home');
		expect(second).toEqual({ tags: ['work', 'home'] });
		expect(toggle({ ...second, tagMatchMode: 'all' }, 'tag:work')).toEqual({ tags: ['home'], tagMatchMode: 'all' });
		expect(toggle({ tags: ['home'], tagMatchMode: 'all' }, 'tag:home')).toEqual({});
	});

	it('点击收集箱清除所有侧栏筛选字段，并保留文本和优先级条件', () => {
		expect(toggle({
			keyword: '发布',
			titleKeyword: '文档',
			priority: ['high'],
			dateRange: { start: 100, end: 199 },
			overdueOnly: true,
			status: 'done',
			showCompleted: true,
			archived: true,
			group: 'Personal',
			tags: ['work'],
			tagMatchMode: 'all',
		}, 'inbox')).toEqual({
			keyword: '发布',
			titleKeyword: '文档',
			priority: ['high'],
		});
	});

	it('由当前筛选而非最近点击项判定侧栏激活状态', () => {
		const filter: TaskSearchFilter = {
			status: 'done',
			showCompleted: true,
			group: 'Personal',
			tags: ['work', 'home'],
			dateRange: { start: 100, end: 199 },
		};

		expect(isSidebarFilterActive(filter, 'done', rules)).toBe(true);
		expect(isSidebarFilterActive(filter, 'group:Personal', rules)).toBe(true);
		expect(isSidebarFilterActive(filter, 'tag:home', rules)).toBe(true);
		expect(isSidebarFilterActive(filter, 'today', rules)).toBe(true);
		expect(isSidebarFilterActive(filter, 'week', rules)).toBe(false);
	});

	it('不会写入显式 undefined', () => {
		const result = toggle({ tags: ['work'], tagMatchMode: 'all' }, 'tag:work');
		expect(Object.values(result)).not.toContain(undefined);
	});
});

describe('TaskDateRule', () => {
	const now = new Date(2026, 6, 15, 12, 30, 0, 0).getTime();

	it('解析并解析今天规则为本地当天边界', () => {
		const rule = parseTaskDateRule({ preset: 'today' });

		expect(rule).toEqual({ preset: 'today' });
		expect(resolveTaskDateRule(rule!, now)).toEqual({
			start: new Date(2026, 6, 15, 0, 0, 0, 0).getTime(),
			end: new Date(2026, 6, 15, 23, 59, 59, 999).getTime(),
		});
	});

	it('按周一至周日解析跨周规则', () => {
		expect(resolveTaskDateRule({ preset: 'thisWeek' }, now)).toEqual({
			start: new Date(2026, 6, 13, 0, 0, 0, 0).getTime(),
			end: new Date(2026, 6, 19, 23, 59, 59, 999).getTime(),
		});
		expect(resolveTaskDateRule({ preset: 'nextWeek' }, now)).toEqual({
			start: new Date(2026, 6, 20, 0, 0, 0, 0).getTime(),
			end: new Date(2026, 6, 26, 23, 59, 59, 999).getTime(),
		});
	});

	it('按连续自然日解析跨月的最近和未来规则', () => {
		const monthEnd = new Date(2026, 6, 1, 12, 0, 0, 0).getTime();

		expect(resolveTaskDateRule({ preset: 'recent7Days' }, monthEnd)).toEqual({
			start: new Date(2026, 5, 25, 0, 0, 0, 0).getTime(),
			end: new Date(2026, 6, 1, 23, 59, 59, 999).getTime(),
		});
		expect(resolveTaskDateRule({ preset: 'next30Days' }, monthEnd)).toEqual({
			start: new Date(2026, 6, 1, 0, 0, 0, 0).getTime(),
			end: new Date(2026, 6, 30, 23, 59, 59, 999).getTime(),
		});
	});

	it('解析自定义起止 offset，并支持无日期规则', () => {
		expect(resolveTaskDateRule({ preset: 'custom', startOffset: -2, endOffset: 3 }, now)).toEqual({
			start: new Date(2026, 6, 13, 0, 0, 0, 0).getTime(),
			end: new Date(2026, 6, 18, 23, 59, 59, 999).getTime(),
		});
		expect(resolveTaskDateRule({ preset: 'none' }, now)).toBeUndefined();
	});

	it('拒绝非法规则并提供稳定摘要', () => {
		expect(isTaskDateRule({ preset: 'today' })).toBe(true);
		expect(isTaskDateRule({ preset: 'custom', startOffset: 2, endOffset: 1 })).toBe(false);
		expect(isTaskDateRule({ preset: 'custom', startOffset: 0.5, endOffset: 1 })).toBe(false);
		expect(parseTaskDateRule({ preset: 'unknown' })).toBeUndefined();
		expect(getTaskDateRuleSummary({ preset: 'recent7Days' })).toBe('最近 7 天');
		expect(getTaskDateRuleSummary({ preset: 'custom', startOffset: -2, endOffset: 3 })).toBe('自定义：-2 至 +3 天');
	});
});

describe('TaskSortConfig', () => {
	it('uses the three-field default ordering', () => {
		expect(DEFAULT_TASK_SORT_CONFIG).toEqual([
			{ field: 'priority', order: 'desc' },
			{ field: 'dueDate', order: 'asc' },
			{ field: 'status', order: 'asc' },
		]);
		expect(parseTaskSortConfig(undefined)).toEqual(DEFAULT_TASK_SORT_CONFIG);
	});

	it('migrates a legacy single-field object to a normalized rule array', () => {
		expect(parseTaskSortConfig({ field: 'priority', order: 'desc' })).toEqual([
			{ field: 'priority', order: 'desc' },
		]);
		expect(parseTaskSortConfig({ field: 'group' })).toEqual([
			{ field: 'group', order: 'asc' },
		]);
	});

	it('accepts all user-facing fields and rejects malformed rule arrays', () => {
		expect(parseTaskSortConfig([
			{ field: 'group', order: 'desc' },
			{ field: 'tags', order: 'asc' },
			{ field: 'updatedAt', order: 'desc' },
		])).toEqual([
			{ field: 'group', order: 'desc' },
			{ field: 'tags', order: 'asc' },
			{ field: 'updatedAt', order: 'desc' },
		]);
		expect(parseTaskSortConfig([])).toEqual(DEFAULT_TASK_SORT_CONFIG);
		expect(parseTaskSortConfig([
			{ field: 'priority', order: 'desc' },
			{ field: 'priority', order: 'asc' },
		])).toEqual(DEFAULT_TASK_SORT_CONFIG);
		expect(parseTaskSortConfig([{ field: 'unknown', order: 'asc' }])).toEqual(DEFAULT_TASK_SORT_CONFIG);
	});
});
