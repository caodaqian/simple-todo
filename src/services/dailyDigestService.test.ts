import { describe, expect, it } from 'vitest';
import type { Task } from '../types/task';
import { buildDailyDigest, isDailyDigestDue } from './dailyDigestService';

const task = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1', title: '任务', status: 'todo', priority: 'medium', tags: [], group: '', description: '', subtasks: [], createdAt: 1, updatedAt: 1, ...overrides,
});

describe('dailyDigestService', () => {
	it('runs once after the configured local time and builds completed, due and overdue sections', () => {
		const now = Date.UTC(2026, 7, 9, 1, 30);
		expect(isDailyDigestDue(now, '09:00', 'Asia/Shanghai')).toBe(true);
		expect(isDailyDigestDue(now, '10:00', 'Asia/Shanghai')).toBe(false);
		const digest = buildDailyDigest([
			task({ id: 'done', status: 'done', completedAt: Date.UTC(2026, 7, 9, 1) }),
			task({ id: 'due', dueEnd: Date.UTC(2026, 7, 9, 4) }),
			task({ id: 'overdue', dueEnd: Date.UTC(2026, 7, 8, 4) }),
		], now, 'Asia/Shanghai');
		expect(digest.dateKey).toBe('2026-08-09');
		expect(digest.completed.map((item) => item.id)).toEqual(['done']);
		expect(digest.due.map((item) => item.id)).toEqual(['due']);
		expect(digest.overdue.map((item) => item.id)).toEqual(['overdue']);
		expect(digest.activeCount).toBe(2);
	});
});
