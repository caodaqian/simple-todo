import type { RepeatRule, Task } from '../types/task';
import { getTaskStart } from '../types/task';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * 按 repeat 规则从基准开始时间（dueStart / 旧 dueDate）计算下一个实例的开始时间。
 * 若基准无，回退到「现在 + interval 天」。
 */
export const computeNextDueDate = (task: Task, now: number = Date.now()): number => {
	const rule = task.repeat;
	if (!rule) {
		throw new Error('任务无重复规则');
	}
	const base = getTaskStart(task) ?? now;
	switch (rule.type) {
		case 'daily':
		case 'custom':
			return base + rule.interval * MS_PER_DAY;
		case 'weekly':
			return base + rule.interval * MS_PER_WEEK;
		case 'monthly': {
			const d = new Date(base);
			d.setMonth(d.getMonth() + rule.interval);
			return d.getTime();
		}
		default:
			return base + rule.interval * MS_PER_DAY;
	}
};

/**
 * 判断任务标记 done 后是否应该生成下一实例。
 * 需满足：有 repeat 规则、状态为 done、未达 repeatUntil、未达 repeatCount。
 */
export const shouldSpawnNext = (task: Task, now: number = Date.now()): boolean => {
	const rule = task.repeat;
	if (!rule) return false;
	if (task.status !== 'done') return false;
	if (rule.repeatUntil !== undefined && computeNextDueDate(task, now) > rule.repeatUntil) {
		return false;
	}
	const generated = rule.generatedCount ?? 0;
	if (rule.repeatCount !== undefined && generated >= rule.repeatCount) {
		return false;
	}
	return true;
};

const generateTaskId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `${timestamp}-${random}`;
};

/**
 * 构造下一实例（不写入存储）：新 id、status=todo、dueDate 推进、
 * remindedAt/snoozedUntil 清空、repeat.generatedCount +1。
 */
export const buildNextInstance = (task: Task, now: number = Date.now()): Task => {
	const rule = task.repeat;
	if (!rule) {
		throw new Error('任务无重复规则');
	}
	const nextDueDate = computeNextDueDate(task, now);
	const nextRepeat: RepeatRule = {
		...rule,
		generatedCount: (rule.generatedCount ?? 0) + 1,
	};
	const next: Task = {
		id: generateTaskId(),
		title: task.title,
		status: 'todo',
		priority: task.priority,
		tags: [...task.tags],
		group: task.group,
		description: task.description,
		subtasks: task.subtasks.map((s) => ({
			id: generateTaskId(),
			title: s.title,
			completed: false,
			createdAt: now,
			updatedAt: now,
		})),
		createdAt: now,
		updatedAt: now,
		repeat: nextRepeat,
	};
	if (task.allDay !== undefined) next.allDay = task.allDay;
	// 推进 dueEnd 以保持与 dueStart 的相对 offset
	if (task.dueStart !== undefined && task.dueEnd !== undefined) {
		next.dueEnd = nextDueDate + (task.dueEnd - task.dueStart);
	}
	if (task.dueStart !== undefined) {
		// 新模型：用 dueStart 推进
		next.dueStart = nextDueDate;
	} else if (task.dueDate !== undefined) {
		// 旧模型：保持 dueDate
		next.dueDate = nextDueDate;
	} else if (nextDueDate !== undefined) {
		// 原无 dueStart/dueDate 但有 wrap fallback 推进了时间，挂到 dueStart
		next.dueStart = nextDueDate;
	}
	if (task.reminderOffset !== undefined) {
		next.reminderOffset = task.reminderOffset;
	}
	return next;
};
