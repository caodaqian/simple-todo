import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { TodoView } from '../types/settings';
import type { TaskSearchFilter, TaskSortConfig } from '../types/task';
import SavedViewDialog from './SavedViewDialog.vue';

const unmounts: Array<() => void> = [];

interface DialogMount {
	root: HTMLElement;
	updates: boolean[];
	saves: Array<{ name: string; filter: TaskSearchFilter; sort: TaskSortConfig }>;
}

const buttonByText = (container: ParentNode, text: string): HTMLButtonElement | undefined =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
		(button) => button.textContent?.trim() === text,
	);

const mountDialog = async (overrides: Partial<{
	modelValue: boolean;
	view: TodoView;
	initialName: string;
	initialFilter: TaskSearchFilter;
	initialSort: TaskSortConfig;
	availableTags: string[];
	availableGroups: string[];
}> = {}): Promise<DialogMount> => {
	const root = document.createElement('div');
	document.body.append(root);
	const updates: boolean[] = [];
	const saves: Array<{ name: string; filter: TaskSearchFilter; sort: TaskSortConfig }> = [];
	const app = createApp(SavedViewDialog, {
		modelValue: true,
		view: 'list' as TodoView,
		initialName: '本周工作',
		initialFilter: {
			priority: ['high'],
			status: ['todo'],
			tags: ['产品'],
			dateRange: { start: new Date(2026, 6, 1).getTime(), end: new Date(2026, 6, 31, 23, 59, 59, 999).getTime() },
		},
		initialSort: [{ field: 'dueDate', order: 'asc' }],
		availableTags: ['产品', '发布'],
		availableGroups: ['工作', '生活'],
		...overrides,
		'onUpdate:modelValue': (value: boolean) => updates.push(value),
		onSave: (payload: { name: string; filter: TaskSearchFilter; sort: TaskSortConfig }) => saves.push(payload),
	});
	app.mount(root);
	unmounts.push(() => {
		app.unmount();
		root.remove();
	});
	await nextTick();

	return { root, updates, saves };
};

afterEach(() => {
	while (unmounts.length > 0) unmounts.pop()?.();
	document.body.innerHTML = '';
});

describe('SavedViewDialog', () => {
	it('打开时初始化独立草稿并将名称输入框置为焦点', async () => {
		const initialFilter: TaskSearchFilter = {
			priority: ['high'],
			status: ['todo'],
			tags: ['产品'],
			dateRange: { start: 100, end: 200 },
		};
		const initialSort: TaskSortConfig = [{ field: 'dueDate', order: 'asc' }];
		await mountDialog({ initialFilter, initialSort });

		const nameInput = document.body.querySelector<HTMLInputElement>('input[name="saved-view-name"]');
		expect(nameInput?.value).toBe('本周工作');
		expect(document.activeElement).toBe(nameInput);

		buttonByText(document.body, '#发布')?.click();
		await nextTick();

		expect(initialFilter).toEqual({
			priority: ['high'],
			status: ['todo'],
			tags: ['产品'],
			dateRange: { start: 100, end: 200 },
		});
		expect(initialSort).toEqual([{ field: 'dueDate', order: 'asc' }]);
	});

	it('编辑分组、状态和标签只更新内部草稿，保存时输出组合筛选', async () => {
		const { updates, saves } = await mountDialog();

		buttonByText(document.body, '工作')?.click();
		await nextTick();
		buttonByText(document.body, '进行中')?.click();
		await nextTick();
		buttonByText(document.body, '#发布')?.click();
		await nextTick();

		expect(updates).toEqual([]);

		buttonByText(document.body, '保存')?.click();
		await nextTick();

		expect(saves).toEqual([{
			name: '本周工作',
			filter: {
				priority: ['high'],
				status: ['todo', 'doing'],
				tags: ['产品', '发布'],
				group: '工作',
				dateRange: { start: new Date(2026, 6, 1).getTime(), end: new Date(2026, 6, 31, 23, 59, 59, 999).getTime() },
			},
			sort: [{ field: 'dueDate', order: 'asc' }],
		}]);
		expect(updates).toEqual([false]);
	});

	it('名称 trim 后为空时禁用保存', async () => {
		await mountDialog({ initialName: '   ' });

		const nameInput = document.body.querySelector<HTMLInputElement>('input[name="saved-view-name"]');
		const saveButton = buttonByText(document.body, '保存');
		expect(nameInput).not.toBeNull();
		expect(saveButton?.disabled).toBe(true);

		if (nameInput) {
			nameInput.value = '  新视图  ';
			nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		}
		await nextTick();

		expect(saveButton?.disabled).toBe(false);
	});

	it('取消不会保存，仅请求关闭', async () => {
		const { updates, saves } = await mountDialog();

		buttonByText(document.body, '取消')?.click();
		await nextTick();

		expect(saves).toEqual([]);
		expect(updates).toEqual([false]);
	});

	it('按 Escape 不会保存，仅请求关闭', async () => {
		const { updates, saves } = await mountDialog();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextTick();

		expect(saves).toEqual([]);
		expect(updates).toEqual([false]);
	});
});
