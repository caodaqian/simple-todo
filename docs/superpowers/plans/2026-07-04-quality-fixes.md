# 待办插件质量修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三个阻碍插件"合格"的核心问题：urgent 类型、CalendarView 数据流孤立、提醒/重复任务 UI 缺失。

**Architecture:** 
1. Task 1：把 `'urgent'` 加入 `TaskPriority` 并在所有类型声明处对齐，消除 5 处类型错误；
2. Task 2：CalendarView 改为从 prop 接收 `tasks`，与其他三个视图对齐；
3. Task 3：TaskEditor 侧栏补充提醒（reminderOffset）和重复规则（repeat）两个 side-card。

**Tech Stack:** Vue 3 + TypeScript, Vite, Vitest, utools-api-types

## Global Constraints

- `strict: true` + `exactOptionalPropertyTypes: true` — 所有可选字段赋值须条件展开
- CSS 变量体系：只用 `--color-*` / `--space-*` / `--text-*` canonical tokens，不用 legacy 别名
- 不新增外部依赖
- `npm run type-check` 通过，`npx vitest run` 全绿后方可完成
- 代码风格跟随项目：`<script setup lang="ts">` + 2-space indent（实际观察到 2-space）

---

## Task 1：urgent 加入 TaskPriority 类型

**Files:**
- Modify: `src/types/task.ts` (L3)
- Modify: `src/services/searchService.ts` (PRIORITY_RANK)
- Modify: `src/components/TaskCard.vue` (priorityClass 函数)
- Modify: `src/components/TaskEditor.vue` (priorityOptions 数组)
- Modify: `src/services/templateService.ts` (priority fallback 逻辑)
- Test: `src/services/searchService.test.ts` (新增 urgent 排序测试)

**Interfaces:**
- 产出：`TaskPriority = 'low' | 'medium' | 'high' | 'urgent'`，供所有下游消费

- [ ] **Step 1：修改 task.ts 类型定义**

文件：`src/types/task.ts` 第 3 行

```typescript
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
```

- [ ] **Step 2：修改 searchService.ts PRIORITY_RANK**

文件：`src/services/searchService.ts`，把 `PRIORITY_RANK` 增加 urgent。

```typescript
const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};
```

- [ ] **Step 3：修改 TaskCard.vue priorityClass**

文件：`src/components/TaskCard.vue`，`priorityClass` 函数签名与返回值。

```typescript
function priorityClass(p: TaskPriority): 'high' | 'medium' | 'low' | 'urgent' {
  return p;
}
```

- [ ] **Step 4：TaskEditor.vue 优先级选项补充 urgent**

文件：`src/components/TaskEditor.vue`，`priorityOptions` 数组：

```typescript
const priorityOptions: Array<{ label: string; value: TaskPriority }> = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '紧急', value: 'urgent' },
];
```

- [ ] **Step 5：templateService.ts priority 校验逻辑**

文件：`src/services/templateService.ts`，找到 priority 的 fallback/校验（isTodoPriority 已包含 urgent，但 templateService 直接比较字符串的地方需同步）。

搜索 `templateService.ts` 中 `priority` 的 fallback：若有 `=== 'low' || ...` 手写校验，补充 `urgent`；若调用的是 `isTodoPriority()`（来自 filterUtils.ts），则此处无需改动——filterUtils 已包含 urgent。

验证方式：`npm run type-check` 看 templateService.ts 有无新错误。

- [ ] **Step 6：运行 type-check 确认 0 个 urgent 错误**

```bash
cd /Users/cdq/Project/简悦清单 && npm run type-check 2>&1 | grep -i urgent
```

期望：无输出（无 urgent 相关报错）。

- [ ] **Step 7：补充 searchService 排序测试**

文件：`src/services/searchService.test.ts`，在排序测试区块添加：

```typescript
it('按优先级 desc 排序：urgent > high > medium > low', () => {
  const tasks = [
    makeTask({ priority: 'low' }),
    makeTask({ priority: 'urgent' }),
    makeTask({ priority: 'medium' }),
    makeTask({ priority: 'high' }),
  ];
  const result = searchAndSortTasks(tasks, {}, { field: 'priority', order: 'desc' });
  expect(result.map(t => t.priority)).toEqual(['urgent', 'high', 'medium', 'low']);
});
```

- [ ] **Step 8：运行测试确认全绿**

```bash
cd /Users/cdq/Project/简悦清单 && npx vitest run 2>&1 | tail -20
```

