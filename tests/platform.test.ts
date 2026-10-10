import { describe, expect, it } from 'vitest';
import { isTerminalShortcut } from '../src/platform';

describe('terminal shortcuts preserve shell controls', () => {
  const key = { ctrlKey: false, shiftKey: false, metaKey: false, altKey: false };
  it('uses Command on Mac without swallowing Ctrl+C or Ctrl+F', () => {
    expect(isTerminalShortcut({ ...key, metaKey: true }, true)).toBe(true);
    expect(isTerminalShortcut({ ...key, ctrlKey: true }, true)).toBe(false);
    expect(isTerminalShortcut({ ...key, metaKey: true, altKey: true }, true)).toBe(false);
  });
  it('keeps Windows Ctrl+Shift shortcuts and forwards plain Ctrl to SSH', () => {
    expect(isTerminalShortcut({ ...key, ctrlKey: true, shiftKey: true }, false)).toBe(true);
    expect(isTerminalShortcut({ ...key, ctrlKey: true }, false)).toBe(false);
  });
});
