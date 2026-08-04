import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { buildWebhookRequest, formatWebhookEvent, formatWebhookMessage, sendWebhook, validateWebhookUrl } from './webhookClient.js';

const publicLookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);

function createRequestHarness(response: { statusCode: number; body?: string } | null) {
	let requestOptions: Record<string, unknown> | undefined;
	let requestBody = '';
	const request = vi.fn((_url: string, options: Record<string, unknown>, callback: (response: EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> }) => void) => {
		requestOptions = options;
		const client = new EventEmitter() as EventEmitter & {
			setTimeout: (timeout: number, handler: () => void) => void;
			write: (chunk: string) => void;
			end: () => void;
			destroy: ReturnType<typeof vi.fn>;
			triggerTimeout: () => void;
		};
		let timeoutHandler = () => {};
		client.setTimeout = vi.fn((timeout: number, handler: () => void) => {
			timeoutHandler = handler;
		});
		client.write = vi.fn((chunk: string) => {
			requestBody += chunk;
		});
		client.destroy = vi.fn();
		client.triggerTimeout = () => timeoutHandler();
		client.end = vi.fn(() => {
			if (!response) return;
			queueMicrotask(() => {
				const incoming = new EventEmitter() as EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> };
				incoming.statusCode = response.statusCode;
				incoming.destroy = vi.fn();
				callback(incoming);
				if (response.body) incoming.emit('data', Buffer.from(response.body));
				incoming.emit('end');
			});
		});
		return client;
	});

	return {
		request,
		getRequestOptions: () => requestOptions,
		getRequestBody: () => requestBody,
	};
}

const feishuCredentials = {
	url: 'https://open.feishu.cn/open-apis/bot/v2/hook/sensitive-token',
	secret: 'sensitive-secret',
};

const testMessage = { title: '简悦清单', text: '简悦清单机器人通知测试' };

