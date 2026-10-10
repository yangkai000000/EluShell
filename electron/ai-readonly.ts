import { z } from 'zod';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { AIInput } from '../src/ai-shared';

export type AIReadTool = (
  sessionId: string,
  name: string,
  args: unknown,
  signal: AbortSignal,
) => Promise<string>;
const argsSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((p) => p.startsWith('/') && !/[\x00-\x1f\x7f]/.test(p), '需要远程绝对路径'),
    query: z.string().min(1).max(200).optional(),
  })
  .strict();
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function readonlyCommand(name: string, args: unknown) {
  const a = argsSchema.parse(args);
  if (name !== 'find_paths' || !a.query) throw Error('没有直接修改文件的能力；仅支持只读查找工具');
  // No model-provided shell syntax or flags. Escape glob metacharacters as literal filename text.
  const pattern = '*' + a.query.replace(/[\\*?\[\]]/g, '\\$&') + '*';
  return `find ${quote(a.path)} -maxdepth 16 -iname ${quote(pattern)} -print 2>/dev/null`;
}
export function validateTarget(input: AIInput) {
  if (input.attachments.some((a) => a.kind !== 'image' && a.sessionId !== input.sessionId))
    throw Error('引用内容来自其他服务器，请切换回来源服务器或移除引用');
}
export function createReadTool(
  ftp: (id: string) => Promise<SFTPWrapper>,
  exec: (id: string, command: string, signal: AbortSignal) => Promise<string>,
): AIReadTool {
  return async (id, name, value, signal) => {
    if (!['list_directory', 'find_paths', 'read_file', 'search_text'].includes(name))
      throw Error('我没有直接修改文件的能力');
    const a = argsSchema.parse(value);
    signal.throwIfAborted();
    if (name === 'find_paths')
      return (
        (await exec(id, readonlyCommand(name, a), signal)).slice(0, 60000) +
        '\n（查找深度上限 16，结果最多 60000 字符）'
      );
    const sftp = await ftp(id);
    const call = <T>(fn: (cb: (e: Error | null | undefined, v: T) => void) => void) =>
      new Promise<T>((resolve, reject) => {
        const stop = () => finish(Error('只读操作已停止'));
        const timer = setTimeout(() => finish(Error('只读操作超时')), 12000);
        const finish = (e: Error | null | undefined, v?: T) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', stop);
          e ? reject(e) : resolve(v!);
        };
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
        else fn(finish);
      });
    const stat = await call<Stats>((cb) => sftp.stat(a.path, cb));
    if (name === 'list_directory') {
      if (!stat.isDirectory()) throw Error('路径不是目录');
      const rows = await call<import('ssh2').FileEntry[]>((cb) => sftp.readdir(a.path, cb));
      return JSON.stringify({
        entries: rows.slice(0, 500).map((f) => ({
          name: f.filename,
          directory: (f.attrs.mode & 0o170000) === 0o040000,
          size: f.attrs.size,
        })),
        truncated: rows.length > 500,
      }).slice(0, 60000);
    }
    if (!stat.isFile()) throw Error('只允许读取普通文件，不读取设备、管道或目录');
    if (stat.size > 2 * 1024 * 1024) throw Error('文件超过 2 MB，请选择较小的文本文件');
    if (name === 'search_text' && !a.query) throw Error('请提供搜索文本');
    const data = await new Promise<Buffer>((resolve, reject) => {
      const stream = sftp.createReadStream(a.path, { flags: 'r', start: 0, end: 2 * 1024 * 1024 });
      const chunks: Buffer[] = [];
      const stop = () => stream.destroy(Error('只读操作已停止'));
      const timer = setTimeout(() => stream.destroy(Error('读取超时')), 12000);
      signal.addEventListener('abort', stop, { once: true });
      stream.on('data', (b: Buffer) => chunks.push(b));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('close', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      });
      if (signal.aborted) stop();
    });
    if (data.includes(0)) throw Error('此文件不是可读取的文本文件');
    const lines = data.toString('utf8').split(/\r?\n/);
    const result = lines
      .map((line, i) => `${i + 1}: ${line}`)
      .filter((_, i) => name !== 'search_text' || lines[i].includes(a.query!))
      .join('\n');
    return (
      result.slice(0, 60000) + (result.length > 60000 ? '\n[内容已截断]' : '') || '没有匹配内容'
    );
  };
}
