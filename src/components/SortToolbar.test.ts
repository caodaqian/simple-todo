import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { TaskSortConfig } from '../types/task';
import SortToolbar from './SortToolbar.vue';

const unmounts: Array<() => void> = [];

const mountToolbar = async (modelValue: TaskSortConfig): Promise<{ root: HTMLElement; updates: TaskSortConfig[] }> => {
	const root = document.createElement('div');
	document.body.append(root);
	const updates: TaskSortConfig[] = [];
	const app = createApp(SortToolbar, {
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

describe('SortToolbar', () => {
	it('opens the sorting panel and marks custom rules as active', async () => {
		const { root } = await mountToolbar([{ field: 'tags', order: 'asc' }]);
		const trigger = root.querySelector<HTMLButtonElement>('.sort-trigger');
		expect(trigger?.classList.contains('active')).toBe(true);
		expect(root.querySelector('.sort-badge')?.textContent).toBe('1');

		trigger?.click();
		await nextTick();
		expect(root.querySelector('.sort-panel')).not.toBeNull();
	});

	it('closes when Escape is pressed', async () => {
		const { root } = await mountToolbar([{ field: 'priority', order: 'desc' }]);
		root.querySelector<HTMLButtonElement>('.sort-trigger')?.click();
		await nextTick();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextTick();
		expect(root.querySelector('.sort-panel')).not.toBeNull();
		expect(root.querySelector<HTMLElement>('.sort-popover')?.style.display).toBe('none');
	});
});
