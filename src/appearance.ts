import { useEffect, useState, type CSSProperties } from 'react';
import type { Appearance, Background } from './shared';

export function effectiveTerminal(appearance: Appearance): Background {
  return appearance.includeTerminal ? appearance.workspace : appearance.terminal;
}
export function foregroundFor(color: string) {
  const rgb = [1, 3, 5].map((i) => {
    const channel = parseInt(color.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#27364b' : '#cbd5e1';
}
export function useBackground(background: Background, report: (message: string) => void) {
  const [asset, setAsset] = useState({ id: '', url: '' });
  useEffect(() => {
    let cancelled = false;
    if (background.kind === 'image' && background.image) {
      void window.elu
        ?.backgroundImage(background.image)
        .then((url) => {
          if (!cancelled) setAsset({ id: background.image!, url });
        })
        .catch(() => {
          if (!cancelled) report('背景图片读取失败，请在外观设置中重新选择');
        });
    } else setAsset({ id: '', url: '' });
    return () => {
      cancelled = true;
    };
  }, [background.kind, background.image]);
  return {
    backgroundColor: background.color,
    backgroundImage:
      background.kind === 'image' && asset.id === background.image && asset.url
        ? `url("${asset.url}")`
        : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  } satisfies CSSProperties;
}
