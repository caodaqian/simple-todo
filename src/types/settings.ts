export type AppearanceMode = 'light' | 'dark' | 'system';

export type TodoView = 'list' | 'kanban' | 'eisenhower' | 'calendar';

export type AccentColor =
	| 'rosewater' | 'flamingo' | 'pink' | 'mauve'
	| 'red' | 'maroon' | 'peach' | 'yellow'
	| 'green' | 'teal' | 'sky' | 'sapphire'
	| 'blue' | 'lavender';

export const ACCENT_COLORS: readonly AccentColor[] = [
	'rosewater', 'flamingo', 'pink', 'mauve',
	'red', 'maroon', 'peach', 'yellow',
	'green', 'teal', 'sky', 'sapphire',
	'blue', 'lavender',
] as const;

import type { TaskSearchFilter, TaskSortOption } from './task';

export interface SavedFilterView {
	id: string;
	name: string;
	view: TodoView;
	section: string;
	filter: TaskSearchFilter;
	sort?: TaskSortOption;
	/**
	 * @deprecated 旧结构字段，仅用于迁移时读取。新代码请使用 `filter.tags`。
	 */
	tagFilter?: string[];
	/**
	 * @deprecated 旧结构字段，仅用于迁移时读取。新代码请使用 `filter.showCompleted`。
	 */
	showCompleted?: boolean;
}

export interface AppSettings {
	appearanceMode: AppearanceMode;
	accentColor: AccentColor;
	showCompleted: boolean;
	defaultView: TodoView;
	notifyEnabled: boolean;
	savedViews: SavedFilterView[];
}

export const DEFAULT_SETTINGS: AppSettings = {
	appearanceMode: 'system',
	accentColor: 'mauve',
	showCompleted: false,
	defaultView: 'list',
	notifyEnabled: true,
	savedViews: [],
};
