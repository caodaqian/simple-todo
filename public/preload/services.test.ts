import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../plugin.json';

const require = createRequire(import.meta.url);
const webhookClient = require('./webhookClient.js') as { sendWebhook: typeof vi.fn };

describe('MCP tool registration', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		window.utools = {
			...(window.utools ?? {}),
			dbStorage: { getItem: vi.fn(), setItem: vi.fn() },
			dbCryptoStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
			getPath: vi.fn(() => '/tmp'),
			showNotification: vi.fn(),
			registerTool: vi.fn(),
		} as typeof window.utools;
	});

	it('exposes only the narrow webhook credential API to the renderer', async () => {
		await import('./services.js');

		expect(Object.keys(window.services.webhooks).sort()).toEqual(['clearCredentials', 'getStatuses', 'saveCredentials', 'testCredentials']);
		expect(window.services.webhooks).not.toHaveProperty('read');
		expect(window.services.webhooks).not.toHaveProperty('sendWebhook');
		expect(window.services.webhooks).not.toHaveProperty('send');
	});

	it('returns invalid_credentials when testing an unconfigured webhook', async () => {
		const sendWebhookMock = vi.spyOn(webhookClient, 'sendWebhook');
		await import('./services.js');

		const result = await window.services.webhooks.testCredentials('feishu');

		expect(result).toEqual({ ok: false, errorCode: 'invalid_credentials' });
		expect(sendWebhookMock).not.toHaveBeenCalled();
	});

	it('tests stored credentials with the fixed notification message', async () => {
		const credentials = {
			url: 'https://open.feishu.cn/open-apis/bot/v2/hook/sensitive-token',
			secret: 'sensitive-secret',
		};
		window.utools!.dbCryptoStorage!.getItem = vi.fn(() => credentials);
		await import('./services.js');
		const sendWebhookMock = vi.spyOn(webhookClient, 'sendWebhook').mockResolvedValue({ ok: true, status: 200 });

		const result = await window.services.webhooks.testCredentials('feishu');

		expect(result).toEqual({ ok: true, status: 200 });
		expect(sendWebhookMock).toHaveBeenCalledWith('feishu', credentials, {
			title: '简悦清单',
			text: '简悦清单机器人通知测试',
		});
	});

	it('routes webhook credential status and writes only through dbCryptoStorage', async () => {
		const encryptedValues = new Map<string, unknown>();
		window.utools!.dbCryptoStorage = {
			getItem: vi.fn((key: string) => encryptedValues.get(key) ?? null),
			setItem: vi.fn((key: string, value: unknown) => encryptedValues.set(key, value)),
			removeItem: vi.fn((key: string) => encryptedValues.delete(key)),
		};
		await import('./services.js');
		vi.mocked(window.utools!.dbStorage!.getItem).mockClear();
		vi.mocked(window.utools!.dbStorage!.setItem).mockClear();

		const saved = await window.services.webhooks.saveCredentials('feishu', {
			url: 'https://open.feishu.cn/open-apis/bot/v2/hook/sensitive-token-4321',
			secret: 'sensitive-secret',
		});
		const statuses = await window.services.webhooks.getStatuses();

		expect(saved).toEqual({ platform: 'feishu', configured: true, endpointLabel: 'feishu · …4321' });
		expect(statuses).toEqual([
			{ platform: 'feishu', configured: true, endpointLabel: 'feishu · …4321' },
			{ platform: 'dingtalk', configured: false },
		]);
		expect(window.utools!.dbCryptoStorage!.setItem).toHaveBeenCalledTimes(1);
		expect(window.utools!.dbCryptoStorage!.getItem).toHaveBeenCalled();
		expect(window.utools!.dbStorage!.getItem).not.toHaveBeenCalled();
		expect(window.utools!.dbStorage!.setItem).not.toHaveBeenCalled();
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
