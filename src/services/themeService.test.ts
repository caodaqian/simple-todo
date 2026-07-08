import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccentColor, AppearanceMode } from '../types/settings';
import { themeService } from './themeService';

type UtoolsThemeMock = { isDarkColors?: () => boolean };

type MatchMediaListener = (event: MediaQueryListEvent) => void;

interface MockMediaQueryList extends Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener' | 'addListener' | 'removeListener'> {
	listeners: Set<MatchMediaListener>;
}

const setUtoolsThemeMock = (utools: UtoolsThemeMock | undefined): void => {
	const win = window as Window & { utools?: Window['utools'] };
	if (utools === undefined) {
		delete win.utools;
		return;
	}

	const mockUtools: NonNullable<Window['utools']> = {
		onPluginEnter: vi.fn(),
		onPluginOut: vi.fn(),
		hide: vi.fn(),
		show: vi.fn(),
		getPath: vi.fn(() => ''),
		getWindowWidth: vi.fn(() => 0),
		getWindowHeight: vi.fn(() => 0),
		registerTool: vi.fn(),
		copyText: vi.fn(),
		readText: vi.fn(async () => ''),
		...utools,
	};
	win.utools = mockUtools;
};

const installMatchMedia = (matches: boolean): MockMediaQueryList => {
	const listeners = new Set<MatchMediaListener>();
	const mediaQueryList: MockMediaQueryList = {
		matches,
		listeners,
		addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
			listeners.add(listener as MatchMediaListener);
		}),
		removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
			listeners.delete(listener as MatchMediaListener);
		}),
		addListener: vi.fn((listener: MatchMediaListener) => {
			listeners.add(listener);
		}),
		removeListener: vi.fn((listener: MatchMediaListener) => {
			listeners.delete(listener);
		}),
	};

	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		writable: true,
		value: vi.fn(() => mediaQueryList),
	});

	return mediaQueryList;
};

describe('themeService', () => {
	beforeEach(() => {
		document.documentElement.removeAttribute('data-theme');
		document.documentElement.removeAttribute('data-accent');
		document.documentElement.style.colorScheme = '';
		setUtoolsThemeMock(undefined);
		vi.restoreAllMocks();
	});

	afterEach(() => {
		setUtoolsThemeMock(undefined);
	});

	describe('getEffective', () => {
		it.each<[AppearanceMode, string]>([
			['light', 'latte'],
			['dark', 'mocha'],
		])('maps %s mode directly to %s', (mode, expected) => {
			expect(themeService.getEffective(mode)).toBe(expected);
		});

		it('uses uTools dark color state when system mode is selected and uTools reports dark', () => {
			installMatchMedia(false);
			setUtoolsThemeMock({ isDarkColors: () => true });

			expect(themeService.getEffective('system')).toBe('mocha');
		});

		it('uses uTools dark color state when system mode is selected and uTools reports light', () => {
			installMatchMedia(true);
			setUtoolsThemeMock({ isDarkColors: () => false });

			expect(themeService.getEffective('system')).toBe('latte');
		});

		it('falls back to browser color scheme when uTools API is unavailable', () => {
			installMatchMedia(false);

			expect(themeService.getEffective('system')).toBe('latte');
		});

		it('falls back to browser color scheme when uTools API throws', () => {
			installMatchMedia(false);
			setUtoolsThemeMock({ isDarkColors: () => { throw new Error('uTools unavailable'); } });

			expect(themeService.getEffective('system')).toBe('latte');
		});
	});

	describe('apply', () => {
		it('writes effective theme, accent, and native color scheme to the document root', () => {
			setUtoolsThemeMock({ isDarkColors: () => true });

			themeService.apply('system', 'sky' as AccentColor);

			expect(document.documentElement.getAttribute('data-theme')).toBe('mocha');
			expect(document.documentElement.getAttribute('data-accent')).toBe('sky');
			expect(document.documentElement.style.colorScheme).toBe('dark');
		});
	});

	describe('watchSystem', () => {
		it('notifies on media query changes and removes listeners during cleanup', () => {
			const mediaQueryList = installMatchMedia(false);
			const callback = vi.fn();

			const cleanup = themeService.watchSystem(callback);
			expect(mediaQueryList.listeners.size).toBe(1);

			const listener = [...mediaQueryList.listeners][0]!;
			listener({ matches: true } as MediaQueryListEvent);
			expect(callback).toHaveBeenCalledWith('mocha');

			cleanup();
			expect(mediaQueryList.listeners.size).toBe(0);
		});

		it('refreshes from uTools system state when the plugin window regains focus', () => {
			installMatchMedia(false);
			setUtoolsThemeMock({ isDarkColors: () => true });
			const callback = vi.fn();

			const cleanup = themeService.watchSystem(callback);
			window.dispatchEvent(new Event('focus'));
			expect(callback).toHaveBeenCalledWith('mocha');

			callback.mockClear();
			cleanup();
			window.dispatchEvent(new Event('focus'));
			expect(callback).not.toHaveBeenCalled();
		});
	});
});
