import { computed } from 'vue';
import type { Task } from '../types/task';

export function useTaskHierarchy(tasks: () => readonly Task[]): {
	getTaskDepth: (task: Task) => number;
	getParentTitle: (task: Task) => string;
} {
	const taskById = computed(() => new Map(tasks().map((task) => [task.id, task])));

	const getTaskDepth = (task: Task): number => {
		if (!task.parentTaskId) return 0;

		const visited = new Set<string>([task.id]);
		let depth = 0;
		let parentId: string | undefined = task.parentTaskId;

		while (parentId && !visited.has(parentId)) {
			visited.add(parentId);
			depth += 1;
			parentId = taskById.value.get(parentId)?.parentTaskId;
		}

		return depth;
	};

	const getParentTitle = (task: Task): string => {
		if (!task.parentTaskId) return '';
		return taskById.value.get(task.parentTaskId)?.title ?? '';
	};

	return { getTaskDepth, getParentTitle };
}