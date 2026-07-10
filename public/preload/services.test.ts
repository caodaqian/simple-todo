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
});