describe('webhookClient request builders', () => {
	it('accepts only the official Feishu robot endpoint', async () => {
		const parsed = await validateWebhookUrl(
			'feishu',
			'https://open.feishu.cn/open-apis/bot/v2/hook/token-123',
			{ lookup: publicLookup },
		);

		expect(parsed.hostname).toBe('open.feishu.cn');
		await expect(validateWebhookUrl('feishu', 'http://open.feishu.cn/open-apis/bot/v2/hook/token', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('feishu', 'https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/token', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/token?x=1', { lookup: publicLookup })).rejects.toThrow();
	});

	it('accepts only the official DingTalk robot endpoint and access token', async () => {
		const parsed = await validateWebhookUrl(
			'dingtalk',
			'https://oapi.dingtalk.com/robot/send?access_token=token-123',
			{ lookup: publicLookup },
		);

		expect(parsed.searchParams.get('access_token')).toBe('token-123');
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com/robot/send', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=x&sign=y', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('dingtalk', 'https://user@oapi.dingtalk.com/robot/send?access_token=x', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com:443/robot/send?access_token=x', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com:8443/robot/send?access_token=x', { lookup: publicLookup })).rejects.toThrow();
	});

	it('rejects IP literals and hostnames resolving to non-public addresses', async () => {
		await expect(validateWebhookUrl('feishu', 'https://127.0.0.1/open-apis/bot/v2/hook/token', { lookup: publicLookup })).rejects.toThrow();
		await expect(validateWebhookUrl('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/token', {
			lookup: async () => [{ address: '192.168.1.2', family: 4 }],
		})).rejects.toThrow();
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=x', {
			lookup: async () => [{ address: '::1', family: 6 }],
		})).rejects.toThrow();
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=x', {
			lookup: async () => { throw new Error('dns failed'); },
		})).rejects.toThrow();
	});

	it.each([
		'::ffff:127.0.0.1',
		'::ffff:192.168.1.1',
		'::ffff:7f00:1',
	])('rejects IPv4-mapped IPv6 DNS results: %s', async (address) => {
		await expect(validateWebhookUrl('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/token', {
			lookup: async () => [{ address, family: 6 }],
		})).rejects.toThrow();
	});

	it.each([
		'100.64.0.1',
		'100.127.255.254',
		'198.18.0.1',
		'198.19.255.254',
		'fec0::1',
		'ff02::1',
		'2001:db8::1',
	])('rejects non-global DNS results: %s', async (address) => {
		await expect(validateWebhookUrl('dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=x', {
			lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
		})).rejects.toThrow();
	});

	it('rejects mixed DNS results when any address is non-global', async () => {
		await expect(validateWebhookUrl('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/token', {
			lookup: async () => [
				{ address: '8.8.8.8', family: 4 },
				{ address: '100.64.0.1', family: 4 },
			],
		})).rejects.toThrow();
	});

	it('builds an unsigned Feishu text request', () => {
		const request = buildWebhookRequest(
			'feishu',
			{ url: 'https://open.feishu.cn/open-apis/bot/v2/hook/token' },
			{ title: '标题', text: '提醒内容' },
			1599360473000,
		);

		expect(request.url).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/token');
		expect(JSON.parse(request.body)).toEqual({ msg_type: 'text', content: { text: '提醒内容' } });
		expect(request.headers).toEqual({
			'Content-Type': 'application/json; charset=utf-8',
			'User-Agent': 'JianYueTodo/1.0',
		});
	});

	it('builds a signed Feishu request with a seconds timestamp', () => {
		const request = buildWebhookRequest(
			'feishu',
			{ url: 'https://open.feishu.cn/open-apis/bot/v2/hook/token', secret: 'demo' },
			{ title: '标题', text: '提醒内容' },
			1599360473000,
		);

		expect(JSON.parse(request.body)).toEqual({
			timestamp: 1599360473,
			sign: 'l1N0gAcBjdwBvGm1xMjOF0XSyaLRpR7tuO5dHfhAYc8=',
			msg_type: 'text',
			content: { text: '提醒内容' },
		});
	});

	it('builds a signed DingTalk Markdown request with URL signature parameters', () => {
		const request = buildWebhookRequest(
			'dingtalk',
			{ url: 'https://oapi.dingtalk.com/robot/send?access_token=token', secret: 'SECdemo' },
			{ title: '任务提醒', text: '提醒内容' },
			1599360473000,
		);
		const parsed = new URL(request.url);

		expect(parsed.searchParams.get('timestamp')).toBe('1599360473000');
		expect(parsed.searchParams.get('sign')).toBe('tGWkA5eQOQNCNPDgphtxIoNLO+/gD8Lcb705KQoRzeY=');
		expect(JSON.parse(request.body)).toEqual({
			msgtype: 'markdown',
			markdown: { title: '任务提醒', text: '提醒内容' },
		});
	});

	it('does not add DingTalk signature parameters without a secret', () => {
		const request = buildWebhookRequest(
			'dingtalk',
			{ url: 'https://oapi.dingtalk.com/robot/send?access_token=token' },
			{ title: '任务提醒', text: '提醒内容' },
			1599360473000,
		);
		const parsed = new URL(request.url);

		expect(parsed.searchParams.has('timestamp')).toBe(false);
		expect(parsed.searchParams.has('sign')).toBe(false);
	});

	it('normalizes and truncates message fields at platform-safe boundaries', () => {
		const message = formatWebhookMessage({ title: `  ${'标'.repeat(100)}  `, text: `  第一行\r\n第二行\r第三行\n${'内'.repeat(4100)}  ` });

		expect(message.title).toHaveLength(80);
		expect(message.text).toHaveLength(4000);
		expect(message.title.startsWith('标')).toBe(true);
		expect(message.text.startsWith('第一行\n第二行\n第三行\n')).toBe(true);
		expect(message.text).not.toContain('\r');
	});
});

