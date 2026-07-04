# Copilot Instructions - 简悦清单 uTools 插件

## 快速参考

**项目**：简悦清单 - Vue 3 + TypeScript + Vite uTools 插件

**栈**：
- 前端：Vue 3 (Composition API) + TypeScript
- 构建：Vite (dev: localhost:5173)
- 存储：uTools dbStorage (自动云同步)
- 类型：utools-api-types

**关键文件**：
- `public/plugin.json` - 功能指令定义
- `src/App.vue` - 路由入口和生命周期处理
- `src/types/task.ts` - 任务数据模型
- `src/services/taskService.ts` - 任务 CRUD 操作
- `src/views/` - 各视图实现

## 开发命令

```bash
# 类型检查（推荐）
npm run type-check

# 生产构建
npm run build

# 访问浏览器
# http://localhost:5173 (Vite 自动启动)
```

**重要**：不要使用 `npm run dev`。

## uTools API 速查

```typescript
// 数据存储
utools.dbStorage.getItem('key');
utools.dbStorage.setItem('key', JSON.stringify(data));
utools.dbStorage.removeItem('key');

// 窗口
utools.hide(); utools.show();
utools.getWindowWidth(); utools.getWindowHeight();

// 通知
utools.showNotification({ title: '...', body: '...' });

// 剪贴板
utools.copyText('text');
utools.readText();

// 插件生命周期（App.vue）
window.utools.onPluginEnter((action) => { ... });
window.utools.onPluginOut(() => { ... });
```

## 架构规范

- **功能模块**：每个 `plugin.json` 功能对应 `src/ViewName/index.vue`
- **数据服务**：所有数据操作通过 `TaskService` 进行
- **类型安全**：所有代码必须完全类型化，启用 `strict: true`
- **文件结构**：按功能分模块，组件/服务/类型/工具分离

## 任务管理功能

详见 `.vscode/task-management.md` 以获得完整的实现指南。

关键接口：
```typescript
interface Task {
  id: string; title: string; description: string;
  status: 'todo' | 'doing' | 'done'; priority: 'low' | 'medium' | 'high';
  tags: string[]; group: string; dueDate?: number;
  createdAt: number; updatedAt: number;
  subtasks: Subtask[]; visible: boolean;
}
```

核心服务方法：
- `taskService.createTask()` / `updateTask()` / `deleteTask()`
- `taskService.addSubtask()` / `updateSubtask()` / `deleteSubtask()`
- `searchService.filterTasks()` / `sortTasks()`

## 视图实现清单

- ✅ **列表视图**：表格形式，支持排序筛选
- ✅ **看板视图**：按状态分列 (todo | doing | done)
- ✅ **四象限视图**：Eisenhower 矩阵（优先级 × 紧迫度）
- ✅ **日历视图**：按截止日期展示
- ✅ **搜索过滤**：标题/内容/标签/分组/日期范围

## 常见问题

| 问题 | 答案 |
|------|------|
| utools undefined | 检查 `utools-api-types` 在 tsconfig.json 中 |
| 数据不同步 | 确保使用 JSON 字符串存储，uTools 框架自动处理云同步 |
| 性能缓慢 | 避免在循环中频繁调用 dbStorage，使用批量操作 |
| 类型错误 | 启用 `npm run type-check`，修复所有 TS 错误 |

## 相关文档

- 详细指南：[AGENTS.md](../../AGENTS.md)
- 任务管理：[.vscode/task-management.md](.vscode/task-management.md)
- uTools 官方：https://www.u-tools.cn/docs/
- Vue 3：https://vuejs.org/
- TypeScript：https://www.typescriptlang.org/

---

**有问题？**参考 AGENTS.md 的"问题排查"部分或查看完整文档。
