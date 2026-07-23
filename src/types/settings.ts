export type AppearanceMode = 'light' | 'dark' | 'system';

export type TodoView = 'list' | 'kanban' | 'eisenhower' | 'calendar';

export type FontScale = 'compact' | 'standard' | 'comfortable' | 'large';

export type MainWindowHeightPreset = 'compact' | 'standard' | 'spacious' | 'immersive';

export type StickyWindowSizePreset = 'compact' | 'standard' | 'wide' | 'tall';

export type StickyWindowWidthPreset = 'narrow' | 'standard' | 'wide' | 'extra-wide';

export type StickyWindowHeightPreset = 'compact' | 'standard' | 'tall' | 'extra-tall';

export type StickyWindowPositionPreset = 'auto' | 'top-left' | 'top-right' | 'center' | 'bottom-right';

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
	starred: boolean;
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
	fontScale: FontScale;
	mainWindowHeightPreset: MainWindowHeightPreset;
	stickyWindowSizePreset: StickyWindowSizePreset;
	stickyWindowWidthPreset: StickyWindowWidthPreset;
	stickyWindowHeightPreset: StickyWindowHeightPreset;
	stickyWindowPositionPreset: StickyWindowPositionPreset;
	showCompleted: boolean;
	defaultView: TodoView;
	notifyEnabled: boolean;
	pomodoroMinutes: number;
	savedViews: SavedFilterView[];
}

export const DEFAULT_SETTINGS: AppSettings = {
	appearanceMode: 'system',
	accentColor: 'mauve',
	fontScale: 'standard',
	mainWindowHeightPreset: 'standard',
	stickyWindowSizePreset: 'standard',
	stickyWindowWidthPreset: 'standard',
	stickyWindowHeightPreset: 'standard',
	stickyWindowPositionPreset: 'auto',
	showCompleted: false,
	defaultView: 'list',
	notifyEnabled: true,
	pomodoroMinutes: 40,
	savedViews: [],
};
