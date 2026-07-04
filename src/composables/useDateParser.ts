export interface DateParseResult {
	/** @deprecated 改用 dueStart/allDay，保留兼容旧调用 */
	dueDate?: number;
	/** 截止开始时间戳；纯日期表达取当天 00:00 */
	dueStart?: number;
	/** 全天任务：仅匹配到日期、未匹配到时间时为 true */
	allDay?: boolean;
	cleanedText: string;
}

const WEEKDAY_MAP: Record<string, number> = {
	日: 0,
	天: 0,
	一: 1,
	二: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 0,
	1: 1,
	2: 2,
	3: 3,
	4: 4,
	5: 5,
	6: 6,
	7: 0,
};

const getStartOfDay = (date: Date): Date => {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
};

const getDateForWeekday = (now: Date, targetWeekday: number): Date => {
	const startOfToday = getStartOfDay(now);
	const currentWeekday = startOfToday.getDay();
	const diff = (targetWeekday - currentWeekday + 7) % 7;
	// "下周X" 总是指下一个星期，至少 7 天后
	const daysToAdd = diff === 0 ? 7 : diff;
	return new Date(startOfToday.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
};

const parseTime = (value: string): { hour: number; minute: number } | null => {
	// 24小时制：14:00, 14点, 14点30分
	const time24 = value.match(/(\d{1,2}):(\d{2})/);
	if (time24) {
		const hour = Number.parseInt(time24[1]!, 10);
		const minute = Number.parseInt(time24[2]!, 10);
		if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
			return { hour, minute };
		}
	}

	// 24小时制中文：15点、14点30分；12小时制：上午/下午 X点(Y分)
	const amPm = value.match(/(上午|下午|晚上|早上|傍晚)?\s*(\d{1,2})点(?:\s*(\d{1,2})分)?/);
	if (amPm) {
		const period = amPm[1] ?? '';
		let hour = Number.parseInt(amPm[2]!, 10);
		const minute = amPm[3] ? Number.parseInt(amPm[3], 10) : 0;
		if (minute < 0 || minute > 59) {
			return null;
		}
		if (period) {
			// 12小时制
			if (hour < 1 || hour > 12) {
				return null;
			}
			if (period === '下午' || period === '晚上' || period === '傍晚') {
				hour = hour === 12 ? 12 : hour + 12;
			} else if (period === '上午' || period === '早上') {
				hour = hour === 12 ? 0 : hour;
			}
		} else {
			// 24小时制
			if (hour < 0 || hour > 23) {
				return null;
			}
		}
		return { hour, minute };
	}

	return null;
};

