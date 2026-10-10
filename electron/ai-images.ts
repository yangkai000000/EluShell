import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AIImageAssetSchema, type AIChat } from '../src/ai-shared';

export class AIImages {
  constructor(private directory: string) {}
  async store(chat: AIChat) {
    let changed = false;
    for (const m of chat.messages)
      for (const a of m.attachments || []) {
        if (a.kind !== 'image' || !a.data) continue;
        const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(a.data);
        if (!match) throw Error('图片格式无效');
        const bytes = Buffer.from(match[2], 'base64');
        if (bytes.length > 5 * 1024 * 1024) throw Error('图片超过 5 MB');
        const id = z.string().uuid().parse(chat.id);
        const asset = `${id}/${createHash('sha256').update(bytes).digest('hex')}.${match[1]}`;
        const file = path.join(this.directory, 'ai-images', asset);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes, { flag: 'wx' }).catch((e) => {
          if (e.code !== 'EEXIST') throw e;
        });
        a.asset = asset;
        delete a.data;
        changed = true;
      }
    return changed;
  }
  async read(value: unknown) {
    const asset = AIImageAssetSchema.parse(value);
    const bytes = await readFile(path.join(this.directory, 'ai-images', asset));
    if (bytes.length > 5 * 1024 * 1024) throw Error('图片超过大小限制');
    return `data:image/${asset.split('.').at(-1)};base64,${bytes.toString('base64')}`;
  }
  async hydrate(chat: AIChat): Promise<AIChat> {
    const messages = [];
    for (const m of chat.messages) {
      const attachments = [];
      for (const a of m.attachments || [])
        attachments.push(
          a.kind === 'image' && a.asset && !a.data ? { ...a, data: await this.read(a.asset) } : a,
        );
      messages.push({ ...m, attachments });
    }
    return { ...chat, messages };
  }
  async remove(chatId: string) {
    const id = z.string().uuid().parse(chatId);
    await rm(path.join(this.directory, 'ai-images', id), { recursive: true, force: true });
  }
}
