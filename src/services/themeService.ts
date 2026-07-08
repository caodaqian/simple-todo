import type { AccentColor, AppearanceMode } from '../types/settings';

export type EffectiveTheme = 'latte' | 'mocha';

type UtoolsThemeApi = {
	isDarkColors?: () => boolean;
};

const toEffectiveTheme = (isDark: boolean): EffectiveTheme => isDark ? 'mocha' : 'latte';

function detectUtoolsTheme(): EffectiveTheme | null {
	try {
		const utools = (window as Window & { utools?: UtoolsThemeApi }).utools;
		if (typeof utools?.isDarkColors !== 'function') {
			return null;
		}
		return toEffectiveTheme(utools.isDarkColors());
	} catch {
		return null;
	}
}

function detectSystemTheme(): EffectiveTheme {
	const utoolsTheme = detectUtoolsTheme();
	if (utoolsTheme) {
		return utoolsTheme;
	}

	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return 'mocha';
	}
	return toEffectiveTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export const themeService = {
	getEffective(mode: AppearanceMode): EffectiveTheme {
		if (mode === 'light') return 'latte';
		if (mode === 'dark') return 'mocha';
		return detectSystemTheme();
	},

	apply(mode: AppearanceMode, accent: AccentColor): void {
		if (typeof document === 'undefined') return;
		const html = document.documentElement;
		const effectiveTheme = this.getEffective(mode);
		html.setAttribute('data-theme', effectiveTheme);
		html.setAttribute('data-accent', accent);
		html.style.colorScheme = effectiveTheme === 'mocha' ? 'dark' : 'light';
	},

	watchSystem(cb: (effective: EffectiveTheme) => void): () => void {
		if (typeof window === 'undefined') {
			return () => undefined;
		}

		const refresh = (): void => {
			cb(detectSystemTheme());
		};

		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);

		if (typeof window.matchMedia !== 'function') {
			return () => {
				window.removeEventListener('focus', refresh);
				document.removeEventListener('visibilitychange', refresh);
			};
		}

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = (e: MediaQueryListEvent): void => {
			cb(toEffectiveTheme(e.matches));
		};
		const cleanup = (): void => {
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
		// 兼容旧 Safari：addListener fallback
		if (typeof mq.addEventListener === 'function') {
			mq.addEventListener('change', handler);
			return () => {
				mq.removeEventListener('change', handler);
				cleanup();
			};
		}
		mq.addListener(handler);
		return () => {
			mq.removeListener(handler);
			cleanup();
		};
	},
};
