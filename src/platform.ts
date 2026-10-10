export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const commandKey = isMac ? '⌘' : 'Ctrl';
export const terminalShortcut = (key: string) =>
  `${isMac ? '⌘' : 'Ctrl+Shift+'}${key}`;
export function isTerminalShortcut(
  event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean },
  mac = isMac,
) {
  return !event.altKey && (mac ? event.metaKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey);
}
