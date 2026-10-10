import { z } from 'zod';

const absolutePath = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((s) => s.startsWith('/') && !/[\x00-\x1f\x7f]/.test(s), '请输入服务器上的绝对路径');
export const CertificateSourceSchema = z.object({
  configPath: absolutePath,
  sudo: z.boolean().default(false),
});
export type CertificateSource = z.infer<typeof CertificateSourceSchema>;
export const CertificateOptionsSchema = z.object({
  inspectionId: z.string().uuid(),
  serverIndex: z.number().int().min(0),
  names: z.array(z.string().trim().min(1).max(253)).min(1).max(30),
  days: z.number().int().min(1).max(3650),
  port: z.number().int().min(1).max(65535),
  applyNginx: z.boolean(),
  redirectHttp: z.boolean().default(false),
  httpServerIndex: z.number().int().min(0).optional(),
  certificateDirectory: absolutePath,
  keyDirectory: absolutePath,
  mainConfigPath: absolutePath,
  nginxPath: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine(
      (s) => (s === 'nginx' || s.startsWith('/')) && !/[\x00-\x1f\x7f]/.test(s),
      '请输入 nginx 或 Nginx 可执行文件的绝对路径',
    ),
});
export type CertificateOptions = z.infer<typeof CertificateOptionsSchema>;
export type CertificateServer = {
  index: number;
  names: string[];
  listens: string[];
  redirectHttp?: boolean;
  redirectOnly?: boolean;
  manualRedirect?: { status: number; target: string };
};
export type CertificateInspection = {
  id: string;
  configPath: string;
  content: string;
  servers: CertificateServer[];
  mainConfigPath?: string;
};
export type CertificatePreview = {
  id: string;
  before: string;
  after: string;
  certificatePath: string;
  privateKeyPath: string;
  backupPath: string;
  names: string[];
  days: number;
  applyNginx: boolean;
  redirectHttp: boolean;
  httpSource?: string;
  originalRedirect?: string;
};

export function hasHttpListener(server: CertificateServer) {
  return !server.listens.length || server.listens.some((listen) => !/\bssl\b/.test(listen));
}
export function httpSources(servers: CertificateServer[], selected: number) {
  const business = servers.find((s) => s.index === selected);
  if (!business) return [];
  if (hasHttpListener(business)) return [business];
  return servers.filter((s) => !s.listens.some((listen) => /\bssl\b/.test(listen)));
}
export function suggestedHttpSource(servers: CertificateServer[], selected: number) {
  const business = servers.find((s) => s.index === selected);
  if (!business) return undefined;
  const sources = httpSources(servers, selected);
  if (hasHttpListener(business)) return business.index;
  const signature = (s: CertificateServer) =>
    [...s.names]
      .map((n) => n.toLowerCase())
      .sort()
      .join('\n');
  const matches = sources.filter((s) => signature(s) === signature(business));
  return matches.length === 1 ? matches[0].index : undefined;
}
export function suggestedCertificateServer(servers: CertificateServer[]) {
  const candidates = servers.filter((s) => !s.redirectOnly);
  const first = candidates[0];
  if (!first) return 0;
  const names = (s: CertificateServer) =>
    [...s.names]
      .map((n) => n.toLowerCase())
      .sort()
      .join('\n');
  const tls = candidates.filter(
    (s) => s.listens.some((listen) => /\bssl\b/.test(listen)) && names(s) === names(first),
  );
  return tls.length === 1 ? tls[0].index : first.index;
}
export function certificateSiteLabel(server: CertificateServer) {
  return `站点 ${server.index + 1} · ${server.names.join(', ') || '未设置 server_name'} · ${server.listens.join(', ') || '默认 HTTP 端口'}`;
}
export type CertificateJob = {
  id: string;
  sessionId: string;
  state: 'running' | 'completed' | 'failed';
  output: string;
  certificatePath: string;
  privateKeyPath: string;
  backupPath: string;
  error?: string;
};
