const fs = require('node:fs')
const path = require('node:path')
const {
  STORAGE_KEY,
  readTasksFromDb: readTasksFromDbPure,
  writeTasksToDb: writeTasksToDbPure,
  createTaskHandler,
  listTasksHandler,
  completeTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
  addSubtaskHandler,
  updateSubtaskHandler,
  deleteSubtaskHandler,
  searchTasksHandler,
  taskOverviewHandler,
  listTagsHandler,
  listGroupsHandler,
  exportTasksHandler,
  importTasksHandler,
  getTaskHandler,
  getSettingsHandler,
  renderMarkdownHandler,
  bulkUpdateHandler,
  notifyHandler,
  createTemplateHandler,
  listTemplatesHandler,
  deleteTemplateHandler,
  applyTemplateHandler,
  setReminderHandler,
  snoozeReminderHandler,
  dismissReminderHandler,
  listDueRemindersHandler,
} = require('./toolHandlers')

// marked is used by the todo_render_markdown MCP tool. preload is a Node
// CommonJS environment, so require() works. The handler does not perform
// XSS sanitization (no DOMPurify in Node); consumers must sanitize if they
// render the returned HTML in a browser context.
let markedRenderer = null
try {
  markedRenderer = require('marked').marked
} catch {
  markedRenderer = null
}

// ── dbStorage accessor ────────────────────────────────────────────────
function db() {
  return window.utools.dbStorage
}

function readTasksFromDb() {
  return readTasksFromDbPure(db())
}

function writeTasksToDb(tasks) {
  return writeTasksToDbPure(db(), tasks)
}

// Notify renderer that task store changed so it can refresh.
function notifyTasksChanged() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jianyue:tasks-changed'))
    }
  } catch {
    /* ignore — notification is best-effort */
  }
}

// Wrap a write-tool so it notifies the renderer on success.
function withNotify(handler) {
  return async function (params) {
    const result = handler(db(), params)
    notifyTasksChanged()
    return result
  }
}

// ── window.services (file/node capabilities) ─────────────────────────
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  // 导出所有任务为 JSON 文件
  exportTasks() {
    const tasks = readTasksFromDb()
    const filePath = path.join(window.utools.getPath('downloads'), 'jianyue-tasks-' + Date.now() + '.json')
    fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), { encoding: 'utf-8' })
    return { filePath, count: tasks.length }
  },
  // 从 JSON 文件导入任务
  importTasks(filePath) {
    const raw = fs.readFileSync(filePath, { encoding: 'utf-8' })
    const imported = JSON.parse(raw)
    if (!Array.isArray(imported)) {
      throw new Error('导入文件格式错误：期望 JSON 数组')
    }
    const existing = readTasksFromDb()
    const existingIds = new Set(existing.map(function (t) { return t.id }))
    let added = 0
    for (const item of imported) {
      if (item && item.id && !existingIds.has(item.id)) {
        existing.push(item)
        existingIds.add(item.id)
        added++
      }
    }
    writeTasksToDb(existing)
    notifyTasksChanged()
    return { added, total: existing.length }
  },
  __STORAGE_KEY__: STORAGE_KEY,
}

// ── MCP Tool Registration ─────────────────────────────────────────────
// Must be at top level, NOT inside onPluginEnter (AI Agent calls don't trigger onPluginEnter)
// All tools use the `todo_` prefix to avoid collisions with other plugins' MCP tools.
window.utools.registerTool('todo_create_task', withNotify(createTaskHandler))
window.utools.registerTool('todo_list_tasks', async function (params) {
  return listTasksHandler(db(), params)
})
window.utools.registerTool('todo_complete_task', withNotify(completeTaskHandler))
window.utools.registerTool('todo_update_task', withNotify(updateTaskHandler))
window.utools.registerTool('todo_delete_task', withNotify(deleteTaskHandler))

// Subtasks
window.utools.registerTool('todo_add_subtask', withNotify(addSubtaskHandler))
window.utools.registerTool('todo_update_subtask', withNotify(updateSubtaskHandler))
window.utools.registerTool('todo_delete_subtask', withNotify(deleteSubtaskHandler))

// Search / overview / enumeration (read-only)
window.utools.registerTool('todo_search_tasks', async function (params) {
  return searchTasksHandler(db(), params)
})
window.utools.registerTool('todo_get_overview', async function (params) {
  return taskOverviewHandler(db(), params)
})
window.utools.registerTool('todo_list_tags', async function () {
  return listTagsHandler(db())
})
window.utools.registerTool('todo_list_groups', async function () {
  return listGroupsHandler(db())
})

// Single task detail + settings + markdown (read-only)
window.utools.registerTool('todo_get_task', async function (params) {
  return getTaskHandler(db(), params)
})
window.utools.registerTool('todo_get_settings', async function () {
  return getSettingsHandler(db())
})
window.utools.registerTool('todo_render_markdown', async function (params) {
  if (!markedRenderer) throw new Error('marked 渲染器未安装')
  return renderMarkdownHandler(params, { render: markedRenderer })
})

// Export / import (file IO via fs + downloads dir)
window.utools.registerTool('todo_export_tasks', withNotify(function (params) {
  return exportTasksHandler(params, {
    fs: fs,
    path: path,
    downloadsDir: window.utools.getPath('downloads'),
    readTasks: readTasksFromDb,
  })
}))
window.utools.registerTool('todo_import_tasks', withNotify(function (params) {
  return importTasksHandler(params, {
    fs: fs,
    readTasks: readTasksFromDb,
    saveTasks: writeTasksToDb,
  })
}))

// Bulk update (write, capped at 100 ids)
window.utools.registerTool('todo_bulk_update', withNotify(bulkUpdateHandler))

// Notify (system notification, respects notifyEnabled setting)
window.utools.registerTool('todo_notify', async function (params) {
  return notifyHandler(params, {
    showNotification: window.utools.showNotification.bind(window.utools),
    settingsDb: db(),
  })
})

// Templates (independent storage in jianyue.templates)
window.utools.registerTool('todo_create_template', withNotify(function (params) {
  return createTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_list_templates', async function () {
  return listTemplatesHandler(db())
})
window.utools.registerTool('todo_delete_template', withNotify(function (params) {
  return deleteTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_apply_template', withNotify(function (params) {
  return applyTemplateHandler(db(), params)
}))

// Reminder management (write tools, refresh views)
window.utools.registerTool('todo_set_reminder', withNotify(setReminderHandler))
window.utools.registerTool('todo_snooze_reminder', withNotify(snoozeReminderHandler))
window.utools.registerTool('todo_dismiss_reminder', withNotify(dismissReminderHandler))

// Due reminders query (read-only)
window.utools.registerTool('todo_list_due_reminders', async function (params) {
  return listDueRemindersHandler(db(), params)
})
