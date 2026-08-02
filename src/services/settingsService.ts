import { ref, type Ref } from 'vue';
import type {
	AccentColor,
	AppSettings,
	AppearanceMode,
	FontScale,
	MainWindowHeightPreset,
	NormalizedAppSettings,
	SavedFilterView,
	StickyWindowHeightPreset,
	StickyWindowPositionPreset,
	StickyWindowSizePreset,
	StickyWindowWidthPreset,
	TodoView,
} from '../types/settings';
import { ACCENT_COLORS, DEFAULT_SETTINGS, DEFAULT_WEBHOOK_SETTINGS } from '../types/settings';
import type { TaskSearchFilter } from '../types/task';
import type {
	DailyDigestSettings,
	WebhookEventType,
	WebhookSettings,
	WebhookTargetSettings,
} from '../types/webhook';
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

const isFontScale = (value: unknown): value is FontScale => {
	return value === 'compact' || value === 'standard' || value === 'comfortable' || value === 'large';
};

const isMainWindowHeightPreset = (value: unknown): value is MainWindowHeightPreset => {
	return value === 'compact' || value === 'standard' || value === 'spacious' || value === 'immersive';
};

const isStickyWindowSizePreset = (value: unknown): value is StickyWindowSizePreset => {
	return value === 'compact' || value === 'standard' || value === 'wide' || value === 'tall';
};

const isStickyWindowWidthPreset = (value: unknown): value is StickyWindowWidthPreset => {
	return value === 'narrow' || value === 'standard' || value === 'wide' || value === 'extra-wide';
};

const isStickyWindowHeightPreset = (value: unknown): value is StickyWindowHeightPreset => {
	return value === 'compact' || value === 'standard' || value === 'tall' || value === 'extra-tall';
};

const isStickyWindowPositionPreset = (value: unknown): value is StickyWindowPositionPreset => {
	return value === 'auto' || value === 'top-left' || value === 'top-right' || value === 'center' || value === 'bottom-right';
};

const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
	'task.due',
	'task.completed',
	'digest.daily',
];

const isWebhookEventType = (value: unknown): value is WebhookEventType => {
	return WEBHOOK_EVENT_TYPES.includes(value as WebhookEventType);
};

const cloneWebhookTargetSettings = (settings: WebhookTargetSettings): WebhookTargetSettings => ({
	enabled: settings.enabled,
	events: [...settings.events],
	...(settings.keyword !== undefined ? { keyword: settings.keyword } : {}),
});

const cloneWebhookSettings = (settings: WebhookSettings): WebhookSettings => ({
	feishu: cloneWebhookTargetSettings(settings.feishu),
	dingtalk: cloneWebhookTargetSettings(settings.dingtalk),
	dailyDigest: { ...settings.dailyDigest },
});

const createDefaultSettings = (): NormalizedAppSettings => ({
	...DEFAULT_SETTINGS,
	savedViews: [],
	webhooks: cloneWebhookSettings(DEFAULT_WEBHOOK_SETTINGS),
});

const cloneSettings = (settings: NormalizedAppSettings): NormalizedAppSettings => ({
	...settings,
	savedViews: [...settings.savedViews],
	webhooks: cloneWebhookSettings(settings.webhooks),
});

const parseWebhookEvents = (
	value: unknown,
	fallback: readonly WebhookEventType[],
): WebhookEventType[] => {
	if (!Array.isArray(value)) {
		return [...fallback];
	}

	return [...new Set(value.filter(isWebhookEventType))];
};

const parseWebhookTargetSettings = (
	value: unknown,
	fallback: WebhookTargetSettings,
): WebhookTargetSettings => {
	if (!isObjectRecord(value)) {
		return cloneWebhookTargetSettings(fallback);
	}

	const keyword = typeof value.keyword === 'string' ? value.keyword.trim() : '';
	return {
		enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
		events: parseWebhookEvents(value.events, fallback.events),
		...(keyword.length > 0 ? { keyword } : {}),
	};
};

