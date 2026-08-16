import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, ref, type PropType } from 'vue';
import type { Task } from '../../types/task';

vi.mock('../../components/AppIcon.vue', () => ({ default: defineComponent({ template: '<span />' }) }));
vi.mock('../../components/PomodoroStartButton.vue', () => ({ default: defineComponent({ template: '<span />' }) }));
vi.mock('../../components/SmartTaskInput.vue', () => ({ default: defineComponent({ template: '<span />' }) }));
vi.mock('../../components/TaskCompletionBlockedModal.vue', () => ({ default: defineComponent({ template: '<span />' }) }));
vi.mock('../../components/TaskEditor.vue', () => ({ default: defineComponent({ template: '<span />' }) }));
vi.mock('../../components/TaskQuickActions.vue', () => ({ default: defineComponent({ template: '<span />' }) }));
vi.mock('../../components/ViewToolbar.vue', () => ({ default: defineComponent({ template: '<div><slot name="left" /><slot name="actions" /></div>' }) }));
vi.mock('../../components/TaskCard.vue', () => ({
	default: defineComponent({
		props: { task: { type: Object as PropType<Task>, required: true } },
		template: '<article class="mock-task-card">{{ task.title }}</article>',
	}),
}));
vi.mock('../../composables/useTaskHierarchy', () => ({
	useTaskHierarchy: () => ({
		getTaskDepth: () => 0,
		getParentTitle: () => undefined,
	}),
}));
vi.mock('../../composables/useTaskQuickActions', () => ({
	useTaskQuickActions: () => ({
		blockedInfo: ref(null),
		dismissBlockedModal: vi.fn(),
		cycleStatus: vi.fn(),
		setPriority: vi.fn(),
		toggleArchive: vi.fn(),
	}),
}));

import EisenhowerView from './index.vue';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-' + Math.random().toString(36).slice(2, 8),
	title: '任务',
	status: 'todo',
	priority: 'urgent',
	tags: [],
	group: '',
	description: '',
	subtasks: [],
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const mounts: Array<() => void> = [];

const mountView = async (tasks: Task[]): Promise<HTMLElement> => {
	const root = document.createElement('div');
	document.body.append(root);
	const app = createApp(EisenhowerView, { tasks, filter: { showCompleted: true } });
	app.mount(root);
	mounts.push(() => {
		app.unmount();
		root.remove();
	});
	await nextTick();
	return root;
};

afterEach(() => {
	while (mounts.length > 0) mounts.pop()?.();
	document.body.innerHTML = '';
});

describe('EisenhowerView deadline ordering', () => {
	it('renders each quadrant from latest deadline to earliest with undated tasks last', async () => {
		const root = await mountView([
			makeTask({ id: 'undated', title: '无截止时间' }),
			makeTask({ id: 'early', title: '较早截止', dueEnd: 100 }),
			makeTask({ id: 'late', title: '较晚截止', dueEnd: 500 }),
		]);

		const cards = root.querySelectorAll('.quadrant:first-of-type .mock-task-card');
		expect(Array.from(cards).map((card) => card.textContent)).toEqual(['较晚截止', '较早截止', '无截止时间']);
	});
});