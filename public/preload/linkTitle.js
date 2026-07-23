const dns = require('node:dns').promises
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const MAX_RESPONSE_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 2000
const MAX_REDIRECTS = 3

function isPrivateIp(address) {
	const version = net.isIP(address)
	if (version === 4) {
		const parts = address.split('.').map(Number)
		return parts[0] === 10
			|| (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
			|| (parts[0] === 192 && parts[1] === 168)
			|| parts[0] === 127
			|| parts[0] === 0
			|| (parts[0] === 169 && parts[1] === 254)
	}
	if (version === 6) {
		const normalized = address.toLowerCase()
		return normalized === '::1'
			|| normalized === '::'
			|| normalized.startsWith('fc')
			|| normalized.startsWith('fd')
			|| normalized.startsWith('fe8')
			|| normalized.startsWith('fe9')
			|| normalized.startsWith('fea')
			|| normalized.startsWith('feb')
	}
	return true
}

async function isSafePageTitleUrl(value) {
	let url
	try { url = new URL(value) } catch { return false }
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
	if (url.username || url.password) return false
	if (url.port && url.port !== '80' && url.port !== '443') return false
	const hostname = url.hostname.toLowerCase()
	if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || net.isIP(hostname) && isPrivateIp(hostname)) return false
	try {
		const records = await dns.lookup(hostname, { all: true, verbatim: true })
		return records.length > 0 && records.every((record) => !isPrivateIp(record.address))
	} catch {
		return false
	}
}

function normalizeTitle(value) {
	return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function parsePageTitle(html) {
	const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i.exec(html)
	if (!match || !match[1]) return ''
	return normalizeTitle(match[1].replace(/<[^>]*>/g, ''))
}

function requestHtml(urlValue, redirectsLeft) {
	return new Promise((resolve) => {
		let parsed
		try { parsed = new URL(urlValue) } catch { resolve(''); return }
		const client = parsed.protocol === 'https:' ? https : http
		const request = client.get(parsed, {
			headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'JianYueTodo/1.0' },
		}, (response) => {
			if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirectsLeft > 0) {
				response.resume()
				const next = new URL(response.headers.location, parsed).href
				isSafePageTitleUrl(next).then((safe) => resolve(safe ? requestHtml(next, redirectsLeft - 1) : '')).catch(() => resolve(''))
				return
			}
			const contentType = String(response.headers['content-type'] || '').toLowerCase()
			if (response.statusCode !== 200 || (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))) {
				response.resume()
				resolve('')
				return
			}
			const chunks = []
			let total = 0
			response.setEncoding('utf8')
			response.on('data', (chunk) => {
				total += Buffer.byteLength(chunk)
				if (total > MAX_RESPONSE_BYTES) {
					response.destroy()
					resolve('')
					return
				}
				chunks.push(chunk)
				if (/<\/title\s*>/i.test(chunk)) response.destroy()
			})
			response.on('end', () => resolve(chunks.join('')))
			response.on('close', () => { if (chunks.length) resolve(chunks.join('')) })
			response.on('error', () => resolve(''))
		})
		request.setTimeout(REQUEST_TIMEOUT_MS, () => { request.destroy(); resolve('') })
		request.on('error', () => resolve(''))
	})
}

async function fetchPageTitle(value) {
	if (!(await isSafePageTitleUrl(value))) return ''
	return parsePageTitle(await requestHtml(value, MAX_REDIRECTS))
}

module.exports = { fetchPageTitle, isSafePageTitleUrl, parsePageTitle }
