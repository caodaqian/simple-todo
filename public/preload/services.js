const fs = require('node:fs')
const path = require('node:path')
let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch {
  ipcRenderer = null
}
const {
  STORAGE_KEY,
  readTasksFromDb: readTasksFromDbPure,
  writeTasksToDb: writeTasksToDbPure,
  createTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
  searchTasksHandler,
  taskOverviewHandler,
  getTaskHandler,
  bulkUpdateHandler,
  createTemplateHandler,
  listTemplatesHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  applyTemplateHandler,
  snoozeReminderHandler,
  acknowledgeReminderHandler,
  listDueRemindersHandler,
  getReviewHandler,
  suggestOrganizationHandler,
} = require('./toolHandlers')

// ── dbStorage accessor ────────────────────────────────────────────────
let pendingTasksPayload = null

function db() {
  const storage = window.utools.dbStorage
  return {
    getItem(key) {
      if (key === STORAGE_KEY && pendingTasksPayload !== null) {
        const persisted = storage.getItem(key)
        if (persisted === pendingTasksPayload) {
          pendingTasksPayload = null
          return persisted
        }
        return pendingTasksPayload
      }
      return storage.getItem(key)
    },
    setItem(key, value) {
      storage.setItem(key, value)
      if (key === STORAGE_KEY) {
        // uTools 的 dbStorage 偶尔会在 setItem 后短暂返回旧值。立即回读；
        // 未持久化前让后续 MCP 写操作读取本次写入的快照。
        pendingTasksPayload = storage.getItem(key) === value ? null : value
      }
    },
  }
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

if (ipcRenderer) {
  ipcRenderer.on('jianyue:tasks-changed', function () {
    notifyTasksChanged()
  })
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
// Must be at top level, NOT inside onPluginEnter (AI Agent calls don't trigger onPluginEnter).
window.utools.registerTool('todo_create_task', withNotify(createTaskHandler))
window.utools.registerTool('todo_update_task', withNotify(updateTaskHandler))
window.utools.registerTool('todo_delete_task', withNotify(deleteTaskHandler))
window.utools.registerTool('todo_search_tasks', async function (params) {
  return searchTasksHandler(db(), params)
})
window.utools.registerTool('todo_get_task', async function (params) {
  return getTaskHandler(db(), params)
})
window.utools.registerTool('todo_get_overview', async function (params) {
  return taskOverviewHandler(db(), params)
})
window.utools.registerTool('todo_bulk_update', withNotify(bulkUpdateHandler))
window.utools.registerTool('todo_get_review', async function () {
  return getReviewHandler(db())
})
window.utools.registerTool('todo_suggest_organization', async function (params) {
  return suggestOrganizationHandler(db(), params)
})
window.utools.registerTool('todo_create_template', withNotify(function (params) {
  return createTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_list_templates', async function () {
  return listTemplatesHandler(db())
})
window.utools.registerTool('todo_update_template', withNotify(function (params) {
  return updateTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_delete_template', withNotify(function (params) {
  return deleteTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_apply_template', withNotify(function (params) {
  return applyTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_snooze_reminder', withNotify(snoozeReminderHandler))
window.utools.registerTool('todo_acknowledge_reminder', withNotify(acknowledgeReminderHandler))
window.utools.registerTool('todo_list_due_reminders', async function (params) {
  return listDueRemindersHandler(db(), params)
})
