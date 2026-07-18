import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import { buildCalendarRangeSegments } from './calendarViewProjection';

const at = (day: number, hour = 0, minute = 0): number => new Date(2026, 6, day, hour, minute).getTime();

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

const weekKeys = [
	'2026-07-13',
	'2026-07-14',
	'2026-07-15',
	'2026-07-16',
	'2026-07-17',
	'2026-07-18',
	'2026-07-19',
];

describe('buildCalendarRangeSegments', () => {
	it('projects an all-day range as start, middle, and end segments', () => {
		const task = makeTask({
			title: '出差',
			allDay: true,
			dueStart: at(15),
			dueEnd: at(18),
		});

		const segments = buildCalendarRangeSegments([task], weekKeys);

		expect(segments.get('2026-07-15')).toMatchObject([
			{ task, position: 'start', opensSegment: true, closesSegment: false, title: '出差' },
		]);
		expect(segments.get('2026-07-16')).toMatchObject([
			{ task, position: 'middle', opensSegment: false, closesSegment: false },
		]);
		expect(segments.get('2026-07-17')).toMatchObject([
			{ task, position: 'middle', opensSegment: false, closesSegment: false },
		]);
		expect(segments.get('2026-07-18')).toMatchObject([
			{ task, position: 'end', opensSegment: false, closesSegment: true, endLabel: '全天' },
		]);
	});

	it('closes and reopens a range at a week boundary', () => {
		const task = makeTask({ allDay: true, dueStart: at(17), dueEnd: at(21) });
		const cells = [...weekKeys, '2026-07-20', '2026-07-21'];

		const segments = buildCalendarRangeSegments([task], cells);

		expect(segments.get('2026-07-17')).toMatchObject([{ position: 'start', opensSegment: true, closesSegment: false }]);
		expect(segments.get('2026-07-19')).toMatchObject([{ position: 'middle', opensSegment: false, closesSegment: true }]);
		expect(segments.get('2026-07-20')).toMatchObject([{ position: 'middle', opensSegment: true, closesSegment: false }]);
		expect(segments.get('2026-07-21')).toMatchObject([{ position: 'end', opensSegment: false, closesSegment: true }]);
	});

	it('projects an exact-time range onto every covered date', () => {
		const task = makeTask({
			title: '夜间发布',
			dueStart: at(15, 22),
			dueEnd: at(17, 9, 30),
		});

		const segments = buildCalendarRangeSegments([task], weekKeys);

		expect(segments.get('2026-07-15')).toMatchObject([
			{ position: 'start', title: '夜间发布', startLabel: '22:00' },
		]);
		expect(segments.get('2026-07-16')).toMatchObject([{ position: 'middle' }]);
		expect(segments.get('2026-07-17')).toMatchObject([{ position: 'end', endLabel: '截止 09:30' }]);
	});

	it('keeps a single-day task compact with its deadline marker', () => {
		const task = makeTask({ dueStart: at(16, 9), dueEnd: at(16, 14, 30) });

		const segments = buildCalendarRangeSegments([task], weekKeys);

		expect(segments.get('2026-07-16')).toMatchObject([
			{ task, position: 'single', opensSegment: true, closesSegment: true, endLabel: '截止 14:30' },
		]);
	});

	it('projects a deadline-only task as a compact marker on its deadline date', () => {
		const task = makeTask({ title: '提交报表', dueEnd: at(18, 17) });

		const segments = buildCalendarRangeSegments([task], weekKeys);

		expect(segments.get('2026-07-18')).toMatchObject([
			{ task, position: 'single', opensSegment: true, closesSegment: true, endLabel: '截止 17:00' },
		]);
	});

	it('uses visual caps when a range is clipped by the visible calendar cells', () => {
		const task = makeTask({ title: '跨月计划', allDay: true, dueStart: at(12), dueEnd: at(20) });
		const cells = ['2026-07-15', '2026-07-16', '2026-07-17'];

		const segments = buildCalendarRangeSegments([task], cells);

		expect(segments.get('2026-07-15')).toMatchObject([{ position: 'middle', opensSegment: true }]);
		expect(segments.get('2026-07-17')).toMatchObject([{ position: 'middle', closesSegment: true }]);
		expect(segments.get('2026-07-15')![0]).not.toHaveProperty('title');
		expect(segments.get('2026-07-17')![0]).not.toHaveProperty('endLabel');
	});
});