期望：所有测试 PASS，无 FAIL。

- [ ] **Step 9：git commit**

```bash
cd /Users/cdq/Project/简悦清单 && git add src/types/task.ts src/services/searchService.ts src/components/TaskCard.vue src/components/TaskEditor.vue src/services/templateService.ts src/services/searchService.test.ts
git commit -m "fix: add 'urgent' to TaskPriority type, align all usages"
```

---

## Task 2：CalendarView 对齐 tasks prop 数据流

**Files:**
- Modify: `src/views/CalendarView/index.vue` — 删除本地 tasks ref 及独立 reloadTasks，改为接收 `tasks` prop
- Test: 无独立测试（集成视图，靠 type-check 验证）

**Interfaces:**
- 消费：`props.tasks: Task[]`（来自 TodoHub，与 KanbanView/ListView/EisenhowerView 一致）
- 产出：`emit('refresh')` 通知 TodoHub 刷新（保持不变）

- [ ] **Step 1：修改 CalendarView props**

文件：`src/views/CalendarView/index.vue`

在 `defineProps` 中新增 `tasks: Task[]`：

```typescript
const props = defineProps<{
  tasks: Task[];
  filter?: TaskSearchFilter;
}>();
```

- [ ] **Step 2：删除本地 tasks ref 和 reloadTasks**

删除以下代码：
```typescript
const tasks = ref<Task[]>([]);
// ...
const reloadTasks = (): void => { tasks.value = taskService.getAll(); };
```

- [ ] **Step 3：filteredTasks 改用 props.tasks**

```typescript
const filteredTasks = computed(() =>
  searchAndSortTasks(props.tasks, { ...props.filter }, { field: 'dueDate', order: 'asc' }),
);
```

- [ ] **Step 4：删除 watch(filter) 和 onMounted(reloadTasks)**

删除：
```typescript
watch(() => props.filter, () => reloadTasks(), { deep: true });
onMounted(() => { reloadTasks(); goToday(); });
```

改为（只保留 goToday）：
```typescript
onMounted(() => { goToday(); });
```

- [ ] **Step 5：handleStatusChange / handleSaved / handleQuickCreate 内的 reloadTasks() 调用删除**

这些方法原本调 `reloadTasks()` 后才 `emit('refresh')`。现在 tasks 来自 prop，emit('refresh') 后 TodoHub 的 loadTasks 会刷新 prop，无需本地重载。

```typescript
const handleStatusChange = (taskId: string, status: TaskStatus): void => {
  taskService.changeStatus(taskId, status);
  emit('refresh');
};

const handleQuickCreate = (payload: CreateTaskInput): void => {
  taskService.create(payload);
  emit('refresh');
};

const handleSaved = (): void => { emit('refresh'); };
```

- [ ] **Step 6：删除不再需要的 taskService import（若其他引用也被删除）**

检查 CalendarView 是否仍在使用 `taskService`（handleStatusChange 和 handleQuickCreate 仍需）。若仍需，保留 import；否则删除。

- [ ] **Step 7：删除不再需要的 onMounted 的 import（若 onMounted 只剩 goToday 的话，保留 onMounted）**

CalendarView 的 `watch` import 也需检查是否还有其他 watch（如 filter watch 已删）。若无，从 import 中移除 `watch`。

- [ ] **Step 8：type-check 验证**

```bash
cd /Users/cdq/Project/简悦清单 && npm run type-check 2>&1 | grep -i "CalendarView\|calendar"
```

期望：无新增错误。

- [ ] **Step 9：git commit**

```bash
cd /Users/cdq/Project/简悦清单 && git add src/views/CalendarView/index.vue
git commit -m "refactor: CalendarView receive tasks as prop (single source of truth)"
```

---

## Task 3：TaskEditor 补充提醒与重复规则 UI

**Files:**
- Modify: `src/components/TaskEditor.vue` — 新增 `TaskEditorForm` 字段 + side-card 两个 + buildSavePayload/resetForm 同步 + formSnapshot 同步
- Modify: `src/types/task.ts` — 无需改（RepeatRule 等已存在）

**Interfaces:**
- 消费：`taskService.saveTask(payload: SaveTaskInput)` 已支持 `reminderOffset` 和 `repeat`
- 产出：TaskEditor form 包含 `reminderOffset?: number`（分钟数）和 `repeat` 字段

### 3A：提醒偏移（reminderOffset）UI

