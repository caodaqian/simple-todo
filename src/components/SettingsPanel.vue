<script setup lang="ts">
import { settingsService } from '../services/settingsService';
import { taskService } from '../services/taskService';
  import type {
    AccentColor,
    AppSettings,
    AppearanceMode,
    FontScale,
    MainWindowHeightPreset,
    StickyWindowHeightPreset,
    StickyWindowPositionPreset,
    StickyWindowWidthPreset,
    TodoView,
  } from '../types/settings';
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
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'system' },
];

const viewOptions: Array<{ label: string; value: TodoView }> = [
  { label: '列表', value: 'list' },
  { label: '看板', value: 'kanban' },
  { label: '四象限', value: 'eisenhower' },
  { label: '日历', value: 'calendar' },
];

  const fontScaleOptions: Array<{ label: string; value: FontScale; description: string }> = [
    { label: '紧凑', value: 'compact', description: '显示更多任务' },
    { label: '标准', value: 'standard', description: '默认平衡' },
    { label: '舒适', value: 'comfortable', description: '阅读更轻松' },
    { label: '大号', value: 'large', description: '重点放大' },
  ];

  const mainWindowHeightOptions: Array<{ label: string; value: MainWindowHeightPreset; description: string }> = [
    { label: '紧凑', value: 'compact', description: '轻量查看' },
    { label: '标准', value: 'standard', description: '日常使用' },
    { label: '宽敞', value: 'spacious', description: '更多内容' },
    { label: '沉浸', value: 'immersive', description: '专注整理' },
  ];

  const stickyWindowWidthOptions: Array<{ label: string; value: StickyWindowWidthPreset; description: string }> = [
    { label: '窄', value: 'narrow', description: '靠边不挡事' },
    { label: '标准', value: 'standard', description: '默认宽度' },
    { label: '宽', value: 'wide', description: '清单更舒展' },
    { label: '超宽', value: 'extra-wide', description: '长标题更完整' },
  ];

  const stickyWindowHeightOptions: Array<{ label: string; value: StickyWindowHeightPreset; description: string }> = [
    { label: '紧凑', value: 'compact', description: '轻量查看' },
    { label: '标准', value: 'standard', description: '默认高度' },
    { label: '高', value: 'tall', description: '显示更多任务' },
    { label: '超高', value: 'extra-tall', description: '专注整理' },
  ];

  const stickyWindowPositionOptions: Array<{ label: string; value: StickyWindowPositionPreset; description: string }> = [
    { label: '智能', value: 'auto', description: '跟随鼠标屏幕' },
    { label: '左上', value: 'top-left', description: '贴近起始区' },
    { label: '右上', value: 'top-right', description: '默认角落' },
    { label: '居中', value: 'center', description: '醒目查看' },
    { label: '右下', value: 'bottom-right', description: '减少遮挡' },
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

  const setFontScale = (fontScale: FontScale): void => {
    const next = settingsService.updateSettings({ fontScale });
    emit('change', next);
  };

  const setMainWindowHeightPreset = (mainWindowHeightPreset: MainWindowHeightPreset): void => {
    const next = settingsService.updateSettings({ mainWindowHeightPreset });
    emit('change', next);
  };

  const setStickyWindowWidthPreset = (stickyWindowWidthPreset: StickyWindowWidthPreset): void => {
    const next = settingsService.updateSettings({ stickyWindowWidthPreset });
    emit('change', next);
  };

  const setStickyWindowHeightPreset = (stickyWindowHeightPreset: StickyWindowHeightPreset): void => {
    const next = settingsService.updateSettings({ stickyWindowHeightPreset });
    emit('change', next);
  };

  const setStickyWindowPositionPreset = (stickyWindowPositionPreset: StickyWindowPositionPreset): void => {
    const next = settingsService.updateSettings({ stickyWindowPositionPreset });
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

  const handlePomodoroMinutesChange = (event: Event): void => {
    const raw = Number((event.target as HTMLInputElement).value);
    const minutes = Number.isFinite(raw) ? Math.trunc(raw) : 40;
    const next = settingsService.updateSettings({ pomodoroMinutes: Math.min(240, Math.max(1, minutes)) });
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

  const handleRestoreBackup = (): void => {
    if (!confirm('确定恢复最近一次自动备份吗？当前任务将被备份内容覆盖。')) {
      return;
    }

    if (taskService.restoreLatestBackup()) {
      alert('已恢复最近备份');
      emit('refresh');
      return;
    }

    alert('无可用备份');
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
type="button"
              class="btn-segmented"
              :class="{ active: settings.appearanceMode === opt.value }"
              :aria-pressed="settings.appearanceMode === opt.value"
              @click="setMode(opt.value)"
            >{{ opt.label }}</button>
          </div>
          <span class="field-hint">跟随系统会优先读取 uTools 深色主题状态。</span>
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

      <!-- 显示与窗口 -->
      <div class="section">
        <h3 class="section-title">显示与窗口</h3>

        <div class="field">
          <span class="field-label">字号大小</span>
          <div class="option-card-grid">
            <button v-for="opt in fontScaleOptions" :key="opt.value" type="button" class="option-card"
              :class="{ active: settings.fontScale === opt.value }" :aria-pressed="settings.fontScale === opt.value"
              @click="setFontScale(opt.value)">
              <strong>{{ opt.label }}</strong>
              <span>{{ opt.description }}</span>
            </button>
          </div>
          <span class="field-hint">使用阅读感受来选择，不需要记住具体字号。</span>
        </div>

        <div class="field">
          <span class="field-label">主窗口高度</span>
          <div class="option-card-grid">
            <button v-for="opt in mainWindowHeightOptions" :key="opt.value" type="button" class="option-card"
              :class="{ active: settings.mainWindowHeightPreset === opt.value }"
              :aria-pressed="settings.mainWindowHeightPreset === opt.value"
              @click="setMainWindowHeightPreset(opt.value)">
              <strong>{{ opt.label }}</strong>
              <span>{{ opt.description }}</span>
            </button>
          </div>
          <span class="field-hint">uTools 主窗口当前支持调整展开高度；主窗口宽度和屏幕位置由 uTools 管理。</span>
        </div>

        <div class="field">
          <span class="field-label">便签窗口宽度</span>
          <div class="option-card-grid">
            <button v-for="opt in stickyWindowWidthOptions" :key="opt.value" type="button" class="option-card"
              :class="{ active: settings.stickyWindowWidthPreset === opt.value }"
              :aria-pressed="settings.stickyWindowWidthPreset === opt.value"
              @click="setStickyWindowWidthPreset(opt.value)">
              <strong>{{ opt.label }}</strong>
              <span>{{ opt.description }}</span>
            </button>
          </div>
          <span class="field-hint">这里调节便签独立窗口宽度；不需要输入具体像素。</span>
        </div>

        <div class="field">
          <span class="field-label">便签窗口高度</span>
          <div class="option-card-grid">
            <button v-for="opt in stickyWindowHeightOptions" :key="opt.value" type="button" class="option-card"
              :class="{ active: settings.stickyWindowHeightPreset === opt.value }"
              :aria-pressed="settings.stickyWindowHeightPreset === opt.value"
              @click="setStickyWindowHeightPreset(opt.value)">
              <strong>{{ opt.label }}</strong>
              <span>{{ opt.description }}</span>
            </button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">便签出现位置</span>
          <div class="option-card-grid option-card-grid--positions">
            <button v-for="opt in stickyWindowPositionOptions" :key="opt.value" type="button" class="option-card"
              :class="{ active: settings.stickyWindowPositionPreset === opt.value }"
              :aria-pressed="settings.stickyWindowPositionPreset === opt.value"
              @click="setStickyWindowPositionPreset(opt.value)">
              <strong>{{ opt.label }}</strong>
              <span>{{ opt.description }}</span>
            </button>
          </div>
          <span class="field-hint">“智能”会在鼠标所在屏幕的右上角打开，适合多屏使用。</span>
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
        <span class="field-hint">提醒会在插件窗口打开时实时检查；关闭窗口期间错过的提醒会在下次进入时补报。</span>

        <label class="field">
          <span class="field-label">番茄钟时长（分钟）</span>
          <input type="number" min="1" max="240" step="1" :value="settings.pomodoroMinutes"
            @change="handlePomodoroMinutesChange" />
        </label>
      </div>

      <div class="section-divider"></div>

      <!-- 数据 -->
      <div class="section">
        <h3 class="section-title">数据</h3>
        <div class="data-actions">
          <button type="button" class="btn-ghost" @click="handleExport">导出任务</button>
          <button type="button" class="btn-ghost" @click="handleImport">导入任务</button>
          <button type="button" class="btn-ghost" @click="handleRestoreBackup">恢复最近备份</button>
        </div>
        <div class="sync-boundary-note">
          <strong>多设备边界</strong>
          <span>当前数据依赖 uTools 本地存储与云同步，适合个人多设备使用；不提供团队权限、冲突合并或审计记录。</span>
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

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
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

  .option-card-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .option-card-grid--positions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .option-card {
    display: grid;
    gap: 2px;
    padding: var(--space-2);
    text-align: left;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
  }

  .option-card:hover {
    border-color: var(--color-border-strong);
    background: var(--color-bg-hover);
  }

  .option-card.active {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 24%, transparent);
  }

  .option-card strong {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .option-card span {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
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

  .sync-boundary-note {
    display: grid;
    gap: 4px;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .sync-boundary-note strong {
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
</style>
