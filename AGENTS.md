# 简悦清单 - uTools 插件开发指南

## 项目概述

**简悦清单** 是一个 uTools 插件，提供强大的 TODO 任务管理功能。支持多种视图（看板、四象限、日历、列表）、智能搜索、任务分组、优先级管理和 Markdown 描述等功能。

- **技术栈**：Vue 3 + TypeScript + Vite
- **数据存储**：uTools 本地数据库 + 云同步
- **开发环境**：Node.js + Vite dev server (localhost:5173)

## 架构概览

### 项目结构

```
src/
├── App.vue              # 路由入口，处理 utools 插件生命周期
├── main.ts              # Vue 应用初始化
├── main.css             # 全局样式
├── Hello/               # 示例功能模块
├── Read/                # 示例文件读取模块
└── Write/               # 示例文件写入模块

public/
├── plugin.json          # uTools 插件配置文件（功能指令定义）
└── preload/
    └── services.js      # Node.js 预加载脚本，访问系统能力

index.html              # HTML 入口
vite.config.ts          # Vite 配置
tsconfig.json           # TypeScript 配置
```

### 核心模块设计

1. **主要功能模块**（`src/*/index.vue`）
   - 每个功能对应 `plugin.json` 中的一个 `code`
   - 通过 `App.vue` 中的路由逻辑按需加载

2. **数据管理**
   - 使用 `utools.dbStorage` 或 `utools.db` 处理数据持久化
   - 支持离线优先，自动云同步（由 uTools 框架管理）

3. **uTools 生命周期**
   - `window.utools.onPluginEnter()` - 插件启动入口
   - `window.utools.onPluginOut()` - 插件退出处理

## 开发工作流

### 启动开发

```bash
# 1. 仅检查编译（推荐）- 无需启动 dev server
npm run build

# 2. 如需查看浏览器效果，访问
# http://localhost:5173
# （Vite dev server 会自动启动，无需手动命令）

# 3. 类型检查
npm run type-check
```

**注意**：不要使用 `npm run dev`。Vite 会自动监听文件变更。

### 新增功能指令

编辑 `public/plugin.json`：

```json
{
  "features": [
    {
      "code": "kanban",          // 功能代码（唯一）
      "explain": "看板视图",      // 功能说明
      "cmds": ["看板", "kanban"]  // 匹配指令
    }
  ]
}
```

对应在 `src/Kanban/index.vue` 创建组件，在 `App.vue` 中添加路由分支。

## uTools API 核心指南

### 数据存储（必读）

```typescript
// 写入数据
utools.dbStorage.setItem('todos', JSON.stringify(todoArray));

// 读取数据
const todos = JSON.parse(utools.dbStorage.getItem('todos') || '[]');

// 删除数据
utools.dbStorage.removeItem('todos');
```

**数据同步**：uTools 框架自动处理，无需手动配置。

### 窗口 API

```typescript
// 获取窗口信息
const width = utools.getWindowWidth();
const height = utools.getWindowHeight();

// 隐藏/显示窗口
utools.hide(); // 关闭插件窗口
utools.show(); // 显示插件窗口
```

### 系统通知

```typescript
// 显示通知
utools.showNotification({
  title: '任务完成',
  body: '新建任务已保存'
});
```

### 复制/粘贴

```typescript
// 复制文本到剪贴板
utools.copyText('Hello World');

// 获取剪贴板内容
utools.readText().then(text => console.log(text));
```

### AI 能力（如需集成）

```typescript
utools.ai.chat([
  { role: 'user', content: '总结这个任务列表' }
]).then(response => {
  console.log(response.content);
});
```

