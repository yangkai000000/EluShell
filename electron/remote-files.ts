import type { SFTPWrapper, Stats } from 'ssh2';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, lstat, readdir, realpath, unlink, open } from 'node:fs/promises';
import { atomicReplace } from './atomic-replace';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable, addAbortSignal } from 'node:stream';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { FileAction, RemoteDocument } from '../src/shared';
import { TransferManager, type Progress } from './transfers';
import { diagnosticError, traceSftp, type DiagnosticFields } from './transfer-diagnostics';
const MAX_TEXT = 4 * 1024 * 1024;
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const call = <T>(fn: (cb: (err: Error | undefined | null, value: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));
const voidCall = (fn: (cb: (err?: Error | null) => void) => void) =>
  new Promise<void>((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));
export function safeName(name: string) {
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name))
    throw Error('文件名不能包含路径分隔符');
  return name;
}
export function localName(name: string) {
  safeName(name);
  if (
    /[<>:"|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
  )
    throw Error('Windows 不支持文件名：' + name);
  return name;
}
export function mutationPath(value: string) {
  if (!value.startsWith('/') || value.includes('\0')) throw Error('需要绝对远程路径');
  const p = path.posix.normalize(value);
  if (p === '/') throw Error('不能修改或删除文件系统根目录');
  return p;
}
type Entry = {
  remote: string;
  relative: string;
  directory: boolean;
  size: number;
  mode: number;
  link: boolean;
};
type DocumentState = {
  sessionId: string;
  path: string;
  hash: string;
  mode: number;
  newline: 'LF' | 'CRLF';
};
export class RemoteFiles {
  private documents = new Map<string, DocumentState>();
  private saving = new Set<string>();
  constructor(
    private ftp: (id: string) => Promise<SFTPWrapper>,
    private transfers: TransferManager,
    private connectionInfo?: (id: string) => DiagnosticFields,
  ) {}
  async stat(sftp: SFTPWrapper, p: string) {
    return call<Stats>((cb) => sftp.lstat(p, cb));
  }
  private async plan(sftp: SFTPWrapper, root: string, allowLinks = false): Promise<Entry[]> {
    const list: Entry[] = [];
    const walk = async (p: string, relative: string, depth: number) => {
      if (depth > 64 || list.length >= 20000)
        throw Error('目录层级或文件数量超出限制（64 层 / 20000 项）');
      const stats = await this.stat(sftp, p);
      const link = stats.isSymbolicLink();
      if (link && !allowLinks) throw Error('目录包含符号链接，未跟随：' + p);
      if (!link && !stats.isFile() && !stats.isDirectory()) throw Error('不支持特殊设备文件：' + p);
      list.push({
        remote: p,
        relative,
        directory: stats.isDirectory(),
        size: stats.size,
        mode: stats.mode,
        link,
      });
      if (stats.isDirectory()) {
        const children = await call<any[]>((cb) => sftp.readdir(p, cb));
        for (const f of children) {
          safeName(f.filename);
          await walk(
            path.posix.join(p, f.filename),
            path.posix.join(relative, f.filename),
            depth + 1,
          );
        }
      }
    };
    await walk(root, '', 0);
    return list;
  }
  private async replace(sftp: SFTPWrapper, temp: string, target: string) {
    try {
      await voidCall((cb) => sftp.ext_openssh_rename(temp, target, cb));
    } catch (e) {
      if (!/unsupported|not supported|does not support/i.test((e as Error).message)) throw e;
      await voidCall((cb) => sftp.rename(temp, target, cb));
    }
  }
  private async write(
    sftp: SFTPWrapper,
    target: string,
    source: Readable,
    progress: Progress,
    done: number,
    mode?: number,
  ) {
    const temp = path.posix.join(path.posix.dirname(target), '.elushell-' + randomUUID() + '.part');
    let bytes = 0;
    const trace = progress.trace;
    let stage = 'remote.open';
    let remoteOpened = false;
    type SftpOutput = ReturnType<SFTPWrapper['createWriteStream']> & { bytesWritten: number };
    let output: SftpOutput | undefined;
    trace?.('upload.file', {
      target,
      temp,
      mode: (mode === undefined ? 0o644 : mode & 0o7777).toString(8),
      flags: 'wx',
    });
    // The first stream error identifies the origin; pipeline can re-emit it on
    // both streams while tearing down, so those later errors are not new causes.
    let firstStreamError = false;
    const streamError = (side: string, error: unknown) => {
      if (firstStreamError) return;
      firstStreamError = true;
      trace?.('upload.stream-error', {
        side,
        stage,
        remoteOpened,
        bufferedBytes: bytes,
        acknowledgedBytes: output?.bytesWritten ?? 0,
        ...diagnosticError(error),
      });
    };
    source.once('error', (error) => streamError('local.read', error));
    try {
      output = sftp.createWriteStream(temp, {
        flags: 'wx',
        mode: mode === undefined ? 0o644 : mode & 0o7777,
      }) as SftpOutput;
      output.once('open', () => {
        remoteOpened = true;
        stage = 'remote.write';
        trace?.('upload.remote-opened');
      });
      output.once('error', (error: unknown) => streamError('remote.stream', error));
      output.once('finish', () =>
        trace?.('upload.stream-finish', { acknowledgedBytes: output?.bytesWritten ?? 0 }),
      );
      await pipeline(
        source,
        new Transform({
          transform(chunk, _encoding, cb) {
            bytes += chunk.length;
            progress.update({ done: done + bytes });
            cb(null, chunk);
          },
        }),
        output,
        { signal: progress.signal },
      );
      stage = 'remote.chmod';
      if (mode !== undefined) await voidCall((cb) => sftp.chmod(temp, mode & 0o7777, cb));
      stage = 'remote.rename';
      await this.replace(sftp, temp, target);
      trace?.('upload.file-completed', { target, acknowledgedBytes: output.bytesWritten });
    } catch (e) {
      trace?.('upload.file-failed', {
        stage,
        target,
        temp,
        bufferedBytes: bytes,
        acknowledgedBytes: output?.bytesWritten ?? 0,
        ...diagnosticError(e),
      });
      await voidCall((cb) => sftp.unlink(temp, cb)).catch(() => {});
      throw e;
    }
  }
  async downloadMany(sessionId: string, paths: string[], base: string) {
    let next = 0,
      completed = 0;
    const failed: { path: string; error: string }[] = [];
    await Promise.all(
      Array.from({ length: Math.min(3, paths.length) }, async () => {
        while (next < paths.length) {
          const remote = paths[next++];
          try {
            await this.download(sessionId, remote, base);
            completed++;
          } catch (e) {
            failed.push({ path: remote, error: (e as Error).message });
          }
        }
      }),
    );
    return { completed, failed };
  }
  async download(sessionId: string, remote: string, base: string) {
    return this.transfers.run(
      sessionId,
      'download',
      path.posix.basename(remote) || 'root',
      async (progress) => {
        const sftp = await this.ftp(sessionId),
          entries = await this.plan(sftp, remote);
        for (const e of entries)
          for (const segment of e.relative.split('/').filter(Boolean)) localName(segment);
        progress.signal.throwIfAborted();
        await mkdir(base, { recursive: true });
        base = await realpath(base);
        const name = localName(path.posix.basename(remote) || 'root');
        let destination = '';
        for (let n = 0; n < 10000; n++) {
          destination = path.join(base, n ? name + ' (' + n + ')' : name);
          try {
            if (entries[0].directory) await mkdir(destination);
            else {
              const f = await open(destination, 'wx');
              await f.close();
            }
            break;
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n === 9999) throw e;
          }
        }
        const total = entries.filter((e) => !e.directory).reduce((s, e) => s + e.size, 0),
          filesTotal = entries.filter((e) => !e.directory).length;
        progress.update({ state: 'running', total, filesTotal, localPath: destination });
        let done = 0,
          filesDone = 0;
        for (const e of entries) {
          progress.signal.throwIfAborted();
          const target = e.relative
            ? path.join(destination, ...e.relative.split('/'))
            : destination;
          if (e.directory) {
            if (e.relative) await mkdir(target);
            continue;
          }
          const parent = await realpath(path.dirname(target));
          if (
            parent !== base &&
            !parent.startsWith(destination + path.sep) &&
            parent !== destination
          )
            throw Error('下载路径超出目标目录');
          const temp = target + '.' + randomUUID() + '.part';
          let moved = 0;
          try {
            await pipeline(
              sftp.createReadStream(e.remote),
              new Transform({
                transform(chunk, _encoding, cb) {
                  moved += chunk.length;
                  progress.update({ done: done + moved });
                  cb(null, chunk);
                },
              }),
              createWriteStream(temp, { flags: 'wx' }),
              { signal: progress.signal },
            );
            await atomicReplace(temp, target);
          } catch (err) {
            await unlink(temp).catch(() => {});
            throw err;
          }
          done += e.size;
          filesDone++;
          progress.update({ done, filesDone });
        }
        return destination;
      },
    );
  }
  async upload(
    sessionId: string,
    local: string,
    remoteParent: string,
    confirm: (target: string) => Promise<boolean>,
    signal?: AbortSignal,
  ) {
    return this.transfers.run(sessionId, 'upload', path.basename(local), async (progress) => {
      if (signal) progress = { ...progress, signal: AbortSignal.any([progress.signal, signal]) };
      progress.signal.throwIfAborted();
      const trace = progress.trace;
      trace?.('upload.context', { local, remoteParent, ...this.connectionInfo?.(sessionId) });
      const rawSftp = await this.ftp(sessionId);
      const sftp = trace ? traceSftp(rawSftp, trace) : rawSftp;
      const target = path.posix.join(remoteParent, safeName(path.basename(local)));
      if (trace) {
        // Metadata only. A diagnostic probe must not block uploads indefinitely.
        const probes = Promise.allSettled([
          call<Stats>((cb) => sftp.stat(remoteParent, cb)),
          call<string>((cb) => sftp.realpath(remoteParent, cb)),
        ]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          probes,
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              trace('upload.probe-timeout');
              resolve();
            }, 3000);
          }),
        ]);
        clearTimeout(timer);
      }
      try {
        await this.stat(sftp, target);
        if (!(await confirm(target))) throw new DOMException('已取消覆盖', 'AbortError');
      } catch (e) {
        if ((e as any).code !== 2) throw e;
      }
      const entries: {
        local: string;
        remote: string;
        directory: boolean;
        size: number;
        mode: number;
      }[] = [];
      const walk = async (l: string, r: string, depth: number) => {
        progress.signal.throwIfAborted();
        if (depth > 64 || entries.length >= 20000) throw Error('目录过大');
        let st;
        try {
          st = await lstat(l);
        } catch (error) {
          trace?.('local.stat-error', { local: l, ...diagnosticError(error) });
          throw error;
        }
        trace?.('local.stat', { local: l, size: st.size, mode: st.mode.toString(8) });
        if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory()))
          throw Error('不跟随符号链接或特殊文件：' + l);
        entries.push({
          local: l,
          remote: r,
          directory: st.isDirectory(),
          size: st.size,
          mode: st.mode,
        });
        if (st.isDirectory())
          for (const name of await readdir(l)) {
            safeName(name);
            await walk(path.join(l, name), path.posix.join(r, name), depth + 1);
          }
      };
      await walk(local, target, 0);
      const total = entries.filter((e) => !e.directory).reduce((s, e) => s + e.size, 0),
        filesTotal = entries.filter((e) => !e.directory).length;
      progress.update({ state: 'running', total, filesTotal });
      let done = 0,
        filesDone = 0;
      for (const e of entries) {
        progress.signal.throwIfAborted();
        let existing: Stats | undefined;
        try {
          existing = await this.stat(sftp, e.remote);
        } catch (err) {
          if ((err as any).code !== 2) throw err;
        }
        if (existing?.isSymbolicLink()) throw Error('不能覆盖符号链接：' + e.remote);
        if (e.directory) {
          if (!existing) await voidCall((cb) => sftp.mkdir(e.remote, cb));
          else if (!existing.isDirectory()) throw Error('目标不是文件夹：' + e.remote);
        } else {
          if (existing?.isDirectory()) throw Error('目标是文件夹：' + e.remote);
          trace?.('local.read-start', { local: e.local, remotePath: e.remote });
          const source = createReadStream(e.local);
          source.once('open', () => trace?.('local.read-opened', { local: e.local }));
          source.once('end', () =>
            trace?.('local.read-completed', { local: e.local, bytesRead: source.bytesRead }),
          );
          await this.write(sftp, e.remote, source, progress, done, existing?.mode);
          done += e.size;
          filesDone++;
          progress.update({ done, filesDone });
        }
      }
      return target;
    });
  }
  async action(sessionId: string, action: FileAction) {
    const sftp = await this.ftp(sessionId),
      p = mutationPath(action.path);
    if (action.kind === 'rename') {
      const target = path.posix.join(path.posix.dirname(p), safeName(action.name || ''));
      try {
        await this.stat(sftp, target);
        throw Error('目标名称已存在');
      } catch (e) {
        if ((e as any).code !== 2) throw e;
      }
      await voidCall((cb) => sftp.rename(p, target, cb));
      return;
    }
    if (action.kind === 'mkdir') {
      await voidCall((cb) => sftp.mkdir(p, cb));
      return;
    }
    if (action.kind === 'touch') {
      const handle = await call<Buffer>((cb) => sftp.open(p, 'wx', cb));
      await voidCall((cb) => sftp.close(handle, cb));
      return;
    }
    const st = await this.stat(sftp, p);
    if (action.kind === 'chmod') {
      if (
        action.mode === undefined ||
        !Number.isInteger(action.mode) ||
        action.mode < 0 ||
        action.mode > 0o7777
      )
        throw Error('无效权限');
      const entries = action.recursive
        ? await this.plan(sftp, p)
        : [{ remote: p, link: st.isSymbolicLink() }];
      for (const e of entries) {
        if (e.link) throw Error('不修改符号链接权限');
        await voidCall((cb) => sftp.chmod(e.remote, action.mode!, cb));
      }
      return;
    }
    if (action.kind === 'delete') {
      const entries = await this.plan(sftp, p, true);
      for (const e of entries.reverse()) {
        if (e.directory) await voidCall((cb) => sftp.rmdir(e.remote, cb));
        else await voidCall((cb) => sftp.unlink(e.remote, cb));
      }
    }
  }
  async actions(
    sessionId: string,
    action: { kind: 'delete' | 'chmod'; paths: string[]; mode?: number; recursive?: boolean },
  ) {
    if (!['delete', 'chmod'].includes(action.kind)) throw Error('无效批量操作');
    if (!action.paths.length || action.paths.length > 20000)
      throw Error('请选择 1 至 20000 个项目');
    const paths = [...new Set(action.paths.map(mutationPath))];
    if (
      action.kind === 'chmod' &&
      (action.mode === undefined ||
        !Number.isInteger(action.mode) ||
        action.mode < 0 ||
        action.mode > 0o7777)
    )
      throw Error('无效权限');
    // Remove overlapping descendants for recursive operations: process each tree once.
    const selected = new Set(paths);
    const targets =
      action.kind === 'delete' || action.recursive
        ? paths.filter((p) => {
            for (
              let parent = path.posix.dirname(p);
              parent !== '/';
              parent = path.posix.dirname(parent)
            )
              if (selected.has(parent)) return false;
            return true;
          })
        : paths;
    const completed: string[] = [],
      failed: { path: string; error: string }[] = [];
    for (const path of targets) {
      try {
        await this.action(sessionId, {
          kind: action.kind,
          path,
          mode: action.mode,
          recursive: action.recursive,
        });
        completed.push(path);
      } catch (e) {
        failed.push({ path, error: (e as Error).message });
      }
    }
    return { completed, failed };
  }
  async moveMany(sessionId: string, paths: string[], directory: string) {
    if (!paths.length || paths.length > 20000) throw Error('请选择 1 至 20000 个项目');
    if (!directory.startsWith('/') || directory.includes('\0')) throw Error('需要绝对目标目录');
    const sources = [...new Set(paths.map(mutationPath))];
    const sftp = await this.ftp(sessionId);
    const targetDir = await call<string>((cb) => sftp.realpath(directory, cb));
    const targetStat = await call<Stats>((cb) => sftp.stat(targetDir, cb));
    if (!targetStat.isDirectory()) throw Error('目标不是文件夹：' + directory);
    const plan: { source: string; target: string; canonical: string }[] = [];
    const targets = new Set<string>();
    // Validate the whole batch before moving anything. Resolve directory aliases,
    // but move a selected symbolic link itself rather than its destination.
    for (const source of sources) {
      const st = await this.stat(sftp, source);
      const parent = await call<string>((cb) => sftp.realpath(path.posix.dirname(source), cb));
      const name = safeName(path.posix.basename(source));
      const canonical = path.posix.join(parent, name);
      const target = path.posix.join(targetDir, name);
      if (parent === targetDir) throw Error('项目已在目标目录中：' + source);
      if (st.isDirectory() && (targetDir === canonical || targetDir.startsWith(canonical + '/')))
        throw Error('不能将文件夹移到自身或其子目录：' + source);
      if (targets.has(target)) throw Error('所选项目存在同名文件：' + name);
      targets.add(target);
      try {
        await this.stat(sftp, target);
        throw Error('目标已存在同名项目，未移动任何文件：' + target);
      } catch (error) {
        if ((error as { code?: number }).code !== 2) throw error;
      }
      plan.push({ source, target, canonical });
    }
    const canonicalPaths = new Set(plan.map((entry) => entry.canonical));
    for (const entry of plan) {
      let parent = path.posix.dirname(entry.canonical);
      while (parent !== '/') {
        if (canonicalPaths.has(parent)) throw Error('不能同时移动文件夹和它的子项目');
        parent = path.posix.dirname(parent);
      }
    }
    const moved: string[] = [],
      failed: { path: string; error: string }[] = [];
    for (const entry of plan) {
      try {
        // SFTP v3 RENAME does not replace an existing target. Do not use the
        // overwrite-capable posix-rename extension or copy/delete fallbacks.
        await voidCall((cb) => sftp.rename(entry.source, entry.target, cb));
        moved.push(entry.source);
      } catch (error) {
        failed.push({ path: entry.source, error: (error as Error).message });
      }
    }
    return { moved, failed };
  }
  private async buffer(sftp: SFTPWrapper, p: string, progress: Progress) {
    const stat = await call<Stats>((cb) => sftp.stat(p, cb));
    if (!stat.isFile() || stat.size > MAX_TEXT)
      throw Error('编辑器仅支持 4 MiB 以内的普通文本文件');
    progress.update({ state: 'running', total: stat.size, filesTotal: 1 });
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = addAbortSignal(progress.signal, sftp.createReadStream(p));
    for await (const chunk of stream) {
      progress.signal.throwIfAborted();
      size += chunk.length;
      if (size > MAX_TEXT) {
        stream.destroy();
        throw Error('文本文件过大');
      }
      chunks.push(chunk);
      progress.update({ done: size });
    }
    return { data: Buffer.concat(chunks), mode: stat.mode };
  }
  async openText(sessionId: string, p: string): Promise<RemoteDocument> {
    return this.transfers.run(
      sessionId,
      'download',
      '打开编辑 · ' + path.posix.basename(p),
      async (progress) => {
        const sftp = await this.ftp(sessionId);
        p = await call<string>((cb) => sftp.realpath(p, cb));
        const { data, mode } = await this.buffer(sftp, p, progress);
        if (data.includes(0)) throw Error('这是二进制文件，无法作为文本打开');
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
        } catch {
          throw Error('文件不是有效的 UTF-8 文本，请下载后使用对应编码的工具打开');
        }
        const id = randomUUID(),
          newline = text.includes('\r\n') ? 'CRLF' : 'LF';
        this.documents.set(id, { sessionId, path: p, hash: hash(data), mode, newline });
        return { id, sessionId, path: p, text, newline };
      },
    );
  }
  async saveText(id: string, text: string) {
    const doc = this.documents.get(id);
    if (!doc) throw Error('文档已关闭');
    if (this.saving.has(id)) throw Error('正在保存');
    this.saving.add(id);
    try {
      return await this.transfers.run(
        doc.sessionId,
        'upload',
        '保存编辑 · ' + path.posix.basename(doc.path),
        async (progress) => {
          const data = Buffer.from(
            text.replace(/\r?\n/g, doc.newline === 'CRLF' ? '\r\n' : '\n'),
            'utf8',
          );
          if (data.length > MAX_TEXT) throw Error('文件超过编辑大小限制');
          const sftp = await this.ftp(doc.sessionId);
          const current = await this.buffer(sftp, doc.path, { ...progress, update: () => {} });
          if (hash(current.data) !== doc.hash)
            throw Error(
              '远端文件已被其他程序修改。请保留当前内容并重新打开比较，未覆盖服务器文件。',
            );
          progress.update({ state: 'running', done: 0, total: data.length, filesTotal: 1 });
          await this.write(sftp, doc.path, Readable.from([data]), progress, 0, current.mode);
          doc.hash = hash(data);
        },
      );
    } finally {
      this.saving.delete(id);
    }
  }
  closeText(id: string) {
    this.documents.delete(id);
  }
}
