// One in-flight IPC batch per terminal. Acknowledgements arrive after xterm parses it.
export class TerminalOutput {
  private chunks: string[] = [];
  private queued = 0;
  private inFlight = 0;
  private sequence = 0;
  private paused = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private ended?: () => void;
  constructor(
    private send: (data: string, sequence: number) => void,
    private pause: () => void,
    private resume: () => void,
  ) {}
  get pending() {
    return this.queued + this.inFlight;
  }
  push(data: string) {
    if (this.disposed || !data) return;
    this.chunks.push(data);
    this.queued += data.length;
    if (this.pending >= 256 * 1024 && !this.paused) {
      this.paused = true;
      this.pause();
    }
    this.schedule();
  }
  private schedule() {
    if (this.disposed || this.timer || this.inFlight) return;
    if (!this.queued) {
      this.ended?.();
      this.ended = undefined;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 8);
  }
  private flush() {
    if (this.disposed || this.inFlight) return;
    let data = '';
    while (this.chunks.length && data.length < 64 * 1024) {
      const first = this.chunks[0];
      let count = Math.min(first.length, 64 * 1024 - data.length);
      // Keep a UTF-16 surrogate pair together when splitting a batch.
      if (count < first.length && /[\uD800-\uDBFF]/.test(first[count - 1])) count--;
      if (!count) break;
      data += first.slice(0, count);
      if (count === first.length) this.chunks.shift();
      else this.chunks[0] = first.slice(count);
    }
    this.queued -= data.length;
    this.inFlight = data.length;
    this.send(data, ++this.sequence);
  }
  ack(sequence: number) {
    if (this.disposed || !this.inFlight || sequence !== this.sequence) return;
    this.inFlight = 0;
    if (this.paused && this.pending < 64 * 1024 && !this.ended) {
      this.paused = false;
      this.resume();
    }
    this.schedule();
  }
  end(done: () => void) {
    this.ended = done;
    this.schedule();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.chunks = [];
    this.queued = this.inFlight = 0;
    this.ended = undefined;
  }
}
