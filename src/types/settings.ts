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
import type { WebhookSettings } from './webhook';

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
	webhooks?: WebhookSettings;
}

export type NormalizedAppSettings = Omit<AppSettings, 'webhooks'> & {
	webhooks: WebhookSettings;
};

export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = {
	feishu: {
		enabled: false,
		events: ['task.due', 'task.completed', 'digest.daily'],
	},
	dingtalk: {
		enabled: false,
		events: ['task.due', 'task.completed', 'digest.daily'],
	},
	dailyDigest: {
		enabled: false,
		time: '09:00',
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	},
};

export const DEFAULT_SETTINGS: NormalizedAppSettings = {
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
	webhooks: DEFAULT_WEBHOOK_SETTINGS,
};
