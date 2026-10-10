import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  AIConfigSchema,
  completionBody,
  contextUsage,
  responseBlocks,
  effortOptions,
  type AIChat,
  type AIEvent,
} from '../src/ai-shared';
import { AIService, SSEDecoder } from '../electron/ai';
import { ConfigStore } from '../electron/config-store';

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s).reverse(),
  decryptString: (s: Buffer) => Buffer.from(s).reverse().toString(),
};
const directories: string[] = [],
  services: AIService[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true });
});
const frame = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';
function streamResponse(text = '检查端口：\n```bash\nss -lntp\n```', reasoning = '先检查监听端口') {
  const bytes = new TextEncoder().encode(
    frame({ choices: [{ delta: { reasoning_content: reasoning } }] }) +
      frame({ choices: [{ delta: { content: text } }] }) +
      frame({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 42 },
      }) +
      'data: [DONE]\n\n',
  );
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
async function setup(request: typeof fetch = async () => streamResponse()) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'elu-ai-'));
  directories.push(dir);
  const store = new ConfigStore(dir, cipher);
  await store.initialize();
  const events: AIEvent[] = [];
  const service = new AIService(store, cipher, (e) => events.push(e), true, request);
  services.push(service);
  await service.configure(AIConfigSchema.parse({}), {
    deepseek: 'secret-key-test',
    kimi: 'kimi-secret-key',
  });
  return { dir, service, events, store };
}
async function done(events: AIEvent[], count = 1) {
  for (let i = 0; i < 200; i++) {
    if (events.filter((e) => e.done).length >= count) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error('missing completion event');
}
describe('provider requests and context', () => {
  function chat(provider: 'deepseek' | 'kimi', model: string): AIChat {
    return {
      id: randomUUID(),
      title: 'test',
      provider,
      profile: { ...AIConfigSchema.parse({}).profiles[provider], model },
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: randomUUID(),
          role: 'assistant',
          content: 'answer',
          reasoning: 'reason',
          status: 'complete',
        },
      ],
    };
  }
  it('DeepSeek sends thinking and effort without tools or old reasoning', () => {
    const c = chat('deepseek', 'deepseek-v4-flash'),
      b = completionBody(c);
    expect(b).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    expect(b).not.toHaveProperty('tools');
    expect(JSON.stringify(b)).not.toContain('reasoning_content');
    c.profile.effort = 'off';
    expect(completionBody(c)).not.toHaveProperty('reasoning_effort');
  });
  it('Kimi K3 replays preserved reasoning; K2.6 only uses thinking switch', () => {
    const c = chat('kimi', 'kimi-k3');
    expect(completionBody(c)).not.toHaveProperty('thinking');
    expect(JSON.stringify(completionBody(c))).toContain('reasoning_content');
    c.profile.model = 'kimi-k2.6';
    c.profile.effort = 'off';
    expect(completionBody(c)).toMatchObject({ thinking: { type: 'disabled' } });
    expect(completionBody(c)).not.toHaveProperty('reasoning_effort');
    expect(effortOptions('kimi', 'kimi-k2.7-code')).toEqual(['high']);
  });
  it('reserves output, estimates draft and preserved reasoning', () => {
    const c = chat('kimi', 'kimi-k3'),
      before = contextUsage(c);
    c.messages[0].reasoning = '测'.repeat(1000);
    const after = contextUsage(c, 'new question');
    expect(after.remaining).toBeLessThan(before.remaining);
    expect(after.remaining + after.used + after.reserved).toBe(after.limit);
  });
  it('parses multiple fenced commands and disables unclosed streamed code', () => {
    const blocks = responseBlocks('先检查\n```bash\nss -lntp\n```\n再检查\n```sh\nfree -h\n```\n');
    expect(blocks.filter((b) => b.language).map((b) => [b.text, b.closed])).toEqual([
      ['ss -lntp', true],
      ['free -h', true],
    ]);
    expect(responseBlocks('```bash\nrm -')[0].closed).toBe(false);
  });
});
describe('SSE and persistence', () => {
  it('migrates old settings and persists a custom endpoint with encrypted credentials', async () => {
    let requestUrl: string | undefined, requestBody: any, authorization: string | undefined;
    const { service, store, dir, events } = await setup(async (url, options) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(options?.body));
      authorization = (options?.headers as Record<string, string>).Authorization;
      return streamResponse();
    });
    const config = (await service.state()).config;
    expect(config.profiles.custom).toMatchObject({ baseUrl: '', model: '', effort: 'off' });
    config.provider = 'custom';
    config.profiles.custom = {
      ...config.profiles.custom,
      baseUrl: 'https://custom.example.com/v1/',
      model: 'my-model-v2',
      contextWindow: 32000,
    };
    await service.configure(config, { custom: 'custom-private-test-key' });
    const c = await service.create('custom');
    expect(contextUsage(c).limit).toBe(32000);
    await service.send(c.id, 'test custom model');
    await done(events);
    expect(requestUrl).toBe('https://custom.example.com/v1/chat/completions');
    expect(authorization).toBe('Bearer custom-private-test-key');
    expect(requestBody.model).toBe('my-model-v2');
    for (const field of ['thinking', 'reasoning_effort', 'tools'])
      expect(requestBody).not.toHaveProperty(field);
    expect(await readFile(path.join(dir, 'ai-settings.json'), 'utf8')).not.toContain(
      'custom-private-test-key',
    );
    const reopened = new AIService(store, cipher, () => {});
    services.push(reopened);
    expect((await reopened.state()).config.keys.custom).toBe(true);
    expect((await reopened.get(c.id)).profile.model).toBe('my-model-v2');
    c.profile.effort = 'medium';
    c.profile.outputParameter = 'max_completion_tokens';
    expect(completionBody(c)).toMatchObject({
      reasoning_effort: 'medium',
      max_completion_tokens: 4096,
    });
    expect(completionBody(c)).not.toHaveProperty('max_tokens');
    config.profiles.custom.baseUrl = 'https://different.example.com/v1';
    await service.configure(config);
    expect((await service.state()).config.keys.custom).toBe(false);
    await expect(service.send(c.id, 'do not send key elsewhere')).rejects.toThrow('API Key');
  });
  it('rejects incomplete custom settings and invalid capacity without destroying presets', async () => {
    const { service } = await setup();
    const config = (await service.state()).config;
    config.provider = 'custom';
    await expect(service.configure(config, { custom: 'test-key' })).rejects.toThrow('自定义');
    expect((await service.state()).config.keys.deepseek).toBe(true);
    config.profiles.custom.baseUrl = 'https://custom.example.com/v1';
    config.profiles.custom.model = 'my-model';
    config.profiles.custom.contextWindow = 4096;
    await expect(service.configure(config)).rejects.toThrow('上下文容量');
    config.profiles.custom.contextWindow = 32000;
    config.profiles.custom.baseUrl = 'https://custom.example.com/v1/chat/completions';
    await expect(service.configure(config)).rejects.toThrow('基础地址');
  });
  it('handles split CRLF, multi-line frames and comments', () => {
    const s = new SSEDecoder();
    expect(s.push(': keepalive\r\ndata: {"a":\r')).toEqual([]);
    expect(s.push('\ndata: 1}\r\n\r')).toEqual([]);
    expect(s.push('\n')).toEqual(['{"a":\n1}']);
    s.push('data: incomplete');
    expect(() => s.push('', true)).toThrow('中断');
  });
  it('streams split UTF-8, saves chats and never exposes plaintext keys', async () => {
    let body: any;
    const { service, store, dir, events } = await setup(async (_u, options) => {
      body = JSON.parse(String(options?.body));
      return streamResponse();
    });
    const c = await service.create('kimi');
    await service.send(c.id, '如何检查端口？');
    await done(events);
    const saved = await service.get(c.id);
    expect(saved.messages.at(-1)).toMatchObject({
      status: 'complete',
      content: expect.stringContaining('检查端口'),
    });
    expect(saved.usage).toEqual({ prompt: 30, completion: 42 });
    expect(body).not.toHaveProperty('tools');
    expect(await readFile(path.join(dir, 'ai-settings.json'), 'utf8')).not.toContain('secret-key');
    expect(JSON.stringify(await service.state())).not.toContain('encrypted');
    const reopened = new AIService(store, cipher, () => {});
    services.push(reopened);
    expect((await reopened.state()).config.keys.kimi).toBe(true);
    expect((await reopened.get(c.id)).messages.length).toBe(2);
    await service.send(c.id, '进一步解释');
    await done(events, 2);
    expect(body.messages[2].reasoning_content).toBe('先检查监听端口');
    expect(body.messages[2].content).toContain('ss -lntp');
  });
  it('binds keys to API URL and validates efforts without destroying saved config', async () => {
    const { service } = await setup(),
      state = await service.state();
    const invalid = structuredClone(state.config);
    invalid.profiles.kimi.effort = 'off';
    await expect(service.configure(invalid)).rejects.toThrow('思考强度');
    expect((await service.state()).config.keys.kimi).toBe(true);
    state.config.profiles.deepseek.baseUrl = 'https://api.example.com/v1';
    await service.configure(state.config);
    expect((await service.state()).config.keys.deepseek).toBe(false);
    state.config.profiles.deepseek.baseUrl = 'https://api.example.com/anthropic';
    await expect(service.configure(state.config)).rejects.toThrow('OpenAI');
  });
  it('reports HTTP failures without saving provider error payload or key', async () => {
    const { service, events } = await setup(
      async () => new Response('secret-key-test', { status: 401 }),
    );
    const c = await service.create('deepseek');
    await service.send(c.id, 'hello');
    await done(events);
    expect(events.at(-1)?.message.error).toContain('API Key 无效');
    expect(JSON.stringify(await service.get(c.id))).not.toContain('secret-key-test');
  });
  it('stops generation, retries without duplicate user turns and deletes history', async () => {
    let calls = 0;
    const { service, events } = await setup(async (_u, opts) => {
      if (++calls > 1) return streamResponse();
      return new Response(
        new ReadableStream({
          start(c) {
            opts?.signal?.addEventListener('abort', () => c.error(Error('aborted')));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const c = await service.create('deepseek');
    await service.send(c.id, 'hello');
    service.cancel(c.id);
    await done(events);
    expect(events.at(-1)?.message.status).toBe('stopped');
    await service.send(c.id, '', true);
    await done(events, 2);
    expect((await service.get(c.id)).messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    await service.rename(c.id, '重命名');
    expect((await service.get(c.id)).title).toBe('重命名');
    await service.remove(c.id);
    expect((await service.state()).chats).toHaveLength(0);
  });
  it('does not mark a broken or tool-calling stream successful', async () => {
    for (const data of [
      { choices: [{ delta: { content: 'partial' } }] },
      { choices: [{ delta: { tool_calls: [{}] } }] },
    ]) {
      const { service, events } = await setup(
        async () => new Response(frame(data), { headers: { 'content-type': 'text/event-stream' } }),
      );
      const c = await service.create('deepseek');
      await service.send(c.id, 'hi');
      await done(events);
      expect(events.at(-1)?.message.status).toBe('error');
    }
  });
});
