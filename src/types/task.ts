export type TaskStatus = 'todo' | 'doing' | 'done';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Subtask {
	/** @deprecated 子任务已迁移为带 parentTaskId 的完整 Task；此类型仅用于旧数据兼容。 */
	id: string;
	title: string;
	completed: boolean;
	createdAt: number;
	updatedAt: number;
	/** 最近一次标记完成的时间戳；恢复未完成时清除。 */
	completedAt?: number;
}

export type RepeatType = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface RepeatRule {
	type: RepeatType;
	/** custom 时为天数；daily=每 N 天，weekly=每 N 周，monthly=每 N 月 */
	interval: number;
	/** 可选：到此时间戳后停止生成下一个实例 */
	repeatUntil?: number;
	/** 可选：最多生成这么多次（不含原始任务） */
	repeatCount?: number;
	/** 已生成实例次数，用于对比 repeatCount */
	generatedCount?: number;
}

export interface Task {
	id: string;
	/** 父任务 id；存在时当前任务是该父任务的直接子任务。 */
	parentTaskId?: string;
	title: string;
	status: TaskStatus;
	/** @deprecated 用 dueStart 替代；保留以兼容旧数据 */
	dueDate?: number;
	/** 截止开始时间戳（可单独存在，表示瞬时任务） */
	dueStart?: number;
	/** 截止结束时间戳（存在时表示时间段任务） */
	dueEnd?: number;
	/** 全天任务：仅日期，无具体时刻。true 时 dueStart 取当天 00:00 */
	allDay?: boolean;
	priority: TaskPriority;
	tags: string[];
	group: string;
	description: string;
	/** @deprecated 子任务已迁移为扁平 Task；保留用于读取历史嵌套数据。 */
	subtasks: Subtask[];
	createdAt: number;
	updatedAt: number;
	/** 最近一次标记完成的时间戳；恢复未完成时清除。 */
	completedAt?: number;
	/** 提前 dueDate 多少分钟提醒；运行时算 reminderAt = dueDate - offset*60000 */
	reminderOffset?: number;
	/** 上次已提醒时间戳；任务被更新后应重置为 undefined */
	remindedAt?: number;
	/** 推迟提醒到期时间戳；<=now 时允许再次触发，触发后清空 */
	snoozedUntil?: number;
	/** 重复规则；存在时任务标记 done 会自动生成下一实例 */
	repeat?: RepeatRule;
	/** 归档时间戳；存在时默认列表/筛选不显示，仅在归档视图展示。 */
	archivedAt?: number;
}

export interface TaskTemplate {
	id: string;
	name: string;
	title: string;
	priority: TaskPriority;
	tags: string[];
	group: string;
	description: string;
	/** 模板套用时创建为完整子任务的标题列表。 */
	children?: string[];
	/** @deprecated 使用 children；保留以读取历史模板。 */
	subtasks: Subtask[];
	reminderOffset?: number;
	repeat?: RepeatRule;
	createdAt: number;
	updatedAt: number;
}

type TaskEditableFields = Omit<
	Task,
	'id' | 'parentTaskId' | 'createdAt' | 'updatedAt' | 'completedAt' | 'subtasks' | 'dueDate' | 'dueStart' | 'dueEnd' | 'allDay' | 'remindedAt'
> & {
	parentTaskId?: string | undefined;
	dueDate?: number | undefined;
	dueStart?: number | undefined;
	dueEnd?: number | undefined;
	allDay?: boolean | undefined;
	reminderOffset?: number | undefined;
	snoozedUntil?: number | undefined;
	repeat?: RepeatRule | undefined;
	archivedAt?: number | undefined;
	completedAt?: number | undefined;
	/** 允许在 update 时显式重置 remindedAt（写 undefined） */
	remindedAt?: number | undefined;
};

export type CreateTaskInput = TaskEditableFields & {
	subtasks?: Subtask[];
};

export type SaveTaskInput = CreateTaskInput & {
	id?: string;
	createdAt?: number;
	updatedAt?: number;
	dueDate?: number | undefined;
	dueStart?: number | undefined;
	dueEnd?: number | undefined;
	allDay?: boolean | undefined;
	completedAt?: number | undefined;
};

export type UpdateTaskInput = Partial<
	TaskEditableFields
> & {
	subtasks?: Subtask[];
	dueDate?: number | undefined;
	dueStart?: number | undefined;
	dueEnd?: number | undefined;
	allDay?: boolean | undefined;
};

export interface TaskDateRange {
	start?: number;
	end?: number;
}

export type TagMatchMode = 'any' | 'all';

export interface TaskSearchFilter {
	keyword?: string;
	tags?: string[];
	tagMatchMode?: TagMatchMode;
	group?: string;
	dateRange?: TaskDateRange;
	status?: TaskStatus | TaskStatus[];
	priority?: TaskPriority | TaskPriority[];
	showCompleted?: boolean;
	archived?: boolean;
}

export type TaskSortField = 'priority' | 'dueDate' | 'createdAt' | 'updatedAt';

export type TaskSortOrder = 'asc' | 'desc';

export interface TaskSortOption {
	field: TaskSortField;
	order?: TaskSortOrder;
}

/**
 * 任务的起始时间戳。
 * 优先 dueStart，回退到旧 dueDate（兼容历史数据）。
 */
export const getTaskStart = (task: Pick<Task, 'dueStart' | 'dueDate'>): number | undefined => {
	return task.dueStart ?? task.dueDate;
};

/**
 * 任务的结束时间戳。
 * 优先 dueEnd，回退到 dueStart/dueDate（瞬时任务结束=开始）。
 */
export const getTaskEnd = (task: Pick<Task, 'dueEnd' | 'dueStart' | 'dueDate'>): number | undefined => {
	return task.dueEnd ?? task.dueStart ?? task.dueDate;
};

export interface CountedValue {
	name: string;
	count: number;
}

export interface TaskOverview {
	total: number;
	byStatus: Record<TaskStatus, number>;
	byPriority: Record<TaskPriority, number>;
	overdue: number;
	dueToday: number;
	noDueDate: number;
}

export interface TaskImportResult {
	importedCount: number;
	duplicateCount: number;
	invalidCount: number;
}

export interface TaskDateRules {
	now: number;
	startOfToday: number;
	endOfToday: number;
	endOfRecentDays: number;
	recentDays: number;
}
