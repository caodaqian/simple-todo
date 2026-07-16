import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import {
	computeReminderAt,
	getDueReminders,
	getMissedReminders,
	getOverdueReminders,
	isOverdueUnreminded,
	isReminderDue,
} from './reminderService';

const makeTask = (overrides: { [K in keyof Task]?: Task[K] | undefined } = {}): Task => {
	const base: Task = {
		id: 't1',
		title: 'T',
		status: 'todo',
		priority: 'medium',
		tags: [],
		group: '',
		description: '',
		subtasks: [],
		createdAt: 1000,
		updatedAt: 1000,
	};
	const { id, title, status, priority, tags, group, description, subtasks, createdAt, updatedAt, dueDate, dueStart, dueEnd, reminderOffset, remindedAt, snoozedUntil, repeat } = overrides as Partial<Task>;
	const result: Task = {
		id: id ?? base.id,
		title: title ?? base.title,
		status: status ?? base.status,
		priority: priority ?? base.priority,
		tags: tags ?? base.tags,
		group: group ?? base.group,
		description: description ?? base.description,
		subtasks: subtasks ?? base.subtasks,
		createdAt: createdAt ?? base.createdAt,
		updatedAt: updatedAt ?? base.updatedAt,
	};
	if (dueDate !== undefined) result.dueDate = dueDate;
	if (dueStart !== undefined) result.dueStart = dueStart;
	if (dueEnd !== undefined) result.dueEnd = dueEnd;
	if (reminderOffset !== undefined) result.reminderOffset = reminderOffset;
	if (remindedAt !== undefined) result.remindedAt = remindedAt;
	if (snoozedUntil !== undefined) result.snoozedUntil = snoozedUntil;
	if (repeat !== undefined) result.repeat = repeat;
	return result;
};

describe('reminderService', () => {
	describe('computeReminderAt', () => {
		it('returns undefined when no dueDate', () => {
			expect(computeReminderAt(makeTask())).toBeUndefined();
		});
		it('returns dueDate when no reminderOffset', () => {
			expect(computeReminderAt(makeTask({ dueDate: 10000 }))).toBe(10000);
		});
		it('subtracts offset in minutes', () => {
			expect(computeReminderAt(makeTask({ dueDate: 10000, reminderOffset: 30 }))).toBe(10000 - 30 * 60 * 1000);
		});
	});

	describe('isReminderDue', () => {
		it('true when reminderAt passed, no remindedAt, not snoozed, not done', () => {
			const now = 100000;
			const task = makeTask({ dueDate: now - 1000, reminderOffset: 0 });
			expect(isReminderDue(task, now)).toBe(true);
		});
		it('false when done', () => {
			expect(isReminderDue(makeTask({ status: 'done', dueDate: 100, reminderOffset: 0 }), 200)).toBe(false);
		});
		it('false when already reminded', () => {
			expect(isReminderDue(makeTask({ dueDate: 100, reminderOffset: 0, remindedAt: 150 }), 200)).toBe(false);
		});
		it('false when snoozedUntil in future', () => {
			expect(isReminderDue(makeTask({ dueDate: 100, reminderOffset: 0, snoozedUntil: 300 }), 200)).toBe(false);
		});
		it('true when snoozedUntil passed', () => {
			expect(isReminderDue(makeTask({ dueDate: 100, reminderOffset: 0, snoozedUntil: 150 }), 200)).toBe(true);
		});
		it('false when reminderAt in future', () => {
			expect(isReminderDue(makeTask({ dueDate: 500, reminderOffset: 0 }), 200)).toBe(false);
		});
	});

	describe('getDueReminders', () => {
		it('sorts by reminderAt ascending', () => {
			const now = 1000;
			const tasks = [
				makeTask({ id: 'later', dueDate: 900, reminderOffset: 0 }),
				makeTask({ id: 'earlier', dueDate: 100, reminderOffset: 0 }),
			];
			const r = getDueReminders(tasks, now);
			expect(r.map(t => t.id)).toEqual(['earlier', 'later']);
		});
	});

	describe('getOverdueReminders / isOverdueUnreminded', () => {
		it('overdue captures tasks without reminderOffset', () => {
			const now = 1000;
			const task = makeTask({ id: 'od', dueDate: 500 });
			expect(isOverdueUnreminded(task, now)).toBe(true);
			expect(getOverdueReminders([task], now)).toHaveLength(1);
		});
		it('excludes done and reminded', () => {
			const now = 1000;
			expect(isOverdueUnreminded(makeTask({ status: 'done', dueDate: 500 }), now)).toBe(false);
			expect(isOverdueUnreminded(makeTask({ dueDate: 500, remindedAt: 800 }), now)).toBe(false);
		});
	});

	describe('getMissedReminders', () => {
		it('merges due + overdue, dedups, sorts by dueDate', () => {
			const now = 1000;
			const tasks = [
				makeTask({ id: 'withOffset', dueDate: 900, reminderOffset: 100 }), // reminderAt=800 <= now → due
				makeTask({ id: 'noOffset', dueDate: 500 }), // overdue (no offset)
			];
			const r = getMissedReminders(tasks, now);
			expect(r.map(t => t.id).sort()).toEqual(['noOffset', 'withOffset'].sort());
			expect(new Set(r.map(t => t.id)).size).toBe(2);
		});
	});

	describe('deadline-based reminders', () => {
		it('uses dueEnd as reminder base when only dueEnd set', () => {
			expect(computeReminderAt(makeTask({ dueEnd: 10000, reminderOffset: 30 }))).toBe(10000 - 30 * 60 * 1000);
		});
		it('uses dueStart as deadline fallback when neither dueEnd nor dueDate set', () => {
			expect(computeReminderAt(makeTask({ dueStart: 8000, reminderOffset: 10 }))).toBe(8000 - 10 * 60 * 1000);
		});
		it('getOverdueReminders treats task overdue when getTaskDeadline passed', () => {
			const now = 10_000;
			const task = makeTask({ id: 'od-end', dueEnd: 5000, status: 'todo' });
			expect(isOverdueUnreminded(task, now)).toBe(true);
			const task2 = makeTask({ id: 'od-future', dueEnd: 15000, status: 'todo' });
			expect(isOverdueUnreminded(task2, now)).toBe(false);
		});
	});
});
