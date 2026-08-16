import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { taskService } from '../../services/taskService';
import type { Task } from '../../types/task';
import StickyNoteWindow from './index.vue';

const task = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: '任务详情',
	status: 'todo',
	priority: 'medium',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe('StickyNoteWindow', () => {
	let app: App<Element> | null = null;
	let root: HTMLDivElement | null = null;

	afterEach(() => {
		app?.unmount();
		root?.remove();
		app = null;
		root = null;
		vi.restoreAllMocks();
	});

	it('按 Escape 关闭详情，即使焦点元素阻止事件冒泡', async () => {
		vi.spyOn(taskService, 'getAll').mockReturnValue([task()]);
		root = document.createElement('div');
		document.body.append(root);
		app = createApp(StickyNoteWindow);
		app.mount(root);
		await nextTick();

		const taskArticle = root.querySelector<HTMLElement>('.sticky-task');
		expect(taskArticle).not.toBeNull();
		taskArticle?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await nextTick();
		expect(root.querySelector('.sticky-detail')).not.toBeNull();

		const closeButton = root.querySelector<HTMLButtonElement>('.sticky-detail__close');
		expect(closeButton).not.toBeNull();
		closeButton?.focus();
		closeButton?.addEventListener('keydown', (event) => event.stopPropagation(), { once: true });
		closeButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await nextTick();

		expect(root.querySelector('.sticky-detail')).toBeNull();
		expect(root.querySelector('.sticky-window')).not.toBeNull();
	});
});
