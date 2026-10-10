import { it, expect } from 'vitest';
import { closingTabs } from '../src/session-tabs';
it('selects tabs relative to the right-clicked anchor, and cascades dependent tools', () => {
  const tabs = ['a', 'tool:a', 'b', 'new:1', 'c'];
  const tools = [{ id: 'tool:a', sessionId: 'a' }];
  expect(closingTabs(tabs, tools, 'b', 'left')).toEqual(['a', 'tool:a']);
  expect(closingTabs(tabs, tools, 'b', 'right')).toEqual(['new:1', 'c']);
  expect(closingTabs(tabs, tools, 'a', 'current')).toEqual(['a', 'tool:a']);
  expect(closingTabs(tabs, tools, 'tool:a', 'current')).toEqual(['tool:a']);
  expect(closingTabs(tabs, tools, 'b', 'all')).toEqual(tabs);
});
it('keeps a tool and its source SSH session when closing other tabs', () => {
  const tabs = ['a', 'b', 'tool:a', 'c'];
  const tools = [{ id: 'tool:a', sessionId: 'a' }];
  expect(closingTabs(tabs, tools, 'tool:a', 'others')).toEqual(['b', 'c']);
  expect(closingTabs(tabs, tools, 'tool:a', 'left')).toEqual(['b']);
  expect(closingTabs(tabs, tools, 'missing', 'all')).toEqual([]);
});