- [ ] **Step 1：TaskEditorForm 新增 reminderOffset 字段**

文件：`src/components/TaskEditor.vue`，`TaskEditorForm` 接口末尾追加：

```typescript
interface TaskEditorForm {
  // ... 原有字段
  reminderOffset: number | null; // null = 不设提醒；正整数 = 提前 N 分钟
}
```

- [ ] **Step 2：makeEmptyForm 追加默认值**

```typescript
function makeEmptyForm(): TaskEditorForm {
  return {
    // ... 原有字段
    reminderOffset: null,
  };
}
```

- [ ] **Step 3：resetForm 从 task 读取 reminderOffset**

在 `resetForm` 的 `if (task)` 分支中追加：

```typescript
form.value = {
  // ... 原有字段
  reminderOffset: task.reminderOffset !== undefined ? task.reminderOffset : null,
};
```

在 `else` 分支已由 `makeEmptyForm()` 覆盖，无需额外改动。

- [ ] **Step 4：buildSavePayload 写入 reminderOffset**

在 `buildSavePayload()` 的 `payload` 构建中追加：

```typescript
if (form.value.reminderOffset !== null && form.value.reminderOffset >= 0) {
  payload.reminderOffset = form.value.reminderOffset;
}
```

（不要用 `payload.reminderOffset = form.value.reminderOffset ?? undefined`，在 `exactOptionalPropertyTypes` 下会报错，用条件写入。）

- [ ] **Step 5：formSnapshot 中加入 reminderOffset**

```typescript
function formSnapshot(): string {
  const f = form.value;
  return JSON.stringify({
    // ...原有字段
    reminderOffset: f.reminderOffset,
  });
}
```

- [ ] **Step 6：在模板侧栏 due-card 下方新增 reminder-card**

在 `<section class="side-card due-card">` 之后添加：

```html
<section class="side-card reminder-card">
  <div class="section-heading compact">
    <div>
      <p class="section-kicker">提醒</p>
      <h3>提前提醒</h3>
    </div>
  </div>

  <div class="field-block">
    <span class="field-label">提前时间</span>
    <div class="reminder-select-row">
      <select
        :value="form.reminderOffset ?? ''"
        class="reminder-select"
        @change="form.reminderOffset = ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value)"
      >
        <option value="">不提醒</option>
        <option value="0">准时</option>
        <option value="5">提前 5 分钟</option>
        <option value="15">提前 15 分钟</option>
        <option value="30">提前 30 分钟</option>
        <option value="60">提前 1 小时</option>
        <option value="120">提前 2 小时</option>
        <option value="1440">提前 1 天</option>
      </select>
    </div>
    <p v-if="!form.hasDue" class="field-hint">需先设置截止时间</p>
  </div>
</section>
```

### 3B：重复规则（repeat）UI

- [ ] **Step 7：TaskEditorForm 新增 repeat 相关字段**

```typescript
interface TaskEditorForm {
  // ... 原有字段 + reminderOffset
  repeatType: '' | 'daily' | 'weekly' | 'monthly' | 'custom'; // '' = 不重复
  repeatInterval: number;   // 间隔数值
  repeatUntilDate: string;  // YYYY-MM-DD，空=不限制
}
```

- [ ] **Step 8：makeEmptyForm 追加默认值**

```typescript
function makeEmptyForm(): TaskEditorForm {
  return {
    // ... 原有字段
    reminderOffset: null,
    repeatType: '',
    repeatInterval: 1,
    repeatUntilDate: '',
  };
}
```

- [ ] **Step 9：resetForm 从 task 读取 repeat**

```typescript
if (task) {
  // ... 原有字段
  const r = task.repeat;
  form.value = {
    // ... 原有字段
    reminderOffset: task.reminderOffset !== undefined ? task.reminderOffset : null,
    repeatType: r ? r.type : '',
    repeatInterval: r ? r.interval : 1,
    repeatUntilDate: r?.repeatUntil ? formatDateInput(r.repeatUntil) : '',
  };
}
```

- [ ] **Step 10：buildSavePayload 写入 repeat**

```typescript
if (form.value.repeatType) {
  const rule: RepeatRule = {
    type: form.value.repeatType,
    interval: form.value.repeatInterval > 0 ? form.value.repeatInterval : 1,
  };
  if (form.value.repeatUntilDate) {
    const ts = dateInputToTimestamp(form.value.repeatUntilDate);
    if (!Number.isNaN(ts)) rule.repeatUntil = ts;
  }
  payload.repeat = rule;
}
```

