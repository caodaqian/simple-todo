import type {
	AppSettings,
	MainWindowHeightPreset,
	StickyWindowHeightPreset,
	StickyWindowPositionPreset,
	StickyWindowWidthPreset,
} from '../types/settings';

interface DisplayBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface DisplayLike {
	bounds: DisplayBounds;
}

export interface UtoolsWindowPreferenceApi {
	setExpendHeight?: (height: number) => boolean;
	getCursorScreenPoint?: () => { x: number; y: number };
	getDisplayNearestPoint?: (point: { x: number; y: number }) => DisplayLike;
	getPrimaryDisplay?: () => DisplayLike;
}

export interface StickyWindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	minWidth: number;
	minHeight: number;
}

interface StickyWindowSize {
	width: number;
	height: number;
	minWidth: number;
	minHeight: number;
}

interface StickyWindowWidth {
	width: number;
	minWidth: number;
}

interface StickyWindowHeight {
	height: number;
	minHeight: number;
}

const MAIN_WINDOW_HEIGHTS: Record<MainWindowHeightPreset, number> = {
	compact: 460,
	standard: 560,
	spacious: 680,
	immersive: 820,
};

const STICKY_WINDOW_WIDTHS: Record<StickyWindowWidthPreset, StickyWindowWidth> = {
	narrow: { width: 340, minWidth: 300 },
	standard: { width: 380, minWidth: 320 },
	wide: { width: 560, minWidth: 360 },
	'extra-wide': { width: 680, minWidth: 420 },
};

const STICKY_WINDOW_HEIGHTS: Record<StickyWindowHeightPreset, StickyWindowHeight> = {
	compact: { height: 460, minHeight: 340 },
	standard: { height: 560, minHeight: 360 },
	tall: { height: 720, minHeight: 420 },
	'extra-tall': { height: 820, minHeight: 480 },
};

const FALLBACK_POSITION = { x: 80, y: 80 };
const WINDOW_MARGIN_X = 32;
const WINDOW_MARGIN_TOP = 48;
const WINDOW_MARGIN_BOTTOM = 48;

const getUtools = (): UtoolsWindowPreferenceApi | undefined => {
	try {
		return (window as Window & { utools?: UtoolsWindowPreferenceApi }).utools;
	} catch {
		return undefined;
	}
};

const getDisplay = (utools?: UtoolsWindowPreferenceApi): DisplayLike | null => {
	try {
		const point = utools?.getCursorScreenPoint?.();
		const display = point ? utools?.getDisplayNearestPoint?.(point) : undefined;
		return display ?? utools?.getPrimaryDisplay?.() ?? null;
	} catch {
		return null;
	}
};

const clamp = (value: number, min: number, max: number): number => {
	if (max < min) return min;
	return Math.min(Math.max(value, min), max);
};

const resolvePosition = (
	preset: StickyWindowPositionPreset,
	size: StickyWindowSize,
	bounds: DisplayBounds,
): { x: number; y: number } => {
	const minX = bounds.x;
	const maxX = bounds.x + bounds.width - size.width;
	const minY = bounds.y;
	const maxY = bounds.y + bounds.height - size.height;

	const positions: Record<StickyWindowPositionPreset, { x: number; y: number }> = {
		auto: {
			x: bounds.x + bounds.width - size.width - WINDOW_MARGIN_X,
			y: bounds.y + WINDOW_MARGIN_TOP,
		},
		'top-left': {
			x: bounds.x + WINDOW_MARGIN_X,
			y: bounds.y + WINDOW_MARGIN_TOP,
		},
		'top-right': {
			x: bounds.x + bounds.width - size.width - WINDOW_MARGIN_X,
			y: bounds.y + WINDOW_MARGIN_TOP,
		},
		center: {
			x: bounds.x + Math.round((bounds.width - size.width) / 2),
			y: bounds.y + Math.round((bounds.height - size.height) / 2),
		},
		'bottom-right': {
			x: bounds.x + bounds.width - size.width - WINDOW_MARGIN_X,
			y: bounds.y + bounds.height - size.height - WINDOW_MARGIN_BOTTOM,
		},
	};

	const position = positions[preset];
	return {
		x: clamp(position.x, minX, maxX),
		y: clamp(position.y, minY, maxY),
	};
};

export const windowPreferenceService = {
	applyFontScale(settings: Pick<AppSettings, 'fontScale'>): void {
		if (typeof document === 'undefined') return;
		document.documentElement.dataset.fontScale = settings.fontScale;
	},

	applyMainWindowHeight(
		settings: Pick<AppSettings, 'mainWindowHeightPreset'>,
		utools: UtoolsWindowPreferenceApi | undefined = getUtools(),
	): void {
		try {
			utools?.setExpendHeight?.(MAIN_WINDOW_HEIGHTS[settings.mainWindowHeightPreset]);
		} catch {
			// Window sizing is best-effort and unavailable in normal browser development.
		}
	},

	resolveStickyWindowBounds(
		settings: Pick<AppSettings, 'stickyWindowWidthPreset' | 'stickyWindowHeightPreset' | 'stickyWindowPositionPreset'>,
		utools: UtoolsWindowPreferenceApi | undefined = getUtools(),
	): StickyWindowBounds {
		const size = {
			...STICKY_WINDOW_WIDTHS[settings.stickyWindowWidthPreset],
			...STICKY_WINDOW_HEIGHTS[settings.stickyWindowHeightPreset],
		};
		const display = getDisplay(utools);
		if (!display) {
			return { ...FALLBACK_POSITION, ...size };
		}

		const position = resolvePosition(settings.stickyWindowPositionPreset, size, display.bounds);
		return { ...position, ...size };
	},
};
