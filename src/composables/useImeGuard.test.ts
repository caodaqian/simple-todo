import { describe, expect, it, vi } from 'vitest';
import { useImeGuard } from './useImeGuard';

describe('useImeGuard', () => {
	it('ignores Enter while an IME composition is active', () => {
		const { onCompositionStart, shouldIgnoreKeydown } = useImeGuard();

		onCompositionStart();

		expect(shouldIgnoreKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
	});

	it('keeps the guard active through the composition-end key event', () => {
		vi.useFakeTimers();
		const { onCompositionStart, onCompositionEnd, shouldIgnoreKeydown } = useImeGuard();

		onCompositionStart();
		onCompositionEnd();

		expect(shouldIgnoreKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
		vi.runAllTimers();
		expect(shouldIgnoreKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
		vi.useRealTimers();
	});

	it('respects the native IME composition marker', () => {
		const { shouldIgnoreKeydown } = useImeGuard();
		const event = new KeyboardEvent('keydown', { key: 'Enter' });
		Object.defineProperty(event, 'isComposing', { value: true });

		expect(shouldIgnoreKeydown(event)).toBe(true);
	});
});
