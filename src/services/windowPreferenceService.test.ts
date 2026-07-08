import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../types/settings';
import { windowPreferenceService } from './windowPreferenceService';

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
	...DEFAULT_SETTINGS,
	...overrides,
});

const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 } };

describe('windowPreferenceService', () => {
	beforeEach(() => {
		document.documentElement.removeAttribute('data-font-scale');
		vi.restoreAllMocks();
	});

	it('applies font scale as a root data attribute', () => {
		windowPreferenceService.applyFontScale(createSettings({ fontScale: 'comfortable' }));

		expect(document.documentElement.dataset.fontScale).toBe('comfortable');
	});

	it('maps main window height preset to uTools expand height', () => {
		const setExpendHeight = vi.fn(() => true);

		windowPreferenceService.applyMainWindowHeight(createSettings({ mainWindowHeightPreset: 'spacious' }), { setExpendHeight });

		expect(setExpendHeight).toHaveBeenCalledWith(680);
	});

	it('does not throw when uTools height API is unavailable', () => {
		expect(() => windowPreferenceService.applyMainWindowHeight(createSettings(), {})).not.toThrow();
	});

	it('resolves the default sticky window size and smart top-right position', () => {
		const bounds = windowPreferenceService.resolveStickyWindowBounds(createSettings(), {
			getCursorScreenPoint: () => ({ x: 100, y: 100 }),
			getDisplayNearestPoint: () => display,
		});

		expect(bounds).toMatchObject({
			width: 380,
			height: 560,
			x: 1028,
			y: 48,
		});
	});

	it('resolves centered sticky window position without exposing pixels to settings UI', () => {
		const bounds = windowPreferenceService.resolveStickyWindowBounds(createSettings({
			stickyWindowWidthPreset: 'wide',
			stickyWindowPositionPreset: 'center',
		}), {
			getPrimaryDisplay: () => display,
		});

		expect(bounds).toMatchObject({
			width: 560,
			height: 560,
			x: 440,
			y: 170,
		});
	});

	it('resolves sticky window width independently from height', () => {
		const bounds = windowPreferenceService.resolveStickyWindowBounds(createSettings({
			stickyWindowWidthPreset: 'extra-wide',
			stickyWindowHeightPreset: 'tall',
			stickyWindowPositionPreset: 'center',
		}), {
			getPrimaryDisplay: () => display,
		});

		expect(bounds).toMatchObject({
			width: 680,
			height: 720,
			x: 380,
			y: 90,
		});
	});

	it('keeps bottom-right sticky position inside the current display', () => {
		const bounds = windowPreferenceService.resolveStickyWindowBounds(createSettings({
			stickyWindowHeightPreset: 'tall',
			stickyWindowPositionPreset: 'bottom-right',
		}), {
			getCursorScreenPoint: () => ({ x: 1200, y: 500 }),
			getDisplayNearestPoint: () => display,
		});

		expect(bounds).toMatchObject({
			width: 380,
			height: 720,
			x: 1028,
			y: 132,
		});
	});

	it('falls back to a safe sticky position when screen APIs are unavailable', () => {
		const bounds = windowPreferenceService.resolveStickyWindowBounds(createSettings(), {});

		expect(bounds).toMatchObject({ x: 80, y: 80, width: 380, height: 560 });
	});
});
