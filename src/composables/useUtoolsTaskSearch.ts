import { getCurrentInstance, onUnmounted, type Ref } from 'vue';

interface UseUtoolsTaskSearchOptions {
	getTitleKeyword: () => string;
	onInput: (text: string) => void;
	/** uTools 子输入框不可用时，Cmd/Ctrl+F 调用此回调（如打开筛选面板并聚焦关键词输入框）。 */
	onFallbackFocus?: () => void;
	/** 可选的 FilterToolbar 组件 ref，用于回退聚焦。 */
	fallbackToolbar?: Ref<{ focusKeywordSearch: () => void } | null>;
}

interface UtoolsTaskSearch {
	activate: () => void;
	dispose: () => void;
}

const SUB_INPUT_PLACEHOLDER = '搜索任务标题';

export const useUtoolsTaskSearch = ({ getTitleKeyword, onInput, onFallbackFocus, fallbackToolbar }: UseUtoolsTaskSearchOptions): UtoolsTaskSearch => {
	let active = false;
	let disposed = false;
	let keydownInstalled = false;
	let subInputInstalled = false;
	let installedUtools: Window['utools'] | undefined;
	let registeredUtools: Window['utools'] | undefined;

	const removeSubInput = (): void => {
		if (!subInputInstalled) return;
		try {
			installedUtools?.subInputBlur?.();
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
			focusUtoolsSubInput();
		} catch {
			// A failed echo must not lose the installed sub-input cleanup handle.
		}
	};

	const focusUtoolsSubInput = (): boolean => {
		if (!subInputInstalled) return false;
		try {
			if (installedUtools?.subInputSelect?.() === true) return true;
			return installedUtools?.subInputFocus?.() === true;
		} catch {
			return false;
		}
	};

	const triggerFallback = (): void => {
		onFallbackFocus?.();
		fallbackToolbar?.value?.focusKeywordSearch();
	};

	const onKeydown = (event: KeyboardEvent): void => {
		if (
			event.altKey
			|| !(event.metaKey || event.ctrlKey)
			|| event.key.toLowerCase() !== 'f'
		) return;

		// 优先聚焦 uTools 子输入框
		if (focusUtoolsSubInput()) {
			event.preventDefault();
			return;
		}

		// 回退：打开筛选面板并聚焦关键词输入框
		if (onFallbackFocus || fallbackToolbar?.value) {
			triggerFallback();
			event.preventDefault();
		}
		// 两者都不可用时，不阻止默认行为，让浏览器原生查找接管
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
