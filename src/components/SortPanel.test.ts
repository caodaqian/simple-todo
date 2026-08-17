import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { TaskSortConfig } from '../types/task';
import SortPanel from './SortPanel.vue';

const unmounts: Array<() => void> = [];

const mountPanel = async (modelValue: TaskSortConfig): Promise<{ root: HTMLElement; updates: TaskSortConfig[] }> => {
	const root = document.createElement('div');
	document.body.append(root);
	const updates: TaskSortConfig[] = [];
	const app = createApp(SortPanel, {
		modelValue,
		'onUpdate:modelValue': (value: TaskSortConfig) => updates.push(value),
	});
	app.mount(root);
	unmounts.push(() => {
		app.unmount();
		root.remove();
	});
	await nextTick();
	return { root, updates };
};

afterEach(() => {
	while (unmounts.length > 0) unmounts.pop()?.();
	document.body.innerHTML = '';
});

describe('SortPanel', () => {
	it('adds and removes unique sort rules', async () => {
		const { root, updates } = await mountPanel([{ field: 'priority', order: 'desc' }]);
		root.querySelector<HTMLButtonElement>('button[title="添加排序条件"]')?.click();
		await nextTick();

		expect(updates[0]).toEqual([
			{ field: 'priority', order: 'desc' },
			{ field: 'dueDate', order: 'asc' },
		]);

		const removeMount = await mountPanel([
			{ field: 'priority', order: 'desc' },
			{ field: 'dueDate', order: 'asc' },
		]);
		removeMount.root.querySelector<HTMLButtonElement>('button[title="删除"]')?.click();
		await nextTick();
		expect(removeMount.updates[0]).toEqual([{ field: 'dueDate', order: 'asc' }]);
	});

	it('toggles direction and moves a rule', async () => {
		const { root, updates } = await mountPanel([
			{ field: 'priority', order: 'desc' },
			{ field: 'dueDate', order: 'asc' },
		]);

		root.querySelector<HTMLButtonElement>('button[title="高 → 低"]')?.click();
		await nextTick();
		expect(updates[0]).toEqual([
			{ field: 'priority', order: 'asc' },
			{ field: 'dueDate', order: 'asc' },
		]);

		const moveMount = await mountPanel([
			{ field: 'priority', order: 'asc' },
			{ field: 'dueDate', order: 'asc' },
		]);
		moveMount.root.querySelector<HTMLButtonElement>('button[aria-label="第 1 条下移"]')?.click();
		await nextTick();
		expect(moveMount.updates[0]).toEqual([
			{ field: 'dueDate', order: 'asc' },
			{ field: 'priority', order: 'asc' },
		]);
	});

	it('restores the three-field default configuration', async () => {
		const { root, updates } = await mountPanel([{ field: 'tags', order: 'desc' }]);
		root.querySelector<HTMLButtonElement>('button[title="恢复默认"]')?.click();
		await nextTick();

		expect(updates[0]).toEqual([
			{ field: 'priority', order: 'desc' },
			{ field: 'dueDate', order: 'asc' },
			{ field: 'status', order: 'asc' },
		]);
	});
});
