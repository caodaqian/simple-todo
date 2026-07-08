import type { StickyNoteSource } from '../types/stickyNote';
import { settingsService } from './settingsService';
import { stickyNoteService } from './stickyNoteService';
import { windowPreferenceService } from './windowPreferenceService';

interface BrowserWindowLike {
	id?: number;
	show?: () => void;
	close?: () => void;
	isDestroyed?: () => boolean;
	setSize?: (width: number, height: number) => void;
	setPosition?: (x: number, y: number) => void;
	setAlwaysOnTop?: (flag: boolean, level?: string) => void;
	webContents?: { send?: (channel: string, ...args: unknown[]) => void };
}

interface StickyWindowInitPayload {
	type: 'sticky-note';
	senderId: string;
	source: StickyNoteSource;
	appUrl: string;
	createdAt: number;
}

interface UtoolsWindowLike {
	createBrowserWindow?: (url: string, options?: Record<string, unknown>, callback?: () => void) => BrowserWindowLike;
	hideMainWindow?: (isRestorePreWindow?: boolean) => boolean;
	getCursorScreenPoint?: () => { x: number; y: number };
	getDisplayNearestPoint?: (point: { x: number; y: number }) => { bounds: { x: number; y: number; width: number; height: number } };
	getPrimaryDisplay?: () => { bounds: { x: number; y: number; width: number; height: number } };
}

export type StickyWindowOpenResult = { ok: true } | { ok: false; reason: 'utools-unavailable' | 'create-failed' };

let stickyWindow: BrowserWindowLike | null = null;

const getStickyUrl = (): string => {
	return 'sticky.html';
};

const getStickyAppUrl = (): string => {
	if (location.protocol === 'http:' || location.protocol === 'https:') {
		const url = new URL(location.href);
		url.search = '?window=sticky-note';
		url.hash = '';
		return url.toString();
	}
	return 'index.html?window=sticky-note';
};

const createSenderId = (): string => `sticky-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createInitPayload = (source: StickyNoteSource): StickyWindowInitPayload => ({
	type: 'sticky-note',
	senderId: createSenderId(),
	source,
	appUrl: getStickyAppUrl(),
	createdAt: Date.now(),
});

const showStickyWindow = (win: BrowserWindowLike | null): void => {
	try {
		win?.show?.();
		win?.setAlwaysOnTop?.(true);
	} catch {
		// Showing the window is best effort; creation failure is handled by caller.
	}
};

const resizeStickyWindow = (win: BrowserWindowLike | null, utools?: UtoolsWindowLike): void => {
	try {
		const bounds = windowPreferenceService.resolveStickyWindowBounds(settingsService.getSettings(), utools);
		win?.setSize?.(bounds.width, bounds.height);
		win?.setPosition?.(bounds.x, bounds.y);
	} catch {
		// Resizing reused windows is best effort.
	}
};

const canReuseWindow = (win: BrowserWindowLike | null): win is BrowserWindowLike => {
	if (!win) return false;
	try {
		return win.isDestroyed ? !win.isDestroyed() : true;
	} catch {
		return false;
	}
};

export const openStickyNoteWindow = (source: StickyNoteSource): StickyWindowOpenResult => {
	const nextSource = { ...source, updatedAt: Date.now() };
	stickyNoteService.saveSource(nextSource);
	const utools = (window as Window & { utools?: UtoolsWindowLike }).utools;
	const payload = createInitPayload(nextSource);

	if (canReuseWindow(stickyWindow)) {
		try {
			resizeStickyWindow(stickyWindow, utools);
			stickyWindow.webContents?.send?.('jianyue:sticky-source-updated', payload);
			showStickyWindow(stickyWindow);
			utools?.hideMainWindow?.(true);
			return { ok: true };
		} catch {
			stickyWindow = null;
		}
	}

	if (!utools?.createBrowserWindow) {
		console.warn('请在 uTools 插件环境中打开便签窗口');
		return { ok: false, reason: 'utools-unavailable' };
	}

	const bounds = windowPreferenceService.resolveStickyWindowBounds(settingsService.getSettings(), utools);
	let win: BrowserWindowLike | null = null;
	let initSent = false;
	const sendInit = (): void => {
		if (initSent) return;
		if (!win?.webContents?.send) return;
		win.webContents.send('window', payload);
		initSent = true;
	};

	try {
		win = utools.createBrowserWindow(getStickyUrl(), {
			show: true,
			title: '简悦清单便签',
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			minWidth: bounds.minWidth,
			minHeight: bounds.minHeight,
			frame: false,
			closable: true,
			resizable: true,
			alwaysOnTop: true,
			skipTaskbar: true,
			autoHideMenuBar: true,
			backgroundColor: '#00000000',
			transparent: true,
			webPreferences: {
				preload: './preload/stickyWindowPreload.js',
				zoomFactor: 1,
			},
		}, () => {
			sendInit();
			showStickyWindow(win);
		});
	} catch (error) {
		console.error(error);
		return { ok: false, reason: 'create-failed' };
	}

	sendInit();
	showStickyWindow(win);
	stickyWindow = win;
	utools.hideMainWindow?.(true);
	return { ok: true };
};
