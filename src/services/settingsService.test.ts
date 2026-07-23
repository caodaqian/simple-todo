import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type SavedFilterView, type TodoView } from '../types/settings';
import type { TaskSearchFilter, TaskSortOption } from '../types/task';
import { settingsService } from './settingsService';

class MockDbStorage {
	private store = new Map<string, string>();

	getItem<T = unknown>(key: string): T {
		return (this.store.get(key) ?? null) as T;
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

const createViewSnapshot = (overrides: Partial<Omit<SavedFilterView, 'id' | 'name' | 'starred'>> = {}): Omit<SavedFilterView, 'id' | 'name' | 'starred'> => ({
	view: 'list' as TodoView,
	section: 'inbox',
	filter: {},
	...overrides,
});

const createFilter = (overrides: Partial<TaskSearchFilter> = {}): TaskSearchFilter => ({
	...overrides,
});

const createSort = (field: TaskSortOption['field'], order: TaskSortOption['order'] = 'desc'): TaskSortOption => ({
	field,
	order,
});

describe('settingsService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage };
		settingsService.saveSettings(DEFAULT_SETTINGS);
	});

	it('returns default settings when storage is empty', () => {
		const settings = settingsService.getSettings();
		expect(settings.appearanceMode).toBe(DEFAULT_SETTINGS.appearanceMode);
		expect(settings.defaultView).toBe(DEFAULT_SETTINGS.defaultView);
		expect(settings.pomodoroMinutes).toBe(40);
		expect(settings.savedViews).toEqual([]);
	});

	it('migrates legacy settings without savedViews to empty array', () => {
		const legacy = {
			appearanceMode: 'dark',
			accentColor: 'blue',
			showCompleted: true,
			defaultView: 'kanban',
			notifyEnabled: false,
		};
		dbStorage.setItem('jianyue.settings', JSON.stringify(legacy));

		const settings = settingsService.getSettings();
		expect(settings.savedViews).toEqual([]);
		expect(settings.appearanceMode).toBe('dark');
		expect(settings.defaultView).toBe('kanban');
		expect(settings.pomodoroMinutes).toBe(40);
	});

