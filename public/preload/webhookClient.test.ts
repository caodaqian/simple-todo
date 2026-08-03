import { describe, expect, it, vi } from 'vitest';
import { buildWebhookRequest, formatWebhookMessage, validateWebhookUrl } from './webhookClient.js';

const publicLookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);

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
