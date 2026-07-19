import type {
	TagMatchMode,
	TaskDateRange,
	TaskPriority,
	TaskSearchFilter,
	TaskSortField,
	TaskSortOption,
	TaskSortOrder,
	TaskStatus,
} from '../types/task';

export const PRIORITY_OPTIONS: ReadonlyArray<TaskPriority> = ['low', 'medium', 'high', 'urgent'];
export const STATUS_OPTIONS: ReadonlyArray<TaskStatus> = ['todo', 'doing', 'done'];
export const TAG_MATCH_MODE_OPTIONS: ReadonlyArray<TagMatchMode> = ['any', 'all'];

/** 默认排序：与 TodoHub 初始 activeSort 一致。 */
export const DEFAULT_TASK_SORT_OPTION: TaskSortOption = { field: 'updatedAt', order: 'desc' };

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

export const isTodoStatus = (value: unknown): value is TaskStatus =>
	value === 'todo' || value === 'doing' || value === 'done';

export const isTodoPriority = (value: unknown): value is TaskPriority =>
	value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';

export const isTagMatchMode = (value: unknown): value is TagMatchMode =>
	value === 'any' || value === 'all';

export const isTodoSortField = (value: unknown): value is TaskSortField =>
	value === 'priority' || value === 'dueDate' || value === 'createdAt' || value === 'updatedAt';

export const isTodoSortOrder = (value: unknown): value is TaskSortOrder =>
	value === 'asc' || value === 'desc';

const isNumberOrUndefined = (value: unknown): value is number | undefined =>
	value === undefined || typeof value === 'number';

export const isTaskSearchFilter = (value: unknown): value is TaskSearchFilter => {
	if (!isObjectRecord(value)) return false;

	if (value.keyword !== undefined && typeof value.keyword !== 'string') return false;
	if (value.titleKeyword !== undefined && typeof value.titleKeyword !== 'string') return false;

	if (value.tags !== undefined) {
		if (!Array.isArray(value.tags) || value.tags.some((t) => typeof t !== 'string')) return false;
	}
	if (value.tagMatchMode !== undefined && !isTagMatchMode(value.tagMatchMode)) return false;
	if (value.group !== undefined && typeof value.group !== 'string') return false;

	if (value.dateRange !== undefined) {
		const dr = value.dateRange as Record<string, unknown>;
		if (!isObjectRecord(dr)) return false;
		if (!isNumberOrUndefined(dr.start) || !isNumberOrUndefined(dr.end)) return false;
	}

	if (value.status !== undefined) {
		if (Array.isArray(value.status)) {
			if (!value.status.every(isTodoStatus)) return false;
		} else if (!isTodoStatus(value.status)) {
			return false;
		}
	}

	if (value.priority !== undefined) {
		if (Array.isArray(value.priority)) {
			if (!value.priority.every(isTodoPriority)) return false;
		} else if (!isTodoPriority(value.priority)) {
			return false;
		}
	}

	if (value.showCompleted !== undefined && typeof value.showCompleted !== 'boolean') return false;
	if (value.archived !== undefined && typeof value.archived !== 'boolean') return false;

	return true;
};

export const isSortOption = (value: unknown): value is TaskSortOption => {
	if (!isObjectRecord(value)) return false;
	if (!isTodoSortField(value.field)) return false;
	if (value.order !== undefined && !isTodoSortOrder(value.order)) return false;
	return true;
};

/**
 * 解析未知值为 TaskSearchFilter；非法时回退到空 filter（`{}`）。
 * 供 settingsService / uiStateService 共享一致的校验语义。
 */
export const parseTaskSearchFilter = (value: unknown): TaskSearchFilter =>
	isTaskSearchFilter(value) ? (value as TaskSearchFilter) : createEmptyFilter();

/**
 * 解析未知值为 TaskSortOption；非法时回退到默认排序。
 */