	it('saves and retrieves custom pomodoro duration', () => {
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, pomodoroMinutes: 55 });
		expect(settingsService.getSettings().pomodoroMinutes).toBe(55);
	});

	it('migrates display and window preferences to friendly defaults', () => {
		dbStorage.setItem('jianyue.settings', JSON.stringify({
			appearanceMode: 'light',
			accentColor: 'blue',
			showCompleted: false,
			defaultView: 'list',
			notifyEnabled: true,
			pomodoroMinutes: 25,
			savedViews: [],
		}));

		const settings = settingsService.getSettings();
		expect(settings.fontScale).toBe(DEFAULT_SETTINGS.fontScale);
		expect(settings.mainWindowHeightPreset).toBe(DEFAULT_SETTINGS.mainWindowHeightPreset);
		expect(settings.stickyWindowSizePreset).toBe(DEFAULT_SETTINGS.stickyWindowSizePreset);
		expect(settings.stickyWindowWidthPreset).toBe(DEFAULT_SETTINGS.stickyWindowWidthPreset);
		expect(settings.stickyWindowHeightPreset).toBe(DEFAULT_SETTINGS.stickyWindowHeightPreset);
		expect(settings.stickyWindowPositionPreset).toBe(DEFAULT_SETTINGS.stickyWindowPositionPreset);
	});

	it('saves and retrieves display and window preferences', () => {
		settingsService.saveSettings({
			...DEFAULT_SETTINGS,
			fontScale: 'large',
			mainWindowHeightPreset: 'immersive',
			stickyWindowSizePreset: 'wide',
			stickyWindowWidthPreset: 'extra-wide',
			stickyWindowHeightPreset: 'tall',
			stickyWindowPositionPreset: 'center',
		});

		const settings = settingsService.getSettings();
		expect(settings.fontScale).toBe('large');
		expect(settings.mainWindowHeightPreset).toBe('immersive');
		expect(settings.stickyWindowSizePreset).toBe('wide');
		expect(settings.stickyWindowWidthPreset).toBe('extra-wide');
		expect(settings.stickyWindowHeightPreset).toBe('tall');
		expect(settings.stickyWindowPositionPreset).toBe('center');
	});

	it('migrates legacy combined sticky size into separate width and height presets', () => {
		dbStorage.setItem('jianyue.settings', JSON.stringify({
			...DEFAULT_SETTINGS,
			stickyWindowSizePreset: 'wide',
			stickyWindowWidthPreset: undefined,
			stickyWindowHeightPreset: undefined,
		}));

		const settings = settingsService.getSettings();
		expect(settings.stickyWindowWidthPreset).toBe('wide');
		expect(settings.stickyWindowHeightPreset).toBe('standard');
	});

	it('falls back to friendly defaults for invalid display and window preferences', () => {
		dbStorage.setItem('jianyue.settings', JSON.stringify({
			...DEFAULT_SETTINGS,
			fontScale: 'tiny',
			mainWindowHeightPreset: 'fullscreen',
			stickyWindowSizePreset: 'huge',
			stickyWindowWidthPreset: 'huge',
			stickyWindowHeightPreset: 'huge',
			stickyWindowPositionPreset: 'random',
		}));

		const settings = settingsService.getSettings();
		expect(settings.fontScale).toBe(DEFAULT_SETTINGS.fontScale);
		expect(settings.mainWindowHeightPreset).toBe(DEFAULT_SETTINGS.mainWindowHeightPreset);
		expect(settings.stickyWindowSizePreset).toBe(DEFAULT_SETTINGS.stickyWindowSizePreset);
		expect(settings.stickyWindowWidthPreset).toBe(DEFAULT_SETTINGS.stickyWindowWidthPreset);
		expect(settings.stickyWindowHeightPreset).toBe(DEFAULT_SETTINGS.stickyWindowHeightPreset);
		expect(settings.stickyWindowPositionPreset).toBe(DEFAULT_SETTINGS.stickyWindowPositionPreset);
		expect(settings.pomodoroMinutes).toBe(DEFAULT_SETTINGS.pomodoroMinutes);
	});

	it('falls back to default pomodoro duration for invalid values', () => {
		dbStorage.setItem('jianyue.settings', JSON.stringify({ ...DEFAULT_SETTINGS, pomodoroMinutes: -1 }));
		expect(settingsService.getSettings().pomodoroMinutes).toBe(40);

		dbStorage.setItem('jianyue.settings', JSON.stringify({ ...DEFAULT_SETTINGS, pomodoroMinutes: 500 }));
		expect(settingsService.getSettings().pomodoroMinutes).toBe(40);
	});

	it('saves and retrieves a custom view with full filter snapshot', () => {
		const filter = createFilter({
			keyword: 'bug',
			tags: ['vue', 'ts'],
			tagMatchMode: 'all',
			priority: ['high'],
			status: ['todo', 'doing'],
			showCompleted: true,
			dateRange: { start: 1700000000000, end: 1800000000000 },
			overdueOnly: true,
		});
		const snapshot = createViewSnapshot({
			view: 'kanban',
			section: 'tag:frontend',
			filter,
			sort: createSort('priority'),
		});

		const saved = settingsService.saveView('前端看板', snapshot);
		expect(saved.id).toBeDefined();
		expect(saved.name).toBe('前端看板');
		expect(saved.view).toBe('kanban');
		expect(saved.section).toBe('tag:frontend');
		expect(saved.filter).toEqual(filter);
		expect(saved.sort).toEqual(createSort('priority'));
		expect(saved.starred).toBe(false);

		const views = settingsService.getViews();
		expect(views).toHaveLength(1);
		expect(views[0]).toEqual(saved);
	});

	it('normalizes a legacy saved view without starred as unstarred', () => {
		const legacy = {
			id: 'view-without-starred',
			name: '旧保存视图',
			view: 'list',
			section: 'inbox',
			filter: { tags: ['bug'] },
		};
		dbStorage.setItem(
			'jianyue.settings',
			JSON.stringify({ ...DEFAULT_SETTINGS, savedViews: [legacy] }),
		);

		const [saved] = settingsService.getViews();
		expect(saved?.starred).toBe(false);
	});

	it('migrates legacy savedViews using tagFilter/showCompleted into the new filter shape', () => {
		const legacy = {
			id: 'view-legacy-1',
			name: '旧视图',
			view: 'list',
			section: 'today',
			tagFilter: ['bug'],
			showCompleted: true,
		};
		dbStorage.setItem(
			'jianyue.settings',
			JSON.stringify({ ...DEFAULT_SETTINGS, savedViews: [legacy] }),
		);

		const settings = settingsService.getSettings();
		expect(settings.savedViews).toHaveLength(1);
		const migrated = settings.savedViews[0]!;
		expect(migrated.id).toBe('view-legacy-1');
		expect(migrated.filter.tags).toEqual(['bug']);
		expect(migrated.filter.showCompleted).toBe(true);
		expect(migrated.starred).toBe(false);
		// 旧字段不再被期待存在；但即使残留也是可读的
		expect(migrated.view).toBe('list');
	});

	it('toggles one saved view star without changing other views or their order', () => {
		const first = settingsService.saveView('视图一', createViewSnapshot());
		const target = settingsService.saveView('视图二', createViewSnapshot({ view: 'kanban' }));
		const last = settingsService.saveView('视图三', createViewSnapshot({ view: 'calendar' }));

		const toggled = settingsService.toggleViewStar(target.id);

		expect(toggled).toEqual({ ...target, starred: true });
		expect(settingsService.getViews()).toEqual([
			first,
			{ ...target, starred: true },
			last,
		]);
	});

	it('returns null when toggling a non-existent saved view star', () => {
		settingsService.saveView('视图一', createViewSnapshot());

		expect(settingsService.toggleViewStar('non-existent-id')).toBeNull();
	});

	it('deletes an existing view', () => {
		const saved = settingsService.saveView('视图一', createViewSnapshot());
		settingsService.saveView('视图二', createViewSnapshot({ view: 'calendar' }));

		const deleted = settingsService.deleteView(saved.id);
		expect(deleted).toBe(true);
		expect(settingsService.getViews()).toHaveLength(1);
		expect(settingsService.getViews()[0]!.name).toBe('视图二');
	});

	it('returns false when deleting a non-existent view', () => {
		settingsService.saveView('视图一', createViewSnapshot());
		expect(settingsService.deleteView('non-existent-id')).toBe(false);
		expect(settingsService.getViews()).toHaveLength(1);
	});

	it('filters out invalid savedViews during migration', () => {
		const valid: SavedFilterView = {
			id: 'view-1',
			name: '有效视图',
			view: 'list',
			section: 'today',
			filter: { tags: ['bug'] },
			starred: false,
		};

		const invalidItems = [
			{ id: 'bad-1', name: 'Missing view' },
			{ id: 'bad-2', name: 'Bad view', view: 'invalid', section: 'inbox', filter: {} },
			{ id: 'bad-3', name: 'Bad tags', view: 'list', section: 'inbox', filter: { tags: [123] } },
			{ id: 'bad-4', name: 'Bad priority', view: 'list', section: 'inbox', filter: { priority: 'critical' } },
			{ id: 'bad-5', name: 'Bad sort', view: 'list', section: 'inbox', filter: {}, sort: { field: 'unknown' } },
		];

		dbStorage.setItem('jianyue.settings', JSON.stringify({ ...DEFAULT_SETTINGS, savedViews: [valid, ...invalidItems] }));

		const settings = settingsService.getSettings();
		expect(settings.savedViews).toHaveLength(1);
		expect(settings.savedViews[0]).toEqual(valid);
	});

	it('persists view changes across service instances (via storage)', () => {
		const snapshot = createViewSnapshot({ view: 'eisenhower', section: 'overdue' });
		const saved = settingsService.saveView('逾期四象限', snapshot);

		// Simulate fresh read from storage
		const freshSettings = settingsService.getSettings();
		expect(freshSettings.savedViews).toHaveLength(1);
		expect(freshSettings.savedViews[0]!.id).toBe(saved.id);
	});
});
