import type { RepeatRule, Task } from '../types/task';
import { getTaskDeadline } from '../types/task';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * 按 repeat 规则从基准截止时间（dueEnd / dueStart / 旧 dueDate）计算下一个实例的截止时间。
 * 若基准无，回退到「现在 + interval」。
 */
export const computeNextDueDate = (task: Task, now: number = Date.now()): number => {
	const rule = task.repeat;
	if (!rule) {
		throw new Error('任务无重复规则');
	}
	const base = getTaskDeadline(task) ?? now;
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
	if (task.parentTaskId !== undefined) next.parentTaskId = task.parentTaskId;
	if (task.allDay !== undefined) next.allDay = task.allDay;
	// 以截止时间为基准推进；时间段任务保留起止相对 offset，单点任务仅写 dueEnd。
	const baseStart = task.dueStart;
	const baseDeadline = getTaskDeadline(task) ?? now;
	const nextDeadline = computeNextDueDate(task, now); // baseDeadline + interval
	if (baseStart !== undefined) {
		const offset = baseDeadline - baseStart; // 时间段长度
		next.dueStart = nextDeadline - offset;
		next.dueEnd = nextDeadline;
	} else {
		next.dueEnd = nextDeadline;
	}
	if (task.reminderOffset !== undefined) {
		next.reminderOffset = task.reminderOffset;
	}
	return next;
};
