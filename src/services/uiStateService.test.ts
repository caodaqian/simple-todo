import { beforeEach, describe, expect, it } from 'vitest';
import type { TodoView } from '../types/settings';
import type { TaskSearchFilter, TaskSortOption } from '../types/task';
import { DEFAULT_UI_STATE, type SideSection, type UiState } from '../types/uiState';
import { uiStateService } from './uiStateService';

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

const STORAGE_KEY = 'jianyue.uiState';
const localStorage = new MockDbStorage();

const writeStored = (state: Record<string, unknown>): void => {
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify(state),
	);
};

describe('uiStateService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		localStorage.clear();
		Reflect.set(window, 'localStorage', localStorage);
		window.utools = { ...(window.utools ?? {}), dbStorage };
		uiStateService.saveUiState(DEFAULT_UI_STATE);
	});

	it('returns default ui state when storage is empty', () => {
		dbStorage.clear();
		const state = uiStateService.getUiState();
		expect(state).toEqual(DEFAULT_UI_STATE);
		expect(state.currentView).toBe('list');
		expect(state.activeSection).toBe('inbox');
		expect(state.activeFilter).toEqual({});
		expect(state.activeSort).toEqual({ field: 'updatedAt', order: 'desc' });
	});

	it('persists and re-reads a full view state round-trip', () => {
		const filter: TaskSearchFilter = {
			keyword: 'bug',
			titleKeyword: '登录',
			tags: ['vue', 'ts'],
			tagMatchMode: 'all',
			priority: ['high'],
			status: ['todo', 'doing'],
			showCompleted: true,
			dateRange: { start: 1700000000000, end: 1800000000000 },
		};
		const sort: TaskSortOption = { field: 'priority', order: 'asc' };
		const state: UiState = {
			currentView: 'kanban',
			activeSection: 'tag:frontend',
			activeFilter: filter,
			activeSort: sort,
		};

		uiStateService.saveUiState(state);
		const restored = uiStateService.getUiState();

		expect(restored).toEqual(state);
		expect(restored.activeFilter).toEqual(filter);
		expect(restored.activeSort).toEqual(sort);
	});

	it('copies legacy state once to localStorage and subsequently writes only locally', () => {
		const legacy: UiState = {
			currentView: 'kanban',
			activeSection: 'today',
			activeFilter: { tags: ['legacy'] },
			activeSort: { field: 'createdAt', order: 'asc' },
		};
		dbStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
		localStorage.removeItem(STORAGE_KEY);

		expect(uiStateService.getUiState()).toEqual(legacy);
		expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(legacy));

		const next: UiState = { ...legacy, currentView: 'calendar' };
		uiStateService.saveUiState(next);
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toMatchObject(next);
		expect(dbStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(legacy));
	});

	it('falls back currentView to list when invalid', () => {
		writeStored({
			currentView: 'bogus',
			activeSection: 'today',
			activeFilter: {},
			activeSort: { field: 'createdAt', order: 'desc' },
		});

		const state = uiStateService.getUiState();
		expect(state.currentView).toBe('list');
		// 其他合法字段应保留
		expect(state.activeSection).toBe('today');
		expect(state.activeSort).toEqual({ field: 'createdAt', order: 'desc' });
	});

	it('falls back activeSection to inbox when empty or unknown prefix', () => {
		writeStored({
			currentView: 'list',
			activeSection: 'unknown:foo',
			activeFilter: {},
			activeSort: { field: 'updatedAt', order: 'desc' },
		});
		expect(uiStateService.getUiState().activeSection).toBe('inbox');

		writeStored({
			currentView: 'list',
			activeSection: '',
			activeFilter: {},
			activeSort: { field: 'updatedAt', order: 'desc' },
		});
		expect(uiStateService.getUiState().activeSection).toBe('inbox');

		writeStored({
			currentView: 'list',
			activeSection: 123,
			activeFilter: {},
			activeSort: { field: 'updatedAt', order: 'desc' },
		});
		expect(uiStateService.getUiState().activeSection).toBe('inbox');
	});

	it('accepts known side sections including tag: and group: prefixes', () => {
		const cases: SideSection[] = ['today', 'week', 'overdue', 'inbox', 'done', 'tag:工作', 'group:项目A'];
		for (const section of cases) {
			writeStored({
				currentView: 'list',
				activeSection: section,
				activeFilter: {},
				activeSort: { field: 'updatedAt', order: 'desc' },
			});
			expect(uiStateService.getUiState().activeSection).toBe(section);
		}
	});

	it('falls back activeFilter to empty when filter is invalid', () => {
		writeStored({
			currentView: 'list',
			activeSection: 'inbox',
			activeFilter: { titleKeyword: 123 },
			activeSort: { field: 'updatedAt', order: 'desc' },
		});
		expect(uiStateService.getUiState().activeFilter).toEqual({});
	});

	it('falls back activeSort to default when sort is invalid or missing', () => {
		writeStored({
			currentView: 'list',
			activeSection: 'inbox',
			activeFilter: {},
			activeSort: { field: 'bogus', order: 'sideways' },
		});
		expect(uiStateService.getUiState().activeSort).toEqual({ field: 'updatedAt', order: 'desc' });

		writeStored({
			currentView: 'list',
			activeSection: 'inbox',
			activeFilter: {},
		});
		expect(uiStateService.getUiState().activeSort).toEqual({ field: 'updatedAt', order: 'desc' });
	});

	it('preserves sort with undefined order (omit order key)', () => {
		writeStored({
			currentView: 'list',
			activeSection: 'inbox',
			activeFilter: {},
			activeSort: { field: 'priority' },
		});
		expect(uiStateService.getUiState().activeSort).toEqual({ field: 'priority' });
	});

	it('returns default state when stored JSON is corrupt', () => {
		(window as unknown as { utools: { dbStorage: MockDbStorage } }).utools.dbStorage.setItem(
			STORAGE_KEY,
			'not-json{',
		);
		expect(uiStateService.getUiState()).toEqual(DEFAULT_UI_STATE);
	});

	it('returns default state when stored value is not an object', () => {
		(window as unknown as { utools: { dbStorage: MockDbStorage } }).utools.dbStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(['not', 'an', 'object']),
		);
		expect(uiStateService.getUiState()).toEqual(DEFAULT_UI_STATE);
	});

	it('updateUiState merges a partial patch and persists the result', () => {
		const initial = uiStateService.updateUiState({ currentView: 'eisenhower' as TodoView });
		expect(initial.currentView).toBe('eisenhower');
		expect(initial.activeSection).toBe('inbox'); // 未被覆盖

		const next = uiStateService.updateUiState({ activeSection: 'overdue' as SideSection });
		expect(next.currentView).toBe('eisenhower');
		expect(next.activeSection).toBe('overdue');
	});

	it('does not throw when dbStorage is unavailable (memory fallback)', () => {
		// 移除 dbStorage，模拟非 utools 环境
		const previous = window.utools;
		delete window.utools;
		try {
			expect(() => uiStateService.getUiState()).not.toThrow();
			expect(() => uiStateService.saveUiState(DEFAULT_UI_STATE)).not.toThrow();
			expect(() => uiStateService.updateUiState({ currentView: 'list' })).not.toThrow();
		} finally {
			window.utools = previous;
		}
	});

	it('exposes a reactive ref hydrated from storage', () => {
		const ref = uiStateService.getUiStateRef();
		expect(ref.value).toEqual(DEFAULT_UI_STATE);
		uiStateService.saveUiState({
			currentView: 'calendar',
			activeSection: 'done',
			activeFilter: { keyword: 'x' },
			activeSort: { field: 'dueDate', order: 'asc' },
		});
		expect(ref.value.currentView).toBe('calendar');
		expect(ref.value.activeSection).toBe('done');
	});
});
