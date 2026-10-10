import { posix as path } from 'node:path';
type Location = { location: string; locationSource: 'entry' | 'cwd' | 'executable' | 'unknown' };
const absolute = (value: string, cwd: string) =>
  value.startsWith('/')
    ? path.normalize(value)
    : cwd.startsWith('/')
      ? path.resolve(cwd, value)
      : '';
// Only consume known interpreter options. Unknown launch forms fall back to cwd,
// rather than presenting an option value or the runtime itself as the service.
function scriptArgument(
  args: string[],
  kind: 'node' | 'python' | 'shell' | 'dotnet',
): string | undefined {
  const values = new Set(
    kind === 'node'
      ? [
          '-r',
          '--require',
          '--import',
          '--loader',
          '--experimental-loader',
          '--conditions',
          '-C',
          '--inspect-port',
          '--icu-data-dir',
          '--title',
        ]
      : kind === 'python'
        ? ['-W', '-X', '--check-hash-based-pycs']
        : kind === 'dotnet'
          ? [
              '--depsfile',
              '--runtimeconfig',
              '--additionalprobingpath',
              '--additional-deps',
              '--fx-version',
            ]
          : [],
  );
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (kind === 'dotnet' && i === 1 && arg === 'exec') continue;
    if (arg === '--') return args[i + 1];
    if (['-c', '-m', '-e', '--eval', '-p', '--print', '-'].includes(arg)) return;
    if (values.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      if (arg.includes('=')) continue;
      if (kind === 'python' && /^-[bBdEhiIOqRsSuvVx]+$/.test(arg)) continue;
      if (kind === 'shell' && /^-[aefnuvx]+$/.test(arg)) continue;
      if (
        kind === 'node' &&
        /^(--inspect(?:-brk|-wait)?|--enable-source-maps|--no-warnings|--trace-warnings|--experimental-strip-types|--watch)$/.test(
          arg,
        )
      )
        continue;
      return;
    }
    if (kind === 'dotnet' && !/\.dll$/i.test(arg)) return;
    if (kind === 'node' && !arg.includes('/') && !/\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/i.test(arg))
      return;
    return arg;
  }
}
export function processLocation(executable: string, cwd: string, argv: string[]): Location {
  const runtime = path.basename(executable || argv[0] || '').replace(/ \(deleted\)$/, '');
  let entry: string | undefined,
    interpreted = false;
  if (/^java(?:\d+)?$/.test(runtime)) {
    interpreted = true;
    const values = new Set([
      '-cp',
      '-classpath',
      '--class-path',
      '-p',
      '--module-path',
      '--upgrade-module-path',
      '--add-modules',
      '--limit-modules',
      '--add-exports',
      '--add-opens',
      '--add-reads',
      '--patch-module',
    ]);
    let jarMode = false;
    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '-jar') {
        jarMode = true;
        continue;
      }
      if (['-m', '--module'].includes(arg)) break;
      if (values.has(arg)) {
        i++;
        continue;
      }
      if (!arg.startsWith('-')) {
        if (jarMode && !arg.startsWith('@')) entry = arg;
        break;
      }
    }
  } else if (/^(node|nodejs)$/.test(runtime)) {
    interpreted = true;
    entry = scriptArgument(argv, 'node');
  } else if (/^python(?:\d+(?:\.\d+)*)?$/.test(runtime)) {
    interpreted = true;
    entry = scriptArgument(argv, 'python');
  } else if (runtime === 'dotnet') {
    interpreted = true;
    entry = scriptArgument(argv, 'dotnet');
  } else if (/^(?:ba|da|z|k)?sh$/.test(runtime)) {
    interpreted = true;
    entry = scriptArgument(argv, 'shell');
  }
  if (entry && !entry.startsWith('-')) {
    const location = absolute(entry, cwd);
    if (location) return { location, locationSource: 'entry' };
  }
  if (interpreted)
    return cwd
      ? { location: cwd, locationSource: 'cwd' }
      : { location: '', locationSource: 'unknown' };
  if (executable) return { location: executable, locationSource: 'executable' };
  return cwd
    ? { location: cwd, locationSource: 'cwd' }
    : { location: '', locationSource: 'unknown' };
}
export function decodeArgv(hex: string): string[] {
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return [];
  const argv = Buffer.from(hex, 'hex').toString('utf8').split('\0');
  if (argv.at(-1) === '') argv.pop();
  return argv;
}
