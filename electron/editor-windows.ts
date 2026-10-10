import { BrowserWindow, dialog, ipcMain, screen } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type { Profile, Settings } from '../src/shared';
import { sessionLabel, type EditorInfo, type EditorDraft } from '../src/editor-shared';
import type { RemoteFiles } from './remote-files';
type Entry = { group: Group; info: EditorInfo; profile: Profile; busy: boolean; moving: boolean };
type Group = {
  window: BrowserWindow;
  entries: Entry[];
  active: string;
  closing: boolean;
  ready: Promise<void>;
};
export class EditorWindows {
  private entries = new Map<string, Entry>();
  private groups = new Set<Group>();
  private opening = new Map<string, Promise<void>>();
  private detached = new Set<string>();
  private quitting = false;
  private primary?: Group;
  constructor(
    private remote: RemoteFiles,
    private settings: () => Promise<Settings>,
    private disconnect: (id: string) => void,
    private icon: string,
  ) {
    const owner = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
      const group = [...this.groups].find((g) => g.window.webContents === event.sender);
      if (!group || event.senderFrame !== group.window.webContents.mainFrame)
        throw Error('无效编辑器来源');
      return group;
    };
    const entryFor = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, id: unknown) => {
      const group = owner(event),
        entry = group.entries.find((e) => e.info.document.id === z.string().parse(id));
      if (!entry || entry.moving) throw Error('此文件不属于当前编辑器窗口');
      return entry;
    };
    ipcMain.handle('editor-load', (e) => this.snapshot(owner(e)));
    ipcMain.handle('editor-save', async (e, id, text) => {
      const entry = entryFor(e, id);
      if (entry.busy) throw Error('正在保存');
      entry.busy = true;
      try {
        await remote.saveText(entry.info.document.id, z.string().max(4194304).parse(text));
      } finally {
        entry.busy = false;
      }
    });
    ipcMain.on('editor-state', (e, id, dirty) => {
      const entry = entryFor(e, id);
      entry.info.dirty = z.boolean().parse(dirty);
      this.title(entry.group);
    });
    ipcMain.handle('editor-activate', (e, id) => {
      const entry = entryFor(e, id);
      entry.group.active = entry.info.document.id;
      this.title(entry.group);
    });
    ipcMain.handle('editor-reorder', (e, id, before) => {
      const entry = entryFor(e, id),
        target = entryFor(e, before),
        group = entry.group;
      if (entry === target) return;
      group.entries = group.entries.filter((item) => item !== entry);
      group.entries.splice(group.entries.indexOf(target), 0, entry);
      this.changed(group);
    });
    ipcMain.handle('editor-close', (e, id) => {
      const entry = entryFor(e, id);
      if (entry.busy) throw Error('正在保存，请稍后关闭');
      this.remove(entry);
    });
    ipcMain.handle('editor-detach', async (e, id, draft: EditorDraft, dragged: boolean) => {
      const entry = entryFor(e, id),
        source = entry.group;
      if (entry.busy) throw Error('正在保存，请稍后分离标签');
      if (source.entries.length === 1) return;
      const cursor = screen.getCursorScreenPoint(),
        bounds = source.window.getBounds();
      if (
        dragged &&
        cursor.x >= bounds.x &&
        cursor.x < bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y < bounds.y + bounds.height
      )
        return;
      z.object({
        baseline: z.string().max(4194304),
        state: z.object({ doc: z.string().max(4194304) }).passthrough(),
        mode: z.enum(['auto', 'shell', 'log', 'json', 'yaml', 'javascript', 'css', 'html', 'text']),
        scrollTop: z.number().finite().nonnegative(),
      }).parse(draft);
      if (JSON.stringify(draft).length > 32 * 1024 * 1024)
        throw Error('编辑历史过大，请保存后重试');
      entry.moving = true;
      const previousDraft = entry.info.draft;
      entry.info.draft = draft;
      const target = this.createGroup([entry], cursor);
      // load() can read the pending snapshot; saving is blocked until the move commits.
      try {
        await target.ready;
        source.entries = source.entries.filter((item) => item !== entry);
        entry.group = target;
        entry.moving = false;
        if (source.active === id) source.active = source.entries[0].info.document.id;
        this.changed(source);
        this.changed(target);
        this.focus(target);
      } catch (error) {
        target.entries = [];
        target.closing = true;
        target.window.destroy();
        entry.info.draft = previousDraft;
        entry.moving = false;
        throw error;
      }
    });
  }
  private snapshot(group: Group) {
    return { entries: group.entries.map((e) => e.info), active: group.active };
  }
  private title(group: Group) {
    const entry = group.entries.find((e) => e.info.document.id === group.active);
    group.window.setTitle(
      entry
        ? `${entry.info.dirty ? '● ' : ''}${entry.info.title} · EluShell`
        : 'EluShell 文件编辑器',
    );
  }
  private changed(group: Group) {
    if (!group.window.isDestroyed()) {
      this.title(group);
      group.window.webContents.send('editor-changed', this.snapshot(group));
    }
  }
  private focus(group: Group) {
    if (group.window.isMinimized()) group.window.restore();
    group.window.show();
    group.window.focus();
  }
  private createGroup(entries: Entry[] = [], position?: { x: number; y: number }) {
    const work = position ? screen.getDisplayNearestPoint(position).workArea : undefined;
    const window = new BrowserWindow({
      width: 1050,
      height: 760,
      minWidth: 620,
      minHeight: 420,
      show: false,
      icon: this.icon,
      backgroundColor: '#ffffff',
      ...(work && position
        ? {
            x: Math.max(work.x, Math.min(position.x - 100, work.x + work.width - 620)),
            y: Math.max(work.y, Math.min(position.y - 20, work.y + work.height - 420)),
          }
        : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const group: Group = {
      window,
      entries,
      active: entries[0]?.info.document.id || '',
      closing: false,
      ready: Promise.resolve(),
    };
    this.groups.add(group);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.on('close', (event) => {
      if (group.closing || this.quitting) return;
      if (group.entries.some((e) => e.busy || e.moving)) {
        event.preventDefault();
        dialog.showMessageBoxSync(window, { message: '文件正在保存或移动，请稍后关闭。' });
        return;
      }
      const dirty = group.entries.filter((e) => e.info.dirty);
      if (
        dirty.length &&
        dialog.showMessageBoxSync(window, {
          type: 'warning',
          message: '此窗口有未保存的文件，仍要关闭？',
          detail: dirty.map((e) => e.info.title).join('\n'),
          buttons: ['取消', '放弃并关闭'],
          defaultId: 0,
          cancelId: 0,
        }) !== 1
      )
        event.preventDefault();
    });
    window.on('closed', () => {
      this.groups.delete(group);
      if (this.primary === group) this.primary = undefined;
      for (const entry of group.entries) {
        if (entry.group !== group) continue;
        this.entries.delete(this.key(entry.info.document.sessionId, entry.info.document.path));
        this.remote.closeText(entry.info.document.id);
        this.release(entry.info.document.sessionId);
      }
    });
    group.ready = process.env.ELUSHELL_DEV_URL
      ? (() => {
          const url = new URL(process.env.ELUSHELL_DEV_URL!);
          url.searchParams.set('editor', '1');
          return window.loadURL(url.href);
        })()
      : window.loadFile(path.join(__dirname, '../dist/index.html'), { query: { editor: '1' } });
    return group;
  }
  private key(session: string, file: string) {
    return JSON.stringify([session, file]);
  }
  private remove(entry: Entry) {
    const { group, info } = entry;
    this.entries.delete(this.key(info.document.sessionId, info.document.path));
    group.entries = group.entries.filter((e) => e !== entry);
    this.remote.closeText(info.document.id);
    this.release(info.document.sessionId);
    if (!group.entries.length) {
      group.closing = true;
      group.window.close();
    } else {
      if (group.active === info.document.id) group.active = group.entries[0].info.document.id;
      this.changed(group);
    }
  }
  async configure(settings: Settings) {
    for (const entry of this.entries.values()) {
      const profile = settings.profiles.find((p) => p.id === entry.profile.id) || entry.profile;
      entry.info.title = `${sessionLabel({ name: profile.name, host: entry.profile.host }, settings.sessionNameMode)} · ${path.posix.basename(entry.info.document.path)}`;
    }
    this.groups.forEach((group) => this.changed(group));
  }
  async open(sessionId: string, source: string, profile: Profile) {
    const file = path.posix.normalize(source),
      key = this.key(sessionId, file);
    if (!file.startsWith('/')) throw Error('需要绝对远程路径');
    const focus = () => {
      const e = this.entries.get(key);
      if (e) {
        e.group.active = e.info.document.id;
        this.changed(e.group);
        this.focus(e.group);
      }
    };
    if (this.entries.has(key)) {
      focus();
      return;
    }
    if (this.opening.has(key)) {
      await this.opening.get(key);
      focus();
      return;
    }
    const task = (async () => {
      const document = await this.remote.openText(sessionId, file);
      try {
        const settings = await this.settings();
        const group =
          this.primary && !this.primary.window.isDestroyed()
            ? this.primary
            : (this.primary = [...this.groups].find((g) => !g.closing) || this.createGroup());
        const entry: Entry = {
          group,
          profile: { ...profile },
          busy: false,
          moving: false,
          info: {
            document,
            connectionName: profile.name,
            address: `${profile.username}@${profile.host}:${profile.port}`,
            title: `${sessionLabel(profile, settings.sessionNameMode)} · ${path.posix.basename(file)}`,
          },
        };
        this.entries.set(key, entry);
        group.entries.push(entry);
        group.active = document.id;
        await group.ready;
        this.changed(group);
        this.focus(group);
      } catch (error) {
        this.entries.delete(key);
        this.remote.closeText(document.id);
        throw error;
      }
    })();
    this.opening.set(key, task);
    try {
      await task;
    } finally {
      this.opening.delete(key);
      this.release(sessionId);
    }
  }
  private hasSession(id: string) {
    return (
      [...this.entries.values()].some((e) => e.info.document.sessionId === id) ||
      [...this.opening.keys()].some((key) => JSON.parse(key)[0] === id)
    );
  }
  deferDisconnect(id: string) {
    if (!this.hasSession(id)) return false;
    this.detached.add(id);
    return true;
  }
  private release(id: string) {
    if (this.detached.has(id) && !this.hasSession(id)) {
      this.detached.delete(id);
      this.disconnect(id);
    }
  }
  hasUnsaved() {
    return [...this.entries.values()].some((e) => e.info.dirty || e.busy || e.moving);
  }
  confirmQuit(parent: BrowserWindow) {
    if (this.quitting) return true;
    if ([...this.entries.values()].some((e) => e.busy || e.moving)) {
      dialog.showMessageBoxSync(parent, { message: '文件正在保存或移动，请稍后退出。' });
      return false;
    }
    const dirty = [...this.entries.values()].filter((e) => e.info.dirty);
    if (
      dirty.length &&
      dialog.showMessageBoxSync(parent, {
        type: 'warning',
        message: '编辑器有未保存的修改，仍要退出？',
        detail: dirty.map((e) => e.info.title).join('\n'),
        buttons: ['取消', '放弃并退出'],
        defaultId: 0,
        cancelId: 0,
      }) !== 1
    )
      return false;
    this.quitting = true;
    return true;
  }
}
