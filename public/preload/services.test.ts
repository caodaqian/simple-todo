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

	it('writes each MCP task to an isolated native document', async () => {
		const documents = new Map<string, UtoolsDbDocument>();
		let revision = 0;
		window.utools.dbStorage = {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		};
		window.utools.db = {
			get: (id) => documents.get(id) ?? null,
			put: (document) => {
				const current = documents.get(document._id);
				if (current && current._rev !== document._rev) return { ok: false, error: true, name: 'conflict' };
				const rev = `rev-${++revision}`;
				documents.set(document._id, { ...document, _rev: rev });
				return { ok: true, rev };
			},
			remove: (document) => {
				const current = documents.get(document._id);
				if (!current || current._rev !== document._rev) return { ok: false, error: true, name: 'conflict' };
				documents.delete(document._id);
				return { ok: true, rev: `rev-${++revision}` };
			},
			bulkDocs: (items) => items.map((item) => window.utools.db!.put(item)),
			allDocs: (prefix) => [...documents.values()].filter((document) => prefix === undefined || document._id.startsWith(prefix)),
		};

		await import('./services.js');

		const registered = vi.mocked(window.utools.registerTool).mock.calls;
		const createTask = registered.find(([name]) => name === 'todo_create_task')![1] as (params: { title: string }) => Promise<{ id: string }>;
		const updateTask = registered.find(([name]) => name === 'todo_update_task')![1] as (params: { task_id: string; title: string }) => Promise<{ title: string }>;

		const created = await createTask({ title: '先创建' });
		const updated = await updateTask({ task_id: created.id, title: '立即更新' });

		expect(updated.title).toBe('立即更新');
		expect(documents.get(`jianyue/task/${created.id}`)?.data).toMatchObject({ id: created.id, title: '立即更新' });
		expect(window.utools.dbStorage.setItem).not.toHaveBeenCalledWith('jianyue.tasks', expect.anything());
	});
});
