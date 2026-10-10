import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AIImages } from '../electron/ai-images';
import { AIConfigSchema, ChatSchema, completionBody, type AIChat } from '../src/ai-shared';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
it('stores images outside chat records, hydrates requests, isolates deletions and rejects traversal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'elu-images-'));
  dirs.push(directory);
  const images = new AIImages(directory);
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  const chat: AIChat = {
    id: randomUUID(),
    title: 'images',
    provider: 'deepseek',
    profile: AIConfigSchema.parse({}).profiles.deepseek,
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        content: 'image',
        reasoning: '',
        status: 'complete',
        attachments: [{ kind: 'image', name: 'a.png', data }],
      },
    ],
  };
  expect(await images.store(chat)).toBe(true);
  expect(JSON.stringify(chat)).not.toContain('base64');
  const stored = ChatSchema.parse(chat);
  const image = stored.messages[0].attachments![0];
  if (image.kind !== 'image') throw Error('wrong fixture');
  expect(await images.read(image.asset)).toBe(data);
  expect(JSON.stringify(completionBody(await images.hydrate(stored)))).toContain(data);
  expect(JSON.stringify(stored)).not.toContain('base64');
  await expect(images.read('../settings.json')).rejects.toThrow();
  await images.remove(chat.id);
  await expect(readFile(path.join(directory, 'ai-images', image.asset!))).rejects.toThrow();
});
