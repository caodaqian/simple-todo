import { describe, expect, it, vi } from 'vitest';
import { createWebhookCredentialStore } from './webhookCredentials.js';

function createCryptoStorage() {
	const values = new Map<string, unknown>();
	return {
		values,
		storage: {
			getItem: vi.fn((key: string) => values.get(key) ?? null),
			setItem: vi.fn((key: string, value: unknown) => {
				values.set(key, value);
			}),
			removeItem: vi.fn((key: string) => {
				values.delete(key);
			}),
		},
	};
}

describe('webhookCredentials', () => {
	it('stores Feishu and DingTalk credentials in separate encrypted slots', () => {
		const { storage } = createCryptoStorage();
		const store = createWebhookCredentialStore(storage);

		store.save('feishu', { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/feishu-token', secret: 'feishu-secret' });
		store.save('dingtalk', { url: 'https://oapi.dingtalk.com/robot/send?access_token=dingtalk-token', secret: 'dingtalk-secret' });

		expect(store.read('feishu')).toEqual({ url: 'https://open.feishu.cn/open-apis/bot/v2/hook/feishu-token', secret: 'feishu-secret' });
		expect(store.read('dingtalk')).toEqual({ url: 'https://oapi.dingtalk.com/robot/send?access_token=dingtalk-token', secret: 'dingtalk-secret' });
		expect(storage.setItem).toHaveBeenCalledTimes(2);
		expect(storage.setItem.mock.calls[0]?.[0]).not.toBe(storage.setItem.mock.calls[1]?.[0]);
	});

	it('overwrites and clears a platform credential', () => {
		const { storage } = createCryptoStorage();
		const store = createWebhookCredentialStore(storage);

		store.save('feishu', { url: 'https://example.com/old-token' });
		store.save('feishu', { url: 'https://example.com/new-token' });
		expect(store.read('feishu')).toEqual({ url: 'https://example.com/new-token' });

		store.clear('feishu');
		expect(store.read('feishu')).toBeNull();
		expect(store.getStatus('feishu')).toEqual({ platform: 'feishu', configured: false });
	});

	it('omits a blank secret', () => {
		const { storage } = createCryptoStorage();
		const store = createWebhookCredentialStore(storage);

		store.save('dingtalk', { url: 'https://example.com/token', secret: '   ' });

		expect(store.read('dingtalk')).toEqual({ url: 'https://example.com/token' });
	});

	it('rejects unsupported platforms and blank URLs', () => {
		const { storage } = createCryptoStorage();
		const store = createWebhookCredentialStore(storage);

		expect(() => store.save('slack', { url: 'https://example.com/token' })).toThrow('不支持的 Webhook 平台');
		expect(() => store.read('slack')).toThrow('不支持的 Webhook 平台');
		expect(() => store.save('feishu', { url: '   ' })).toThrow('Webhook URL 不能为空');
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it('returns only the platform and a masked token tail in status', () => {
		const { storage } = createCryptoStorage();
		const store = createWebhookCredentialStore(storage);
		const url = 'https://oapi.dingtalk.com/robot/send?access_token=very-sensitive-token-9876';
		const secret = 'never-return-this-secret';

		const status = store.save('dingtalk', { url, secret });

		expect(status).toEqual({ platform: 'dingtalk', configured: true, endpointLabel: 'dingtalk · …9876' });
		expect(JSON.stringify(status)).not.toContain('robot/send');
		expect(JSON.stringify(status)).not.toContain('access_token');
		expect(JSON.stringify(status)).not.toContain('very-sensitive-token');
		expect(JSON.stringify(status)).not.toContain(secret);
	});

	it('normalizes missing or incomplete encrypted storage errors', () => {
		expect(() => createWebhookCredentialStore(undefined).getStatus('feishu')).toThrow('加密凭据存储不可用');
		expect(() => createWebhookCredentialStore({ getItem: vi.fn() }).read('feishu')).toThrow('加密凭据存储不可用');
	});

	it('normalizes encrypted storage failures without leaking credentials', () => {
		const leakedToken = 'private-token-1234';
		const storage = {
			getItem: vi.fn(() => {
				throw new Error(`failed ${leakedToken}`);
			}),
			setItem: vi.fn(() => {
				throw new Error(`failed ${leakedToken}`);
			}),
			removeItem: vi.fn(() => {
				throw new Error(`failed ${leakedToken}`);
			}),
		};
		const store = createWebhookCredentialStore(storage);

		for (const operation of [
			() => store.read('feishu'),
			() => store.save('feishu', { url: `https://example.com/${leakedToken}`, secret: leakedToken }),
			() => store.clear('feishu'),
		]) {
			try {
				operation();
				throw new Error('expected operation to fail');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe('加密凭据操作失败');
				expect((error as Error).message).not.toContain(leakedToken);
			}
		}
	});

	it('never uses ordinary dbStorage', () => {
		const dbStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
		window.utools = { ...(window.utools ?? {}), dbStorage } as typeof window.utools;
		const { storage } = createCryptoStorage();
		const store = createWebhookCredentialStore(storage);

		store.save('feishu', { url: 'https://example.com/token' });
		store.getStatus('feishu');
		store.clear('feishu');

		expect(dbStorage.getItem).not.toHaveBeenCalled();
		expect(dbStorage.setItem).not.toHaveBeenCalled();
		expect(dbStorage.removeItem).not.toHaveBeenCalled();
	});
});