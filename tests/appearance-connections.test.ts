import { it, expect } from 'vitest';
import {
  AppearanceSchema,
  BackgroundSchema,
  defaults,
  emptyProfile,
  SettingsSchema,
} from '../src/shared';
import { effectiveTerminal, foregroundFor } from '../src/appearance';
import { canMoveFolder, folderPath, moveConnectionItem } from '../src/connections';

it('loads pre-appearance settings with independent terminal defaults', () => {
  const { appearance: _, ...old } = defaults;
  const current = SettingsSchema.parse(old);
  expect(current.appearance.terminalFontSize).toBe(13);
  expect(effectiveTerminal(current.appearance).color).toBe('#101923');
  expect(effectiveTerminal({ ...current.appearance, includeTerminal: true }).color).toBe('#f3f5f8');
});
it('validates font sizes, color values and managed image identifiers', () => {
  for (const value of [0, 8, 33, 13.5])
    expect(AppearanceSchema.safeParse({ terminalFontSize: value }).success).toBe(false);
  expect(AppearanceSchema.safeParse({ terminalFont: '' }).success).toBe(false);
  for (const image of ['../credentials.json', 'C:/private.png', '/etc/passwd', 'a.png'])
    expect(BackgroundSchema.safeParse({ color: '#101923', image }).success).toBe(false);
  expect(BackgroundSchema.safeParse({ color: 'red' }).success).toBe(false);
  expect(
    BackgroundSchema.safeParse({ color: '#ABCDEF', kind: 'image', image: 'a'.repeat(64) + '.png' })
      .success,
  ).toBe(true);
});
it('chooses legible terminal foreground for light and dark solid backgrounds', () => {
  expect(foregroundFor('#ffffff')).toBe('#27364b');
  expect(foregroundFor('#f3f5f8')).toBe('#27364b');
  expect(foregroundFor('#101923')).toBe('#cbd5e1');
});
const fixture = {
  ...defaults,
  folders: [
    { id: 'a', name: '生产' },
    { id: 'b', name: '服务', parentId: 'a' },
    { id: 'c', name: '测试' },
  ],
  profiles: [
    {
      ...emptyProfile,
      id: 'p',
      name: 'API',
      host: 'localhost',
      username: 'app',
      folderId: 'b',
      startup: 'pwd',
      tunnels: [
        {
          id: 't',
          type: 'local' as const,
          bindHost: '127.0.0.1',
          bindPort: 13306,
          targetHost: 'localhost',
          targetPort: 3306,
          enabled: true,
        },
      ],
    },
  ],
};
it('moves an entire subtree while retaining profiles, tunnels and credential identity', () => {
  const result = moveConnectionItem(fixture, { kind: 'folder', id: 'a' }, 'c');
  expect(folderPath(result.folders, 'b')).toBe('连接 / 测试 / 生产 / 服务');
  expect(result.profiles).toEqual(fixture.profiles);
  expect(fixture.folders[0]).not.toHaveProperty('parentId');
  expect(moveConnectionItem(result, { kind: 'folder', id: 'a' }, '').folders[2].id).toBe('c');
});
it('moves connections between folders and root without changing the endpoint or ID', () => {
  const moved = moveConnectionItem(fixture, { kind: 'profile', id: 'p' }, 'c');
  expect(moved.profiles[0]).toEqual({ ...fixture.profiles[0], folderId: 'c', group: '测试' });
  expect(
    moveConnectionItem(moved, { kind: 'profile', id: 'p' }, '').profiles[0].folderId,
  ).toBeUndefined();
});
it('rejects self, descendant and missing destinations', () => {
  expect(canMoveFolder(fixture.folders, 'a', 'a')).toBe(false);
  expect(canMoveFolder(fixture.folders, 'a', 'b')).toBe(false);
  for (const target of ['a', 'b', 'missing'])
    expect(() => moveConnectionItem(fixture, { kind: 'folder', id: 'a' }, target)).toThrow();
  expect(() => moveConnectionItem(fixture, { kind: 'profile', id: 'missing' }, '')).toThrow();
});
