import type {
	CountedValue,
	TagMatchMode,
	Task,
	TaskDateRange,
	TaskDateRules,
	TaskOverview,
	TaskPriority,
	TaskSearchFilter,
	TaskSortOption,
	TaskStatus,
} from '../types/task';
import { getTaskDeadline, getTaskEnd, getTaskStart } from '../types/task';

const PRIORITY_RANK: Record<TaskPriority, number> = {
	low: 1,
	medium: 2,
	high: 3,
	urgent: 4,
};

const DEFAULT_TAG_MATCH_MODE: TagMatchMode = 'any';

const normalizeText = (value: string): string => value.trim().toLowerCase();

export const getTaskDateRules = (now = Date.now(), recentDays = 7): TaskDateRules => {
	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);

	const endOfToday = new Date(now);
	endOfToday.setHours(23, 59, 59, 999);

	const endOfRecentDays = new Date(endOfToday.getTime() + (Math.max(recentDays, 1) - 1) * 24 * 60 * 60 * 1000);

	return {
		now,
		startOfToday: startOfToday.getTime(),
		endOfToday: endOfToday.getTime(),
		endOfRecentDays: endOfRecentDays.getTime(),
		recentDays,
	};
};

const isActiveTask = (task: Task): boolean => task.status !== 'done';

export const isTaskDueToday = (task: Task, rules: TaskDateRules): boolean => {
	const deadline = getTaskDeadline(task);
	return deadline !== undefined && deadline >= rules.startOfToday && deadline <= rules.endOfToday;
};

export const isTaskInRecentDays = (task: Task, rules: TaskDateRules): boolean => {
	const deadline = getTaskDeadline(task);
	return deadline !== undefined && deadline >= rules.startOfToday && deadline <= rules.endOfRecentDays;
};

export const isTaskOverdue = (task: Task, rules: TaskDateRules): boolean => {
	const end = getTaskEnd(task);
	return isActiveTask(task) && end !== undefined && end < rules.startOfToday;
};

export const isTaskUrgent = (task: Task, rules: TaskDateRules): boolean => {
	const end = getTaskEnd(task);
	return isActiveTask(task) && end !== undefined && end <= rules.endOfToday;
};

const normalizeStatuses = (status?: TaskStatus | TaskStatus[]): Set<TaskStatus> | null => {
	if (!status) {
		return null;
	}

	return new Set(Array.isArray(status) ? status : [status]);
};

const normalizePriorities = (priority?: TaskPriority | TaskPriority[]): Set<TaskPriority> | null => {
	if (!priority) {
		return null;
	}

	return new Set(Array.isArray(priority) ? priority : [priority]);
};

const isInDateRange = (task: Task, range: TaskDateRange): boolean => {
	const deadline = getTaskDeadline(task);
	const taskStart = getTaskStart(task) ?? deadline;
	const taskEnd = getTaskEnd(task) ?? deadline;
	if (taskStart === undefined || taskEnd === undefined) {
		return false;
	}

	const rangeStart = range.start;
	const rangeEnd = range.end;

	// 区间交集：task [start, end] 与 [rangeStart, rangeEnd] 有重叠
	if (rangeStart !== undefined && rangeEnd !== undefined) {
		const min = Math.min(rangeStart, rangeEnd);
		const max = Math.max(rangeStart, rangeEnd);
		return taskEnd >= min && taskStart <= max;
	}
	if (rangeStart !== undefined && taskEnd < rangeStart) {
		return false;
	}
	if (rangeEnd !== undefined && taskStart > rangeEnd) {
		return false;
	}
	return true;
};

const matchesKeyword = (task: Task, keyword: string): boolean => {
	const normalizedKeyword = normalizeText(keyword);
	if (!normalizedKeyword) {
		return true;
	}

	const title = normalizeText(task.title);
	const description = normalizeText(task.description);
	return title.includes(normalizedKeyword) || description.includes(normalizedKeyword);
};

const matchesTitleKeyword = (task: Task, keyword: string): boolean => {
	const normalizedKeyword = normalizeText(keyword);
	return !normalizedKeyword || normalizeText(task.title).includes(normalizedKeyword);
};

const matchesTags = (task: Task, tags: string[], mode: TagMatchMode): boolean => {
	if (tags.length === 0) {
		return true;
	}

	const requiredTags = tags.map(normalizeText).filter(Boolean);
	if (requiredTags.length === 0) {
		return true;
	}

	const taskTags = new Set(task.tags.map(normalizeText));

	if (mode === 'all') {
		return requiredTags.every((tag) => taskTags.has(tag));
	}

	return requiredTags.some((tag) => taskTags.has(tag));
};

const compareDueDate = (left: Task, right: Task, order: 'asc' | 'desc'): number => {
	const leftDueDate = getTaskDeadline(left);
	const rightDueDate = getTaskDeadline(right);

	if (leftDueDate === undefined && rightDueDate === undefined) {
		return 0;
	}

	if (leftDueDate === undefined) {
		return 1;
	}

	if (rightDueDate === undefined) {
		return -1;
	}

	return order === 'desc' ? rightDueDate - leftDueDate : leftDueDate - rightDueDate;
};

