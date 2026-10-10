import { z } from 'zod';

// Deliberately conservative: startup argument recovery must be unambiguous.
const serverPath = z
  .string()
  .trim()
  .regex(/^\/[A-Za-z0-9_./-]+$/, '请填写绝对路径（不含空格或特殊字符）')
  .max(2048);
export const NginxUpgradeSourceSchema = z.object({
  binary: serverPath,
  config: serverPath,
  prefix: serverPath.default('/usr/local/nginx'),
  pidPath: z.union([z.literal(''), serverPath]).default(''),
  sudo: z.boolean().default(false),
  healthUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((s) => {
      try {
        const u = new URL(s);
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) &&
          !u.username &&
          !u.password &&
          !u.hash &&
          !/[\x00-\x20\x7f]/.test(s)
        );
      } catch {
        return false;
      }
    }, '请填写本机健康检查地址，例如 http://127.0.0.1:8800/'),
});
export type NginxUpgradeSource = z.infer<typeof NginxUpgradeSourceSchema>;
export type NginxUpgradeCheck = { name: string; ok: boolean; detail: string };
export type NginxUpgradePreview = {
  id: string;
  currentVersion: string;
  targetVersion: string;
  ssl: boolean;
  binary: string;
  config: string;
  prefix: string;
  pid: number;
  backupPath: string;
  checks: NginxUpgradeCheck[];
  ready: boolean;
  expiresAt: number;
  packageBytes: number;
  system?: string;
  strategy?: string;
};
export type NginxUpgradeJob = {
  id: string;
  sessionId: string;
  state: 'running' | 'completed' | 'failed' | 'unknown';
  stage: string;
  percent: number;
  output: string;
  backupPath: string;
  error?: string;
};
export type NginxBundle = {
  version: string;
  sha256: string;
  bytes: number;
  arch: string;
  minGlibc: string;
  prefix: string;
  config: string;
  pid: string;
};
