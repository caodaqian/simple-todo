import { onUnmounted, watch } from 'vue';
import { settingsService } from '../services/settingsService';
import { windowPreferenceService } from '../services/windowPreferenceService';

export function useWindowPreferences(): { applyMainWindowHeight: () => void } {
	const settings = settingsService.getSettingsRef();

	const applyFontScale = (): void => {
		windowPreferenceService.applyFontScale(settings.value);
	};

	const applyMainWindowHeight = (): void => {
		windowPreferenceService.applyMainWindowHeight(settings.value);
	};

	applyFontScale();
	applyMainWindowHeight();

	const stopFontWatch = watch(
		() => settings.value.fontScale,
		() => applyFontScale(),
	);

	const stopWindowWatch = watch(
		() => settings.value.mainWindowHeightPreset,
		() => applyMainWindowHeight(),
	);

	onUnmounted(() => {
		stopFontWatch();
		stopWindowWatch();
	});

	return { applyMainWindowHeight };
}
