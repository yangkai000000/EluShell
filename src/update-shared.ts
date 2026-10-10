import { z } from 'zod';

export const UpdatePreferencesSchema = z.object({
  url: z.string().trim().max(2048).default(''),
  autoCheck: z.boolean().default(true),
  allowHttp: z.boolean().default(false),
});
export const UpdateConfigSchema = UpdatePreferencesSchema.extend({
  ignoredVersion: z.string().max(80).default(''),
  deferredUntil: z.number().finite().nonnegative().default(0),
  lastChecked: z.number().finite().nonnegative().default(0),
});
export type UpdatePreferences = z.infer<typeof UpdatePreferencesSchema>;
export type UpdateConfig = z.infer<typeof UpdateConfigSchema>;
export type UpdateStatus = {
  currentVersion: string;
  supported: boolean;
  config: UpdateConfig;
  phase:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'current'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error';
  installStep?: 'preparing' | 'launching';
  version?: string;
  notes?: string;
  percent?: number;
  error?: string;
  prompt: boolean;
};
export function normalizeUpdatePreferences(value: unknown): UpdatePreferences {
  const p = UpdatePreferencesSchema.parse(value);
  if (!p.url) return p;
  let url: URL;
  try {
    url = new URL(p.url);
  } catch {
    throw Error('请输入完整的更新目录地址，例如 https://域名/updates/windows/x64/');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('更新地址只支持 HTTP(S) 目录，不能包含账号、密码、查询参数或锚点');
  if (url.protocol === 'http:' && !p.allowHttp)
    throw Error('HTTP 地址需要勾选允许 HTTP 测试源，正式发布建议使用 HTTPS');
  if (/\.(yml|yaml|exe|blockmap)$/i.test(url.pathname))
    throw Error('请填写发布目录地址，不要填写安装包或 latest.yml 文件地址');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return { ...p, url: url.href };
}
