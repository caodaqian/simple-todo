import type { TodoView } from './settings';
import type { TaskSearchFilter, TaskSortOption } from './task';

/**
 * 侧边栏分区标识。仅用于侧边栏高亮，不再派生 filter。
 * 与 TodoHub 内的 SideSection 保持一致。
 */
export type SideSection = 'today' | 'week' | 'overdue' | 'inbox' | 'done' | 'archived' | `tag:${string}` | `group:${string}`;

/**
 * 运行时视图状态：用户当前选中的视图、侧栏分区、筛选与排序。
 * 该状态跨会话持久化，重启后恢复"上次视图"。
 * 与 AppSettings 不同——后者是用户配置的偏好，本接口是会话级的实时视图快照。
 */
export interface UiState {
	/** 当前选中的视图 tab */
	currentView: TodoView;
	/** 当前侧栏分区高亮 */
	activeSection: SideSection;
	/** 当前筛选条件（所有视图共享同一份） */
	activeFilter: TaskSearchFilter;
	/** 当前排序（list/kanban 共享；eisenhower/calendar 忽略） */
	activeSort: TaskSortOption;
}

export const DEFAULT_UI_STATE: UiState = {
	currentView: 'list',
	activeSection: 'inbox',
	activeFilter: {},
	activeSort: { field: 'updatedAt', order: 'desc' },
};
