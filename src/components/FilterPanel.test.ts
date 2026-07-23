import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { TaskSearchFilter } from '../types/task';
import FilterPanel from './FilterPanel.vue';
import FilterToolbar from './FilterToolbar.vue';

const unmounts: Array<() => void> = [];

const buttonByText = (container: ParentNode, text: string): HTMLButtonElement | undefined =>
	Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
		(button) => button.textContent?.trim() === text,
	);

const mountFilterPanel = async (
	modelValue: TaskSearchFilter,
	availableGroups?: string[],
): Promise<{ panel: HTMLElement; updates: TaskSearchFilter[] }> => {
	const root = document.createElement('div');
	document.body.append(root);
	const updates: TaskSearchFilter[] = [];
	const app = createApp(FilterPanel, {
		modelValue,
		...(availableGroups === undefined ? {} : { availableGroups }),
		'onUpdate:modelValue': (value: TaskSearchFilter) => updates.push(value),
	});
	app.mount(root);
	unmounts.push(() => {
		app.unmount();
		root.remove();
	});
	await nextTick();

	const panel = root.querySelector<HTMLElement>('.filter-panel');
	if (!panel) throw new Error('Filter panel did not mount');
	return { panel, updates };
};

afterEach(() => {
	while (unmounts.length > 0) unmounts.pop()?.();
	document.body.innerHTML = '';
});

describe('FilterPanel group filter', () => {
	it('shows optional group choices', async () => {
		const { panel } = await mountFilterPanel({}, ['工作', '生活']);

		expect(panel.textContent).toContain('分组');
		expect(buttonByText(panel, '全部分组')).toBeDefined();
		expect(buttonByText(panel, '工作')).toBeDefined();
		expect(buttonByText(panel, '生活')).toBeDefined();
	});

	it('emits the merged filter when a group is selected', async () => {
		const { panel, updates } = await mountFilterPanel({ keyword: '发布', status: 'doing' }, ['工作']);

		buttonByText(panel, '工作')?.click();
		await nextTick();

		expect(updates).toEqual([{ keyword: '发布', status: 'doing', group: '工作' }]);
	});

	it('removes group through mergePatch when all groups is selected', async () => {
		const { panel, updates } = await mountFilterPanel({ keyword: '发布', group: '工作' }, ['工作']);

		buttonByText(panel, '全部分组')?.click();
		await nextTick();

		expect(updates).toEqual([{ keyword: '发布' }]);
		expect(Object.hasOwn(updates[0] ?? {}, 'group')).toBe(false);
	});

	it('shows groups in the panel after the toolbar is opened', async () => {
		const root = document.createElement('div');
		document.body.append(root);
		const app = createApp(FilterToolbar, { modelValue: {}, availableGroups: ['工作'] });
		app.mount(root);
		unmounts.push(() => {
			app.unmount();
			root.remove();
		});
		await nextTick();

		buttonByText(root, '筛选')?.click();
		await nextTick();

		expect(buttonByText(root, '全部分组')).toBeDefined();
		expect(buttonByText(root, '工作')).toBeDefined();
	});
});
