import { ref, type Ref } from 'vue';
import type { TodoView } from '../types/settings';
import type { SideSection, UiState } from '../types/uiState';
import { DEFAULT_UI_STATE } from '../types/uiState';
import { parseTaskSearchFilter, parseTaskSortOption } from './filterUtils';
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

const isTodoView = (value: unknown): value is TodoView =>
	value === 'list' || value === 'kanban' || value === 'eisenhower' || value === 'calendar';

/** 已知侧栏分区字面量；tag:/group: 前缀单独校验。 */
const KNOWN_SECTIONS: readonly SideSection[] = ['today', 'week', 'overdue', 'inbox', 'done', 'archived'];

const isSideSection = (value: unknown): value is SideSection => {
	if (typeof value !== 'string' || value.length === 0) return false;
	if ((KNOWN_SECTIONS as readonly string[]).includes(value)) return true;
	// 允许任意非空 tag: 或 group: 后缀
	if (value.startsWith('tag:') && value.length > 'tag:'.length) return true;
	if (value.startsWith('group:') && value.length > 'group:'.length) return true;
	return false;
};

const parseUiState = (raw: string): UiState => {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isObjectRecord(parsed)) {
			return { ...DEFAULT_UI_STATE };
		}

		return {
			currentView: isTodoView(parsed.currentView) ? parsed.currentView : DEFAULT_UI_STATE.currentView,
			activeSection: isSideSection(parsed.activeSection)
				? parsed.activeSection
				: DEFAULT_UI_STATE.activeSection,
			activeFilter: parseTaskSearchFilter(parsed.activeFilter),
			activeSort: parseTaskSortOption(parsed.activeSort),
		};
	} catch {
		return { ...DEFAULT_UI_STATE };
	}
};

class UiStateService {
	private readonly storageKey = STORAGE_KEYS.UI_STATE;

	private memoryUiState: UiState = { ...DEFAULT_UI_STATE };

	private readonly uiStateRef: Ref<UiState> = ref<UiState>({ ...DEFAULT_UI_STATE });

	constructor() {
		// Hydrate ref from persisted storage at construction time.
		const initial = this.getUiState();
		this.uiStateRef.value = initial;
	}

	getUiStateRef(): Ref<UiState> {
		return this.uiStateRef;
	}

	getUiState(): UiState {
		const raw = this.readFromStorage();

		if (raw === null) {
			return { ...this.memoryUiState };
		}

		const state = parseUiState(raw);
		this.memoryUiState = state;
		return { ...state };
	}

	saveUiState(state: UiState): void {
		const nextState: UiState = { ...state };
		this.memoryUiState = nextState;
		this.uiStateRef.value = nextState;

		const localStorage = this.getLocalStorage();
		if (!localStorage) {
			return;
		}

		try {
			localStorage.setItem(this.storageKey, JSON.stringify(nextState));
		} catch {
			// Gracefully fall back to memory storage when localStorage fails.
		}
	}

	updateUiState(patch: Partial<UiState>): UiState {
		const nextState: UiState = {
			...this.getUiState(),
			...patch,
		};

		this.saveUiState(nextState);
		return nextState;
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
		if (!dbStorage) {
			return null;
		}

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

export const uiStateService = new UiStateService();
