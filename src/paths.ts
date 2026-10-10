export function remotePath(path: string, base = '/') {
  const parts = (path.startsWith('/') ? path : base + '/' + path).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return '/' + out.join('/');
}
export function ancestors(path: string) {
  const result = ['/'];
  let cursor = '';
  for (const name of path.split('/').filter(Boolean)) {
    cursor += '/' + name;
    result.push(cursor);
  }
  return result;
}
