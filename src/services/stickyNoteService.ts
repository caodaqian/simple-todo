import type { SavedFilterView, TodoView } from '../types/settings';
import type { StickyCurrentSourceInput, StickyNoteSource } from '../types/stickyNote';
import type { TaskSearchFilter, TaskSortOption } from '../types/task';
import { isSortOption, isTaskSearchFilter } from './filterUtils';
import { STORAGE_KEYS } from './storageKeys';

interface UtoolsDbStorage {
	getItem(key: string): unknown;
	setItem(key: string, value: string): unknown;
}

interface UtoolsLike {
	dbStorage?: UtoolsDbStorage;
}

const DEFAULT_SOURCE: StickyNoteSource = {
	sourceKind: 'current',
	title: '收集箱',
	view: 'list',
	section: 'inbox',
	filter: {},
	updatedAt: 0,
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isTodoView = (value: unknown): value is TodoView => {
	return value === 'list' || value === 'kanban' || value === 'eisenhower' || value === 'calendar';
};

const cloneFilter = (filter: TaskSearchFilter): TaskSearchFilter => {
	const cloned: TaskSearchFilter = { ...filter };
	if (filter.tags !== undefined) cloned.tags = [...filter.tags];
	if (filter.dateRange !== undefined) cloned.dateRange = { ...filter.dateRange };
	if (filter.dateRule !== undefined) cloned.dateRule = { ...filter.dateRule };
	if (Array.isArray(filter.status)) cloned.status = [...filter.status];
	if (Array.isArray(filter.priority)) cloned.priority = [...filter.priority];
	return cloned;
};
const cloneSort = (sort: TaskSortOption | undefined): TaskSortOption | undefined => sort ? { ...sort } : undefined;

const cloneSource = (source: StickyNoteSource): StickyNoteSource => {
	const cloned: StickyNoteSource = {
		sourceKind: source.sourceKind,
		title: source.title,
		view: source.view,
		section: source.section,
		filter: cloneFilter(source.filter),
		updatedAt: source.updatedAt,
	};
	if (source.sort !== undefined) cloned.sort = { ...source.sort };
	if (source.savedViewId !== undefined) cloned.savedViewId = source.savedViewId;
	return cloned;
};

const toStickyNoteSource = (value: unknown): StickyNoteSource | null => {
	if (!isObjectRecord(value)) return null;
	const { sourceKind, title, view, section, filter, sort, savedViewId, updatedAt } = value;
	if (sourceKind !== 'current' && sourceKind !== 'saved') return null;
	if (typeof title !== 'string' || title.length === 0) return null;
	if (!isTodoView(view)) return null;
	if (typeof section !== 'string') return null;
	if (!isTaskSearchFilter(filter)) return null;
	if (sort !== undefined && !isSortOption(sort)) return null;
	if (savedViewId !== undefined && typeof savedViewId !== 'string') return null;
	if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;

	const source: StickyNoteSource = {
		sourceKind,
		title,
		view,
		section,
		filter: cloneFilter(filter),
		updatedAt,
	};
	if (sort !== undefined) source.sort = { ...sort };
	if (savedViewId !== undefined) source.savedViewId = savedViewId;
	return source;
};

class StickyNoteService {
	private readonly storageKey = STORAGE_KEYS.STICKY_NOTE;

	private memorySource: StickyNoteSource = { ...DEFAULT_SOURCE };

	getSource(): StickyNoteSource {
		const raw = this.readFromStorage();
		if (raw === null) return cloneSource(this.memorySource);
		try {
			const parsed = toStickyNoteSource(JSON.parse(raw));
			if (!parsed) {
				this.memorySource = { ...DEFAULT_SOURCE };
				return { ...DEFAULT_SOURCE };
			}
			this.memorySource = parsed;
			return cloneSource(parsed);
		} catch {
			this.memorySource = { ...DEFAULT_SOURCE };
			return { ...DEFAULT_SOURCE };
		}
	}

	saveSource(source: StickyNoteSource): StickyNoteSource {
		const next = cloneSource(source);
		this.memorySource = next;
		const localStorage = this.getLocalStorage();
		if (localStorage) {
			try {
				localStorage.setItem(this.storageKey, JSON.stringify(next));
			} catch {
		// Keep memory fallback when localStorage fails.
			}
		}
		return cloneSource(next);
	}

	buildSourceFromCurrent(input: StickyCurrentSourceInput): StickyNoteSource {
		const source: StickyNoteSource = {
			sourceKind: 'current',
			title: input.title.trim() || '当前视图',
			view: input.view,
			section: input.section,
			filter: cloneFilter(input.filter),
			updatedAt: Date.now(),
		};
		const sort = cloneSort(input.sort);
		if (sort) source.sort = sort;
		return source;
	}

	buildSourceFromSaved(view: SavedFilterView): StickyNoteSource {
		const source: StickyNoteSource = {
			sourceKind: 'saved',
			title: view.name,
			view: view.view,
			section: view.section,
			filter: cloneFilter(view.filter),
			savedViewId: view.id,
			updatedAt: Date.now(),
		};
		const sort = cloneSort(view.sort);
		if (sort) source.sort = sort;
		return source;
	}

	private getDbStorage(): UtoolsDbStorage | null {
		try {
			const maybeWindow = window as Window & { utools?: UtoolsLike };
			return maybeWindow.utools?.dbStorage ?? null;
		} catch {
			return null;
		}
	}

	private getLocalStorage(): Storage | null {
		try {
			return window.localStorage ?? null;
		} catch {
			return null;
		}
	}

	private readFromStorage(): string | null {
		const localStorage = this.getLocalStorage();
		if (!localStorage) return null;
		try {
			const localValue = localStorage.getItem(this.storageKey);
			if (localValue !== null) return localValue;
		} catch {
			return null;
		}

		const dbStorage = this.getDbStorage();
		if (!dbStorage) return null;
		try {
			const value = dbStorage.getItem(this.storageKey);
			if (typeof value !== 'string') return null;
			localStorage.setItem(this.storageKey, value);
			return value;
		} catch {
			return null;
		}
	}
}

export const stickyNoteService = new StickyNoteService();
