import DOMPurify from 'dompurify';
import { marked } from 'marked';

export interface MarkdownRenderOptions {
	async?: boolean;
	breaks?: boolean;
}

const DEFAULT_OPTIONS: Required<MarkdownRenderOptions> = {
	async: false,
	breaks: true,
};

/**
 * 将 Markdown 文本渲染为经过安全净化的 HTML。
 *
 * 该函数会：
 * 1. 使用 marked 解析 Markdown；
 * 2. 使用 DOMPurify 过滤危险标签、属性、事件处理程序和 javascript: 伪协议；
 * 3. 返回可直接插入 DOM 的安全 HTML 字符串。
 */
export const renderMarkdown = (raw: string, options: MarkdownRenderOptions = {}): string => {
	const merged: Required<MarkdownRenderOptions> = { ...DEFAULT_OPTIONS, ...options };
	const html = marked.parse(raw, { async: merged.async, breaks: merged.breaks }) as string;
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|xxx):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
	});
};

/**
 * 判断一段文本是否包含任何 Markdown 标记。
 */
export const hasMarkdown = (raw: string): boolean => {
	const normalized = raw.trim();
	if (!normalized) {
		return false;
	}

	// 常见 Markdown 标记：标题、列表、粗体、斜体、代码、链接、图片、引用、分隔线
	const mdPattern = /(?:^|\s)(#{1,6}\s|[*\-_]\s|\*\*|__|`[^`]+`|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|>\s|```|\*[^*]+\*|_[^_]+_)/m;
	return mdPattern.test(normalized);
};
