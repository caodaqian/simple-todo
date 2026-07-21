/// <reference types="vite/client" />

interface WindowServices {
	readFile(file: string): string;
	writeTextFile(text: string): string;
	writeImageFile(base64Url: string): string | undefined;
	exportTasks(): { filePath: string; count: number };
	importTasks(filePath: string): { added: number; total: number };
}

interface ToolContext {
	sendProgress?: (opts: { progress: number; total: number; message: string }) => void;
}

interface UtoolsRegisterToolHandler {
	(params: Record<string, unknown>, ctx: ToolContext): Promise<unknown> | unknown;
}

interface UtoolsDbDocument {
	_id: string;
	_rev?: string;
	data?: unknown;
	[key: string]: unknown;
}

interface UtoolsDbResult {
	ok?: boolean;
	error?: boolean;
	name?: string;
	message?: string;
	id?: string;
	rev?: string;
}

interface UtoolsDb {
	get(id: string): UtoolsDbDocument | null;
	put(document: UtoolsDbDocument): UtoolsDbResult;
	remove(document: UtoolsDbDocument): UtoolsDbResult;
	bulkDocs(documents: UtoolsDbDocument[]): UtoolsDbResult[];
	allDocs(prefix?: string): UtoolsDbDocument[];
}

interface Window {
	services: WindowServices;
	utools?: {
		onPluginEnter(callback: (action: { code: string; type?: string; payload?: unknown }) => void): void;
		onPluginOut(callback: (isKill: boolean) => void): void;
		setSubInput?(onChange: (details: { text: string }) => void, placeholder?: string, isFocus?: boolean): boolean;
		setSubInputValue?(text: string): boolean;
		subInputFocus?(): boolean;
		subInputBlur?(): boolean;
		subInputSelect?(): boolean;
		removeSubInput?(): boolean;
		db?: UtoolsDb;
		dbStorage?: {
			getItem(key: string): unknown;
			setItem(key: string, value: string): unknown;
			removeItem(key: string): void;
		};
		showNotification?(body: string, featureName?: string): void;
		hideMainWindow?(isRestorePreWindow?: boolean): boolean;
		showMainWindow?(): boolean;
		createBrowserWindow?(url: string, options?: Record<string, unknown>, callback?: () => void): {
			id?: number;
			show?: () => void;
			close?: () => void;
			isDestroyed?: () => boolean;
			setSize?: (width: number, height: number) => void;
			setPosition?: (x: number, y: number) => void;
			getBounds?: () => { x: number; y: number; width: number; height: number };
			setAlwaysOnTop?: (flag: boolean, level?: string) => void;
			webContents?: { send?: (channel: string, ...args: unknown[]) => void };
		};
		setExpendHeight?(height: number): boolean;
		sendToParent?(channel: string, ...args: unknown[]): void;
		getWindowType?(): 'main' | 'detach' | 'browser';
		isDarkColors?(): boolean;
		redirect?(label: string | [string, string], payload?: unknown): boolean;
		getCursorScreenPoint?(): { x: number; y: number };
		getDisplayNearestPoint?(point: { x: number; y: number }): { bounds: { x: number; y: number; width: number; height: number } };
		getPrimaryDisplay?(): { bounds: { x: number; y: number; width: number; height: number } };
		getAllDisplays?(): Array<{ bounds: { x: number; y: number; width: number; height: number } }>;
		hide(): void;
		show(): void;
		getPath(name: string): string;
		getWindowWidth(): number;
		getWindowHeight(): number;
		registerTool(name: string, handler: UtoolsRegisterToolHandler): void;
		copyText(text: string): void;
		readText(): Promise<string>;
		[key: string]: unknown;
	};
}
