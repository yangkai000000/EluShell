import { nativeImage } from 'electron';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BackgroundSchema } from '../src/shared';

// Only native-dialog selections are imported. Renderer requests use managed asset IDs.
export async function importBackground(directory: string, source: string) {
  if ((await stat(source)).size > 20 * 1024 * 1024) throw Error('请选择不超过 20 MB 的图片');
  const image = nativeImage.createFromBuffer(await readFile(source));
  const size = image.getSize();
  if (image.isEmpty() || !size.width || !size.height)
    throw Error('无法读取图片，请选择 PNG、JPG 或 WebP');
  if (size.width * size.height > 40_000_000)
    throw Error('图片尺寸过大，请选择不超过 4000 万像素的图片');
  const png = image.toPNG();
  const name = createHash('sha256').update(png).digest('hex') + '.png';
  const dir = path.join(directory, 'backgrounds');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), png, { flag: 'wx' }).catch((e) => {
    if (e.code !== 'EEXIST') throw e;
  });
  return { image: name, imageName: path.basename(source).slice(0, 255) };
}
export async function readBackground(directory: string, value: unknown) {
  const name = BackgroundSchema.shape.image.unwrap().parse(value);
  const buffer = await readFile(path.join(directory, 'backgrounds', name));
  return 'data:image/png;base64,' + buffer.toString('base64');
}