const compareBySortOption = (left: Task, right: Task, option: TaskSortOption): number => {
	const order = option.order ?? 'asc';
	const direction = order === 'desc' ? -1 : 1;

	switch (option.field) {
		case 'priority':
			return (PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]) * direction;
		case 'dueDate':
			return compareDueDate(left, right, order);
		case 'createdAt':
			return (left.createdAt - right.createdAt) * direction;
		case 'updatedAt':
			return (left.updatedAt - right.updatedAt) * direction;
		default:
			return 0;
	}
};

export const filterTasks = (tasks: Task[], filter: TaskSearchFilter = {}): Task[] => {
	const {
		keyword,
		titleKeyword,
		tags = [],
		tagMatchMode = DEFAULT_TAG_MATCH_MODE,
		group,
		dateRange,
		status,
		priority,
		showCompleted = false,
		archived,
	} = filter;

	const normalizedGroup = group ? normalizeText(group) : '';
	const statusSet = normalizeStatuses(status);
	const prioritySet = normalizePriorities(priority);

	// Default behavior hides archived tasks. Archived views opt in with archived=true.
	const source = tasks.filter((task) => {
		const isArchived = task.archivedAt !== undefined;
		if (archived === true) return isArchived;
		if (archived === false) return !isArchived;
		return !isArchived;
	});

	return source.filter((task) => {
		// When no explicit status filter is set and showCompleted is false, exclude done tasks.
		if (!statusSet && !showCompleted && task.status === 'done') {
			return false;
		}

		if (keyword && !matchesKeyword(task, keyword)) {
			return false;
		}

		if (titleKeyword && !matchesTitleKeyword(task, titleKeyword)) {
			return false;
		}

		if (!matchesTags(task, tags, tagMatchMode)) {
			return false;
		}

		if (normalizedGroup && normalizeText(task.group) !== normalizedGroup) {
			return false;
		}

		if (dateRange && !isInDateRange(task, dateRange)) {
			return false;
		}

		if (statusSet && !statusSet.has(task.status)) {
			return false;
		}

		if (prioritySet && !prioritySet.has(task.priority)) {
			return false;
		}

		return true;
	});
};

export const sortTasks = (tasks: Task[], sortOption?: TaskSortOption): Task[] => {
	if (!sortOption) {
		return [...tasks];
	}

	return tasks
		.map((task, index) => ({ task, index }))
		.sort((left, right) => {
			const compared = compareBySortOption(left.task, right.task, sortOption);
			if (compared !== 0) {
				return compared;
			}

			return left.index - right.index;
		})
		.map(({ task }) => task);
};

export const searchAndSortTasks = (
	tasks: Task[],
	filter: TaskSearchFilter = {},
	sortOption?: TaskSortOption,
): Task[] => {
	const filtered = filterTasks(tasks, filter);
	return sortTasks(filtered, sortOption);
};

const countValues = (values: string[]): CountedValue[] => {
	const counter = new Map<string, { name: string; count: number }>();

	for (const value of values) {
		const normalized = normalizeText(value);
		if (!normalized) {
			continue;
		}

		const existing = counter.get(normalized);
		if (existing) {
			existing.count += 1;
			continue;
		}

		counter.set(normalized, {
			name: value.trim(),
			count: 1,
		});
	}

	return Array.from(counter.values()).sort((left, right) => {
		if (left.count !== right.count) {
			return right.count - left.count;
		}

		return left.name.localeCompare(right.name, 'zh-Hans-CN');
	});
};

export const extractTaskTags = (
	tasks: Task[],
): CountedValue[] => {
	const tagValues: string[] = [];

	for (const task of tasks) {
		const uniqueTags = new Set(task.tags.map((tag) => tag.trim()).filter(Boolean));
		for (const tag of uniqueTags) {
			tagValues.push(tag);
		}
	}

	return countValues(tagValues);
};

export const extractTaskGroups = (
	tasks: Task[],
): CountedValue[] => {
	return countValues(tasks.map((task) => task.group));
};

export const buildTaskOverview = (
	tasks: Task[],
	options: { nowTs?: number } = {},
): TaskOverview => {
	const source = [...tasks];

	const byStatus: Record<TaskStatus, number> = {
		todo: 0,
		doing: 0,
		done: 0,
	};

	const byPriority: Record<TaskPriority, number> = {
		low: 0,
		medium: 0,
		high: 0,
		urgent: 0,
	};

	const now = options.nowTs ?? Date.now();
	const rules = getTaskDateRules(now);

	let overdue = 0;
	let dueToday = 0;
	let noDueDate = 0;

	for (const task of source) {
		byStatus[task.status] += 1;
		byPriority[task.priority] += 1;

		if (getTaskStart(task) === undefined) {
			noDueDate += 1;
			continue;
		}

		if (isTaskOverdue(task, rules)) {
			overdue += 1;
			continue;
		}

		if (isTaskDueToday(task, rules)) {
			dueToday += 1;
		}
	}

	return {
		total: source.length,
		byStatus,
		byPriority,
		overdue,
		dueToday,
		noDueDate,
	};
};

export const searchService = {
	filterTasks,
	sortTasks,
	searchAndSortTasks,
	extractTaskTags,
	extractTaskGroups,
	buildTaskOverview,
	getTaskDateRules,
	isTaskDueToday,
	isTaskInRecentDays,
	isTaskOverdue,
	isTaskUrgent,
};
