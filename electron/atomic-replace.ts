import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

// Windows may briefly hold the destination open during a read or antivirus scan.
// Retry the atomic replacement; never remove the existing configuration first.
export async function atomicReplace(
  source: string,
  target: string,
  replace = rename,
  pause: (ms: number) => Promise<unknown> = setTimeout,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await replace(source, target);
      return;
    } catch (error) {
      if (
        attempt === 5 ||
        !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')
      )
        throw error;
      await pause(20 * 2 ** attempt);
    }
  }
}
