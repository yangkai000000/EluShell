import type { Profile, RemoteDocument, Settings } from './shared';
import type { EditorLanguage } from './editor-language';
export function sessionLabel(
  profile: Pick<Profile, 'name' | 'host'>,
  mode: Settings['sessionNameMode'],
) {
  return mode === 'ip' ? profile.host : profile.name || profile.host;
}
export type EditorDraft = { state: any; baseline: string; mode: EditorLanguage; scrollTop: number };
export type EditorInfo = {
  document: RemoteDocument;
  connectionName: string;
  address: string;
  title: string;
  dirty?: boolean;
  draft?: EditorDraft;
};
export type EditorGroup = { entries: EditorInfo[]; active: string };
export interface EditorBridge {
  load(): Promise<EditorGroup>;
  save(id: string, text: string): Promise<void>;
  state(id: string, dirty: boolean): void;
  close(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  reorder(id: string, before: string): Promise<void>;
  detach(id: string, draft: EditorDraft, dragged?: boolean): Promise<void>;
  onChange(fn: (group: EditorGroup) => void): () => void;
}
declare global {
  interface Window {
    eluEditor?: EditorBridge;
  }
}