const isDigestTime = (value: unknown): value is string => {
	return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
};

const isIanaTimezone = (value: unknown): value is string => {
	if (typeof value !== 'string' || value.length === 0) {
		return false;
	}

	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
};

const parseDailyDigestSettings = (value: unknown): DailyDigestSettings => {
	const fallback = DEFAULT_WEBHOOK_SETTINGS.dailyDigest;
	if (!isObjectRecord(value)) {
		return { ...fallback };
	}

	return {
		enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
		time: isDigestTime(value.time) ? value.time : fallback.time,
		timezone: isIanaTimezone(value.timezone) ? value.timezone : fallback.timezone,
	};
};

const parseWebhookSettings = (value: unknown): WebhookSettings => {
	if (!isObjectRecord(value)) {
		return cloneWebhookSettings(DEFAULT_WEBHOOK_SETTINGS);
	}

	return {
		feishu: parseWebhookTargetSettings(value.feishu, DEFAULT_WEBHOOK_SETTINGS.feishu),
		dingtalk: parseWebhookTargetSettings(value.dingtalk, DEFAULT_WEBHOOK_SETTINGS.dingtalk),
		dailyDigest: parseDailyDigestSettings(value.dailyDigest),
	};
};

const legacySizeToWidthPreset = (value: unknown): StickyWindowWidthPreset => {
	if (value === 'compact') return 'narrow';
	if (value === 'wide') return 'wide';
	return DEFAULT_SETTINGS.stickyWindowWidthPreset;
};

const legacySizeToHeightPreset = (value: unknown): StickyWindowHeightPreset => {
	if (value === 'compact') return 'compact';
	if (value === 'tall') return 'tall';
	return DEFAULT_SETTINGS.stickyWindowHeightPreset;
};

const normalizePomodoroMinutes = (value: unknown): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_SETTINGS.pomodoroMinutes;
	}

	const minutes = Math.trunc(value);
	return minutes >= 1 && minutes <= 240 ? minutes : DEFAULT_SETTINGS.pomodoroMinutes;
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
		starred: false,
		view,
		section,
		filter,
	};
};

const parseSavedFilterView = (value: unknown): SavedFilterView | null => {
	if (!isObjectRecord(value)) {
		return null;
	}

	const { id, name, view, section, filter } = value;

	if (typeof id !== 'string' || id.length === 0) return null;
	if (typeof name !== 'string' || name.length === 0) return null;
	if (!isTodoView(view)) return null;
	if (typeof section !== 'string') return null;
	if (!isTaskSearchFilter(filter)) return null;
	if (value.sort !== undefined && !isSortOption(value.sort)) return null;

	return {
		id,
		name,
		starred: typeof value.starred === 'boolean' ? value.starred : false,
		view,
		section,
		filter,
		...(value.sort !== undefined ? { sort: value.sort } : {}),
	};
};

