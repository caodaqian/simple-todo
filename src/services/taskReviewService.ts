import type { PomodoroSession } from '../types/pomodoro';
import type { CountedValue, Task, TaskPriority, TaskStatus } from '../types/task';
import { getTaskDateRules, isTaskInRecentDays, isTaskOverdue } from './searchService';

export interface TrendPoint {
	date: string;
	count: number;
}

export interface TaskReview {
	total: number;
	active: number;
	completed: number;
	archived: number;
	completionRate: number;
	overdue: number;
	delayRate: number;
	dueThisWeek: number;
	noDueDate: number;
	focusMinutes: number;
	byStatus: Record<TaskStatus, number>;
	byPriority: Record<TaskPriority, number>;
	topGroups: CountedValue[];
	topTags: CountedValue[];
	completionTrend: TrendPoint[];
}

interface BuildTaskReviewOptions {
	tasks: Task[];
	pomodoros?: PomodoroSession[];
	now?: number;
}

const countValues = (values: string[]): CountedValue[] => {
	const counter = new Map<string, CountedValue>();
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		const existing = counter.get(key);
		if (existing) {
			existing.count += 1;
		} else {
			counter.set(key, { name: trimmed, count: 1 });
		}
	}
	return [...counter.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'));
};

const toDayStart = (timestamp: number): number => {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

const toTrendLabel = (timestamp: number): string => {
	const date = new Date(timestamp);
	return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const percent = (part: number, total: number): number => total > 0 ? Math.round((part / total) * 100) : 0;

const buildCompletionTrend = (tasks: Task[], now: number): TrendPoint[] => {
	const day = 24 * 60 * 60 * 1000;
	const todayStart = toDayStart(now);
	const counts = new Map<number, number>();
	for (let i = 6; i >= 0; i -= 1) {
		counts.set(todayStart - i * day, 0);
	}

	for (const task of tasks) {
		if (task.status !== 'done') continue;
		const completedDay = toDayStart(task.updatedAt);
		if (!counts.has(completedDay)) continue;
		counts.set(completedDay, (counts.get(completedDay) ?? 0) + 1);
	}

	return [...counts.entries()].map(([timestamp, count]) => ({ date: toTrendLabel(timestamp), count }));
};

export const buildTaskReview = ({ tasks, pomodoros = [], now = Date.now() }: BuildTaskReviewOptions): TaskReview => {
	const visibleTasks = tasks.filter((task) => task.archivedAt === undefined);
	const archived = tasks.length - visibleTasks.length;
	const rules = getTaskDateRules(now);

	const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
	const byPriority: Record<TaskPriority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
	let overdue = 0;
	let dueThisWeek = 0;
	let noDueDate = 0;

	for (const task of visibleTasks) {
		byStatus[task.status] += 1;
		byPriority[task.priority] += 1;
		if (task.dueStart === undefined && task.dueDate === undefined) {
			noDueDate += 1;
		}
		if (isTaskOverdue(task, rules)) {
			overdue += 1;
		}
		if (isTaskInRecentDays(task, rules)) {
			dueThisWeek += 1;
		}
	}

	const active = byStatus.todo + byStatus.doing;
	const completed = byStatus.done;
	const focusMinutes = pomodoros
		.filter((session) => session.status === 'finished')
		.reduce((sum, session) => sum + session.durationMinutes, 0);

	return {
		total: visibleTasks.length,
		active,
		completed,
		archived,
		completionRate: percent(completed, visibleTasks.length),
		overdue,
		delayRate: percent(overdue, active),
		dueThisWeek,
		noDueDate,
		focusMinutes,
		byStatus,
		byPriority,
		topGroups: countValues(visibleTasks.map((task) => task.group)).slice(0, 5),
		topTags: countValues(visibleTasks.flatMap((task) => [...new Set(task.tags)])).slice(0, 5),
		completionTrend: buildCompletionTrend(visibleTasks, now),
	};
};
