import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, type PropType } from 'vue';
import type { AppSettings, TodoView } from '../../types/settings';
import type { TaskSearchFilter, TaskSortOption } from '../../types/task';

const { settingsState, saveView, toggleViewStar, getUiState, catchUpReminders, drainWebhookReminders, useReminderScheduler } = vi.hoisted(() => {
	const settingsState: { value: AppSettings } = { value: {} as AppSettings };
	return {
		settingsState,
		saveView: vi.fn(),
		toggleViewStar: vi.fn(),
		getUiState: vi.fn(),
		catchUpReminders: vi.fn(),
		drainWebhookReminders: vi.fn(),
		useReminderScheduler: vi.fn(),
	};
});

vi.mock('../../services/settingsService', () => ({
	settingsService: {
		getSettings: () => settingsState.value,
		saveView,
		toggleViewStar,
		deleteView: vi.fn(),
		saveSettings: vi.fn(),
	},
}));

vi.mock('../../services/uiStateService', () => ({
	uiStateService: {
		getUiState,
		saveUiState: vi.fn(),
	},
}));

vi.mock('../../services/taskService', () => ({
	taskService: { getAll: () => [] },
}));

vi.mock('../../composables/useUtoolsTaskSearch', () => ({
	useUtoolsTaskSearch: () => ({ activate: vi.fn(), dispose: vi.fn() }),
}));

vi.mock('../../composables/useReminderScheduler', () => ({
	catchUpReminders,
	drainWebhookReminders,
	useReminderScheduler,
}));

vi.mock('../../services/stickyWindowService', () => ({ openStickyNoteWindow: vi.fn(() => ({ ok: true })) }));
vi.mock('../../services/stickyNoteService', () => ({ stickyNoteService: { buildSourceFromCurrent: vi.fn(), buildSourceFromSaved: vi.fn() } }));
vi.mock('../../services/smartTaskOrganizerService', () => ({ buildSmartOrganizationPlan: vi.fn(() => ({ changes: [] })) }));

vi.mock('../../components/AppIcon.vue', () => ({ default: { template: '<span />' } }));
vi.mock('../../components/PomodoroStatusPill.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../components/SettingsPanel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../components/TaskEditor.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../components/TaskReviewPanel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../../components/TemplateLibraryPanel.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../CalendarView/index.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../EisenhowerView/index.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../KanbanView/index.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../ListView/index.vue', () => ({ default: { template: '<div />' } }));

vi.mock('../../components/FilterToolbar.vue', () => ({
	default: defineComponent({
		props: { modelValue: { type: Object as PropType<TaskSearchFilter>, required: true } },
		template: '<output data-testid="active-filter">{{ JSON.stringify(modelValue) }}</output>',
	}),
}));

vi.mock('../../components/SavedViewDialog.vue', () => ({
	default: defineComponent({
		props: { modelValue: { type: Boolean, required: true } },
		emits: ['update:modelValue', 'save'],
		template: `
			<div v-if="modelValue" data-testid="saved-view-dialog">
				<button
					data-testid="saved-view-dialog-save"
					@click="$emit('save', { name: '草稿视图', filter: { tags: ['草稿标签'] }, sort: { field: 'createdAt', order: 'desc' } })"
				>保存</button>
			</div>
		`,
	}),
}));

import TodoHub from './index.vue';

const baseSettings = (): AppSettings => ({
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
});

const mountTodoHub = async (): Promise<HTMLElement> => {
	const root = document.createElement('div');
	document.body.append(root);
	createApp(TodoHub).mount(root);
	await nextTick();
	return root;
};

afterEach(() => {
	document.body.innerHTML = '';
	delete window.utools;
	vi.clearAllMocks();
});

describe('TodoHub Webhook Outbox 生命周期', () => {
	it('drains restored deliveries without regenerating reminder events', async () => {
		settingsState.value = baseSettings();
		getUiState.mockReturnValue({ currentView: 'list', activeSection: 'inbox', activeFilter: {}, activeSort: { field: 'dueDate' } });
		let restore: (() => void) | undefined;
		window.utools = {
			onDbRestore: vi.fn((callback: () => void) => {
				restore = callback;
			}),
			onPluginEnter: vi.fn(),
		} as unknown as typeof window.utools;
		await mountTodoHub();

		restore?.();

		expect(drainWebhookReminders).toHaveBeenCalledOnce();
		expect(catchUpReminders).not.toHaveBeenCalled();
	});
});

