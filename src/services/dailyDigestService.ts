import { getTaskDeadline, type Task } from '../types/task';
import type { WebhookDigestSnapshot, WebhookTaskSnapshot } from '../types/webhook';

export type DailyDigest = WebhookDigestSnapshot & { dateKey: string };

const dateParts = (timestamp: number, timezone: string): Record<string, string> => {
	return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(timestamp).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
};

const dateKey = (timestamp: number, timezone: string): string => {
	const parts = dateParts(timestamp, timezone);
	return `${parts.year!}-${parts.month!}-${parts.day!}`;
};

const snapshot = (task: Task): WebhookTaskSnapshot => {
	const dueAt = getTaskDeadline(task);
	return {
		id: task.id,
		title: task.title,
		description: task.description,
		priority: task.priority,
		tags: [...task.tags],
		group: task.group,
		...(dueAt === undefined ? {} : { dueAt }),
		...(task.completedAt === undefined ? {} : { completedAt: task.completedAt }),
	};
};

const startOfDay = (now: number, timezone: string): number => {
	const parts = dateParts(now, timezone);
	const guess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
	const observed = dateParts(guess, timezone);
	const offset = Date.UTC(Number(observed.year), Number(observed.month) - 1, Number(observed.day), Number(observed.hour), Number(observed.minute)) - guess;
	return guess - offset;
};

export const isDailyDigestDue = (now: number, time: string, timezone: string): boolean => {
	if (!/^\d{2}:\d{2}$/.test(time)) return false;
	const parts = dateParts(now, timezone);
	return `${parts.hour!}:${parts.minute!}` >= time;
};

export const buildDailyDigest = (tasks: Task[], now: number, timezone: string): DailyDigest => {
	const key = dateKey(now, timezone);
	const periodStart = startOfDay(now, timezone);
	const periodEnd = startOfDay(now + 36 * 60 * 60_000, timezone);
	const active = tasks.filter((task) => task.status !== 'done');
	return {
		dateKey: key,
		periodStart,
		periodEnd,
		timezone,
		completed: tasks.filter((task) => task.status === 'done' && task.completedAt !== undefined && dateKey(task.completedAt, timezone) === key).map(snapshot),
		due: active.filter((task) => {
			const dueAt = getTaskDeadline(task);
			return dueAt !== undefined && dateKey(dueAt, timezone) === key;
		}).map(snapshot),
		overdue: active.filter((task) => {
			const dueAt = getTaskDeadline(task);
			return dueAt !== undefined && dueAt < periodStart;
		}).map(snapshot),
		activeCount: active.length,
	};
};
