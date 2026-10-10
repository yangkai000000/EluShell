import { useEffect, useState } from 'react';
import type { ConfigInfo, Settings } from './shared';
import ConnectionSharing from './ConnectionSharing';
export default function ConfigPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const [info, setInfo] = useState<ConfigInfo | null>(null),
    [message, setMessage] = useState('');
  const load = () => window.elu!.configInfo().then(setInfo);
  useEffect(() => {
    void load().catch((e) => setMessage(String(e)));
  }, []);
  const action = async (fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      setMessage(typeof result === 'string' ? result : '');
      await load();
    } catch (e) {
      setMessage(String(e));
    }
  };
  return (
    <section className="config-panel">
      <label>
        本地配置目录<code>{info?.directory}</code>
      </label>
      <button onClick={() => void action(() => window.elu!.showConfigDirectory())}>
        打开配置目录
      </button>
      <label>
        下载目录<code>{info?.downloadDirectory}</code>
      </label>
      <button onClick={() => void action(() => window.elu!.chooseDownloadDirectory())}>
        更改下载目录
      </button>
      <label>
        连接导出目录<code>{info?.exportDirectory}</code>
      </label>
      <button onClick={() => void action(() => window.elu!.chooseExportDirectory())}>
        更改导出目录
      </button>
      <ConnectionSharing settings={settings} onChange={onChange} />
      <p>
        导出默认附带已保存的连接密码，也可选择不携带密码。分类、隧道与登录命令一并导出，私钥路径和私钥文件不导出。
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
