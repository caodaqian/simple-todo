import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import { buildNextInstance, computeNextDueDate, shouldSpawnNext } from './repeatService';

const makeTask = (overrides: { [K in keyof Task]?: Task[K] | undefined } = {}): Task => {
	const base: Task = {
		id: 't1',
		title: 'T',
		status: 'todo',
		priority: 'high',
		tags: ['a'],
		group: 'G',
		description: 'd',
		subtasks: [{ id: 's1', title: '子', completed: false, createdAt: 1, updatedAt: 1 }],
		createdAt: 1000,
		updatedAt: 1000,
		dueDate: new Date('2026-07-01T09:00:00Z').getTime(),
		reminderOffset: 15,
		repeat: { type: 'daily', interval: 1, generatedCount: 0 },
	};
	const { id, parentTaskId, title, status, priority, tags, group, description, subtasks, createdAt, updatedAt, dueDate, reminderOffset, remindedAt, snoozedUntil, repeat } = overrides as Partial<Task>;
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
	if ('parentTaskId' in overrides && parentTaskId !== undefined) {
		result.parentTaskId = parentTaskId;
	}
	if ('dueDate' in overrides) {
		if (dueDate !== undefined) result.dueDate = dueDate;
	} else {
		result.dueDate = base.dueDate!;
	}
	if ('reminderOffset' in overrides) {
		if (reminderOffset !== undefined) result.reminderOffset = reminderOffset;
	} else if (base.reminderOffset !== undefined) {
		result.reminderOffset = base.reminderOffset;
	}
	if ('remindedAt' in overrides) {
		if (remindedAt !== undefined) result.remindedAt = remindedAt;
	}
	if ('snoozedUntil' in overrides) {
		if (snoozedUntil !== undefined) result.snoozedUntil = snoozedUntil;
	}
	if ('repeat' in overrides) {
		if (repeat !== undefined) result.repeat = repeat;
	} else if (base.repeat !== undefined) {
		result.repeat = base.repeat;
	}
	return result;
};

describe('repeatService', () => {
	describe('computeNextDueDate', () => {
		it('daily adds interval days', () => {
			const t = makeTask({ repeat: { type: 'daily', interval: 3 } });
			const next = computeNextDueDate(t);
			expect(next).toBe(t.dueDate! + 3 * 86400 * 1000);
		});
		it('weekly adds interval weeks', () => {
			const t = makeTask({ repeat: { type: 'weekly', interval: 2 } });
			expect(computeNextDueDate(t)).toBe(t.dueDate! + 14 * 86400 * 1000);
		});
		it('monthly advances month', () => {
			const t = makeTask({ repeat: { type: 'monthly', interval: 1 } });
			const next = computeNextDueDate(t);
			expect(new Date(next).getUTCMonth()).toBe(new Date(t.dueDate!).getUTCMonth() + 1);
		});
		it('custom adds interval days', () => {
			const t = makeTask({ repeat: { type: 'custom', interval: 10 } });
			expect(computeNextDueDate(t)).toBe(t.dueDate! + 10 * 86400 * 1000);
		});
		it('falls back to now when no dueDate', () => {
			const t = makeTask({ dueDate: undefined, repeat: { type: 'daily', interval: 1 } });
			const now = 5000;
			expect(computeNextDueDate(t, now)).toBe(now + 86400 * 1000);
		});
		it('throws without repeat', () => {
			expect(() => computeNextDueDate(makeTask({ repeat: undefined }))).toThrow();
		});
	});

	describe('shouldSpawnNext', () => {
		it('true when done with valid repeat', () => {
			expect(shouldSpawnNext(makeTask({ status: 'done' }))).toBe(true);
		});
		it('false when not done', () => {
			expect(shouldSpawnNext(makeTask({ status: 'todo' }))).toBe(false);
		});
		it('false when no repeat', () => {
			expect(shouldSpawnNext(makeTask({ status: 'done', repeat: undefined }))).toBe(false);
		});
		it('false when repeatUntil exceeded', () => {
			const t = makeTask({
				status: 'done',
				dueDate: new Date('2026-12-05T00:00:00Z').getTime(),
				repeat: { type: 'daily', interval: 1, repeatUntil: new Date('2026-12-02T00:00:00Z').getTime() },
			});
			expect(shouldSpawnNext(t)).toBe(false);
		});
		it('false when repeatCount reached', () => {
			const t = makeTask({ status: 'done', repeat: { type: 'daily', interval: 1, repeatCount: 5, generatedCount: 5 } });
			expect(shouldSpawnNext(t)).toBe(false);
		});
		it('true when generatedCount below repeatCount', () => {
			const t = makeTask({ status: 'done', repeat: { type: 'daily', interval: 1, repeatCount: 5, generatedCount: 3 } });
			expect(shouldSpawnNext(t)).toBe(true);
		});
	});

	describe('buildNextInstance', () => {
		it('creates new todo task with advanced dueDate and incremented generatedCount', () => {
			const t = makeTask({ status: 'done' });
			const next = buildNextInstance(t, 2000);
			expect(next.id).not.toBe(t.id);
			expect(next.status).toBe('todo');
			expect(next.dueDate).toBe(t.dueDate! + 86400 * 1000);
			expect(next.repeat?.generatedCount).toBe(1);
			expect(next.reminderOffset).toBe(15);
			expect(next.remindedAt).toBeUndefined();
			expect(next.snoozedUntil).toBeUndefined();
		});
		it('resets subtasks to uncompleted with new ids', () => {
			const t = makeTask({ status: 'done' });
			const next = buildNextInstance(t, 2000);
			expect(next.subtasks).toHaveLength(1);
			expect(next.subtasks[0]!.id).not.toBe('s1');
			expect(next.subtasks[0]!.completed).toBe(false);
		});
		it('keeps parentTaskId when repeating a child task', () => {
			const t = makeTask({ status: 'done', parentTaskId: 'parent-1' });
			const next = buildNextInstance(t, 2000);
			expect(next.parentTaskId).toBe('parent-1');
		});
		it('throws without repeat', () => {
			expect(() => buildNextInstance(makeTask({ repeat: undefined }), 2000)).toThrow();
		});
	});
});
