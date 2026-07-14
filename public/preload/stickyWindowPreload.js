let ipcRenderer = null
try {
	ipcRenderer = require('electron').ipcRenderer
} catch {
	ipcRenderer = null
}

const INIT_KEY = 'jianyue.sticky.init'

function safeDispatch(channel, payload) {
	try {
		window.dispatchEvent(new CustomEvent(channel, { detail: payload }))
	} catch {
		/* best effort */
	}
}

function persistInit(payload, eventName) {
	if (!payload || typeof payload !== 'object') return
	try {
		window.sessionStorage.setItem(INIT_KEY, JSON.stringify(payload))
	} catch {
		/* best effort */
	}
	safeDispatch(eventName, payload)
}

// 与 stickyWindowService.getStickyAppUrl 保持一致的 appUrl 计算逻辑。
// 让 preload 自主决定跳转地址，避免依赖主窗口通过 IPC(`window`) 推送 appUrl
// 时，因 preload 尚未注册监听而错过首条消息、使 sticky.html 永久卡在「便签启动中…」。
function computeAppUrl() {
	var protocol = window.location.protocol
	if (protocol === 'http:' || protocol === 'https:') {
		try {
			var url = new URL(window.location.href)
			url.search = '?window=sticky-note'
			url.hash = ''
			return url.toString()
		} catch {
			return ''
		}
	}
	return 'index.html?window=sticky-note'
}

function updateBootMessage(text) {
	try {
		var el = document.getElementById('boot-message')
		if (el && typeof text === 'string' && text.length > 0) el.textContent = text
	} catch {
		/* best effort */
	}
}

function navigateToAppUrl(appUrl) {
	if (!appUrl || typeof appUrl !== 'string' || appUrl.length === 0) return
	if (window.location.href === appUrl) return
	updateBootMessage('正在加载便签…')
	window.location.replace(appUrl)
}

function navigateToApp(payload) {
	if (!payload || typeof payload.appUrl !== 'string' || payload.appUrl.length === 0) return
	navigateToAppUrl(payload.appUrl)
}

// sticky.html 是「跳板页」：preload 一旦运行就主动计算 appUrl 并跳转到 Vue 便签视图，
// 不再等待主窗口的 window IPC（首启时序不可靠）。source 已由 stickyNoteService
// 在打开前持久化到 uTools.dbStorage，Vue 端 StickyNoteWindow 会作为回退读取。
navigateToAppUrl(computeAppUrl())

if (ipcRenderer) {
	ipcRenderer.on('window', function (_event, payload) {
		persistInit(payload, 'jianyue:sticky-window-init')
		navigateToApp(payload)
	})

	ipcRenderer.on('jianyue:sticky-source-updated', function (_event, payload) {
		persistInit(payload, 'jianyue:sticky-source-updated')
		navigateToApp(payload)
	})
}

window.__JIANYUE_STICKY_INIT_KEY__ = INIT_KEY
