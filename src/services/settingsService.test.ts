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

const createViewSnapshot = (overrides: Partial<Omit<SavedFilterView, 'id' | 'name'>> = {}): Omit<SavedFilterView, 'id' | 'name'> => ({
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

		const views = settingsService.getViews();
		expect(views).toHaveLength(1);
		expect(views[0]).toEqual(saved);
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
		// 旧字段不再被期待存在；但即使残留也是可读的
		expect(migrated.view).toBe('list');
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
