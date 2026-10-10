import { Plus, X } from 'lucide-react';
import type { Tunnel } from './shared';
export default function TunnelEditor({
  rules,
  onChange,
}: {
  rules: Tunnel[];
  onChange: (r: Tunnel[]) => void;
}) {
  const update = (id: string, patch: Partial<Tunnel>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <section className="tunnel-editor">
      <div className="section-caption">
        <strong>SSH 隧道 / 端口转发</strong>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rules,
              {
                id: crypto.randomUUID(),
                type: 'local',
                bindHost: '127.0.0.1',
                bindPort: 13306,
                targetHost: '127.0.0.1',
                targetPort: 3306,
                enabled: true,
              },
            ])
          }
        >
          <Plus size={14} />
          添加隧道
        </button>
      </div>
      <p>
        本地转发：本机端口 → SSH 服务器可达的目标。远程转发：服务器端口 →
        本机可达的目标。随会话建立与关闭。
      </p>
      {rules.map((r, i) => (
        <div className="tunnel-rule" key={r.id}>
          <div className="tunnel-rule-title">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => update(r.id, { enabled: e.target.checked })}
              />
              启用规则 {i + 1}
            </label>
            <button
              type="button"
              title="删除隧道"
              onClick={() => onChange(rules.filter((x) => x.id !== r.id))}
            >
              <X size={14} />
            </button>
          </div>
          <div className="form-grid">
            <label>
              转发类型
              <select
                value={r.type}
                onChange={(e) => update(r.id, { type: e.target.value as Tunnel['type'] })}
              >
                <option value="local">本地转发（-L）</option>
                <option value="remote">远程转发（-R）</option>
              </select>
            </label>
            <label>
              监听地址
              <input
                required
                value={r.bindHost}
                onChange={(e) => update(r.id, { bindHost: e.target.value })}
              />
            </label>
            <label>
              监听端口
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={r.bindPort}
                onChange={(e) => update(r.id, { bindPort: +e.target.value })}
              />
            </label>
            <label>
              目标主机
              <input
                required
                value={r.targetHost}
                onChange={(e) => update(r.id, { targetHost: e.target.value })}
              />
            </label>
            <label>
              目标端口
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={r.targetPort}
                onChange={(e) => update(r.id, { targetPort: +e.target.value })}
              />
            </label>
          </div>
        </div>
      ))}
    </section>
  );
}
