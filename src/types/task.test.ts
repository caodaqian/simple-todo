import { describe, expect, it } from 'vitest';
import type { Task } from './task';
import { getTaskDeadline, getTaskEnd, getTaskStart, normalizeDateRange } from './task';

const base = { id: 't', title: 'T', status: 'todo', priority: 'medium', tags: [], group: '', description: '', subtasks: [], createdAt: 1, updatedAt: 1 } as unknown as Task;

describe('getTaskDeadline', () => {
  it('returns undefined when no due fields', () => {
    expect(getTaskDeadline(base)).toBeUndefined();
  });
  it('prefers dueEnd over dueStart/dueDate', () => {
    expect(getTaskDeadline({ ...base, dueStart: 100, dueEnd: 200, dueDate: 300 } as Task)).toBe(200);
  });
  it('falls back to dueStart when no dueEnd', () => {
    expect(getTaskDeadline({ ...base, dueStart: 500 } as Task)).toBe(500);
  });
  it('falls back to legacy dueDate when no dueStart/dueEnd', () => {
    expect(getTaskDeadline({ ...base, dueDate: 700 } as Task)).toBe(700);
  });
});

describe('getTaskEnd aligns with deadline', () => {
  it('returns dueEnd first, then dueStart, then dueDate', () => {
    expect(getTaskEnd({ ...base, dueStart: 100, dueEnd: 200 } as Task)).toBe(200);
    expect(getTaskEnd({ ...base, dueStart: 100 } as Task)).toBe(100);
    expect(getTaskEnd({ ...base, dueDate: 50 } as Task)).toBe(50);
  });
});

describe('normalizeDateRange', () => {
  it('returns empty when both undefined', () => {
    expect(normalizeDateRange(undefined, undefined)).toEqual({});
  });
  it('normalizes a single point to dueEnd only', () => {
    expect(normalizeDateRange(100, undefined)).toEqual({ dueEnd: 100 });
    expect(normalizeDateRange(undefined, 100)).toEqual({ dueEnd: 100 });
  });
  it('keeps equal timestamps as a single point', () => {
    expect(normalizeDateRange(100, 100)).toEqual({ dueEnd: 100 });
  });
  it('sorts two distinct timestamps ascending', () => {
    expect(normalizeDateRange(300, 100)).toEqual({ dueStart: 100, dueEnd: 300 });
    expect(normalizeDateRange(100, 300)).toEqual({ dueStart: 100, dueEnd: 300 });
  });
});