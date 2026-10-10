import type { SFTPWrapper } from 'ssh2';

// A bounded window avoids one WAN round trip for every chunk while keeping
// progress based on server acknowledgements, not bytes merely queued locally.
export function uploadNginxPackage(
  ftp: SFTPWrapper,
  destination: string,
  bytes: Buffer,
  progress: (sent: number) => void,
  timeoutMs = 600_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let handle: Buffer | undefined;
    let offset = 0,
      pending = 0,
      sent = 0,
      stopped = false;
    const timer = setTimeout(() => finish(Error('上传超时，尚未切换程序')), timeoutMs);
    function finish(error?: Error) {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (!handle) {
        error ? reject(error) : resolve();
        return;
      }
      const closing = handle;
      handle = undefined;
      if (error) {
        reject(error);
        ftp.close(closing, () => {});
      } else {
        const closeTimer = setTimeout(() => reject(Error('上传关闭超时，尚未切换程序')), 15000);
        ftp.close(closing, (e) => {
          clearTimeout(closeTimer);
          e ? reject(e) : resolve();
        });
      }
    }
    function pump() {
      if (stopped || !handle) return;
      if (offset >= bytes.length) {
        if (!pending) finish();
        return;
      }
      const position = offset;
      const length = Math.min(32768, bytes.length - position);
      offset += length;
      pending++;
      ftp.write(handle, bytes, position, length, position, (error) => {
        pending--;
        if (stopped) return;
        if (error) {
          finish(error);
          return;
        }
        sent += length;
        progress(sent);
        pump();
      });
    }
    ftp.open(destination, 'wx', 0o600, (error, opened) => {
      if (stopped) {
        if (opened) ftp.close(opened, () => {});
        return;
      }
      if (error) {
        finish(error);
        return;
      }
      handle = opened;
      for (let i = 0; i < 16 && !stopped; i++) pump();
    });
  });
}