const parseSavedViews = (value: unknown): SavedFilterView[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	const migrated: SavedFilterView[] = [];
	for (const entry of value) {
		const savedView = parseSavedFilterView(entry);
		if (savedView) {
			migrated.push(savedView);
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

const normalizeSettings = (parsed: unknown): NormalizedAppSettings => {
	if (!isObjectRecord(parsed)) {
		return createDefaultSettings();
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
			fontScale: isFontScale(parsed.fontScale)
				? parsed.fontScale
				: DEFAULT_SETTINGS.fontScale,
			mainWindowHeightPreset: isMainWindowHeightPreset(parsed.mainWindowHeightPreset)
				? parsed.mainWindowHeightPreset
				: DEFAULT_SETTINGS.mainWindowHeightPreset,
			stickyWindowSizePreset: isStickyWindowSizePreset(parsed.stickyWindowSizePreset)
				? parsed.stickyWindowSizePreset
				: DEFAULT_SETTINGS.stickyWindowSizePreset,
			stickyWindowWidthPreset: isStickyWindowWidthPreset(parsed.stickyWindowWidthPreset)
				? parsed.stickyWindowWidthPreset
				: legacySizeToWidthPreset(parsed.stickyWindowSizePreset),
			stickyWindowHeightPreset: isStickyWindowHeightPreset(parsed.stickyWindowHeightPreset)
				? parsed.stickyWindowHeightPreset
				: legacySizeToHeightPreset(parsed.stickyWindowSizePreset),
			stickyWindowPositionPreset: isStickyWindowPositionPreset(parsed.stickyWindowPositionPreset)
				? parsed.stickyWindowPositionPreset
				: DEFAULT_SETTINGS.stickyWindowPositionPreset,
			// Support migration: read showCompleted; ignore legacy includeHidden
			showCompleted:
				typeof parsed.showCompleted === 'boolean'
					? parsed.showCompleted
					: DEFAULT_SETTINGS.showCompleted,
			defaultView: isTodoView(parsed.defaultView)
				? parsed.defaultView
				: DEFAULT_SETTINGS.defaultView,
			notifyEnabled,
			pomodoroMinutes: normalizePomodoroMinutes(parsed.pomodoroMinutes),
			savedViews: parseSavedViews(parsed.savedViews),
			webhooks: parseWebhookSettings(parsed.webhooks),
	};
};

const parseSettings = (raw: string): NormalizedAppSettings => {
	try {
		return normalizeSettings(JSON.parse(raw) as unknown);
	} catch {
		return createDefaultSettings();
	}
};

class SettingsService {
	private readonly storageKey = STORAGE_KEYS.SETTINGS;

	private memorySettings: NormalizedAppSettings = createDefaultSettings();

	private readonly settingsRef: Ref<NormalizedAppSettings> = ref<NormalizedAppSettings>(createDefaultSettings());

	constructor() {
		// Hydrate ref from persisted storage at construction time.
		const initial = this.getSettings();
		this.settingsRef.value = initial;
	}

	getSettingsRef(): Ref<NormalizedAppSettings> {
		return this.settingsRef;
	}

	getSettings(): NormalizedAppSettings {
		const raw = this.readFromStorage();

		if (raw === null) {
			return cloneSettings(this.memorySettings);
		}

		const settings = parseSettings(raw);
		this.memorySettings = settings;
		return cloneSettings(settings);
	}

	saveSettings(settings: AppSettings): void {
		const nextSettings = normalizeSettings(settings);
		this.memorySettings = nextSettings;
		this.settingsRef.value = cloneSettings(nextSettings);

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

	updateSettings(patch: Partial<AppSettings>): NormalizedAppSettings {
		const nextSettings: AppSettings = {
			...this.getSettings(),
			...patch,
		};
		const normalized = normalizeSettings(nextSettings);

		this.saveSettings(normalized);
		return normalized;
	}

	getViews(): SavedFilterView[] {
		return [...this.getSettings().savedViews];
	}

	saveView(name: string, snapshot: Omit<SavedFilterView, 'id' | 'name' | 'starred'>): SavedFilterView {
		const current = this.getSettings();
		const view: SavedFilterView = {
			...snapshot,
			id: generateSavedViewId(),
			name: name.trim(),
			starred: false,
		};

		const nextSettings: AppSettings = {
			...current,
			savedViews: [...current.savedViews, view],
		};

		this.saveSettings(nextSettings);
		return view;
	}

	toggleViewStar(id: string): SavedFilterView | null {
		const current = this.getSettings();
		const targetIndex = current.savedViews.findIndex((view) => view.id === id);
		if (targetIndex === -1) {
			return null;
		}

		const toggled = {
			...current.savedViews[targetIndex]!,
			starred: !current.savedViews[targetIndex]!.starred,
		};
		const savedViews = current.savedViews.map((view, index) => index === targetIndex ? toggled : view);
		this.saveSettings({ ...current, savedViews });
		return toggled;
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
