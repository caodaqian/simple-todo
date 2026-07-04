import { describe, expect, it } from 'vitest';
import { parseDateFromText } from './useDateParser';

describe('useDateParser', () => {
	// 使用本地时间构造 now，避免 CI 时区差异
	const now = new Date(2026, 5, 22, 10, 0, 0).getTime();

	it('parses 今天', () => {
		const result = parseDateFromText('今天', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 0, 0, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('parses 明天 with 24-hour time', () => {
		const result = parseDateFromText('明天 14:00', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 23, 14, 0, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('parses 后天', () => {
		const result = parseDateFromText('后天', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 24, 0, 0, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('parses 下周一', () => {
		const result = parseDateFromText('下周一', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 29, 0, 0, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('parses Chinese date expression', () => {
		const result = parseDateFromText('6月25日', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 25, 0, 0, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('parses ISO date with time', () => {
		const result = parseDateFromText('2026-06-30 09:30', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 30, 9, 30, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('defaults time-only to today', () => {
		const result = parseDateFromText('16:45', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 16, 45, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('parses afternoon time expression', () => {
		const result = parseDateFromText('今天下午3点', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 15, 0, 0).getTime());
		expect(result.cleanedText).toBe('');
	});

	it('strips date/time from title while keeping attributes intact', () => {
		const result = parseDateFromText('!高 明天14:00 完成报告 ~工作 #紧急', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 23, 14, 0, 0).getTime());
		expect(result.cleanedText).toBe('!高 完成报告 ~工作 #紧急');
	});

	it('returns undefined dueDate for plain text', () => {
		const result = parseDateFromText('普通任务标题', now);
		expect(result.dueDate).toBeUndefined();
		expect(result.cleanedText).toBe('普通任务标题');
	});

	it('parses 24-hour Chinese time expression', () => {
		const result = parseDateFromText('15点 开会', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 15, 0, 0).getTime());
		expect(result.cleanedText).toBe('开会');
	});

	it('parses 24-hour Chinese time with minutes', () => {
		const result = parseDateFromText('14点30分提交报告', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 14, 30, 0).getTime());
		expect(result.cleanedText).toBe('提交报告');
	});

	it('parses morning time expression', () => {
		const result = parseDateFromText('上午10点晨练', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 10, 0, 0).getTime());
		expect(result.cleanedText).toBe('晨练');
	});

	it('parses late night 24-hour colon time', () => {
		const result = parseDateFromText('23:59 关电脑', now);
		expect(result.dueDate).toBe(new Date(2026, 5, 22, 23, 59, 0).getTime());
		expect(result.cleanedText).toBe('关电脑');
	});
});
