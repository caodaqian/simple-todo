import { onUnmounted, watch } from 'vue';
import { settingsService } from '../services/settingsService';
import { themeService } from '../services/themeService';

/**
 * 全局唯一调用一次（建议放在 App.vue setup）。
 * 监听 settings 变化以实时应用 theme/accent；
 * 在 appearanceMode='system' 时监听系统色彩偏好变化。
 */
export function useTheme(): void {
	const settings = settingsService.getSettingsRef();
	let unwatchSystem: (() => void) | null = null;

	const applyCurrent = (): void => {
		themeService.apply(settings.value.appearanceMode, settings.value.accentColor);
	};

	const bindSystemWatcher = (): void => {
		unwatchSystem?.();
		unwatchSystem = null;
		if (settings.value.appearanceMode === 'system') {
			unwatchSystem = themeService.watchSystem(() => applyCurrent());
		}
	};

	// 初次应用
	applyCurrent();
	bindSystemWatcher();

	// 监听 mode/accent 变化
	watch(
		() => [settings.value.appearanceMode, settings.value.accentColor] as const,
		() => applyCurrent(),
	);

	// mode 切到/离开 system 时重新绑/解绑系统监听
	watch(
		() => settings.value.appearanceMode,
		() => bindSystemWatcher(),
	);

	onUnmounted(() => {
		unwatchSystem?.();
		unwatchSystem = null;
	});
}
