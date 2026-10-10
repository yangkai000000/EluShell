import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AIService } from '../electron/ai';
import { ConfigStore } from '../electron/config-store';
import {
  createReadTool,
  readonlyCommand,
  validateTarget,
  type AIReadTool,
} from '../electron/ai-readonly';
import { AIConfigSchema, AIInputSchema, completionBody, type AIEvent } from '../src/ai-shared';

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const sse = (delta: unknown, finish = 'stop') =>
  new Response(
    'data: ' +
      JSON.stringify({ choices: [{ delta, finish_reason: finish }] }) +
      '\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
async function setup(request: typeof fetch, tool: AIReadTool) {
  const dir = await mkdtemp(path.join(tmpdir(), 'elu-readonly-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = new ConfigStore(dir, cipher);
  await store.initialize();
  const events: AIEvent[] = [];
  const service = new AIService(store, cipher, (e) => events.push(e), true, request, tool);
  cleanup.push(() => service.close());
  await service.configure(AIConfigSchema.parse({}), { deepseek: 'test-key' });
  const chat = await service.create('deepseek');
  return { service, chat, events };
}
describe('read-only AI boundary', () => {
  it('rejects shell operations, injected flags and relative paths before remote access', async () => {
    const ftp = vi.fn(),
      exec = vi.fn();
    const tool = createReadTool(ftp, exec),
      signal = new AbortController().signal;
    for (const name of ['exec', 'write_file', 'delete_file', 'chmod'])
      await expect(tool(randomUUID(), name, { path: '/etc/x' }, signal)).rejects.toThrow(
        '没有直接修改',
      );
    expect(() =>
      readonlyCommand('find_paths', { path: '/etc', query: 'x', command: 'rm -rf /' }),
    ).toThrow();
    expect(() => readonlyCommand('find_paths', { path: '-exec', query: 'x' })).toThrow();
    const command = readonlyCommand('find_paths', {
      path: "/etc/x'; touch /tmp/pwn; '",
      query: '$(touch /tmp/pwn)*',
    });
    expect(command).toContain("'\\''");
    expect(command).toContain('\\*');
    expect(ftp).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
  it('reads only regular bounded text files and searches without a shell', async () => {
    const stream = vi.fn(() => Readable.from([Buffer.from('server {\nlisten 80;\n}')]));
    const stat = vi.fn((_: string, cb: Function) => cb(null, { isFile: () => true, size: 25 }));
    const ftp = { stat, createReadStream: stream };
    const exec = vi.fn();
    const tool = createReadTool(async () => ftp as any, exec);
    expect(
      await tool(
        'id',
        'search_text',
        { path: '/etc/itos.conf', query: 'listen' },
        new AbortController().signal,
      ),
    ).toBe('2: listen 80;');
    expect(stream.mock.calls[0]).toEqual([
      '/etc/itos.conf',
      expect.objectContaining({ flags: 'r' }),
    ]);
    stat.mockImplementation((_, cb) => cb(null, { isFile: () => false, size: 0 }));
    await expect(
      tool('id', 'read_file', { path: '/dev/random' }, new AbortController().signal),
    ).rejects.toThrow('普通文件');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(exec).not.toHaveBeenCalled();
  });
  it('rejects cross-server references and invalid image payloads', () => {
    expect(() =>
      validateTarget({
        content: '检查',
        sessionId: randomUUID(),
        attachments: [{ kind: 'path', sessionId: randomUUID(), path: '/etc', label: 'A' }],
      }),
    ).toThrow('其他服务器');
    expect(() =>
      AIInputSchema.parse({
        content: '',
        attachments: [{ kind: 'image', name: 'x', data: 'https://example.org/x.png' }],
      }),
    ).toThrow();
  });
  it('runs a tool loop, feeds actual results back, persists references and sends image content parts', async () => {
    const bodies: any[] = [];
    const tool = vi.fn(async () => '1: listen 8080;');
    const { service, chat, events } = await setup(async (_, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return bodies.length === 1
        ? sse(
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'read1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"/etc/itos.conf"}' },
                },
              ],
            },
            'tool_calls',
          )
        : sse({ content: '实际配置监听 8080。' });
    }, tool);
    const sessionId = randomUUID();
    await service.send(chat.id, {
      content: '检查配置',
      sessionId,
      attachments: [
        { kind: 'selection', label: 'test', sessionId, text: 'error\nline2' },
        { kind: 'image', name: 'test.png', data: 'data:image/png;base64,iVBORw0KGgo=' },
      ],
    });
    await vi.waitFor(() => expect(events.at(-1)?.done).toBe(true));
    expect(events.at(-1)?.message.status).toBe('complete');
    expect(bodies[0].messages[1].content[1].type).toBe('image_url');
    expect(bodies[0].messages[1].content[0].text).toContain('终端引用');
    expect(bodies[1].messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'read1',
      content: '1: listen 8080;',
    });
    expect(tool).toHaveBeenCalledWith(
      sessionId,
      'read_file',
      { path: '/etc/itos.conf' },
      expect.any(AbortSignal),
    );
    const saved = await service.get(chat.id);
    expect(saved.messages[0].content).toBe('检查配置');
    expect(saved.messages[0].attachments).toHaveLength(2);
    expect(JSON.stringify(completionBody(saved))).toContain('listen 8080');
  });
  it('cancels an active tool and never starts the next model request', async () => {
    const request = vi.fn(async () =>
      sse(
        {
          tool_calls: [
            { index: 0, id: 'c', function: { name: 'read_file', arguments: '{"path":"/etc/x"}' } },
          ],
        },
        'tool_calls',
      ),
    );
    const tool = vi.fn(
      (_id, _name, _args, signal: AbortSignal) =>
        new Promise<string>((_, reject) =>
          signal.addEventListener('abort', () => reject(Error('stopped'))),
        ),
    );
    const { service, chat, events } = await setup(request, tool);
    await service.send(chat.id, { content: 'read', sessionId: randomUUID(), attachments: [] });
    await vi.waitFor(() => expect(tool).toHaveBeenCalled());
    service.cancel(chat.id);
    await vi.waitFor(() => expect(events.at(-1)?.done).toBe(true));
    expect(events.at(-1)?.message.status).toBe('stopped');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
