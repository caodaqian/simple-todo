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

interface Window {
	services: WindowServices;
	utools?: {
		onPluginEnter(callback: (action: { code: string; type?: string; payload?: unknown }) => void): void;
		onPluginOut(callback: (isKill: boolean) => void): void;
		dbStorage?: {
			getItem(key: string): unknown;
			setItem(key: string, value: string): unknown;
			removeItem(key: string): void;
		};
		showNotification?(opts: { title: string; body: string }): void;
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
