import { it, expect } from 'vitest';
import { sortFiles, fileOwner } from '../src/file-list';
const data = [
  { name: 'b.log', size: 200, modified: 2, mode: 0o644, directory: false, uid: 1000, gid: 1000 },
  {
    name: 'a.log',
    size: 4000,
    modified: 1,
    mode: 0o600,
    directory: false,
    user: 'deploy',
    group: 'team',
  },
];
it('sorts numeric file fields by values and owner names in both directions without mutating input', () => {
  for (const field of ['size', 'modified', 'mode', 'owner', 'name'] as const) {
    const asc = sortFiles(data, field, false),
      desc = sortFiles(data, field, true);
    expect(asc.map((f) => f.name)).toEqual(desc.map((f) => f.name).reverse());
  }
  expect(sortFiles(data, 'size', false)[0].size).toBe(200);
  expect(data[0].name).toBe('b.log');
  expect(fileOwner(data[0])).toBe('1000 / 1000');
  expect(fileOwner(data[1])).toBe('deploy / team');
});
