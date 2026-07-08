import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StickyNoteSource } from '../types/stickyNote';

const source: StickyNoteSource = {
	sourceKind: 'current',
	title: '今天',
	view: 'list',
	section: 'today',
	filter: {},
	updatedAt: 1,
};

describe('stickyWindowService', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it('opens the real uTools sticky bootstrap html with a dedicated preload', async () => {
		const send = vi.fn();
		const createBrowserWindow = vi.fn((url: string, _options: Record<string, unknown>, callback?: () => void) => {
			if (!url.endsWith('.html')) {
				throw new Error('加载的不是 html 文件');
			}
			callback?.();
			return { show: vi.fn(), setAlwaysOnTop: vi.fn(), isDestroyed: () => false, webContents: { send } };
		});
		const hideMainWindow = vi.fn();
		window.utools = {
			...(window.utools ?? {}),
			createBrowserWindow,
			hideMainWindow,
			getCursorScreenPoint: () => ({ x: 100, y: 100 }),
			getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
		} as unknown as typeof window.utools;

		const { openStickyNoteWindow } = await import('./stickyWindowService');

		const result = openStickyNoteWindow(source);

		expect(result).toEqual({ ok: true });
		expect(createBrowserWindow.mock.calls[0]?.[0]).toBe('sticky.html');
		expect(createBrowserWindow.mock.calls[0]?.[1]).toMatchObject({
			show: true,
			frame: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			webPreferences: {
				preload: './preload/stickyWindowPreload.js',
				zoomFactor: 1,
			},
		});
		expect(send).toHaveBeenCalledWith('window', expect.objectContaining({
			type: 'sticky-note',
			source: expect.objectContaining({ title: '今天' }),
			appUrl: expect.stringContaining('?window=sticky-note'),
			senderId: expect.stringMatching(/^sticky-/),
		}));
		expect(hideMainWindow).toHaveBeenCalledWith(true);
	});

	it('creates the sticky window visible instead of relying on a hidden load callback', async () => {
		const createBrowserWindow = vi.fn((_url: string, _options: Record<string, unknown>) => ({
			show: vi.fn(),
			setAlwaysOnTop: vi.fn(),
			isDestroyed: () => false,
		}));
		window.utools = {
			...(window.utools ?? {}),
			createBrowserWindow,
			getCursorScreenPoint: () => ({ x: 100, y: 100 }),
			getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
		} as unknown as typeof window.utools;

		const { openStickyNoteWindow } = await import('./stickyWindowService');

		openStickyNoteWindow(source);

		expect(createBrowserWindow.mock.calls[0]?.[1]).toMatchObject({ show: true });
	});

	it('applies friendly sticky size and position settings when creating the window', async () => {
		const createBrowserWindow = vi.fn((_url: string, _options: Record<string, unknown>) => ({
			show: vi.fn(),
			setAlwaysOnTop: vi.fn(),
			isDestroyed: () => false,
		}));
		window.utools = {
			...(window.utools ?? {}),
			createBrowserWindow,
			getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
		} as unknown as typeof window.utools;
		const { DEFAULT_SETTINGS } = await import('../types/settings');
		const { settingsService } = await import('./settingsService');
		settingsService.saveSettings({
			...DEFAULT_SETTINGS,
			stickyWindowWidthPreset: 'wide',
			stickyWindowHeightPreset: 'tall',
			stickyWindowPositionPreset: 'center',
		});

		const { openStickyNoteWindow } = await import('./stickyWindowService');

		openStickyNoteWindow(source);

		expect(createBrowserWindow.mock.calls[0]?.[1]).toMatchObject({
			x: 440,
			y: 90,
			width: 560,
			height: 720,
			minWidth: 360,
			minHeight: 420,
		});
	});

	it('updates a reused sticky window size and position when settings changed', async () => {
		const setSize = vi.fn();
		const setPosition = vi.fn();
		const send = vi.fn();
		const createBrowserWindow = vi.fn((_url: string, _options: Record<string, unknown>) => ({
			show: vi.fn(),
			setAlwaysOnTop: vi.fn(),
			isDestroyed: () => false,
			setSize,
			setPosition,
			webContents: { send },
		}));
		window.utools = {
			...(window.utools ?? {}),
			createBrowserWindow,
			getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
		} as unknown as typeof window.utools;
		const { DEFAULT_SETTINGS } = await import('../types/settings');
		const { settingsService } = await import('./settingsService');
		settingsService.saveSettings(DEFAULT_SETTINGS);
		const { openStickyNoteWindow } = await import('./stickyWindowService');

		openStickyNoteWindow(source);
		settingsService.saveSettings({
			...DEFAULT_SETTINGS,
			stickyWindowWidthPreset: 'extra-wide',
			stickyWindowHeightPreset: 'tall',
			stickyWindowPositionPreset: 'bottom-right',
		});
		openStickyNoteWindow(source);

		expect(createBrowserWindow).toHaveBeenCalledTimes(1);
		expect(setSize).toHaveBeenCalledWith(680, 720);
		expect(setPosition).toHaveBeenCalledWith(728, 132);
	});

	it('does not open an external browser fallback outside uTools', async () => {
		(window as unknown as { utools: typeof window.utools | undefined }).utools = undefined;
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		const { openStickyNoteWindow } = await import('./stickyWindowService');

		expect(openStickyNoteWindow(source)).toEqual({ ok: false, reason: 'utools-unavailable' });
		expect(openSpy).not.toHaveBeenCalled();
	});
});
