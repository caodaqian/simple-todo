import { describe, expect, it } from 'vitest';
import { hasMarkdown, renderMarkdown } from './markdownService';

describe('markdownService', () => {
	describe('renderMarkdown', () => {
		it('renders basic Markdown safely', () => {
			const html = renderMarkdown('# Hello\n\nThis is **bold** and `code`.');
			expect(html).toContain('<h1>Hello</h1>');
			expect(html).toContain('<strong>bold</strong>');
			expect(html).toContain('<code>code</code>');
		});

		it('removes script tags and event handlers', () => {
			const raw = `## Title\n<script>alert('xss')</script><p onclick="alert('click')">text</p>`;
			const html = renderMarkdown(raw);
			expect(html).not.toContain('<script>');
			expect(html).not.toContain('</script>');
			expect(html).not.toContain('onclick');
			expect(html).toContain('<h2>Title</h2>');
			expect(html).toContain('<p>text</p>');
		});

		it('sanitizes javascript: pseudo-protocol in links', () => {
			const raw = `[click me](javascript:alert('xss'))`;
			const html = renderMarkdown(raw);
			expect(html).not.toContain('javascript:');
			expect(html).not.toContain('onclick');
		});

		it('removes onerror handlers from images while keeping safe images', () => {
			const raw = `![alt](image.png "title")<img src="x" onerror="alert('xss')">`;
			const html = renderMarkdown(raw);
			expect(html).not.toContain('onerror');
			expect(html).toContain('alt');
		});

		it('strips dangerous iframe and object tags', () => {
			const raw = `Hello\n<iframe src="https://example.com"></iframe><object data="x"></object>`;
			const html = renderMarkdown(raw);
			expect(html).not.toContain('<iframe');
			expect(html).not.toContain('<object');
			expect(html).toContain('Hello');
		});

		it('preserves safe external https links', () => {
			const raw = `[uTools](https://www.u-tools.cn)`;
			const html = renderMarkdown(raw);
			expect(html).toContain('href="https://www.u-tools.cn"');
			expect(html).toContain('uTools');
		});

		it('returns empty string for empty input', () => {
			expect(renderMarkdown('')).toBe('');
			expect(renderMarkdown('   ')).toBe('');
		});
	});

	describe('hasMarkdown', () => {
		it('detects common Markdown markers', () => {
			expect(hasMarkdown('# Heading')).toBe(true);
			expect(hasMarkdown('**bold**')).toBe(true);
			expect(hasMarkdown('- list')).toBe(true);
			expect(hasMarkdown('[link](url)')).toBe(true);
			expect(hasMarkdown('`code`')).toBe(true);
		});

		it('returns false for plain text', () => {
			expect(hasMarkdown('plain text')).toBe(false);
			expect(hasMarkdown('')).toBe(false);
		});
	});
});
