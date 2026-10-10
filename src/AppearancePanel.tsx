import { useEffect, useState } from 'react';
import { Image, Pipette, RotateCcw } from 'lucide-react';
import { AppearanceSchema, type Appearance, type Background } from './shared';

function ColorField({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (color: string) => void;
}) {
  const [text, setText] = useState(color),
    [error, setError] = useState('');
  useEffect(() => setText(color), [color]);
  const commit = (value: string) => {
    setText(value);
    if (/^#[a-f\d]{6}$/i.test(value)) {
      onChange(value);
      setError('');
    }
  };
  const eyedrop = async () => {
    const EyeDropper = (
      window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    if (!EyeDropper) return;
    try {
      commit((await new EyeDropper().open()).sRGBHex);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('取色失败，请使用调色板');
    }
  };
  return (
    <div className="color-field">
      <span>{label}</span>
      <div>
        <input
          type="color"
          aria-label={label + '调色板'}
          value={color}
          onChange={(e) => commit(e.target.value)}
        />
        <input
          aria-label={label + '色号'}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            if (!/^#[a-f\d]{6}$/i.test(text)) {
              setText(color);
              setError('请输入 #RRGGBB 格式的色号');
            }
          }}
        />
        {'EyeDropper' in window && (
          <button type="button" title={label + '屏幕取色'} onClick={() => void eyedrop()}>
            <Pipette size={15} />
          </button>
        )}
      </div>
      {error && <small role="status">{error}</small>}
    </div>
  );
}
function BackgroundEditor({
  title,
  value,
  change,
}: {
  title: string;
  value: Background;
  change: (value: Background) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pick = async () => {
    setBusy(true);
    setError('');
    try {
      const asset = await window.elu!.chooseBackground();
      if (asset) change({ ...value, ...asset, kind: 'image' });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="background-editor">
      <legend>{title}</legend>
      <div className="background-modes" role="group" aria-label={title + '类型'}>
        {(['color', 'image'] as const).map((kind) => (
          <button
            key={kind}
            aria-pressed={value.kind === kind}
            onClick={() => change({ ...value, kind })}
          >
            {kind === 'color' ? '纯色' : '本地图片'}
          </button>
        ))}
      </div>
      <ColorField
        label={title + (value.kind === 'image' ? '底色' : '颜色')}
        color={value.color}
        onChange={(color) => change({ ...value, color })}
      />
      {value.kind === 'image' && (
        <>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void pick()}
            aria-label={'选择' + title + '图片'}
          >
            <Image size={15} />
            {busy ? '导入中…' : '选择图片'}
          </button>
          <span className="background-filename" title={value.imageName}>
            {value.imageName || '尚未选择图片'}
          </span>
          <small>图片居中铺满，支持 PNG / JPG / WebP，最大 20 MB。</small>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
export default function AppearancePanel({
  value,
  change,
}: {
  value: Appearance;
  change: (value: Appearance) => void;
}) {
  return (
    <section className="appearance-panel">
      <div className="appearance-heading">
        <h3>字体与背景</h3>
        <button onClick={() => change(AppearanceSchema.parse({}))}>
          <RotateCcw size={13} />
          恢复默认外观
        </button>
      </div>
      <div className="font-grid">
        <label>
          界面字体
          <input
            list="ui-fonts"
            value={value.uiFont}
            maxLength={200}
            onChange={(e) => {
              if (e.target.value.trim()) change({ ...value, uiFont: e.target.value });
            }}
          />
        </label>
        <label>
          界面字号
          <select
            aria-label="界面字号"
            value={value.uiFontSize}
            onChange={(e) => change({ ...value, uiFontSize: +e.target.value })}
          >
            {Array.from({ length: 9 }, (_, i) => i + 10).map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        <label>
          终端字体
          <input
            list="terminal-fonts"
            value={value.terminalFont}
            maxLength={200}
            onChange={(e) => {
              if (e.target.value.trim()) change({ ...value, terminalFont: e.target.value });
            }}
          />
        </label>
        <label>
          终端字号
          <select
            aria-label="终端字号"
            value={value.terminalFontSize}
            onChange={(e) => change({ ...value, terminalFontSize: +e.target.value })}
          >
            {Array.from({ length: 24 }, (_, i) => i + 9).map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
      </div>
      <datalist id="ui-fonts">
        <option value='"Segoe UI", "Microsoft YaHei", sans-serif' />
        <option value='"Microsoft YaHei", sans-serif' />
        <option value="SimSun, serif" />
      </datalist>
      <datalist id="terminal-fonts">
        <option value='"Cascadia Code", Consolas, monospace' />
        <option value='Consolas, "Microsoft YaHei", monospace' />
        <option value='"JetBrains Mono", Consolas, monospace' />
        <option value='"Courier New", monospace' />
      </datalist>
      <p>可输入本机已安装的字体名称。修改即时生效，并自动保存。</p>
      <BackgroundEditor
        title="工作区背景"
        value={value.workspace}
        change={(workspace) => change({ ...value, workspace })}
      />
      <label className="appearance-checkbox">
        <input
          type="checkbox"
          checked={value.includeTerminal}
          onChange={(e) => change({ ...value, includeTerminal: e.target.checked })}
        />
        工作区背景包含终端
      </label>
      {!value.includeTerminal && (
        <BackgroundEditor
          title="终端背景"
          value={value.terminal}
          change={(terminal) => change({ ...value, terminal })}
        />
      )}
    </section>
  );
}
