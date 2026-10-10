import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SFTPWrapper } from 'ssh2';

export type DiagnosticFields = Record<string, string | number | boolean | undefined>;
export type DiagnosticTrace = (event: string, fields?: DiagnosticFields) => void;

export function diagnosticError(error: unknown): DiagnosticFields {
  const e = error as NodeJS.ErrnoException;
  return {
    errorName: e?.name,
    errorCode: e?.code,
    errorMessage: String(e?.message ?? error).slice(0, 2048),
    syscall: e?.syscall,
    errorPath: e?.path,
  };
}

// Dedicated bounded log, deliberately never serializes profiles, SSH debug output,
// file buffers, shell output, credentials or arbitrary error objects.
export class TransferDiagnostics {
  private pending = Promise.resolve();
  private queued = 0;
  private dropped = 0;
  private failure: string | undefined;
  readonly directory: string;
  constructor(
    root: string,
    private version: string,
    private maxBytes = 2 * 1024 * 1024,
  ) {
    this.directory = path.join(root, 'logs');
    this.record('runtime', this.runtime());
  }
  private runtime(): DiagnosticFields {
    return {
      version: this.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      electron: process.versions.electron,
      node: process.versions.node,
      logSchema: 1,
    };
  }
  private file(index = 0) {
    return path.join(this.directory, `transfers${index ? '.' + index : ''}.jsonl`);
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  record(event: string, fields: DiagnosticFields = {}) {
    if (this.queued >= 1000) {
      this.dropped++;
      return;
    }
    // Bounded primitive fields; local home names are removed from exported paths.
    const clean: DiagnosticFields = {};
    for (const [key, value] of Object.entries(fields)) {
      if (/password|secret|token|privatekey|passphrase|content|buffer/i.test(key)) continue;
      if (typeof value === 'string')
        clean[key] = value.split(os.homedir()).join('<home>').slice(0, 4096);
      else if (typeof value === 'number' || typeof value === 'boolean') clean[key] = value;
    }
    const line = JSON.stringify({ ...clean, time: new Date().toISOString(), event }) + '\n';
    this.queued++;
    void this.enqueue(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const bytes = await stat(this.file()).then(
        (s) => s.size,
        (e) => {
          if (e.code !== 'ENOENT') throw e;
          return 0;
        },
      );
      if (bytes + Buffer.byteLength(line) > this.maxBytes) {
        await unlink(this.file(2)).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        for (const index of [1, 0])
          await rename(this.file(index), this.file(index + 1)).catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
      }
      await appendFile(this.file(), line, { mode: 0o600 });
    })
      .catch((e) => {
        this.failure = String(e.message);
      })
      .finally(() => {
        this.queued--;
      });
  }
  trace(transferId: string, sessionId: string): DiagnosticTrace {
    return (event, fields) => this.record(event, { ...fields, transferId, sessionId });
  }
  async flush() {
    await this.pending;
  }
  async exportTo(destination: string) {
    return this.enqueue(async () => {
      const header =
        JSON.stringify({
          event: 'export',
          time: new Date().toISOString(),
          ...this.runtime(),
          droppedEvents: this.dropped,
          loggingError: this.failure,
          includes:
            'Connection host, login username, file paths, SFTP stages and errors. No credentials or file content.',
        }) + '\n';
      const parts = [header];
      for (const index of [2, 1, 0]) {
        try {
          parts.push(await readFile(this.file(index), 'utf8'));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
      if (parts.length === 1 && this.failure) throw Error('诊断日志写入失败：' + this.failure);
      await writeFile(destination, parts.join(''), { mode: 0o600 });
      if (process.platform !== 'win32') await chmod(destination, 0o600);
    });
  }
}

const operations = new Set([
  'stat',
  'lstat',
  'realpath',
  'mkdir',
  'open',
  'write',
  'fchmod',
  'chmod',
  'close',
  'unlink',
  'rename',
  'ext_openssh_rename',
]);

// A transfer-scoped proxy observes the original ssh2 callbacks, including the
// fchmod/chmod performed internally by WriteStream. It never changes the shared
// SFTP connection or logs handles/buffers. Errors are always logged; successful
// WRITE requests are sampled to keep large uploads cheap.
export function traceSftp(sftp: SFTPWrapper, trace: DiagnosticTrace): SFTPWrapper {
  let sequence = 0,
    nextWriteSample = 0,
    acknowledgedBytes = 0;
  return new Proxy(sftp, {
    get(target, key, receiver) {
      const method = Reflect.get(target, key, receiver);
      if (typeof key !== 'string' || !operations.has(key) || typeof method !== 'function')
        return method;
      return (...args: any[]) => {
        const operationId = ++sequence;
        const fields: DiagnosticFields = { operation: key, operationId };
        if (
          [
            'stat',
            'lstat',
            'realpath',
            'mkdir',
            'open',
            'chmod',
            'unlink',
            'rename',
            'ext_openssh_rename',
          ].includes(key)
        )
          fields.remotePath = args[0];
        if (key === 'rename' || key === 'ext_openssh_rename') fields.destination = args[1];
        if (key === 'open') {
          fields.flags = typeof args[1] === 'string' ? args[1] : String(args[1]);
          fields.mode = typeof args[2] === 'number' ? args[2].toString(8) : undefined;
        }
        if (key === 'chmod' || key === 'fchmod') fields.mode = Number(args[1]).toString(8);
        let sample = true;
        if (key === 'write') {
          fields.requestedBytes = args[3];
          fields.offset = args[4];
          sample = args[4] >= nextWriteSample;
          if (sample) nextWriteSample = args[4] + 8 * 1024 * 1024;
        }
        if (sample) trace('sftp.request', fields);
        const started = Date.now();
        const callback = args[args.length - 1];
        if (typeof callback === 'function')
          args[args.length - 1] = (error: unknown, ...values: any[]) => {
            const result: DiagnosticFields = { ...fields, elapsedMs: Date.now() - started };
            if (error) trace('sftp.error', { ...result, ...diagnosticError(error) });
            else {
              if (key === 'write') {
                acknowledgedBytes += typeof values[0] === 'number' ? values[0] : args[3];
                result.acknowledgedBytes = acknowledgedBytes;
              }
              if (key === 'stat' || key === 'lstat') {
                const stats = values[0];
                result.mode = stats?.mode?.toString(8);
                result.uid = stats?.uid;
                result.gid = stats?.gid;
                result.size = stats?.size;
              }
              if (key === 'realpath') result.resolvedPath = values[0];
              if (sample) trace('sftp.success', result);
            }
            callback(error, ...values);
          };
        try {
          return Reflect.apply(method, target, args);
        } catch (error) {
          trace('sftp.error', { ...fields, ...diagnosticError(error) });
          throw error;
        }
      };
    },
  });
}
