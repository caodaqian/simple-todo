import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Task } from '../types/task';
import { useTaskHierarchy } from './useTaskHierarchy';

const makeTask = (overrides: Partial<Task>): Task => ({
	id: 'task',
	title: '任务',
	status: 'todo',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe('useTaskHierarchy', () => {
	it('returns task depth and direct parent title', () => {
		const root = makeTask({ id: 'root', title: '父任务' });
		const child = makeTask({ id: 'child', title: '子任务', parentTaskId: root.id });
		const grandchild = makeTask({ id: 'grandchild', title: '孙任务', parentTaskId: child.id });
		const tasks = ref<Task[]>([root, child, grandchild]);
		const { getTaskDepth, getParentTitle } = useTaskHierarchy(() => tasks.value);

		expect(getTaskDepth(root)).toBe(0);
		expect(getTaskDepth(child)).toBe(1);
		expect(getTaskDepth(grandchild)).toBe(2);
		expect(getParentTitle(grandchild)).toBe('子任务');
	});

	it('stops depth calculation when hierarchy contains a cycle', () => {
		const a = makeTask({ id: 'a', title: 'A', parentTaskId: 'b' });
		const b = makeTask({ id: 'b', title: 'B', parentTaskId: 'a' });
		const tasks = ref<Task[]>([a, b]);
		const { getTaskDepth, getParentTitle } = useTaskHierarchy(() => tasks.value);

		expect(getTaskDepth(a)).toBe(1);
		expect(getParentTitle(a)).toBe('B');
	});

	it('reacts to task list changes', () => {
		const child = makeTask({ id: 'child', title: '子任务', parentTaskId: 'missing' });
		const tasks = ref<Task[]>([child]);
		const { getParentTitle } = useTaskHierarchy(() => tasks.value);

		expect(getParentTitle(child)).toBe('');

		tasks.value = [makeTask({ id: 'missing', title: '补上的父任务' }), child];

		expect(getParentTitle(child)).toBe('补上的父任务');
	});
});