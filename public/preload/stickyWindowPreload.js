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

function navigateToApp(payload) {
	if (!payload || typeof payload.appUrl !== 'string' || payload.appUrl.length === 0) return
	if (window.location.href === payload.appUrl) return
	window.location.replace(payload.appUrl)
}

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