详见 [uTools 官方文档](https://www.u-tools.cn/docs/developer/api-reference/utools/)。

## 任务管理功能设计建议

### 数据模型

```typescript
interface Task {
  id: string;                    // 唯一标识
  title: string;                 // 任务名称
  description: string;           // Markdown 格式描述
  status: 'todo' | 'doing' | 'done'; // 任务状态
  priority: 'low' | 'medium' | 'high'; // 优先级
  tags: string[];               // 标签数组
  group: string;                // 分组/项目
  dueDate?: number;             // 截止日期（时间戳）
  createdAt: number;            // 创建时间
  updatedAt: number;            // 更新时间
  subtasks: Subtask[];          // 子任务
  visible: boolean;             // 是否显示
}

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}
```

### 视图实现

- **看板视图**：按状态列组织卡片（Kanban Board）
- **四象限视图**：按优先级和时间紧迫度分类（Eisenhower Matrix）
- **日历视图**：按 dueDate 在日历上展示
- **列表视图**：表格形式，支持排序和筛选

### 搜索和筛选

建议创建搜索服务处理：
- 标题/内容模糊匹配
- 标签精确匹配
- 日期范围筛选
- 优先级过滤
- 分组筛选
- 状态过滤

## 代码规范

### TypeScript

- 启用 `strict: true`，所有代码必须完全类型化
- 使用接口定义数据结构，避免 `any`
- 为 utools API 使用 `utools-api-types` 类型包

### Vue 3 + Composition API

- 优先使用 `<script setup lang="ts">` 语法
- 使用 ref 和 computed 管理响应式状态
- 组件命名采用 PascalCase，文件名采用 kebab-case

### 文件组织

```
src/
├── components/         # 可复用组件
├── views/             # 各视图模块（Hello、Read、Write 之类）
├── stores/            # 状态管理（如需）
├── services/          # 业务逻辑服务
├── types/             # TypeScript 类型定义
└── utils/             # 工具函数
```

## 常见开发任务

### 添加新视图

1. 在 `public/plugin.json` 中添加功能指令
2. 创建 `src/ViewName/index.vue` 组件
3. 在 `App.vue` 路由分支中添加条件渲染
4. 实现视图逻辑和数据绑定

### 处理数据持久化

```typescript
// 在组件中
const saveTask = (task: Task) => {
  const tasks = JSON.parse(utools.dbStorage.getItem('tasks') || '[]');
  tasks.push(task);
  utools.dbStorage.setItem('tasks', JSON.stringify(tasks));
};
```

### 调试

- 浏览器控制台：访问 http://localhost:5173 在 DevTools 中调试
- Vite 热更新：编辑文件自动刷新
- 类型检查：`npm run type-check` 捕获 TS 错误

## 关键注意事项

1. **不要在 Vue 组件中直接访问 window.utools 而不先检查存在性**
   ```typescript
   // ✅ 正确
   if (window.utools) {
     window.utools.onPluginEnter(...);
   }

   // ❌ 避免
   window.utools.onPluginEnter(...); // 开发时可能未定义
   ```

2. **JSON 序列化**：uTools 数据库存储需要 JSON 序列化
   ```typescript
   utools.dbStorage.setItem('key', JSON.stringify(data));
   const data = JSON.parse(utools.dbStorage.getItem('key') || '{}');
   ```

3. **性能**：频繁读写数据库可能影响性能，使用缓存或批量操作
   ```typescript
   // ❌ 避免在循环中频繁写入
   tasks.forEach(t => utools.dbStorage.setItem(`task-${t.id}`, ...));

   // ✅ 批量写入
   utools.dbStorage.setItem('tasks', JSON.stringify(tasks));
   ```

4. **类型安全**：始终为 `utools` 全局对象提供类型
   ```typescript
   declare global {
     interface Window {
       utools: any; // 或使用 utools-api-types 的具体类型
     }
   }
   ```

## 相关资源

- [uTools 官方文档](https://www.u-tools.cn/docs/)
- [uTools API 参考](https://www.u-tools.cn/docs/developer/api-reference/)
- [Vue 3 文档](https://vuejs.org/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Vite 文档](https://vitejs.dev/)

## 问题排查

| 问题                              | 解决方案                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| 类型错误：`utools is not defined` | 检查 `tsconfig.json` 中是否包含 `utools-api-types`，或在文件顶部声明全局类型 |
| 数据不同步                        | 确保数据以 JSON 字符串格式存储，检查 uTools 云同步设置                       |
| Vite 不更新                       | 检查 `vite.config.ts` 配置，确认文件变更被监听                               |
| 插件不显示功能                    | 验证 `plugin.json` 语法正确，重启 uTools 应用                                |

---

**最后更新**：2026-04-28