const parseDate = (value: string, now: Date): Date | null => {
	const normalized = value.trim();
	if (!normalized) {
		return null;
	}

	// 今天 / 明天 / 后天
	if (/^(今|明|后)天$/.test(normalized)) {
		const startOfToday = getStartOfDay(now);
		if (normalized.startsWith('今')) return startOfToday;
		if (normalized.startsWith('明')) {
			return new Date(startOfToday.getTime() + 1 * 24 * 60 * 60 * 1000);
		}
		return new Date(startOfToday.getTime() + 2 * 24 * 60 * 60 * 1000);
	}

	// 下周X
	const nextWeekMatch = normalized.match(/^下(?:周|星期|礼拜)([日一二三四五六天1234567])$/);
	if (nextWeekMatch) {
		const targetWeekday = WEEKDAY_MAP[nextWeekMatch[1]!];
		if (targetWeekday !== undefined) {
			return getDateForWeekday(now, targetWeekday);
		}
	}

	// 数字日期：YYYY-MM-DD / YYYY/MM/DD / MM-DD / MM/DD
	const isoDateMatch = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
	if (isoDateMatch) {
		const year = Number.parseInt(isoDateMatch[1]!, 10);
		const month = Number.parseInt(isoDateMatch[2]!, 10) - 1;
		const day = Number.parseInt(isoDateMatch[3]!, 10);
		const candidate = new Date(year, month, day, 0, 0, 0, 0);
		if (candidate.getFullYear() === year && candidate.getMonth() === month && candidate.getDate() === day) {
			return candidate;
		}
	}

	const shortDateMatch = normalized.match(/^(\d{1,2})[-/](\d{1,2})$/);
	if (shortDateMatch) {
		const month = Number.parseInt(shortDateMatch[1]!, 10) - 1;
		const day = Number.parseInt(shortDateMatch[2]!, 10);
		const candidate = new Date(now.getFullYear(), month, day, 0, 0, 0, 0);
		if (candidate.getMonth() === month && candidate.getDate() === day) {
			return candidate;
		}
	}

	// M月D日 / M月D号
	const chineseDateMatch = normalized.match(/^(\d{1,2})月(\d{1,2})(日|号)$/);
	if (chineseDateMatch) {
		const month = Number.parseInt(chineseDateMatch[1]!, 10) - 1;
		const day = Number.parseInt(chineseDateMatch[2]!, 10);
		const candidate = new Date(now.getFullYear(), month, day, 0, 0, 0, 0);
		if (candidate.getMonth() === month && candidate.getDate() === day) {
			return candidate;
		}
	}

	return null;
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const findFirstMatch = (text: string, pattern: RegExp): { match: string; index: number } | null => {
	const localPattern = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
	const result = localPattern.exec(text);
	if (!result) {
		return null;
	}
	return { match: result[0], index: result.index };
};

const removeMatchFromText = (text: string, index: number, length: number): string => {
	return collapseWhitespace(text.slice(0, index) + text.slice(index + length));
};

/**
 * 从文本中解析出截止日期，并返回去除日期/时间表达后的干净文本。
 *
 * 支持的表达：
 * - 今天、明天、后天
 * - 下周一/二/.../日（含 1-7）
 * - YYYY-MM-DD、YYYY/MM/DD、MM-DD、MM/DD、M月D日
 * - HH:mm、HH点(YY分)（24小时制）、上午/下午 H点
 *
 * 日期和时间表达可以在文本中的任意位置，解析后会将其从标题中移除。
 */
export const parseDateFromText = (text: string, now = Date.now()): DateParseResult => {
	const nowDate = new Date(now);
	let workingText = text;
	let matchedDate: Date | null = null;
	let matchedTime: { hour: number; minute: number } | null = null;

	// 优先匹配完整的中文日期词组，其次匹配数字日期
	const datePatterns = [
		/(今|明|后)天/,
		/下(?:周|星期|礼拜)([日一二三四五六天1234567])/,
		/\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
		/\d{1,2}[-/]\d{1,2}/,
		/\d{1,2}月\d{1,2}(日|号)/,
	];

	for (const pattern of datePatterns) {
		const found = findFirstMatch(workingText, pattern);
		if (found) {
			const candidate = parseDate(found.match, nowDate);
			if (candidate) {
				matchedDate = candidate;
				workingText = removeMatchFromText(workingText, found.index, found.match.length);
				break;
			}
		}
	}

	// 在剩余文本中匹配时间
	const timePatterns = [
		/\d{1,2}:\d{2}/,
		/(上午|下午|晚上|早上|傍晚)?\s*\d{1,2}点(?:\s*\d{1,2}分)?/,
	];

	for (const pattern of timePatterns) {
		const found = findFirstMatch(workingText, pattern);
		if (found) {
			const candidate = parseTime(found.match);
			if (candidate) {
				matchedTime = candidate;
				workingText = removeMatchFromText(workingText, found.index, found.match.length);
				break;
			}
		}
	}

	// 如果没有匹配到日期，但匹配到时间，则默认使用今天
	if (!matchedDate && matchedTime) {
		matchedDate = getStartOfDay(nowDate);
	}

	if (!matchedDate) {
		return { cleanedText: text.trim() };
	}

	const dueStart = new Date(
		matchedDate.getFullYear(),
		matchedDate.getMonth(),
		matchedDate.getDate(),
		matchedTime?.hour ?? 0,
		matchedTime?.minute ?? 0,
		0,
		0,
	).getTime();

	return {
		dueDate: dueStart,
		dueStart,
		allDay: matchedTime === null,
		cleanedText: workingText.trim(),
	};
};

/**
 * Vue composable 包装，返回一个稳定引用的解析函数。
 */
export const useDateParser = () => {
	return {
		parseDateFromText,
	};
};
