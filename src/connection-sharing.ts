import { z } from 'zod';
import { defaults, FolderSchema, ProfileSchema, SettingsSchema, type Settings } from './shared';
export const ConnectionBundleSchema = z
  .object({
    format: z.literal('elushell-connections').optional(),
    version: z.union([z.literal(1), z.literal(2)]),
    profiles: z.array(ProfileSchema).max(1000),
    folders: z.array(FolderSchema).max(1000).default([]),
    credentials: z.array(z.object({
      profileId: z.string().min(1),
      password: z.string().min(1).max(32768),
    })).max(1000).optional(),
  })
  .superRefine((bundle, ctx) => {
    const parsed = SettingsSchema.safeParse({ ...defaults, ...bundle });
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: '连接分类层级或引用无效' });
    if (new Set(bundle.profiles.map((p) => p.id)).size !== bundle.profiles.length)
      ctx.addIssue({ code: 'custom', message: '连接 ID 重复' });
    if (bundle.credentials !== undefined && bundle.version !== 2)
      ctx.addIssue({ code: 'custom', message: '带密码的配置必须使用版本 2 格式' });
    const credentials = bundle.credentials || [];
    if (new Set(credentials.map((c) => c.profileId)).size !== credentials.length ||
      credentials.some((c) => !bundle.profiles.some((p) => p.id === c.profileId && p.auth === 'password')))
      ctx.addIssue({ code: 'custom', message: '密码必须对应唯一的密码认证连接' });
  });
export type ConnectionBundle = z.infer<typeof ConnectionBundleSchema>;
export function exportConnectionBundle(settings: Settings, credentials?: ConnectionBundle['credentials']): ConnectionBundle {
  const bundle = ConnectionBundleSchema.parse({
    format: 'elushell-connections',
    version: credentials === undefined ? 1 : 2,
    profiles: settings.profiles,
    folders: settings.folders,
    ...(credentials === undefined ? {} : { credentials }),
  });
  return { ...bundle, profiles: bundle.profiles.map(({ privateKeyPath: _, demo: __, ...p }) => p) };
}
export function mergeConnectionBundle(settings: Settings, input: unknown) {
  const bundle = ConnectionBundleSchema.parse(input);
  const folders = settings.folders.map((f) => ({ ...f })),
    profiles = [...settings.profiles];
  const mapping = new Map<string, string>();
  const imported = new Map(bundle.folders.map((f) => [f.id, f]));
  const resolveFolder = (id: string): string => {
    if (mapping.has(id)) return mapping.get(id)!;
    const f = imported.get(id)!;
    const parentId = f.parentId ? resolveFolder(f.parentId) : undefined;
    let existing = folders.find((x) => x.name === f.name && x.parentId === parentId);
    if (!existing) {
      existing = { id: crypto.randomUUID(), name: f.name, parentId };
      folders.push(existing);
    }
    mapping.set(id, existing.id);
    return existing.id;
  };
  for (const f of bundle.folders) resolveFolder(f.id);
  const identity = (p: Settings['profiles'][number]) =>
    JSON.stringify([p.folderId || '', p.name, p.host.toLowerCase(), p.port, p.username, p.auth]);
  const known = new Set(profiles.map(identity));
  const rows: { name: string; host: string; username: string; action: string; credential: string }[] = [];
  const importedIds: { sourceId: string; targetId: string }[] = [];
  const passwordIds = new Set(bundle.credentials?.map((c) => c.profileId));
  let added = 0,
    skipped = 0;
  for (const source of bundle.profiles) {
    const p = { ...source, folderId: source.folderId ? mapping.get(source.folderId) : undefined };
    if (known.has(identity(p))) {
      skipped++;
      rows.push({ name: p.name, host: p.host, username: p.username, action: '跳过重复', credential: '保留本机配置' });
      continue;
    }
    known.add(identity(p));
    const { privateKeyPath: _, demo: __, ...fields } = p;
    const targetId = crypto.randomUUID();
    importedIds.push({ sourceId: source.id, targetId });
    profiles.push({
      ...fields,
      id: targetId,
      group: '',
      autoStartup: false,
      tunnels: p.tunnels?.map((t) => ({ ...t, id: crypto.randomUUID(), enabled: false })),
    });
    added++;
    rows.push({ name: p.name, host: p.host, username: p.username, action: '新增', credential: passwordIds.has(source.id) ? '导入已保存密码' : p.auth === 'password' ? '需输入密码' : '需本机密钥 / Agent' });
  }
  const next = SettingsSchema.parse({ ...settings, profiles, folders });
  return {
    settings: next,
    added,
    skipped,
    foldersAdded: folders.length - settings.folders.length,
    rows,
    importedIds,
    passwordsAdded: importedIds.filter((p) => passwordIds.has(p.sourceId)).length,
  };
}
