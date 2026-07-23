import { describe, expect, it } from 'vitest';
import {
	buildMarkdownLink,
	extractPageTitle,
	isSingleHttpUrl,
	normalizePageTitle,
} from './linkPasteService';

describe('linkPasteService', () => {
	it('recognizes only a single http or https URL', () => {
		expect(isSingleHttpUrl('https://example.com/docs')).toBe('https://example.com/docs');
		expect(isSingleHttpUrl(' http://example.com/path ')).toBe('http://example.com/path');
		expect(isSingleHttpUrl('https://example.com\nnext')).toBeNull();
		expect(isSingleHttpUrl('[docs](https://example.com)')).toBeNull();
		expect(isSingleHttpUrl('javascript:alert(1)')).toBeNull();
	});

	it('builds a markdown link while escaping closing brackets in label', () => {
		expect(buildMarkdownLink('文档 [正式版]', 'https://example.com/a_(b)')).toBe(
			'[文档 \\[正式版\\]](https://example.com/a_(b))',
		);
	});

	it('extracts and normalizes a useful title from html', () => {
		expect(extractPageTitle('<html><head><title>  GitHub   ·   Example </title></head></html>')).toBe('GitHub · Example');
		expect(extractPageTitle('<html><body>No title</body></html>')).toBe('');
		expect(normalizePageTitle('   ')).toBe('');
		expect(normalizePageTitle('A'.repeat(300))).toHaveLength(120);
	});
});
