import { ref } from 'vue';
import { taskWorkflowService, type BlockedCompletionInfo } from '../services/taskWorkflowService';
import type { Task, TaskStatus } from '../types/task';

/**
 * 包装单任务状态变更：完成被阻止时填充 blockedInfo 供 UI 弹出模态框，
 * 而不是依赖旧的纯文本 uTools 通知。批量完成路径不使用此 composable。
 */
export function useCompletionBlockedModal(): {
	blockedInfo: ReturnType<typeof ref<BlockedCompletionInfo | null>>;
	guardedChangeStatus: (taskId: string, status: TaskStatus) => Task | null;
	dismissBlockedModal: () => void;
} {
	const blockedInfo = ref<BlockedCompletionInfo | null>(null);

	const guardedChangeStatus = (taskId: string, status: TaskStatus): Task | null => {
		const updated = taskWorkflowService.changeStatus(taskId, status);
		if (!updated && status === 'done') {
			blockedInfo.value = taskWorkflowService.getBlockedCompletionInfo(taskId);
		}
		return updated;
	};

	const dismissBlockedModal = (): void => {
		blockedInfo.value = null;
	};

	return { blockedInfo, guardedChangeStatus, dismissBlockedModal };
}
