import { beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../plugin.json';

describe('MCP tool registration', () => {
	beforeEach(() => {
		vi.resetModules();
		window.utools = {
			...(window.utools ?? {}),
			dbStorage: { getItem: vi.fn(), setItem: vi.fn() },
			getPath: vi.fn(() => '/tmp'),
			showNotification: vi.fn(),
			registerTool: vi.fn(),
		} as typeof window.utools;
	});

	it('registers exactly the tools declared in plugin.json', async () => {
		await import('./services.js');

		const registered = vi.mocked(window.utools.registerTool).mock.calls.map(([name]) => name).sort();
		expect(registered).toEqual(Object.keys(plugin.tools).sort());
		expect(registered).toHaveLength(17);
	});

	it('keeps a just-written task available to the next MCP write while storage is stale', async () => {
		const persisted = new Map<string, string>();
		const delayedWrites = new Map<string, string>();
		window.utools.dbStorage = {
			getItem: vi.fn((key: string) => persisted.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => {
				delayedWrites.set(key, value);
			}),
		};

		await import('./services.js');

		const registered = vi.mocked(window.utools.registerTool).mock.calls;
		const createTask = registered.find(([name]) => name === 'todo_create_task')![1] as (params: { title: string }) => Promise<{ id: string }>;
		const updateTask = registered.find(([name]) => name === 'todo_update_task')![1] as (params: { task_id: string; title: string }) => Promise<{ title: string }>;

		const created = await createTask({ title: '先创建' });
		const updated = await updateTask({ task_id: created.id, title: '立即更新' });

		expect(updated.title).toBe('立即更新');
		expect(delayedWrites.get('jianyue.tasks')).toContain('立即更新');
	});
});
