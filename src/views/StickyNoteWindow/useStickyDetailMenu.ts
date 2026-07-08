import { ref } from 'vue';

export const useStickyDetailMenu = () => {
	const activeTaskId = ref<string | null>(null);

	const open = (taskId: string): void => {
		activeTaskId.value = taskId;
	};

	const openFromContextMenu = (event: MouseEvent, taskId: string): void => {
		event.preventDefault();
		open(taskId);
	};

	const close = (): void => {
		activeTaskId.value = null;
	};

	const closeOnEscape = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') close();
	};

	return { activeTaskId, open, openFromContextMenu, close, closeOnEscape };
};
