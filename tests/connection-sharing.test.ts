import { describe, it, expect } from 'vitest';
import { defaults, emptyProfile, type Settings } from '../src/shared';
import {
  ConnectionBundleSchema,
  exportConnectionBundle,
  mergeConnectionBundle,
} from '../src/connection-sharing';
const profile = {
  ...emptyProfile,
  id: 'foreign',
  name: 'Orders',
  host: 'server.example',
  username: 'deploy',
  folderId: 'foreign-child',
  startup: 'pwd',
  autoStartup: true,
  privateKeyPath: 'C:\\private\\id_ed25519',
  tunnels: [
    {
      id: 'tunnel',
      type: 'local' as const,
      bindHost: '127.0.0.1',
      bindPort: 13306,
      targetHost: '127.0.0.1',
      targetPort: 3306,
      enabled: true,
    },
  ],
};
const bundle = {
  version: 1 as const,
  profiles: [profile],
  folders: [
    { id: 'foreign-root', name: 'Team' },
    { id: 'foreign-child', name: 'API', parentId: 'foreign-root' },
  ],
};
describe('sharing connection configurations', () => {
  it('merges folder paths, remaps colliding IDs and preserves local history and settings', () => {
    const current: Settings = {
      ...defaults,
      profiles: [{ ...profile, id: 'foreign', host: 'local.example', folderId: 'local-child' }],
      folders: [
        { id: 'local-root', name: 'Team' },
        { id: 'local-child', name: 'API', parentId: 'local-root' },
      ],
      history: { foreign: ['local-only'] },
    };
    const result = mergeConnectionBundle(current, bundle);
    expect(result.added).toBe(1);
    expect(result.foldersAdded).toBe(0);
    expect(result.settings.profiles[0]).toEqual(current.profiles[0]);
    const imported = result.settings.profiles[1];
    expect(imported.id).not.toBe('foreign');
    expect(imported.folderId).toBe('local-child');
    expect(imported.autoStartup).toBe(false);
    expect(imported.startup).toBe('pwd');
    expect(imported.privateKeyPath).toBeUndefined();
    expect(imported.tunnels![0].enabled).toBe(false);
    expect(imported.tunnels![0].id).not.toBe('tunnel');
    expect(result.settings.history).toEqual(current.history);
    expect(result.settings.appearance).toEqual(current.appearance);
    const twice = mergeConnectionBundle(result.settings, bundle);
    expect(twice.added).toBe(0);
    expect(twice.skipped).toBe(1);
    expect(twice.foldersAdded).toBe(0);
  });
  it('exports only connection fields and category hierarchy, excluding passwords, keys and personal settings', () => {
    const s = {
      ...defaults,
      profiles: [{ ...profile, password: 'do-not-export', encrypted: 'vault-data' }],
      folders: bundle.folders,
      history: { foreign: ['personal-history'] },
    };
    const exported = exportConnectionBundle(s);
    const text = JSON.stringify(exported);
    for (const excluded of ['do-not-export', 'vault-data', 'id_ed25519', 'personal-history'])
      expect(text).not.toContain(excluded);
    expect(exported.profiles[0].tunnels).toHaveLength(1);
    expect(exported.profiles[0].startup).toBe('pwd');
    expect(mergeConnectionBundle(defaults, exported).settings.folders).toHaveLength(2);
  });
  it('rejects invalid versions, duplicate IDs, cyclic folders and broken references', () => {
    for (const invalid of [
      { ...bundle, version: 3 },
      { ...bundle, profiles: [profile, profile] },
      { ...bundle, folders: [{ id: 'foreign-child', name: 'cycle', parentId: 'foreign-child' }] },
      { ...bundle, folders: [] },
    ])
      expect(ConnectionBundleSchema.safeParse(invalid).success).toBe(false);
  });
  it('validates version 2 credential references and keeps plaintext out of merged settings', () => {
    const shared = exportConnectionBundle({ ...defaults, profiles: [profile], folders: bundle.folders }, [{ profileId: profile.id, password: 'fixture-only' }]);
    expect(shared.version).toBe(2);
    const result = mergeConnectionBundle(defaults, shared);
    expect(result.passwordsAdded).toBe(1);
    expect(result.importedIds[0].targetId).toBe(result.settings.profiles[0].id);
    expect(JSON.stringify(result)).not.toContain('fixture-only');
    for (const invalid of [
      { ...shared, version: 1 },
      { ...shared, credentials: [{ profileId: 'missing', password: 'fixture' }] },
      { ...shared, credentials: [...shared.credentials!, ...shared.credentials!] },
      { ...shared, profiles: [{ ...profile, auth: 'key' }] },
    ]) expect(ConnectionBundleSchema.safeParse(invalid).success).toBe(false);
  });
  it('skips duplicates without overwriting different tunnel or startup settings and enforces capacity', () => {
    const first = mergeConnectionBundle(defaults, bundle);
    const changed = { ...bundle, profiles: [{ ...profile, startup: 'changed', port: 22 }] };
    expect(mergeConnectionBundle(first.settings, changed).settings.profiles[0].startup).toBe('pwd');
    const full = {
      ...defaults,
      profiles: Array.from({ length: 1000 }, (_, n) => ({
        ...emptyProfile,
        id: String(n),
        name: String(n),
        host: 'existing.example',
        username: 'test',
      })),
    };
    expect(() => mergeConnectionBundle(full, bundle)).toThrow();
  });
});
