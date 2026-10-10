import { randomUUID } from 'node:crypto';
import type { Transfer } from '../src/shared';
import {
  diagnosticError,
  type DiagnosticTrace,
  type TransferDiagnostics,
} from './transfer-diagnostics';
export type Progress = {
  signal: AbortSignal;
  update: (patch: Partial<Transfer>) => void;
  trace?: DiagnosticTrace;
};
export class TransferManager {
  private jobs = new Map<string, Transfer>();
  private controllers = new Map<string, AbortController>();
  constructor(
    private emit: (job: Transfer) => void,
    private diagnostics?: TransferDiagnostics,
  ) {}
  list() {
    return [...this.jobs.values()].reverse();
  }
  cancel(id: string) {
    this.controllers.get(id)?.abort();
  }
  async run<T>(
    sessionId: string,
    direction: Transfer['direction'],
    label: string,
    work: (p: Progress) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID(),
      controller = new AbortController();
    const job: Transfer = {
      id,
      sessionId,
      direction,
      label,
      state: 'preparing',
      done: 0,
      total: 0,
      filesDone: 0,
      filesTotal: 0,
      started: Date.now(),
    };
    this.jobs.set(id, job);
    this.controllers.set(id, controller);
    this.emit({ ...job });
    const trace = this.diagnostics?.trace(id, sessionId);
    trace?.('transfer.start', { direction, label });
    let last = 0;
    const update = (patch: Partial<Transfer>) => {
      Object.assign(job, patch);
      if (Date.now() - last > 80 || patch.state) {
        last = Date.now();
        this.emit({ ...job });
      }
    };
    try {
      const result = await work({ signal: controller.signal, update, trace });
      update({ state: 'completed', done: job.total, filesDone: job.filesTotal });
      trace?.('transfer.completed', { total: job.total, filesTotal: job.filesTotal });
      return result;
    } catch (e) {
      trace?.('transfer.failed', {
        ...diagnosticError(e),
        cancelled: controller.signal.aborted || (e as Error).name === 'AbortError',
        bufferedBytes: job.done,
        total: job.total,
        filesDone: job.filesDone,
      });
      update({
        state:
          controller.signal.aborted || (e as Error).name === 'AbortError' ? 'cancelled' : 'failed',
        error: controller.signal.aborted ? '已取消' : (e as Error).message,
      });
      throw e;
    } finally {
      this.controllers.delete(id);
      if (this.jobs.size > 150) {
        for (const [key, value] of this.jobs) {
          if (!this.controllers.has(key) && value !== job) {
            this.jobs.delete(key);
            break;
          }
        }
      }
    }
  }
}
