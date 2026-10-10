export type TabTool = { id: string; sessionId: string };
export type CloseMode = 'current' | 'left' | 'right' | 'others' | 'all';
export function closingTabs(tabs: string[], tools: TabTool[], anchor: string, mode: CloseMode) {
  const index = tabs.indexOf(anchor);
  if (index < 0) return [];
  const selected = new Set(
    tabs.filter(
      (id, i) =>
        mode === 'all' ||
        (mode === 'current'
          ? id === anchor
          : mode === 'left'
            ? i < index
            : mode === 'right'
              ? i > index
              : id !== anchor),
    ),
  );
  // Keeping a tool also keeps the SSH session it depends on.
  if (mode !== 'current' && mode !== 'all') {
    selected.delete(anchor);
    const owner = tools.find((t) => t.id === anchor)?.sessionId;
    if (owner) selected.delete(owner);
  }
  for (const tool of tools) if (selected.has(tool.sessionId)) selected.add(tool.id);
  return tabs.filter((id) => selected.has(id));
}
