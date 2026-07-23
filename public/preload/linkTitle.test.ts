import { describe, expect, it } from 'vitest';
import { isSafePageTitleUrl, parsePageTitle } from './linkTitle.js';

describe('linkTitle', () => {
	it('allows public web URLs on standard ports', async () => {
		await expect(isSafePageTitleUrl('https://example.com/docs')).resolves.toBe(true);
		await expect(isSafePageTitleUrl('http://example.com:80/docs')).resolves.toBe(true);
	});

	it('rejects local, private and non-standard targets', async () => {
		await expect(isSafePageTitleUrl('http://localhost')).resolves.toBe(false);
		await expect(isSafePageTitleUrl('http://127.0.0.1')).resolves.toBe(false);
		await expect(isSafePageTitleUrl('http://192.168.1.10')).resolves.toBe(false);
		await expect(isSafePageTitleUrl('https://example.com:8443')).resolves.toBe(false);
		await expect(isSafePageTitleUrl('file:///etc/hosts')).resolves.toBe(false);
	});

	it('parses and normalizes the first title', () => {
		expect(parsePageTitle('<title>  Example   Site </title>')).toBe('Example Site');
		expect(parsePageTitle('<html><head></head></html>')).toBe('');
	});
});