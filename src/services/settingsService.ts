import { ref, type Ref } from 'vue';
import type { AccentColor, AppSettings, AppearanceMode, SavedFilterView, TodoView } from '../types/settings';
import { ACCENT_COLORS, DEFAULT_SETTINGS } from '../types/settings';
import type { TaskSearchFilter } from '../types/task';
import { isSortOption, isTaskSearchFilter } from './filterUtils';
import { STORAGE_KEYS } from './storageKeys';

interface UtoolsDbStorage {
	getItem(key: string): unknown;
	setItem(key: string, value: string): unknown;
}

interface UtoolsLike {
	dbStorage?: UtoolsDbStorage;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isAppearanceMode = (value: unknown): value is AppearanceMode => {
	return value === 'light' || value === 'dark' || value === 'system';
};

const isTodoView = (value: unknown): value is TodoView => {
	return value === 'list' || value === 'kanban' || value === 'eisenhower' || value === 'calendar';
};

const isAccentColor = (value: unknown): value is AccentColor => {
	return ACCENT_COLORS.includes(value as AccentColor);
};

const migrateLegacyView = (value: Record<string, unknown>): SavedFilterView | null => {
	const { id, name, view, section, tagFilter, showCompleted } = value;
	if (typeof id !== 'string' || id.length === 0) return null;
	if (typeof name !== 'string' || name.length === 0) return null;
	if (!isTodoView(view)) return null;
	if (typeof section !== 'string') return null;

	const filter: TaskSearchFilter = {};
	if (Array.isArray(tagFilter) && tagFilter.every((t) => typeof t === 'string')) {
		filter.tags = [...tagFilter];
	}
	if (typeof showCompleted === 'boolean') {
		filter.showCompleted = showCompleted;
	}

	return {
		id,
		name,
		view,
		section,
		filter,
	};
};

const isSavedFilterView = (value: unknown): value is SavedFilterView => {
	if (!isObjectRecord(value)) {
		return false;
	}

	const { id, name, view, section, filter } = value;

	if (typeof id !== 'string' || id.length === 0) return false;
	if (typeof name !== 'string' || name.length === 0) return false;
	if (!isTodoView(view)) return false;
	if (typeof section !== 'string') return false;
	if (!isTaskSearchFilter(filter)) return false;
	if (value.sort !== undefined && !isSortOption(value.sort)) return false;

	return true;
};

const parseSavedViews = (value: unknown): SavedFilterView[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	const migrated: SavedFilterView[] = [];
	for (const entry of value) {
		if (isSavedFilterView(entry)) {
			migrated.push(entry);
			continue;
		}
		// 兼容旧结构：含 tagFilter/showCompleted 但无 filter 的条目
		if (isObjectRecord(entry) && entry.filter === undefined) {
			const legacy = migrateLegacyView(entry);
			if (legacy) migrated.push(legacy);
		}
	}
	return migrated;
};

const generateSavedViewId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `view-${timestamp}-${random}`;
};

const parseSettings = (raw: string): AppSettings => {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isObjectRecord(parsed)) {
			return { ...DEFAULT_SETTINGS };
		}

		const notifyEnabled =
			typeof parsed.notifyEnabled === 'boolean'
				? parsed.notifyEnabled
				: typeof parsed.notificationsEnabled === 'boolean'
					? parsed.notificationsEnabled
					: DEFAULT_SETTINGS.notifyEnabled;

		return {
			appearanceMode: isAppearanceMode(parsed.appearanceMode)
				? parsed.appearanceMode
				: DEFAULT_SETTINGS.appearanceMode,
			accentColor: isAccentColor(parsed.accentColor)
				? parsed.accentColor
				: DEFAULT_SETTINGS.accentColor,
			// Support migration: read showCompleted; ignore legacy includeHidden
			showCompleted:
				typeof parsed.showCompleted === 'boolean'
					? parsed.showCompleted
					: DEFAULT_SETTINGS.showCompleted,
			defaultView: isTodoView(parsed.defaultView)
				? parsed.defaultView
				: DEFAULT_SETTINGS.defaultView,
			notifyEnabled,
			savedViews: parseSavedViews(parsed.savedViews),
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
};

class SettingsService {
	private readonly storageKey = STORAGE_KEYS.SETTINGS;

	private memorySettings: AppSettings = { ...DEFAULT_SETTINGS };

	private readonly settingsRef: Ref<AppSettings> = ref<AppSettings>({ ...DEFAULT_SETTINGS });

	constructor() {
		// Hydrate ref from persisted storage at construction time.
		const initial = this.getSettings();
		this.settingsRef.value = initial;
	}

	getSettingsRef(): Ref<AppSettings> {
		return this.settingsRef;
	}

	getSettings(): AppSettings {
		const raw = this.readFromStorage();

		if (raw === null) {
			return { ...this.memorySettings };
		}

		const settings = parseSettings(raw);
		this.memorySettings = settings;
		return { ...settings };
	}

	saveSettings(settings: AppSettings): void {
		const nextSettings: AppSettings = { ...settings };
		this.memorySettings = nextSettings;
		this.settingsRef.value = nextSettings;

		const dbStorage = this.getDbStorage();
		if (!dbStorage) {
			return;
		}

		try {
			dbStorage.setItem(this.storageKey, JSON.stringify(nextSettings));
		} catch {
			// Gracefully fall back to memory storage when dbStorage fails.
		}
	}

	updateSettings(patch: Partial<AppSettings>): AppSettings {
		const nextSettings: AppSettings = {
			...this.getSettings(),
			...patch,
		};

		this.saveSettings(nextSettings);
		return nextSettings;
	}

	getViews(): SavedFilterView[] {
		return [...this.getSettings().savedViews];
	}

	saveView(name: string, snapshot: Omit<SavedFilterView, 'id' | 'name'>): SavedFilterView {
		const current = this.getSettings();
		const view: SavedFilterView = {
			...snapshot,
			id: generateSavedViewId(),
			name: name.trim(),
		};

		const nextSettings: AppSettings = {
			...current,
			savedViews: [...current.savedViews, view],
		};

		this.saveSettings(nextSettings);
		return view;
	}

	deleteView(id: string): boolean {
		const current = this.getSettings();
		const nextViews = current.savedViews.filter((view) => view.id !== id);

		if (nextViews.length === current.savedViews.length) {
			return false;
		}

		this.saveSettings({ ...current, savedViews: nextViews });
		return true;
	}

	private getDbStorage(): UtoolsDbStorage | null {
		try {
			const maybeWindow = window as Window & { utools?: UtoolsLike };
			if (!maybeWindow.utools?.dbStorage) {
				return null;
			}
			return maybeWindow.utools.dbStorage;
		} catch {
			return null;
		}
	}

	private readFromStorage(): string | null {
		const dbStorage = this.getDbStorage();
		if (!dbStorage) {
			return null;
		}

		try {
			const value = dbStorage.getItem(this.storageKey);
			return typeof value === 'string' ? value : null;
		} catch {
			return null;
		}
	}
}

export const settingsService = new SettingsService();
