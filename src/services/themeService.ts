import type { AccentColor, AppearanceMode } from '../types/settings';

export type EffectiveTheme = 'latte' | 'mocha';

function detectSystemTheme(): EffectiveTheme {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return 'mocha';
	}
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'mocha' : 'latte';
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
		html.setAttribute('data-theme', this.getEffective(mode));
		html.setAttribute('data-accent', accent);
	},

	watchSystem(cb: (effective: EffectiveTheme) => void): () => void {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return () => undefined;
		}
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = (e: MediaQueryListEvent): void => {
			cb(e.matches ? 'mocha' : 'latte');
		};
		// 兼容旧 Safari：addListener fallback
		if (typeof mq.addEventListener === 'function') {
			mq.addEventListener('change', handler);
			return () => mq.removeEventListener('change', handler);
		}
		mq.addListener(handler);
		return () => mq.removeListener(handler);
	},
};
