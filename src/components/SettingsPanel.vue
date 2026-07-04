<script setup lang="ts">
import { settingsService } from '../services/settingsService';
import { taskService } from '../services/taskService';
import type { AccentColor, AppSettings, AppearanceMode, TodoView } from '../types/settings';
import { ACCENT_COLORS } from '../types/settings';
import AppIcon from './AppIcon.vue';

interface Props {
  modelValue: boolean;
  settings: AppSettings;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'change', value: AppSettings): void;
  (event: 'refresh'): void;
}>();

const modeOptions: Array<{ label: string; value: AppearanceMode }> = [
  { label: '☀ 浅色', value: 'light' },
  { label: '☾ 深色', value: 'dark' },
  { label: '⚙ 系统', value: 'system' },
];

const viewOptions: Array<{ label: string; value: TodoView }> = [
  { label: '列表', value: 'list' },
  { label: '看板', value: 'kanban' },
  { label: '四象限', value: 'eisenhower' },
  { label: '日历', value: 'calendar' },
];

const closePanel = (): void => {
  emit('update:modelValue', false);
};

const setMode = (mode: AppearanceMode): void => {
  const next = settingsService.updateSettings({ appearanceMode: mode });
  emit('change', next);
};

const setAccent = (accent: AccentColor): void => {
  const next = settingsService.updateSettings({ accentColor: accent });
  emit('change', next);
};

const handleDefaultViewChange = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value as TodoView;
  const next = settingsService.updateSettings({ defaultView: value });
  emit('change', next);
};

const handleShowCompletedChange = (event: Event): void => {
  const next = settingsService.updateSettings({ showCompleted: (event.target as HTMLInputElement).checked });
  emit('change', next);
};

const handleNotificationsChange = (event: Event): void => {
  const next = settingsService.updateSettings({ notifyEnabled: (event.target as HTMLInputElement).checked });
  emit('change', next);
};

const handleExport = (): void => {
  const dataStr = taskService.exportTasks();
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jianyue-tasks-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const handleImport = (): void => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = taskService.importTasks(text);
      if (result.importedCount === 0 && result.invalidCount > 0 && result.duplicateCount === 0) {
        alert('导入失败：文件格式错误或任务数据无效');
        return;
      }

      alert(`导入完成：新增 ${result.importedCount} 个任务，跳过重复 ${result.duplicateCount} 个，无效 ${result.invalidCount} 个`);
      emit('refresh');
    } catch {
      alert('导入失败：文件格式错误');
    }
  };
  input.click();
};
</script>

<template>
  <div v-if="modelValue" class="settings-mask" @click.self="closePanel">
    <div class="settings-panel" @click.stop>
      <header class="settings-header">
        <div class="settings-header__title">
          <AppIcon name="settings" :size="18" />
          <h2>设置</h2>
        </div>
        <button type="button" class="btn btn-ghost btn-icon" title="关闭" aria-label="关闭" @click="closePanel">
          <AppIcon name="x" :size="18" />
        </button>
      </header>

      <!-- 外观 -->
      <div class="section">
        <h3 class="section-title">外观</h3>

        <div class="field">
          <span class="field-label">主题模式</span>
          <div class="segmented-group">
            <button
              v-for="opt in modeOptions"
              :key="opt.value"
              class="btn-segmented"
              :class="{ active: settings.appearanceMode === opt.value }"
              @click="setMode(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">强调色</span>
          <div class="accent-swatches">
            <button
              v-for="c in ACCENT_COLORS"
              :key="c"
              class="accent-swatch"
              :class="{ active: settings.accentColor === c }"
              :style="{ '--swatch-color': `var(--ctp-${c})` }"
              :title="c"
              @click="setAccent(c)"
            />
          </div>
        </div>
      </div>

      <div class="section-divider"></div>

      <!-- 任务 -->
      <div class="section">
        <h3 class="section-title">任务</h3>

        <label class="field switch-field">
          <input type="checkbox" :checked="settings.showCompleted" @change="handleShowCompletedChange" />
          <span>默认显示已完成任务</span>
        </label>

        <label class="field">
          <span class="field-label">默认视图</span>
          <select :value="settings.defaultView" @change="handleDefaultViewChange">
            <option v-for="option in viewOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field switch-field">
          <input type="checkbox" :checked="settings.notifyEnabled" @change="handleNotificationsChange" />
          <span>任务操作提示通知</span>
        </label>
      </div>

      <div class="section-divider"></div>

      <!-- 数据 -->
      <div class="section">
        <h3 class="section-title">数据</h3>
        <div class="data-actions">
          <button type="button" class="btn-ghost" @click="handleExport">导出任务</button>
          <button type="button" class="btn-ghost" @click="handleImport">导入任务</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--mask-medium);
  display: flex;
  justify-content: flex-end;
  animation: mask-in var(--transition-base);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border-subtle);
  margin-bottom: var(--space-2);
}

.settings-header__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.settings-header__title h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text-primary);
}

.settings-panel {
  width: min(380px, 92vw);
  height: 100vh;
  overflow-y: auto;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-left: 1px solid var(--color-border-subtle);
  box-shadow: var(--shadow-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.section-divider {
  height: 1px;
  background: var(--color-border-subtle);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-base);
  color: var(--color-text-primary);
}

.field-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.segmented-group {
  display: flex;
  gap: var(--space-1);
}

.segmented-group .btn-segmented {
  flex: 1;
  text-align: center;
}

.accent-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.accent-swatch {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  border: 2px solid transparent;
  background: var(--swatch-color);
  cursor: pointer;
  transition: border-color var(--transition-fast), transform var(--transition-fast);
  position: relative;
  padding: 0;
}

.accent-swatch:hover {
  transform: scale(1.15);
}

.accent-swatch.active {
  border-color: var(--color-bg-elevated);
  box-shadow: 0 0 0 2px var(--swatch-color);
}

.switch-field {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}

.switch-field input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--color-accent);
}

select:focus {
  border-color: var(--color-accent);
  box-shadow: var(--ring-focus);
}

.data-actions {
  display: flex;
  gap: var(--space-2);
}

.data-actions .btn-ghost {
  flex: 1;
  justify-content: center;
}
</style>
