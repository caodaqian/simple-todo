import { describe, expect, it } from 'vitest';
import type { PomodoroSession } from '../types/pomodoro';
import type { Task } from '../types/task';
import { buildTaskReview } from './taskReviewService';

const day = 24 * 60 * 60 * 1000;
const now = new Date('2026-07-08T12:00:00+08:00').getTime();
const todayStart = new Date('2026-07-08T00:00:00+08:00').getTime();

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: '任务',
	status: 'todo',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: todayStart,
	updatedAt: todayStart,
	...overrides,
});

const makePomodoro = (overrides: Partial<PomodoroSession> = {}): PomodoroSession => ({
	id: 'p-1',
	taskId: 'task-1',
	taskTitle: '任务',
	startedAt: todayStart,
	durationMinutes: 25,
	endsAt: todayStart + 25 * 60 * 1000,
	status: 'finished',
	...overrides,
});

describe('taskReviewService', () => {
	it('builds completion, delay, focus and trend metrics from active tasks', () => {
		const review = buildTaskReview({
			tasks: [
				makeTask({ id: 'done-today', title: '完成 A', status: 'done', priority: 'high', group: '工作', tags: ['项目'], dueEnd: todayStart + 9 * 60 * 60 * 1000, completedAt: todayStart - 2 * day, updatedAt: todayStart + 10 * 60 * 60 * 1000 }),
				makeTask({ id: 'overdue', title: '延期 B', status: 'todo', priority: 'urgent', group: '工作', tags: ['项目', '风险'], dueEnd: todayStart - day }),
				makeTask({ id: 'open', title: '待办 C', status: 'doing', priority: 'medium', group: '生活', tags: ['习惯'], dueEnd: todayStart + 2 * day }),
				makeTask({ id: 'archived', title: '归档 D', status: 'done', archivedAt: todayStart, updatedAt: todayStart }),
			],
			pomodoros: [
				makePomodoro({ id: 'p1', durationMinutes: 25 }),
				makePomodoro({ id: 'p2', taskId: 'open', durationMinutes: 40 }),
				makePomodoro({ id: 'p3', taskId: 'open', durationMinutes: 30, endsAt: todayStart - 7 * day }),
			],
			now,
		});

		expect(review.total).toBe(3);
		expect(review.completed).toBe(1);
		expect(review.completionRate).toBe(33);
		expect(review.overdue).toBe(1);
		expect(review.delayRate).toBe(50);
		expect(review.dueNextSevenDays).toBe(1);
		expect(review.focusMinutes).toBe(65);
		expect(review.archived).toBe(1);
		expect(review.topGroups[0]).toEqual({ name: '工作', count: 2 });
		expect(review.topTags[0]).toEqual({ name: '项目', count: 2 });
		expect(review.completionTrend.at(-3)).toEqual({ date: '07-06', count: 1 });
		expect(review.completionTrend.at(-1)).toEqual({ date: '07-08', count: 0 });
	});
});