describe('sendWebhook', () => {
	it.each([
		['feishu', feishuCredentials, '{"code":0}'],
		['dingtalk', { url: 'https://oapi.dingtalk.com/robot/send?access_token=sensitive-token' }, '{"errcode":0}'],
	] as const)('sends a successful %s request', async (platform, credentials, responseBody) => {
		const harness = createRequestHarness({ statusCode: 200, body: responseBody });

		const result = await sendWebhook(platform, credentials, testMessage, {
			lookup: publicLookup,
			request: harness.request,
			now: () => 1599360473000,
		});

		expect(result).toEqual({ ok: true, status: 200 });
		expect(harness.getRequestOptions()).toMatchObject({ method: 'POST', headers: buildWebhookRequest(platform, credentials, testMessage, 1599360473000).headers });
		expect(harness.getRequestBody()).toBe(buildWebhookRequest(platform, credentials, testMessage, 1599360473000).body);
	});

	it.each([
		[302, 'invalid_request'],
		[429, 'rate_limited'],
		[503, 'server_error'],
	] as const)('maps HTTP %s without following redirects', async (statusCode, errorCode) => {
		const harness = createRequestHarness({ statusCode, body: '{"code":0}' });

		const result = await sendWebhook('feishu', feishuCredentials, testMessage, { lookup: publicLookup, request: harness.request });

		expect(result).toEqual({ ok: false, status: statusCode, errorCode });
	});

	it('maps request timeout without leaking the request error', async () => {
		let client: (EventEmitter & { triggerTimeout: () => void }) | undefined;
		const request = vi.fn(() => {
			client = new EventEmitter() as EventEmitter & { triggerTimeout: () => void; setTimeout: (timeout: number, handler: () => void) => void; write: () => void; end: () => void; destroy: () => void };
			let timeoutHandler = () => {};
			client.setTimeout = vi.fn((timeout: number, handler: () => void) => { timeoutHandler = handler; });
			client.triggerTimeout = () => timeoutHandler();
			client.write = vi.fn();
			client.end = vi.fn(() => queueMicrotask(() => client?.triggerTimeout()));
			client.destroy = vi.fn(() => client?.emit('error', new Error('socket timeout')));
			return client;
		});

		const result = await sendWebhook('feishu', feishuCredentials, testMessage, { lookup: publicLookup, request });

		expect(result).toEqual({ ok: false, errorCode: 'timeout' });
		expect(client?.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));
	});

	it('maps network errors to a redacted result', async () => {
		const request = vi.fn(() => {
			const client = new EventEmitter() as EventEmitter & { setTimeout: () => void; write: () => void; end: () => void; destroy: () => void };
			client.setTimeout = vi.fn();
			client.write = vi.fn();
			client.destroy = vi.fn();
			client.end = vi.fn(() => queueMicrotask(() => client.emit('error', new Error(`failed ${feishuCredentials.url} ${feishuCredentials.secret}`))));
			return client;
		});

		const result = await sendWebhook('feishu', feishuCredentials, testMessage, { lookup: publicLookup, request });

		expect(result).toEqual({ ok: false, errorCode: 'network_error' });
		expect(JSON.stringify(result)).not.toContain('sensitive');
		expect(JSON.stringify(result)).not.toContain('failed');
	});

	it.each([
		['feishu', feishuCredentials, '{"code":19021,"msg":"signature failed"}', 'invalid_credentials'],
		['feishu', feishuCredentials, '{"code":19024,"msg":"keyword mismatch"}', 'keyword_mismatch'],
		['feishu', feishuCredentials, '{"code":99999,"msg":"raw sensitive response"}', 'invalid_request'],
		['dingtalk', { url: 'https://oapi.dingtalk.com/robot/send?access_token=sensitive-token' }, '{"errcode":310000,"errmsg":"sign not match"}', 'invalid_credentials'],
		['dingtalk', { url: 'https://oapi.dingtalk.com/robot/send?access_token=sensitive-token' }, '{"errcode":310000,"errmsg":"keywords not in content"}', 'keyword_mismatch'],
		['dingtalk', { url: 'https://oapi.dingtalk.com/robot/send?access_token=sensitive-token' }, '{"errcode":40035,"errmsg":"raw sensitive response"}', 'invalid_request'],
	] as const)('normalizes %s business errors without exposing the response', async (platform, credentials, body, errorCode) => {
		const harness = createRequestHarness({ statusCode: 200, body });

		const result = await sendWebhook(platform, credentials, testMessage, { lookup: publicLookup, request: harness.request });

		expect(result).toEqual({ ok: false, status: 200, errorCode });
		expect(JSON.stringify(result)).not.toContain('raw sensitive response');
	});

	it('sends long raw text when the final truncated body stays within 20 KiB', async () => {
		const harness = createRequestHarness({ statusCode: 200, body: '{"code":0}' });

		const result = await sendWebhook('feishu', feishuCredentials, { title: '简悦清单', text: '内'.repeat(7000) }, {
			lookup: publicLookup,
			request: harness.request,
		});

		expect(result).toEqual({ ok: true, status: 200 });
		expect(Buffer.byteLength(harness.getRequestBody(), 'utf8')).toBeLessThanOrEqual(20 * 1024);
		expect(JSON.parse(harness.getRequestBody()).content.text).toHaveLength(4000);
	});

	it('rejects a final request body larger than 20 KiB without creating a request', async () => {
		const harness = createRequestHarness({ statusCode: 200, body: '{"code":0}' });
		const oversizedBody = 'x'.repeat(20 * 1024 + 1);

		const result = await sendWebhook('feishu', feishuCredentials, testMessage, {
			lookup: publicLookup,
			request: harness.request,
			buildRequest: () => ({
				url: feishuCredentials.url,
				body: oversizedBody,
				headers: {},
			}),
		});

		expect(result).toEqual({ ok: false, errorCode: 'invalid_request' });
		expect(harness.request).not.toHaveBeenCalled();
	});

	it('rejects and destroys a response larger than 64 KiB', async () => {
		let incoming: (EventEmitter & { destroy: ReturnType<typeof vi.fn> }) | undefined;
		const request = vi.fn((_url: string, _options: unknown, callback: (response: EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> }) => void) => {
			const client = new EventEmitter() as EventEmitter & { setTimeout: () => void; write: () => void; end: () => void; destroy: () => void };
			client.setTimeout = vi.fn();
			client.write = vi.fn();
			client.destroy = vi.fn();
			client.end = vi.fn(() => queueMicrotask(() => {
				incoming = new EventEmitter() as EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> };
				incoming.statusCode = 200;
				incoming.destroy = vi.fn(() => incoming?.emit('error', new Error('response too large')));
				callback(incoming);
				incoming.emit('data', Buffer.alloc(64 * 1024 + 1));
			}));
			return client;
		});

		const result = await sendWebhook('feishu', feishuCredentials, testMessage, { lookup: publicLookup, request });

		expect(result).toEqual({ ok: false, status: 200, errorCode: 'invalid_request' });
		expect(incoming?.destroy).toHaveBeenCalled();
	});

	it('pins the validated DNS records in the request lookup', async () => {
		const records = [
			{ address: '8.8.8.8', family: 4 },
			{ address: '2001:4860:4860::8888', family: 6 },
		];
		const lookup = vi.fn(async () => records);
		const harness = createRequestHarness({ statusCode: 200, body: '{"code":0}' });

		await sendWebhook('feishu', feishuCredentials, testMessage, { lookup, request: harness.request });
		const fixedLookup = harness.getRequestOptions()?.lookup as (hostname: string, options: { all?: boolean }, callback: (error: Error | null, addresses: unknown, family?: number) => void) => void;
		const callback = vi.fn();
		fixedLookup('open.feishu.cn', { all: true }, callback);

		expect(lookup).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(null, records);
	});
});

