import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { taskService } from '../services/taskService';
import { templateService } from '../services/templateService';
import type { Task, TaskTemplate } from '../types/task';
import TaskEditor from './TaskEditor.vue';

const mounts: Array<() => void> = [];

const mountEditor = async (task?: Task): Promise<HTMLElement> => {
	const root = document.createElement('div');
	document.body.append(root);
	const app = createApp(TaskEditor, { modelValue: true, task });
	app.mount(root);
	mounts.push(() => {
		app.unmount();
		root.remove();
	});
	await nextTick();
	const editor = document.body.querySelector<HTMLElement>('.task-editor');
	if (!editor) throw new Error('Task editor did not mount');
	return editor;
};

beforeEach(() => {
	Object.defineProperty(window, 'utools', {
		configurable: true,
		value: {
			dbStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
		},
	});
	window.services = {
		...window.services,
		fetchPageTitle: vi.fn(async () => 'Example Site'),
	} as unknown as typeof window.services;
});

afterEach(() => {
	while (mounts.length > 0) mounts.pop()?.();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('TaskEditor compact layout', () => {
	it('keeps large content in the main column and aggregates properties in one panel', async () => {
		const editor = await mountEditor();

		const body = editor.querySelector('.task-editor-body');
		expect(body?.querySelector(':scope > .editor-main-column')).not.toBeNull();
		expect(body?.querySelector(':scope > .editor-properties-panel')).not.toBeNull();
		expect(editor.querySelectorAll('.editor-properties-panel')).toHaveLength(1);
		expect(editor.querySelector('.editor-main-column .desc-card')).not.toBeNull();
		expect(editor.querySelector('.editor-main-column .subtask-card')).not.toBeNull();
		expect(editor.querySelector('.editor-properties-panel .organization-section')).not.toBeNull();
		expect(editor.querySelector('.editor-properties-panel .planning-section')).not.toBeNull();
	});

	it('opens the complete template menu from the title workspace', async () => {
		const editor = await mountEditor();
		const trigger = editor.querySelector<HTMLButtonElement>('[data-testid="template-menu-trigger"]');
		expect(trigger).not.toBeNull();
		expect(editor.querySelector('[data-testid="template-menu"]')).toBeNull();

		trigger?.click();
		await nextTick();

		const menu = editor.querySelector('[data-testid="template-menu"]');
		expect(menu).not.toBeNull();
		expect(menu?.textContent).toContain('套用模板');
		expect(menu?.textContent).toContain('保存当前为模板');
		expect(trigger?.getAttribute('aria-expanded')).toBe('true');
		expect(menu?.contains(document.activeElement)).toBe(true);
	});

	it('closes the template popover with Escape and restores trigger focus', async () => {
		const editor = await mountEditor();
		const trigger = editor.querySelector<HTMLButtonElement>('[data-testid="template-menu-trigger"]');
		trigger?.click();
		await nextTick();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextTick();

		expect(editor.querySelector('[data-testid="template-menu"]')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it('persists template children when applying a template to an existing task', async () => {
		const task: Task = {
			id: 'task-1', title: 'Existing', status: 'todo', priority: 'medium', tags: [], group: '',
			description: '', subtasks: [], createdAt: 1, updatedAt: 1,
		};
		const template: TaskTemplate = {
			id: 'tpl-1', name: 'Launch', title: 'Launch project', priority: 'high', tags: ['work'],
			group: 'Project', description: 'Plan', subtasks: [], children: ['Ship'],
			childTasks: [{ title: 'Ship', priority: 'high', tags: ['work'], group: 'Project', description: 'Release it' }],
			createdAt: 1, updatedAt: 1,
		};
		vi.spyOn(templateService, 'list').mockReturnValue([template]);
		vi.spyOn(templateService, 'buildDraft').mockReturnValue({
			task: { title: template.title, status: 'todo', priority: 'high', tags: ['work'], group: 'Project', description: 'Plan', subtasks: [] },
			children: [{ title: 'Ship', status: 'todo', priority: 'high', tags: ['work'], group: 'Project', description: 'Release it', subtasks: [] }],
		});
		vi.spyOn(taskService, 'getById').mockReturnValue(task);
		vi.spyOn(taskService, 'getChildTasks').mockReturnValue([]);
		const saveSpy = vi.spyOn(taskService, 'saveTask').mockImplementation((input) => ({
			id: input.id ?? 'child-1', title: input.title, status: input.status, priority: input.priority,
			tags: [...input.tags], group: input.group, description: input.description, subtasks: [],
			createdAt: input.createdAt ?? 1, updatedAt: input.updatedAt ?? 1,
			...(input.parentTaskId === undefined ? {} : { parentTaskId: input.parentTaskId }),
		}));
		const editor = await mountEditor(task);

		editor.querySelector<HTMLButtonElement>('[data-testid="template-menu-trigger"]')?.click();
		await nextTick();
		const applyButton = Array.from(editor.querySelectorAll<HTMLButtonElement>('[data-testid="template-menu"] button'))
			.find((button) => button.textContent?.trim() === '套用模板');
		applyButton?.click();
		await nextTick();

		expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
			parentTaskId: 'task-1',
			title: 'Ship',
			description: 'Release it',
		}));
		expect(document.activeElement).toBe(editor.querySelector('#task-editor-title-input'));
	});

	it('keeps deadline, reminder and repeat controls together in the planning section', async () => {
		const editor = await mountEditor();
		const planning = editor.querySelector('.planning-section');

		expect(planning?.textContent).toContain('截止');
		expect(planning?.textContent).toContain('提醒');
		expect(planning?.textContent).toContain('重复');
		expect(planning?.querySelector('.due-add-btn')).not.toBeNull();
		expect(planning?.querySelector('.planning-options-grid')).not.toBeNull();
		expect(planning?.querySelector('.reminder-select')).not.toBeNull();
		expect(planning?.querySelector('.repeat-type-select')).not.toBeNull();
	});

	it('uses a single compact header row without a redundant detail kicker', async () => {
		const editor = await mountEditor();

		expect(editor.querySelector('.task-editor-kicker')).toBeNull();
		expect(editor.querySelector('.task-editor-heading-row')).not.toBeNull();
	});

	it('closes the template popover when the editor closes', async () => {
		const editor = await mountEditor();
		editor.querySelector<HTMLButtonElement>('[data-testid="template-menu-trigger"]')?.click();
		await nextTick();

		editor.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
		await nextTick();

		expect(editor.querySelector('[data-testid="template-menu"]')).toBeNull();
	});

	it('offers a smart menu for a pasted URL and inserts the fetched page title', async () => {
		const editor = await mountEditor();
		editor.querySelector<HTMLElement>('.desc-preview')?.click();
		await nextTick();
		const textarea = editor.querySelector<HTMLTextAreaElement>('#task-description-input');
		expect(textarea).not.toBeNull();
		textarea!.focus();
		textarea!.setSelectionRange(0, 0);
		const clipboard = { getData: () => 'https://example.com/docs' } as unknown as DataTransfer;
		const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboard });
		textarea!.dispatchEvent(pasteEvent);
		await nextTick();
		await Promise.resolve();

		expect(editor.querySelector('.link-paste-menu')).not.toBeNull();
		editor.querySelector<HTMLButtonElement>('.link-paste-menu .btn-ghost')?.click();
		await nextTick();
		editor.querySelector<HTMLInputElement>('#link-label-input')!.value = '文档';
		editor.querySelector<HTMLInputElement>('#link-label-input')?.dispatchEvent(new Event('input', { bubbles: true }));
		editor.querySelector<HTMLButtonElement>('.link-paste-menu .btn-primary')?.click();
		await nextTick();

		expect(textarea!.value).toBe('[文档](https://example.com/docs)');
	});

	it('does not intercept pasted ordinary text', async () => {
		const editor = await mountEditor();
		editor.querySelector<HTMLElement>('.desc-preview')?.click();
		await nextTick();
		const textarea = editor.querySelector<HTMLTextAreaElement>('#task-description-input')!;
		const clipboard = { getData: () => '普通文本 https://example.com' } as unknown as DataTransfer;
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: clipboard });
		textarea.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
		expect(editor.querySelector('.link-paste-menu')).toBeNull();
	});
});
