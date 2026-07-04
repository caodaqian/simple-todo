import type { Task } from '../types/task';
import { getTaskStart } from '../types/task';

const MS_PER_MINUTE = 60 * 1000;

/**
 * 计算任务的提醒触发时间戳。
 * reminderAt = dueDate - (reminderOffset ?? 0) * 60000
 * 若无 dueDate 则返回 undefined（无提醒）。
 */
export const computeReminderAt = (task: Task): number | undefined => {
	const start = getTaskStart(task);
	if (start === undefined) return undefined;
	const offset = task.reminderOffset ?? 0;
	return start - offset * MS_PER_MINUTE;
};

/**
 * 判断任务当前是否「应触发提醒」：
 * - reminderAt <= now
 * - remindedAt 为空（未提醒过）
 * - snoozedUntil 为空或已到期
 * - 任务未完成
 */
export const isReminderDue = (task: Task, now: number = Date.now()): boolean => {
	if (task.status === 'done') return false;
	const reminderAt = computeReminderAt(task);
	if (reminderAt === undefined) return false;
	if (reminderAt > now) return false;
	if (task.remindedAt !== undefined) return false;
	if (task.snoozedUntil !== undefined && task.snoozedUntil > now) return false;
	return true;
};

/**
 * 返回所有应触发提醒的任务（按 reminderAt 升序，先到期的先提醒）。
 */
export const getDueReminders = (tasks: Task[], now: number = Date.now()): Task[] => {
	return tasks
		.filter((task) => isReminderDue(task, now))
		.sort((a, b) => {
			const aAt = computeReminderAt(a) ?? Infinity;
			const bAt = computeReminderAt(b) ?? Infinity;
			return aAt - bAt;
		});
};

/**
 * 兜底：到期未完成且未提醒过的任务（即使未设 reminderOffset，到期也提醒一次）。
 * 用于补报场景，与 getDueReminders 互补。
 */
export const isOverdueUnreminded = (task: Task, now: number = Date.now()): boolean => {
	if (task.status === 'done') return false;
	const start = getTaskStart(task);
	if (start === undefined) return false;
	if (start > now) return false;
	if (task.remindedAt !== undefined) return false;
	if (task.snoozedUntil !== undefined && task.snoozedUntil > now) return false;
	return true;
};

/**
 * 返回所有已逾期且未提醒过的任务（含未设 reminderOffset 的）。
 * 用于进入插件时的补报扫描。
 */
export const getOverdueReminders = (tasks: Task[], now: number = Date.now()): Task[] => {
	return tasks
		.filter((task) => isOverdueUnreminded(task, now))
		.sort((a, b) => (getTaskStart(a) ?? Infinity) - (getTaskStart(b) ?? Infinity));
};

/**
 * 补报合并视图：getDueReminders ∪ getOverdueReminders，去重，按 dueDate 升序。
 */
export const getMissedReminders = (tasks: Task[], now: number = Date.now()): Task[] => {
	const due = getDueReminders(tasks, now);
	const overdue = getOverdueReminders(tasks, now);
	const seen = new Set(due.map((t) => t.id));
	const merged = [...due];
	for (const task of overdue) {
		if (!seen.has(task.id)) {
			merged.push(task);
			seen.add(task.id);
		}
	}
	return merged.sort(
		(a, b) =>
			(getTaskStart(a) ?? computeReminderAt(a) ?? Infinity) -
			(getTaskStart(b) ?? computeReminderAt(b) ?? Infinity),
	);
};
