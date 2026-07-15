import { onBeforeUnmount, ref } from 'vue';

export function useImeGuard() {
	const isComposing = ref(false);
	let releaseTimer: number | undefined;

	const onCompositionStart = (): void => {
		if (releaseTimer !== undefined) {
			window.clearTimeout(releaseTimer);
			releaseTimer = undefined;
		}
		isComposing.value = true;
	};

	const onCompositionEnd = (): void => {
		releaseTimer = window.setTimeout(() => {
			isComposing.value = false;
			releaseTimer = undefined;
		}, 0);
	};

	const shouldIgnoreKeydown = (event: KeyboardEvent): boolean => {
		return isComposing.value || event.isComposing;
	};

	onBeforeUnmount(() => {
		if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
	});

	return {
		isComposing,
		onCompositionStart,
		onCompositionEnd,
		shouldIgnoreKeydown,
	};
}
