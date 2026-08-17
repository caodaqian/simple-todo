import type { StickyNoteSource, StickyTaskGroup, StickyTaskItem } from '../types/stickyNote';
import type { Task, TaskPriority, TaskSortInput, TaskStatus } from '../types/task';
import { getTaskStart } from '../types/task';
import { DEFAULT_TASK_SORT_CONFIG } from './filterUtils';
import { searchAndSortTasks, sortTasks } from './searchService';

const statusOrder: TaskStatus[] = ['todo', 'doing', 'done'];
const statusLabels: Record<TaskStatus, string> = {
	todo: '待办',
	doing: '进行中',
	done: '已完成',
};

const priorityGroups: Array<{ key: TaskPriority; title: string }> = [
	{ key: 'urgent', title: '重要且紧急' },
	{ key: 'high', title: '重要不紧急' },
	{ key: 'medium', title: '紧急不重要' },
	{ key: 'low', title: '不重要不紧急' },
];

interface StickyProjectionContext {
	taskById: Map<string, Task>;
	childrenByParentId: Map<string, Task[]>;
}

const createStickyProjectionContext = (tasks: Task[], sort: TaskSortInput): StickyProjectionContext => {
	const taskById = new Map(tasks.map((task) => [task.id, task]));
	const childrenByParentId = new Map<string, Task[]>();

	for (const task of tasks) {
		if (!task.parentTaskId) continue;
		const children = childrenByParentId.get(task.parentTaskId) ?? [];
		children.push(task);
		childrenByParentId.set(task.parentTaskId, sortTasks(children, sort));
	}

	return { taskById, childrenByParentId };
};

const getTaskDepth = (task: Task, context: StickyProjectionContext): number => {
	const visited = new Set<string>([task.id]);
	let depth = 0;
	let parentId = task.parentTaskId;

	while (parentId && !visited.has(parentId)) {
		visited.add(parentId);
		depth += 1;
		parentId = context.taskById.get(parentId)?.parentTaskId;
	}

	return depth;
};

const toStickyTaskItem = (task: Task, context: StickyProjectionContext, visited = new Set<string>()): StickyTaskItem => {
	const directChildren = context.childrenByParentId.get(task.id) ?? [];
	const children = visited.has(task.id)
		? []
		: directChildren.map((child) => toStickyTaskItem(child, context, new Set([...visited, task.id])));
	const parentTitle = task.parentTaskId ? context.taskById.get(task.parentTaskId)?.title : undefined;

	return {
		task,
		depth: getTaskDepth(task, context),
		...(parentTitle ? { parentTitle } : {}),
		children,
		subtaskTotal: directChildren.length,
		subtaskCompleted: directChildren.filter((child) => child.status === 'done').length,
	};
};

const orderTasksByParent = (tasks: Task[]): Task[] => {
	const taskIds = new Set(tasks.map((task) => task.id));
	const childTasksByParent = new Map<string, Task[]>();
	const appendedIds = new Set<string>();
	const ordered: Task[] = [];

	for (const task of tasks) {
		if (!task.parentTaskId) continue;
		const siblings = childTasksByParent.get(task.parentTaskId) ?? [];
		siblings.push(task);
		childTasksByParent.set(task.parentTaskId, siblings);
	}

	for (const task of tasks) {
		if (task.parentTaskId) continue;
		ordered.push(task);
		appendedIds.add(task.id);
		for (const child of childTasksByParent.get(task.id) ?? []) {
			ordered.push(child);
			appendedIds.add(child.id);
		}
	}

	for (const task of tasks) {
		if (!task.parentTaskId || appendedIds.has(task.id) || taskIds.has(task.parentTaskId)) continue;
		ordered.push(task);
		appendedIds.add(task.id);
	}

	return ordered;
};

const compactEmptyGroups = (groups: StickyTaskGroup[]): StickyTaskGroup[] => {
	return groups.filter((group) => group.tasks.length > 0);
};

const formatDateGroup = (timestamp: number): string => {
	return new Date(timestamp).toLocaleDateString('zh-CN', {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
	});
};

const buildListGroups = (tasks: Task[], source: StickyNoteSource, context: StickyProjectionContext): StickyTaskGroup[] => ([{
	key: 'list',
	title: source.title,
	tasks: orderTasksByParent(tasks).map((task) => toStickyTaskItem(task, context)),
}]);

const buildKanbanGroups = (tasks: Task[], context: StickyProjectionContext): StickyTaskGroup[] => compactEmptyGroups(statusOrder.map((status) => ({
	key: status,
	title: statusLabels[status],
	tasks: orderTasksByParent(tasks.filter((task) => task.status === status)).map((task) => toStickyTaskItem(task, context)),
})));

const buildEisenhowerGroups = (tasks: Task[], context: StickyProjectionContext): StickyTaskGroup[] => compactEmptyGroups(priorityGroups.map((group) => ({
	key: group.key,
	title: group.title,
	tasks: orderTasksByParent(tasks.filter((task) => task.priority === group.key)).map((task) => toStickyTaskItem(task, context)),
})));

const buildCalendarGroups = (tasks: Task[], context: StickyProjectionContext): StickyTaskGroup[] => {
	const groups = new Map<string, StickyTaskItem[]>();
	for (const task of tasks) {
		const start = getTaskStart(task);
		if (start === undefined) continue;
		const key = formatDateGroup(start);
		groups.set(key, [...(groups.get(key) ?? []), toStickyTaskItem(task, context)]);
	}
	return [...groups.entries()].map(([title, items]) => ({
		key: title,
		title,
		tasks: orderTasksByParent(items.map((item) => item.task)).map((task) => toStickyTaskItem(task, context)),
	}));
};

export const buildStickyTaskGroups = (tasks: Task[], source: StickyNoteSource): StickyTaskGroup[] => {
	const sort = source.sort ?? DEFAULT_TASK_SORT_CONFIG;
	const filtered = searchAndSortTasks(tasks, source.filter, sort);
	const context = createStickyProjectionContext(tasks, sort);
	switch (source.view) {
		case 'kanban':
			return buildKanbanGroups(filtered, context);
		case 'eisenhower':
			return buildEisenhowerGroups(filtered, context);
		case 'calendar':
			return buildCalendarGroups(filtered, context);
		case 'list':
		default:
			return buildListGroups(filtered, source, context);
	}
};
