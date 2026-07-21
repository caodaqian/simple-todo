import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, ref } from 'vue';
import { useUtoolsTaskSearch } from './useUtoolsTaskSearch';

type UtoolsSearchMock = {
	onPluginEnter: ReturnType<typeof vi.fn>;
	onPluginOut: ReturnType<typeof vi.fn>;
	setSubInput?: ReturnType<typeof vi.fn>;
	setSubInputValue?: ReturnType<typeof vi.fn>;
	subInputSelect?: ReturnType<typeof vi.fn>;
	subInputFocus?: ReturnType<typeof vi.fn>;
	subInputBlur?: ReturnType<typeof vi.fn>;
	removeSubInput?: ReturnType<typeof vi.fn>;
};

const installUtoolsMock = (overrides: Partial<UtoolsSearchMock> = {}): UtoolsSearchMock => {
	const utools: UtoolsSearchMock = {
		onPluginEnter: vi.fn(),
		onPluginOut: vi.fn(),
		setSubInput: vi.fn(() => true),
		setSubInputValue: vi.fn(() => true),
		subInputSelect: vi.fn(() => true),
		subInputFocus: vi.fn(() => true),
		subInputBlur: vi.fn(() => true),
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
		expect(utools.subInputSelect).toHaveBeenCalledOnce();

		search.dispose();
		expect(utools.subInputBlur).toHaveBeenCalledOnce();
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

		failedSearch.dispose();
	});

	it('does not install sub-input when uTools is unavailable', () => {
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => '', onInput: vi.fn() });
		search.activate();
		// 无 window.utools，不应抛异常
		search.dispose();
	});

	it('falls back to the filter keyword input when uTools focus is unavailable', () => {
		const utools = installUtoolsMock({
			subInputSelect: vi.fn(() => false),
			subInputFocus: vi.fn(() => false),
		});
		const focusKeywordSearch = vi.fn();
		const search = useUtoolsTaskSearch({
			getTitleKeyword: () => '',
			onInput: vi.fn(),
			fallbackToolbar: ref({ focusKeywordSearch }),
		});
		search.activate();

		const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
		window.dispatchEvent(event);

		expect(utools.subInputSelect).toHaveBeenCalledTimes(2);
		expect(focusKeywordSearch).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);

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

	it('removes sub-input on plugin exit, then restores it on re-entry', () => {
		const utools = installUtoolsMock();
		let keyword = '进入前';
		const search = useUtoolsTaskSearch({ getTitleKeyword: () => keyword, onInput: vi.fn() });
		search.activate();

		const onPluginOut = utools.onPluginOut.mock.calls[0]![0] as (isKill: boolean) => void;
		const onPluginEnter = utools.onPluginEnter.mock.calls[0]![0] as () => void;
		onPluginOut(false);
		expect(utools.removeSubInput).toHaveBeenCalledOnce();

		keyword = '重新进入后';
		onPluginEnter();
		expect(utools.setSubInput).toHaveBeenCalledTimes(2);
		expect(utools.setSubInputValue).toHaveBeenLastCalledWith('重新进入后');

		search.dispose();
	});

	it('cleans up sub-input on Vue scope disposal without duplicate installation', () => {
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

		const onPluginEnter = utools.onPluginEnter.mock.calls[0]![0] as () => void;
		onPluginEnter();
		expect(utools.setSubInput).toHaveBeenCalledOnce();
	});
});
