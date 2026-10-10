import { useState } from 'react';
import { Activity, Rocket, ShieldCheck, PackageCheck } from 'lucide-react';
import './capture.css';
export default function Toolbox({
  open,
  deploy,
  certificate,
  nginx,
  enabled,
}: {
  open: () => void;
  deploy: () => void;
  certificate: () => void;
  nginx: () => void;
  enabled: boolean;
}) {
  const actions = { capture: open, deploy, certificate, nginx };
  const labels = {
    capture: '抓包',
    deploy: '部署',
    certificate: 'HTTPS 证书',
    nginx: 'Nginx 升级',
  };
  const icons = {
    capture: Activity,
    deploy: Rocket,
    certificate: ShieldCheck,
    nginx: PackageCheck,
  };
  const [menu, setMenu] = useState<{ x: number; y: number; kind: keyof typeof actions } | null>(
      null,
    ),
    [selected, setSelected] = useState('');
  return (
    <div
      className="toolbox"
      onClick={() => setMenu(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setMenu(null);
      }}
    >
      {!enabled ? (
        <p>工具包已停用，请在「功能与性能」中开启。</p>
      ) : (
        <>
          {(['capture', 'deploy', 'certificate', 'nginx'] as const).map((kind) => {
            const Icon = icons[kind];
            return (
              <button
                key={kind}
                className={'toolbox-icon ' + (selected === kind ? 'selected' : '')}
                onClick={() => setSelected(kind)}
                onDoubleClick={actions[kind]}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') actions[kind]();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(kind);
                  setMenu({ x: e.clientX, y: e.clientY, kind });
                }}
              >
                <Icon size={30} />
                <span>{labels[kind]}</span>
              </button>
            );
          })}
        </>
      )}
      {menu && (
        <div
          className="file-context"
          role="menu"
          style={{
            left: Math.min(menu.x, innerWidth - 180),
            top: Math.min(menu.y, innerHeight - 50),
          }}
        >
          <button role="menuitem" onClick={actions[menu.kind]}>
            打开
          </button>
        </div>
      )}
    </div>
  );
}
