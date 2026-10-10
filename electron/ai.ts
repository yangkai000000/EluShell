import { AIImages } from './ai-images';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { validateTarget, type AIReadTool } from './ai-readonly';
import { ConfigStore } from './config-store';
import {
  AIConfigSchema,
  AIInputSchema,
  AI_TOOLS,
  AIProfileSchema,
  ChatSchema,
  ProviderId,
  aiProviders,
  completionBody,
  contextUsage,
  effortOptions,
  type AIConfig,
  type AIProvider,
  type AIChat,
  type AIChatSummary,
  type AIEvent,
  type AIState,
} from '../src/ai-shared';

type Cipher = {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
};
type Vault = Partial<Record<AIProvider, { baseUrl: string; encrypted: string }>>;
const StoredSchema = z.object({
  config: AIConfigSchema,
  vault: z.record(z.object({ baseUrl: z.string(), encrypted: z.string() })),
});

// Streaming frames may span chunks, UTF-8 characters, and CRLF pairs.
export class SSEDecoder {
  private buffer = '';
  push(text: string, end = false) {
    this.buffer += text;
    if (this.buffer.length > 2_000_000) throw Error('AI 返回的数据帧过大');
    const frames: string[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) frames.push(data);
    }
    if (end && this.buffer.trim()) throw Error('AI 响应中断，请重试');
    return frames;
  }
}
function summary(chat: AIChat): AIChatSummary {
  const { messages, usage, ...rest } = chat;
  return rest;
}
export class AIService {
  private config = AIConfigSchema.parse({});
  private enabled = true;
  private images: AIImages;
  image(value: unknown) {
    return this.images.read(value);
  }
  async setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) await this.close();
  }
  private vault: Vault = {};
  private index: AIChatSummary[] = [];
  private ready?: Promise<void>;
  private queue = Promise.resolve();
  private running = new Map<
    string,
    { controller: AbortController; chat: AIChat; task?: Promise<void> }
  >();
  constructor(
    private store: ConfigStore,
    private cipher: Cipher,
    private emit: (e: AIEvent) => void,
    private allowLocalTest = false,
    private request: typeof fetch = fetch,
    private readTool?: AIReadTool,
  ) {
    this.images = new AIImages(store.directory);
  }
  private initialize() {
    return (this.ready ??= (async () => {
      const saved = StoredSchema.parse(
        await this.store.read('ai-settings.json', { config: this.config, vault: {} }),
      );
      this.config = saved.config;
      this.vault = saved.vault;
      await mkdir(path.join(this.store.directory, 'ai-chats'), { recursive: true });
      for (const name of await readdir(path.join(this.store.directory, 'ai-chats'))) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const chat = ChatSchema.parse(await this.store.read('ai-chats/' + name, null));
        if (await this.images.store(chat)) await this.store.write('ai-chats/' + name, chat);
        this.index.push(summary(chat));
      }
      this.index.sort((a, b) => b.updatedAt - a.updatedAt);
    })());
  }
  private serial<T>(fn: () => Promise<T>) {
    const task = this.queue.catch(() => {}).then(fn);
    this.queue = task.then(() => {});
    return task;
  }
  async state(): Promise<AIState> {
    await this.initialize();
    return {
      config: {
        ...this.config,
        keys: {
          deepseek: this.vault.deepseek?.baseUrl === this.config.profiles.deepseek.baseUrl,
          kimi: this.vault.kimi?.baseUrl === this.config.profiles.kimi.baseUrl,
          custom:
            !!this.vault.custom &&
            this.vault.custom.baseUrl === this.config.profiles.custom.baseUrl,
        },
      },
      chats: this.index.map((c) => ({ ...c })),
    };
  }
  private endpoint(value: string) {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !(
        u.protocol === 'https:' ||
        (this.allowLocalTest &&
          u.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(u.hostname))
      )
    )
      throw Error('API 地址必须是 HTTPS 基础地址，不能包含密码、查询参数或片段');
    if (/\/(chat\/completions|anthropic)\/?$/.test(u.pathname))
      throw Error('请填写 OpenAI 兼容基础地址，不含 /chat/completions 或 /anthropic');
    return u.toString().replace(/\/$/, '');
  }
  configure(value: unknown, credentials: unknown = {}) {
    return this.serial(async () => {
      await this.initialize();
      const config = AIConfigSchema.parse(value);
      const keys = z
        .object({
          deepseek: z.string().trim().max(8192).optional(),
          kimi: z.string().trim().max(8192).optional(),
          custom: z.string().trim().max(8192).optional(),
        })
        .parse(credentials);
      const vault = { ...this.vault };
      for (const provider of ProviderId.options) {
        const p = config.profiles[provider];
        if (
          provider === 'custom' &&
          !p.baseUrl &&
          !p.model &&
          !keys.custom &&
          config.provider !== 'custom'
        ) {
          delete vault.custom;
          continue;
        }
        if (!p.baseUrl || !p.model) throw Error('请填写自定义 API 基础地址和模型名称');
        if (provider === 'custom') p.contextWindow ??= 128000;
        p.baseUrl = this.endpoint(p.baseUrl);
        if (provider !== 'custom' && !aiProviders[provider].models.includes(p.model))
          throw Error('请选择支持的模型');
        if (provider === 'custom' && /[\s\x00-\x1f]/.test(p.model))
          throw Error('模型名称不能包含空格或控制字符');
        if (provider === 'custom' && p.maxTokens + 1024 >= (p.contextWindow ?? 128000))
          throw Error('上下文容量需大于输出上限，并为输入保留至少 1024 tokens');
        if (!(effortOptions(provider, p.model) as readonly string[]).includes(p.effort))
          throw Error('此模型不支持所选思考强度');
        if (keys[provider] !== undefined) {
          if (!keys[provider]) delete vault[provider];
          else {
            if (!this.cipher.isEncryptionAvailable())
              throw Error('系统加密服务不可用，API Key 未保存');
            vault[provider] = {
              baseUrl: p.baseUrl,
              encrypted: this.cipher.encryptString(keys[provider]!).toString('base64'),
            };
          }
        } else if (vault[provider]?.baseUrl !== p.baseUrl) delete vault[provider];
      }
      await this.store.write('ai-settings.json', { config, vault });
      this.config = config;
      this.vault = vault;
      return this.state();
    });
  }
  create(provider: unknown) {
    return this.serial(async () => {
      await this.initialize();
      if (this.index.length >= 100) throw Error('最多保留 100 个对话，请删除不需要的历史对话');
      const p = ProviderId.parse(provider),
        now = Date.now();
      if (!this.config.profiles[p].baseUrl || !this.config.profiles[p].model)
        throw Error('请先保存自定义接口地址、API Key 和模型名称');
      const chat: AIChat = {
        id: randomUUID(),
        title: '新对话',
        provider: p,
        profile: { ...this.config.profiles[p] },
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      await this.persist(chat);
      return chat;
    });
  }
  async get(value: unknown) {
    await this.initialize();
    const id = z.string().uuid().parse(value);
    if (!this.index.some((c) => c.id === id)) throw Error('对话不存在');
    const chat =
      this.running.get(id)?.chat ??
      ChatSchema.parse(await this.store.read('ai-chats/' + id + '.json', null));
    if (!this.running.has(id))
      for (const m of chat.messages)
        if (m.status === 'streaming') {
          m.status = 'stopped';
          m.error = '上次退出时回答尚未完成';
        }
    return structuredClone(chat);
  }
  rename(value: unknown, name: unknown) {
    return this.serial(async () => {
      const chat = await this.get(value);
      chat.title = z.string().trim().min(1).max(100).parse(name);
      const run = this.running.get(chat.id);
      if (run) run.chat.title = chat.title;
      await this.persist(chat);
      return this.state();
    });
  }
  remove(value: unknown) {
    return this.serial(async () => {
      const chat = await this.get(value);
      this.cancel(chat.id);
      await this.running.get(chat.id)?.task;
      await unlink(path.join(this.store.directory, 'ai-chats', chat.id + '.json'));
      await this.images.remove(chat.id);
      this.index = this.index.filter((c) => c.id !== chat.id);
      return this.state();
    });
  }
  private async persist(chat: AIChat) {
    await this.images.store(chat);
    await this.store.write('ai-chats/' + chat.id + '.json', structuredClone(chat));
    this.index = [summary(chat), ...this.index.filter((c) => c.id !== chat.id)].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }
  send(value: unknown, input: unknown, retry = false) {
    return this.serial(async () => {
      if (!this.enabled) throw Error('AI 助手已停用，请在功能与性能设置中开启');
      const chat = await this.get(value);
      if (this.running.has(chat.id)) throw Error('此对话正在回答');
      if (this.running.size >= 3) throw Error('最多同时进行 3 个对话，请等待或停止回答');
      const entry = this.vault[chat.provider];
      if (!entry || entry.baseUrl !== chat.profile.baseUrl)
        throw Error('请在设置中配置此对话接口的 API Key，或新建对话使用当前配置');
      if (!this.cipher.isEncryptionAvailable())
        throw Error('系统加密服务不可用，请重新配置 API Key');
      let key: string;
      try {
        key = this.cipher.decryptString(Buffer.from(entry.encrypted, 'base64'));
      } catch {
        throw Error('API Key 无法解密，请重新配置');
      }
      if (retry) {
        if (chat.messages.at(-1)?.role !== 'assistant') throw Error('没有可重试的回答');
        chat.messages.pop();
      } else {
        if (chat.messages.at(-1)?.status !== 'complete' && chat.messages.length)
          throw Error('上一条回答未完成，请重试或新建对话');
        const payload = AIInputSchema.parse(typeof input === 'string' ? { content: input } : input);
        validateTarget(payload);
        const { content, attachments, sessionId } = payload;
        chat.messages.push({
          id: randomUUID(),
          role: 'user',
          content,
          attachments,
          sessionId,
          reasoning: '',
          status: 'complete',
        });
        if (chat.messages.length === 1) chat.title = content.slice(0, 40) || '附件分析';
      }
      if (chat.messages.length >= 199 || contextUsage(chat).remaining < 1024)
        throw Error('上下文空间不足，请新建对话');
      const body = completionBody(await this.images.hydrate(chat));
      const target = chat.messages.filter((m) => m.role === 'user').at(-1)?.sessionId;
      if (target && this.readTool) body.tools = AI_TOOLS;
      chat.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: '',
        reasoning: '',
        status: 'streaming',
      });
      chat.updatedAt = Date.now();
      await this.persist(chat);
      const controller = new AbortController();
      const run = { controller, chat, task: undefined as Promise<void> | undefined };
      this.running.set(chat.id, run);
      run.task = this.stream(chat, key, body, controller).finally(() =>
        this.running.delete(chat.id),
      );
      return structuredClone(chat);
    });
  }
  cancel(value: unknown) {
    this.running.get(z.string().uuid().parse(value))?.controller.abort();
  }
  async close() {
    await this.queue.catch(() => {});
    for (const r of this.running.values()) r.controller.abort();
    await Promise.allSettled([...this.running.values()].map((r) => r.task));
  }
  private async stream(
    chat: AIChat,
    key: string,
    body: Record<string, unknown>,
    controller: AbortController,
  ) {
    const m = chat.messages.at(-1)!;
    let timedOut = false,
      lastEmit = 0,
      lastSave = Date.now(),
      finished = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 300000);
    let idle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90000);
    const publish = (done = false) => {
      lastEmit = Date.now();
      this.emit({ chatId: chat.id, message: { ...m }, usage: chat.usage, done });
    };
    try {
      const sessionId = chat.messages.filter((m) => m.role === 'user').at(-1)?.sessionId;
      for (let round = 0; round < 9; round++) {
        finished = false;
        const calls = new Map<
          number,
          { id: string; type: 'function'; function: { name: string; arguments: string } }
        >();
        const contentStart = m.content.length,
          reasoningStart = m.reasoning.length;
        const response = await this.request(
          this.endpoint(chat.profile.baseUrl) + '/chat/completions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify(body),
            signal: controller.signal,
            redirect: 'error',
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          const reason = (
            {
              401: 'API Key 无效',
              402: '账户余额不足',
              403: '没有模型访问权限',
              429: '请求过于频繁或额度不足',
            } as Record<number, string>
          )[response.status];
          throw Error(reason || 'AI 接口返回 HTTP ' + response.status + '，请检查模型和接口设置');
        }
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
          throw Error('接口没有返回流式对话数据，请检查基础地址');
        const decoder = new TextDecoder(),
          parser = new SSEDecoder();
        const consume = (frames: string[]) => {
          for (const frame of frames) {
            if (frame === '[DONE]') {
              finished = true;
              continue;
            }
            const data = JSON.parse(frame);
            if (data.error) throw Error('AI 服务返回错误，请检查配置后重试');
            const choice = data.choices?.[0];
            if (choice?.delta?.tool_calls) {
              if (!sessionId || !this.readTool) throw Error('请先连接服务器以使用只读工具');
              for (const part of choice.delta.tool_calls) {
                if (!Number.isInteger(part.index) || part.index < 0 || part.index > 3)
                  throw Error('单轮工具调用过多');
                const call = calls.get(part.index) || {
                  id: '',
                  type: 'function' as const,
                  function: { name: '', arguments: '' },
                };
                if (part.id) call.id += part.id;
                if (part.function?.name) call.function.name += part.function.name;
                if (part.function?.arguments) call.function.arguments += part.function.arguments;
                if (
                  call.function.arguments.length > 10000 ||
                  call.id.length > 200 ||
                  call.function.name.length > 100
                )
                  throw Error('工具参数超出限制');
                calls.set(part.index, call);
              }
            }
            if (typeof choice?.delta?.content === 'string') m.content += choice.delta.content;
            if (typeof choice?.delta?.reasoning_content === 'string')
              m.reasoning += choice.delta.reasoning_content;
            if (m.content.length > 256000 || m.reasoning.length > 1_000_000)
              throw Error('回答过长，已停止接收');
            if (choice?.finish_reason === 'length')
              throw Error('达到单次输出上限；可在设置中增加上限后新建对话');
            if (choice?.finish_reason && !['stop', 'tool_calls'].includes(choice.finish_reason))
              throw Error('回答未完整生成，请重试');
            if (['stop', 'tool_calls'].includes(choice?.finish_reason)) finished = true;
            if (
              Number.isFinite(data.usage?.prompt_tokens) &&
              Number.isFinite(data.usage?.completion_tokens)
            )
              chat.usage = {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
              };
          }
        };
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              consume(parser.push(decoder.decode(), true));
              break;
            }
            clearTimeout(idle);
            idle = setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, 90000);
            consume(parser.push(decoder.decode(value, { stream: true })));
            if (Date.now() - lastEmit > 80) publish();
            if (Date.now() - lastSave > 5000) {
              await this.persist(chat);
              lastSave = Date.now();
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (!finished) throw Error('AI 响应未完成，请重试');
        if (!calls.size) {
          if (!m.content.trim()) throw Error('AI 没有回答内容，请重试');
          break;
        }
        if (round === 8 || (m.observations?.length || 0) + calls.size > 24)
          throw Error('达到本次只读查询上限，请缩小范围后继续提问');
        const messages = body.messages as Record<string, unknown>[];
        messages.push({
          role: 'assistant',
          content: m.content.slice(contentStart) || null,
          reasoning_content: m.reasoning.slice(reasoningStart),
          tool_calls: [...calls.values()],
        });
        for (const call of calls.values()) {
          controller.signal.throwIfAborted();
          if (!call.id) throw Error('工具调用缺少标识');
          let result: string;
          try {
            result = await this.readTool!(
              sessionId!,
              call.function.name,
              JSON.parse(call.function.arguments),
              controller.signal,
            );
          } catch (e) {
            controller.signal.throwIfAborted();
            result = '只读工具失败：' + (e instanceof Error ? e.message : String(e));
          }
          result = result.slice(0, 64000);
          (m.observations ??= []).push({
            name: call.function.name + ' ' + call.function.arguments,
            result,
          });
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
          publish();
        }
        if (contextUsage(chat).remaining < 1024)
          throw Error('只读结果已达到上下文上限，请缩小查询范围');
      }
      controller.signal.throwIfAborted();
      m.status = 'complete';
    } catch (e) {
      m.status = controller.signal.aborted && !timedOut ? 'stopped' : 'error';
      const message = e instanceof Error ? e.message : '请求失败';
      m.error = timedOut
        ? '回答超时，请重试或降低思考强度'
        : m.status === 'stopped'
          ? '已停止生成'
          : message === 'fetch failed'
            ? '无法连接 AI 接口，请检查网络和 API 地址'
            : message.replaceAll(key, '[已隐藏]').slice(0, 1000);
    } finally {
      clearTimeout(timeout);
      clearTimeout(idle);
      chat.updatedAt = Date.now();
      try {
        await this.persist(chat);
      } catch {
        m.error = '对话保存失败，请检查配置目录的可用空间';
        m.status = 'error';
      }
      publish(true);
    }
  }
}