注意在 `buildSavePayload` 中 import `RepeatRule` 已在 `SaveTaskInput` 类型里，无需新增 import，但需要在 script 顶部确认 `RepeatRule` 已从 `../types/task` 导入（若没有则加上）。

- [ ] **Step 11：formSnapshot 中加入 repeat 字段**

```typescript
function formSnapshot(): string {
  const f = form.value;
  return JSON.stringify({
    // ...原有字段
    reminderOffset: f.reminderOffset,
    repeatType: f.repeatType,
    repeatInterval: f.repeatInterval,
    repeatUntilDate: f.repeatUntilDate,
  });
}
```

- [ ] **Step 12：在模板中 reminder-card 下方新增 repeat-card**

在 reminder-card 之后添加：

```html
<section class="side-card repeat-card">
  <div class="section-heading compact">
    <div>
      <p class="section-kicker">重复</p>
      <h3>重复规则</h3>
    </div>
  </div>

  <div class="field-block">
    <span class="field-label">重复方式</span>
    <select v-model="form.repeatType" class="repeat-type-select">
      <option value="">不重复</option>
      <option value="daily">每天</option>
      <option value="weekly">每周</option>
      <option value="monthly">每月</option>
      <option value="custom">自定义间隔</option>
    </select>
  </div>

  <template v-if="form.repeatType">
    <div v-if="form.repeatType === 'custom'" class="field-block">
      <span class="field-label">间隔天数</span>
      <input
        v-model.number="form.repeatInterval"
        type="number"
        min="1"
        max="365"
        class="interval-input"
        placeholder="1"
      />
    </div>

    <div class="field-block">
      <span class="field-label">结束日期 <span class="field-hint-inline">（选填）</span></span>
      <input
        v-model="form.repeatUntilDate"
        type="date"
        class="due-input"
        aria-label="重复结束日期"
      />
    </div>
    <p class="field-hint repeat-hint">
      完成任务后自动生成下一个实例
    </p>
  </template>
</section>
```

### 3C：样式补充

- [ ] **Step 13：在 TaskEditor `<style scoped>` 中添加提醒和重复卡片样式**

在 `<style scoped>` 末尾（TaskEditor.vue 的 `</style>` 之前）追加：

```css
/* ── 提醒 & 重复 cards ─────────────────────────────── */
.reminder-select-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.reminder-select,
.repeat-type-select,
.interval-input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  min-height: 34px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  font-size: var(--text-sm);
}

.interval-input {
  max-width: 80px;
}

.field-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.field-hint-inline {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: normal;
}

.repeat-hint {
  margin-top: var(--space-1);
}
```

### 3D：验证

- [ ] **Step 14：type-check**

```bash
cd /Users/cdq/Project/简悦清单 && npm run type-check 2>&1 | tail -30
```

期望：0 errors（或仅有原有的已知遗留错误，但 urgent 已修复后应为 0）。

- [ ] **Step 15：运行全部测试**

```bash
cd /Users/cdq/Project/简悦清单 && npx vitest run 2>&1 | tail -20
```

期望：全部 PASS。

- [ ] **Step 16：git commit**

```bash
cd /Users/cdq/Project/简悦清单 && git add src/components/TaskEditor.vue
git commit -m "feat: add reminder offset and repeat rule UI in TaskEditor"
```

---

## Self-Review

### Spec Coverage

| 问题 | 任务 |
|------|------|
| urgent 类型缺失（5 处 TS 错误） | Task 1 |
| CalendarView 数据流孤立 | Task 2 |
| 提醒/重复无 UI | Task 3 |

### 潜在风险点

- Task 1 Step 5：templateService.ts 的 priority 校验需人工核验，若有硬编码字符串比较则需同步。
- Task 3 Step 10：`payload.repeat = rule` 在 `exactOptionalPropertyTypes` 下直接赋值是合法的（字段存在时赋值，否则不赋值），但若 `SaveTaskInput.repeat` 的类型是 `RepeatRule | undefined`，则需注意不能显式赋 `undefined`——本步骤仅在 `repeatType` 非空时才写入，语义正确。
- Task 2 删除 `watch` + `onMounted` 后，需确认 `watch` 和 `onMounted` 的 import 仍被其他地方使用；若 `onMounted` 仍被 `goToday` 需要则保留，`watch` 如无其他 watch 则删除。