describe('formatWebhookEvent', () => {
	it('formats due and completed task events with an optional keyword', () => {
		const due = formatWebhookEvent({
			id: 'due-1',
			type: 'task.due',
			occurredAt: 2000,
			payload: {
				task: {
					id: 'task-1', title: '提交报告', description: '', priority: 'high', tags: [], group: '', dueAt: 1000,
				},
				reminderAt: 500,
			},
		}, '  应用报警  ');
		const completed = formatWebhookEvent({
			id: 'completed-1',
			type: 'task.completed',
			occurredAt: 3000,
			payload: {
				task: {
					id: 'task-1', title: '提交报告', description: '', priority: 'high', tags: [], group: '', completedAt: 3000,
				},
			},
		});

		expect(due).toEqual({
			title: '任务提醒',
			text: '应用报警\n任务：提交报告\n截止：1970-01-01T00:00:01.000Z\n状态：已逾期',
		});
		expect(completed).toEqual({
			title: '任务完成',
			text: '任务：提交报告\n完成：1970-01-01T00:00:03.000Z',
		});
	});

	it('formats daily digest counts and limits each task list to ten titles', () => {
		const tasks = Array.from({ length: 12 }, (_, index) => ({
			id: `task-${index}`,
			title: `任务 ${index}`,
			description: '',
			priority: 'low',
			tags: [],
			group: '',
		}));
		const formatted = formatWebhookEvent({
			id: 'digest-1',
			type: 'digest.daily',
			occurredAt: 5000,
			payload: {
				digest: {
					periodStart: 0,
					periodEnd: 5000,
					timezone: 'Asia/Shanghai',
					completed: tasks,
					overdue: tasks.slice(0, 2),
					due: tasks.slice(0, 3),
					activeCount: 7,
				},
			},
		});

		expect(formatted.title).toBe('简悦清单每日摘要');
		expect(formatted.text).toContain('完成：12');
		expect(formatted.text).toContain('到期：3');
		expect(formatted.text).toContain('逾期：2');
		expect(formatted.text).toContain('活跃：7');
		expect(formatted.text).toContain('任务 9');
		expect(formatted.text).not.toContain('任务 10');
	});

	it('rejects unknown event types and malformed payloads without echoing input', () => {
		const invalid = { id: 'secret-id', type: 'task.due', occurredAt: 1, payload: { token: 'secret-token' } };
		let error: unknown;
		try {
			formatWebhookEvent(invalid);
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('Webhook event is invalid.');
		expect((error as Error).message).not.toContain('secret');
		expect(() => formatWebhookEvent({ id: 'x', type: 'unknown', occurredAt: 1, payload: {} })).toThrow('Webhook event is invalid.');
	});

	it.each([
		-1,
		1.5,
		Number.MAX_SAFE_INTEGER,
	])('rejects invalid domain timestamps with the generic error', (timestamp) => {
		const event = {
			id: 'due-invalid-time',
			type: 'task.due',
			occurredAt: 2,
			payload: {
				task: {
					id: 'task-1', title: '任务', description: '', priority: 'low', tags: [], group: '', dueAt: timestamp,
				},
				reminderAt: 1,
			},
		};

		expect(() => formatWebhookEvent(event)).toThrow(new Error('Webhook event is invalid.'));
	});

	it.each([
		{ activeCount: -1 },
		{ activeCount: 1.5 },
		{ periodStart: 2, periodEnd: 1 },
		{ timezone: 'Not/A-Timezone' },
	])('rejects semantically invalid daily digests', (override) => {
		const digest = {
			periodStart: 0,
			periodEnd: 1,
			timezone: 'Asia/Shanghai',
			completed: [],
			overdue: [],
			due: [],
			activeCount: 0,
			...override,
		};

		expect(() => formatWebhookEvent({
			id: 'digest-invalid', type: 'digest.daily', occurredAt: 1, payload: { digest },
		})).toThrow(new Error('Webhook event is invalid.'));
	});

	it('rejects keywords that can replace or forge the structured event body', () => {
		const event = {
			id: 'completed-1',
			type: 'task.completed',
			occurredAt: 3,
			payload: {
				task: {
					id: 'task-1', title: '任务', description: '', priority: 'low', tags: [], group: '', completedAt: 3,
				},
			},
		};

		expect(() => formatWebhookEvent(event, '第一行\n伪造字段')).toThrow('Webhook event is invalid.');
		expect(() => formatWebhookEvent(event, 'x'.repeat(101))).toThrow('Webhook event is invalid.');
	});
});