describe('TodoHub 保存视图', () => {
	it('将星标保存视图稳定排在未星标视图前', async () => {
		settingsState.value = {
			...baseSettings(),
			savedViews: [
				{ id: 'first', name: '未星标一', starred: false, view: 'list', section: 'inbox', filter: {} },
				{ id: 'starred', name: '星标视图', starred: true, view: 'list', section: 'inbox', filter: {} },
				{ id: 'second', name: '未星标二', starred: false, view: 'list', section: 'inbox', filter: {} },
			],
		};
		getUiState.mockReturnValue({ currentView: 'list' as TodoView, activeSection: 'inbox', activeFilter: {}, activeSort: { field: 'dueDate' } });

		const root = await mountTodoHub();

		expect(Array.from(root.querySelectorAll('.sidebar-saved-item')).map((item) => item.textContent?.trim())).toEqual([
			'星标视图',
			'未星标一',
			'未星标二',
		]);
	});

	it('将星标视图独立放在左侧最顶部，普通保存视图只显示未星标项', async () => {
		settingsState.value = {
			...baseSettings(),
			savedViews: [
				{ id: 'ordinary', name: '普通视图', starred: false, view: 'list', section: 'inbox', filter: {} },
				{ id: 'starred', name: '重要视图', starred: true, view: 'list', section: 'inbox', filter: {} },
			],
		};
		getUiState.mockReturnValue({ currentView: 'list' as TodoView, activeSection: 'inbox', activeFilter: {}, activeSort: { field: 'dueDate' } });

		const root = await mountTodoHub();
		const sidebar = root.querySelector('.hub-sidebar');
		const starredSection = root.querySelector('.sidebar-starred-views');
		const savedSection = root.querySelector('.sidebar-saved-views');

		expect(sidebar?.firstElementChild).toBe(starredSection);
		expect(Array.from(starredSection?.querySelectorAll('.sidebar-saved-item') ?? []).map((item) => item.textContent?.trim())).toEqual(['重要视图']);
		expect(Array.from(savedSection?.querySelectorAll('.sidebar-saved-item') ?? []).map((item) => item.textContent?.trim())).toEqual(['普通视图']);
	});

	it('点击保存视图加号显示保存视图对话框', async () => {
		settingsState.value = baseSettings();
		getUiState.mockReturnValue({ currentView: 'list' as TodoView, activeSection: 'inbox', activeFilter: {}, activeSort: { field: 'dueDate' } });
		const root = await mountTodoHub();

		root.querySelector<HTMLButtonElement>('.save-view-trigger')?.click();
		await nextTick();

		expect(root.querySelector('[data-testid="saved-view-dialog"]')).not.toBeNull();
	});

	it('保存对话框提交保存当前视图快照且不改变活跃筛选', async () => {
		settingsState.value = baseSettings();
		const activeFilter: TaskSearchFilter = { group: '工作', tags: ['当前标签'], status: 'doing' };
		const activeSort: TaskSortOption = { field: 'priority', order: 'asc' };
		getUiState.mockReturnValue({ currentView: 'kanban' as TodoView, activeSection: 'group:工作', activeFilter, activeSort });
		const root = await mountTodoHub();

		const filterBeforeSave = root.querySelector('[data-testid="active-filter"]')?.textContent;
		root.querySelector<HTMLButtonElement>('.save-view-trigger')?.click();
		await nextTick();
		root.querySelector<HTMLButtonElement>('[data-testid="saved-view-dialog-save"]')?.click();
		await nextTick();

		expect(saveView).toHaveBeenCalledWith('草稿视图', {
			view: 'kanban',
			section: 'group:工作',
			filter: { tags: ['草稿标签'] },
			sort: { field: 'createdAt', order: 'desc' },
		});
		expect(root.querySelector('[data-testid="active-filter"]')?.textContent).toBe(filterBeforeSave);
	});
});
