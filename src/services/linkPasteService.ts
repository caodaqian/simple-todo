const MAX_TITLE_LENGTH = 120;

export const isSingleHttpUrl = (value: string): string | null => {
	const candidate = value.trim();
	if (!candidate || /\s/.test(candidate)) return null;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.href;
	} catch {
		return null;
	}
};

export const normalizePageTitle = (value: string): string => value
	.replace(/\s+/g, ' ')
	.trim()
	.slice(0, MAX_TITLE_LENGTH);

export const extractPageTitle = (html: string): string => {
	const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i.exec(html);
	if (!match?.[1]) return '';
	return normalizePageTitle(match[1].replace(/<[^>]*>/g, ''));
};

export const buildMarkdownLink = (label: string, url: string): string =>
	`[${label.replace(/[\[\]]/g, '\\$&')}](${url})`;
