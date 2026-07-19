import { getCurrentInstance, onUnmounted } from 'vue';

interface UseUtoolsTaskSearchOptions {
	getTitleKeyword: () => string;
	onInput: (text: string) => void;
}

interface UtoolsTaskSearch {
	activate: () => void;
	dispose: () => void;
}

const SUB_INPUT_PLACEHOLDER = '搜索任务标题';

export const useUtoolsTaskSearch = ({ getTitleKeyword, onInput }: UseUtoolsTaskSearchOptions): UtoolsTaskSearch => {
	let active = false;
	let disposed = false;
	let keydownInstalled = false;
	let subInputInstalled = false;
	let installedUtools: Window['utools'] | undefined;
	let registeredUtools: Window['utools'] | undefined;

	const removeSubInput = (): void => {
		if (!subInputInstalled) return;
		try {
			installedUtools?.removeSubInput?.();
		} catch {
			// uTools API failure must not affect the main window.
		}
		subInputInstalled = false;
		installedUtools = undefined;
	};

	const installSubInput = (): void => {
		if (!active || disposed || subInputInstalled) return;
		const utools = window.utools;
		if (typeof utools?.setSubInput !== 'function') return;

		try {
			if (!utools.setSubInput(({ text }) => onInput(text), SUB_INPUT_PLACEHOLDER, true)) return;
		} catch {
			return;
		}

		subInputInstalled = true;
		installedUtools = utools;

		try {
			utools.setSubInputValue?.(getTitleKeyword());
		} catch {
			// A failed echo must not lose the installed sub-input cleanup handle.
		}
	};

	const onKeydown = (event: KeyboardEvent): void => {
		if (
			event.altKey
			|| !(event.metaKey || event.ctrlKey)
			|| event.key.toLowerCase() !== 'f'
			|| !subInputInstalled
		) return;

		try {
			if (installedUtools?.subInputSelect?.() === true) {
				event.preventDefault();
			}
		} catch {
			// Let the browser's native find command handle unavailable uTools APIs.
		}
	};

	const installKeydown = (): void => {
		if (!active || disposed || keydownInstalled) return;
		window.addEventListener('keydown', onKeydown, true);
		keydownInstalled = true;
	};

	const removeKeydown = (): void => {
		if (!keydownInstalled) return;
		window.removeEventListener('keydown', onKeydown, true);
		keydownInstalled = false;
	};

	const deactivate = (): void => {
		active = false;
		removeKeydown();
		removeSubInput();
	};

	const registerPluginLifecycle = (): void => {
		const utools = window.utools;
		if (!utools || registeredUtools === utools) return;
		registeredUtools = utools;

		try {
			utools.onPluginEnter(() => activate());
			utools.onPluginOut(() => deactivate());
		} catch {
			// Some non-uTools environments expose incomplete API shims.
		}
	};

	const activate = (): void => {
		if (disposed) return;
		active = true;
		registerPluginLifecycle();
		installKeydown();
		installSubInput();
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		deactivate();
	};

	if (getCurrentInstance() !== null) {
		onUnmounted(dispose);
	}

	return { activate, dispose };
};