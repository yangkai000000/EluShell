import type { PointerEvent } from 'react';
export function ResizeHandle({
  label,
  axis,
  value,
  min,
  max,
  onChange,
  onCollapse,
  reverse = false,
}: {
  label: string;
  axis: 'x' | 'y';
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onCollapse?: () => void;
  reverse?: boolean;
}) {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    const origin = axis === 'x' ? event.clientX : event.clientY;
    const move = (e: globalThis.PointerEvent) =>
      onChange(
        Math.min(
          max,
          Math.max(
            min,
            value + (reverse ? -1 : 1) * (axis === 'x' ? e.clientX - origin : origin - e.clientY),
          ),
        ),
      );
    const stop = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', stop);
      node.removeEventListener('pointercancel', stop);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
  };
  return (
    <div
      className={'resize-handle resize-' + axis}
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={onCollapse}
      onKeyDown={(e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          onChange(
            Math.min(
              max,
              Math.max(
                min,
                value + (reverse ? -1 : 1) * (['ArrowRight', 'ArrowUp'].includes(e.key) ? 16 : -16),
              ),
            ),
          );
        }
        if (e.key === 'Enter') onCollapse?.();
      }}
    >
      <i />
    </div>
  );
}