export const parseTaskSortOption = (value: unknown): TaskSortOption => {
	if (!isSortOption(value)) return { ...DEFAULT_TASK_SORT_OPTION };
	// exactOptionalPropertyTypes：order 仅在定义时写入，避免 undefined 落入可选字段
	const result: TaskSortOption = { field: value.field };
	if (value.order !== undefined) {
		result.order = value.order;
	}
	return result;
};


/**
 * 计算已生效的筛选字段数量（用于徽标显示）。
 * 仅统计用户主动设置的字段，未定义的字段不计入。
 */
export const countActiveFilterFields = (filter: TaskSearchFilter | undefined): number => {
	if (!filter) return 0;

	let count = 0;
	if (filter.keyword && filter.keyword.trim().length > 0) count += 1;
	if (filter.titleKeyword && filter.titleKeyword.trim().length > 0) count += 1;
	if (Array.isArray(filter.tags) && filter.tags.length > 0) count += 1;
	if (filter.tagMatchMode) count += 1;
	if (filter.group && filter.group.trim().length > 0) count += 1;
	if (filter.dateRange && (filter.dateRange.start !== undefined || filter.dateRange.end !== undefined)) count += 1;
	if (filter.status !== undefined) count += 1;
	if (filter.priority !== undefined) count += 1;
	if (filter.showCompleted !== undefined) count += 1;
	if (filter.archived !== undefined) count += 1;
	return count;
};

/** 创建一份空 filter，所有字段均为 undefined（视为"无筛选"）。 */
export const createEmptyFilter = (): TaskSearchFilter => ({});

/** 合并两个 filter，后者覆盖前者（浅合并）。 */
export const mergeFilter = (base: TaskSearchFilter, patch: Partial<TaskSearchFilter>): TaskSearchFilter => ({
	...base,
	...patch,
});

/**
 * 在 base 上应用一组补丁：补丁值为 undefined 表示移除该字段，
 * 否则覆盖。专为适配 `exactOptionalPropertyTypes: true` 而设计——
 * 避免把显式 undefined 写入可选字段。
 */
export const mergePatch = (
	base: TaskSearchFilter,
	patch: { [K in keyof TaskSearchFilter]?: TaskSearchFilter[K] | undefined },
): TaskSearchFilter => {
	const result: TaskSearchFilter = { ...base };
	for (const key of Object.keys(patch) as Array<keyof TaskSearchFilter>) {
		const value = patch[key];
		if (value === undefined) {
			// 显式 delete，确保返回对象不含 undefined 字段
			Reflect.deleteProperty(result, key);
		} else {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
};

/** 切换数组型多选字段中某值的选中状态，返回新数组（为空时返回 undefined 表示清除该条件）。 */
export const toggleArrayValue = <T>(arr: T[] | undefined, value: T): T[] | undefined => {
	const current = arr ? [...arr] : [];
	const idx = current.indexOf(value);
	if (idx >= 0) {
		current.splice(idx, 1);
	} else {
		current.push(value);
	}
	return current.length === 0 ? undefined : current;
};

/** Date helpers —— 本地时区下 yyyy-mm-dd 与时间戳互转，end 含当日结束。 */
export const dateToTimestampStart = (iso: string): number | undefined => {
	if (!iso) return undefined;
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return undefined;
	return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
};

export const dateToTimestampEnd = (iso: string): number | undefined => {
	if (!iso) return undefined;
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return undefined;
	return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
};

export const timestampToDateInput = (ts: number | undefined): string => {
	if (ts === undefined) return '';
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
};

/**
 * 构造 TaskDateRange：仅在 start/end 任一非空时返回对象，
 * 且绝不向 TaskDateRange 写入显式 undefined 字段
 * （以满足 `exactOptionalPropertyTypes: true`）。
 * 两者皆空时返回 undefined 表示清除该筛选条件。
 */
export const buildDateRange = (start?: number, end?: number): TaskDateRange | undefined => {
	if (start === undefined && end === undefined) return undefined;
	const range: TaskDateRange = {};
	if (start !== undefined) range.start = start;
	if (end !== undefined) range.end = end;
	return range;
};