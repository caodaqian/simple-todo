import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent } from 'vue';
import { useUtoolsTaskSearch } from './useUtoolsTaskSearch';

type UtoolsSearchMock = {
	onPluginEnter: ReturnType<typeof vi.fn>;
	onPluginOut: ReturnType<typeof vi.fn>;
	setSubInput?: ReturnType<typeof vi.fn>;
	setSubInputValue?: ReturnType<typeof vi.fn>;
	subInputSelect?: ReturnType<typeof vi.fn>;
	removeSubInput?: ReturnType<typeof vi.fn>;
};

const installUtoolsMock = (overrides: Partial<UtoolsSearchMock> = {}): UtoolsSearchMock => {
	const utools: UtoolsSearchMock = {
		onPluginEnter: vi.fn(),
		onPluginOut: vi.fn(),
		setSubInput: vi.fn(() => true),
		setSubInputValue: vi.fn(() => true),
		subInputSelect: vi.fn(() => true),
		removeSubInput: vi.fn(() => true),
		...overrides,
	};
	Object.defineProperty(window, 'utools', {
		configurable: true,
		writable: true,
		value: utools,
	});
	return utools;
};

const createFindEvent = (overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent => new KeyboardEvent('keydown', {
	key: 'f',
	metaKey: true,
	cancelable: true,
	...overrides,
});

afterEach(() => {
	delete window.utools;
	vi.restoreAllMocks();
});

describe('useUtoolsTaskSearch', () => {
	it('installs a focused title-search sub-input and forwards its raw text after explicit activation', () => {
		const utools = installUtoolsMock();
		const onInput = vi.fn();
		const search = useUtoolsTaskSearch({
			getTitleKeyword: () => '当前关键词',
			onInput,
		});

		search.activate();

		expect(utools.setSubInput).toHaveBeenCalledOnce();
		const [onChange, placeholder, isFocus] = utools.setSubInput!.mock.calls[0]!;
		expect(placeholder).toBe('搜索任务标题');
		expect(isFocus).toBe(true);
		(onChange as (details: { text: string }) => void)({ text: '  保留原样  ' });
		expect(onInput).toHaveBeenCalledWith('  保留原样  ');
		expect(utools.setSubInputValue).toHaveBeenCalledWith('当前关键词');

		search.dispose();
	});

	it('only marks the sub-input usable and echoes the keyword when installation succeeds', () => {
		const successful = installUtoolsMock();
		const successfulSearch = useUtoolsTaskSearch({
			getTitleKeyword: () => '已安装',
			onInput: vi.fn(),
		});

		successfulSearch.activate();
		expect(successful.setSubInputValue).toHaveBeenCalledWith('已安装');
		successfulSearch.dispose();

		const failed = installUtoolsMock({ setSubInput: vi.fn(() => false) });
		const failedSearch = useUtoolsTaskSearch({
			getTitleKeyword: () => '不应回显',
			onInput: vi.fn(),
		});

		failedSearch.activate();
		expect(failed.setSubInputValue).not.toHaveBeenCalled();

		const event = createFindEvent();
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(failed.subInputSelect).not.toHaveBeenCalled();
		failedSearch.dispose();
	});

	it('only prevents Cmd/Ctrl+F when an installed sub-input is selected successfully', () => {
		const utools = installUtoolsMock();
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
		search.activate();

		const selected = createFindEvent();
		window.dispatchEvent(selected);
		expect(utools.subInputSelect).toHaveBeenCalledOnce();
		expect(selected.defaultPrevented).toBe(true);

		utools.subInputSelect!.mockReturnValue(false);
		const selectionFailed = createFindEvent({ key: 'F', ctrlKey: true, metaKey: false });
		window.dispatchEvent(selectionFailed);
		expect(selectionFailed.defaultPrevented).toBe(false);

		const withAlt = createFindEvent({ altKey: true });
		window.dispatchEvent(withAlt);
		expect(withAlt.defaultPrevented).toBe(false);

		search.dispose();
		const apiUnavailable = createFindEvent();
		window.dispatchEvent(apiUnavailable);
		expect(apiUnavailable.defaultPrevented).toBe(false);
	});

	it('selects the sub-input before a focused control can stop Cmd/Ctrl+F propagation', () => {
		const utools = installUtoolsMock();
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
		const input = document.createElement('input');
		input.addEventListener('keydown', (event) => event.stopPropagation());
		document.body.append(input);
		search.activate();

		try {
			const event = new KeyboardEvent('keydown', {
				key: 'f',
				metaKey: true,
				bubbles: true,
				cancelable: true,
			});
			input.dispatchEvent(event);

			expect(utools.subInputSelect).toHaveBeenCalledOnce();
			expect(event.defaultPrevented).toBe(true);
		} finally {
			input.remove();
			search.dispose();
		}
	});

	it('leaves Cmd/Ctrl+F for native find when uTools is unavailable', () => {
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
		search.activate();

		const event = createFindEvent();
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);

		search.dispose();
	});

	it('leaves Cmd/Ctrl+F for native find when sub-input selection is unavailable', () => {
		const utools = installUtoolsMock();
		delete utools.subInputSelect;
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
		search.activate();

		const event = createFindEvent();
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);

		search.dispose();
		expect(utools.removeSubInput).toHaveBeenCalledOnce();
	});

	it('leaves Cmd/Ctrl+F for native find when sub-input selection throws', () => {
		const utools = installUtoolsMock({
			subInputSelect: vi.fn(() => {
				throw new Error('selection failed');
			}),
		});
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
		search.activate();

		const event = createFindEvent();
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);

		search.dispose();
	});

	it('removes an installed sub-input when keyword echoing throws during installation', () => {
		const utools = installUtoolsMock({
			setSubInputValue: vi.fn(() => {
				throw new Error('echo failed');
			}),
		});
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '关键词', onInput: vi.fn() });
		search.activate();

		search.dispose();
		expect(utools.removeSubInput).toHaveBeenCalledOnce();
	});

	it('removes keyboard and sub-input resources on plugin exit, then restores them on re-entry', () => {
		const utools = installUtoolsMock();
		const removeEventListener = vi.spyOn(window, 'removeEventListener');
		let keyword = '进入前';
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => keyword, onInput: vi.fn() });
		search.activate();

		const onPluginOut = utools.onPluginOut.mock.calls[0]![0] as (isKill: boolean) => void;
		const onPluginEnter = utools.onPluginEnter.mock.calls[0]![0] as () => void;
		onPluginOut(false);
		expect(utools.removeSubInput).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);

		const exitedFindEvent = createFindEvent();
		window.dispatchEvent(exitedFindEvent);
		expect(utools.subInputSelect).not.toHaveBeenCalled();
		expect(exitedFindEvent.defaultPrevented).toBe(false);

		keyword = '重新进入后';
		onPluginEnter();
		expect(utools.setSubInput).toHaveBeenCalledTimes(2);
		expect(utools.setSubInputValue).toHaveBeenLastCalledWith('重新进入后');

		const reenteredFindEvent = createFindEvent();
		window.dispatchEvent(reenteredFindEvent);
		expect(utools.subInputSelect).toHaveBeenCalledOnce();
		expect(reenteredFindEvent.defaultPrevented).toBe(true);

		search.dispose();
	});

	it('cleans up keyboard and sub-input resources on Vue scope disposal without duplicate installation', () => {
		const utools = installUtoolsMock();
		let search: ReturnType<typeof useUtoolsTaskSearch> | undefined;
		const root = document.createElement('div');
		const app = createApp(defineComponent({
			setup() {
				search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
				return () => null;
			},
		}));
		app.mount(root);

		search!.activate();
		search!.activate();
		expect(utools.setSubInput).toHaveBeenCalledOnce();
		expect(utools.onPluginEnter).toHaveBeenCalledOnce();
		expect(utools.onPluginOut).toHaveBeenCalledOnce();

		app.unmount();
		expect(utools.removeSubInput).toHaveBeenCalledOnce();

		const findEvent = createFindEvent();
		window.dispatchEvent(findEvent);
		expect(utools.subInputSelect).not.toHaveBeenCalled();
		expect(findEvent.defaultPrevented).toBe(false);

		const onPluginEnter = utools.onPluginEnter.mock.calls[0]![0] as () => void;
		onPluginEnter();
		expect(utools.setSubInput).toHaveBeenCalledOnce();
	});
});
