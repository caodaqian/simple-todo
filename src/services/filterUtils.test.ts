import { describe, expect, it } from 'vitest';
import type { TaskDateRules, TaskSearchFilter } from '../types/task';
import { isSidebarFilterActive, toggleSidebarFilter } from './filterUtils';

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
			dateRange: { start: 100, end: 199 },
		});

		expect(toggle(today, 'week')).toEqual({
			status: 'done',
			showCompleted: true,
			dateRange: { start: 100, end: 799 },
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
