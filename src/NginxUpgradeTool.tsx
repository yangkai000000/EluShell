import { useEffect, useRef, useState } from 'react';
import { PackageCheck, CheckCircle2, CircleAlert } from 'lucide-react';
import type {
  NginxUpgradeJob,
  NginxUpgradePreview,
  NginxUpgradeSource,
} from './nginx-upgrade-shared';
import './certificate.css';
import './nginx-upgrade.css';

export default function NginxUpgradeTool({
  sessionId,
  name,
  host,
  connected,
  initial,
  onCertificate,
}: {
  sessionId: string;
  name: string;
  host: string;
  connected: boolean;
  initial?: Partial<NginxUpgradeSource>;
  onCertificate: () => void;
}) {
  const [source, setSource] = useState<NginxUpgradeSource>({
    binary: '/usr/local/nginx/sbin/nginx',
    config: '/usr/local/nginx/conf/nginx.conf',
    prefix: '/usr/local/nginx',
    pidPath: '',
    sudo: false,
    healthUrl: 'http://127.0.0.1/',
    ...initial,
  });
  const [preview, setPreview] = useState<NginxUpgradePreview | null>(null);
  const [job, setJob] = useState<NginxUpgradeJob | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const log = useRef<HTMLPreElement>(null);
  const running = job?.state === 'running';
  const disabled = busy || running || !connected;
  useEffect(() => {
    let alive = true,
      updated = false;
    const off = window.elu!.onNginxUpgrade((j) => {
      if (j.sessionId === sessionId) {
        updated = true;
        setJob(j);
      }
    });
    void window
      .elu!.nginxUpgradeList(sessionId)
      .then((jobs) => {
        if (alive && !updated) setJob(jobs[0] || null);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
      off();
    };
  }, [sessionId]);
  const update = (patch: Partial<NginxUpgradeSource>) => {
    setSource((s) => ({ ...s, ...patch }));
    setPreview(null);
    setConfirmed(false);
    setError('');
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="certificate-tool nginx-upgrade" aria-label="Nginx 离线升级">
      <header>
        <PackageCheck size={22} />
        <div>
          <h2>Nginx 离线升级</h2>
          <span>
            {name} · {host}
          </span>
        </div>
        <small>内置 SSL · 无需服务器联网</small>
      </header>
      <ol className="nginx-steps" aria-label="升级步骤">
        {['检测当前实例', '核对升级方案', '执行与结果'].map((s, i) => (
          <li key={s} className={(job ? 2 : preview ? 1 : 0) === i ? 'active' : ''}>
            <b>{i + 1}</b>
            {s}
          </li>
        ))}
      </ol>
      <div className="certificate-body">
        <div className="certificate-form">
          <h3>当前服务器上的 Nginx</h3>
          <p className="certificate-note">
            保留现有站点配置，先检查新版能否加载。独立实例采用平滑切换；系统服务实例按服务管理器重启。
          </p>
          {!connected && (
            <p role="alert" className="certificate-error">
              连接已断开。重新连接后请重新检测。
            </p>
          )}
          <fieldset disabled={disabled}>
            <label>
              Nginx 程序完整路径
              <input
                value={source.binary}
                onChange={(e) => update({ binary: e.target.value })}
                placeholder="/usr/local/nginx/sbin/nginx"
              />
            </label>
            <label>
              Nginx 主配置文件
              <input
                value={source.config}
                onChange={(e) => update({ config: e.target.value })}
                placeholder="/usr/local/nginx/conf/nginx.conf"
              />
            </label>
            <label>
              本机健康检查地址
              <input
                value={source.healthUrl}
                onChange={(e) => update({ healthUrl: e.target.value })}
                placeholder="http://127.0.0.1:8800/"
              />
            </label>
            <p>
              填写能正常访问的本机页面或健康检查接口，要求返回 HTTP 2xx /
              3xx。升级前后都会检查此地址。
            </p>
            <label className="certificate-check">
              <input
                type="checkbox"
                checked={source.sudo}
                onChange={(e) => update({ sudo: e.target.checked })}
              />
              使用免密 sudo（普通用户管理 root 实例时）
            </label>
            <details>
              <summary>高级设置</summary>
              <label>
                运行目录（prefix）
                <input value={source.prefix} onChange={(e) => update({ prefix: e.target.value })} />
              </label>
              <label>
                PID 文件（通常自动识别）
                <input
                  value={source.pidPath}
                  onChange={(e) => update({ pidPath: e.target.value })}
                  placeholder="留空自动读取配置"
                />
              </label>
              <p>
                沿用当前实例的目录和启动方式。第三方模块、共享程序的多个实例及未知启动参数会阻止自动升级。
              </p>
            </details>
            <button
              className="primary"
              onClick={() =>
                act(async () => {
                  setPreview(null);
                  setJob(null);
                  setConfirmed(false);
                  setPreview(await window.elu!.nginxUpgradeInspect(sessionId, source));
                })
              }
            >
              {busy ? '正在检测…' : preview ? '重新检测' : '检测兼容性'}
            </button>
          </fieldset>
          <p>银河麒麟 V10 等 Linux 系统按 CPU 架构、运行库和实际配置检测，不按系统名称直接放行。</p>
          {error && (
            <p role="alert" className="certificate-error">
              {error}
            </p>
          )}
        </div>
        <div className="certificate-results">
          {!preview && !job && (
            <div className="nginx-intro">
              <PackageCheck size={40} />
              <h3>先检测，再升级</h3>
              <p>核对系统与运行实例 → 备份程序和配置 → 检查新版 → 切换并检查响应。</p>
              <p>升级失败时尝试恢复旧程序，备份保存在服务器上。完成后可继续配置 HTTPS。</p>
            </div>
          )}
          {preview && !job && (
            <>
              <h3>{preview.ready ? '可以准备升级' : '请先处理以下检查项'}</h3>
              <p>
                {preview.system} · {preview.strategy}
              </p>
              <dl>
                <dt>版本</dt>
                <dd>
                  {preview.currentVersion} → {preview.targetVersion || '暂无对应包'}
                </dd>
                <dt>当前 SSL</dt>
                <dd>{preview.ssl ? '已启用' : '未启用'}</dd>
                <dt>master</dt>
                <dd>{preview.pid || '未识别'}</dd>
                {preview.backupPath && (
                  <>
                    <dt>备份目录</dt>
                    <dd>{preview.backupPath}</dd>
                  </>
                )}
              </dl>
              <ul className="nginx-checks">
                {preview.checks.map((c) => (
                  <li key={c.name} className={c.ok ? 'ok' : 'blocked'}>
                    {c.ok ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
                    <div>
                      <strong>{c.name}</strong>
                      <p>{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {preview.ready && (
                <div className="nginx-confirm">
                  <p>
                    下一步上传内置包（{(preview.packageBytes / 1048576).toFixed(1)}{' '}
                    MB），新版配置检查通过后切换。检测结果 15 分钟内有效，执行前再次核对配置与进程。
                  </p>
                  <label className="certificate-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={disabled}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    已核对目标服务器和健康检查地址，同意执行升级
                  </label>
                  <button
                    className="primary"
                    disabled={disabled || !confirmed}
                    onClick={() =>
                      act(async () => {
                        setJob(await window.elu!.nginxUpgradeStart(sessionId, preview.id));
                      })
                    }
                  >
                    备份并升级
                  </button>
                </div>
              )}
            </>
          )}
          {job && (
            <div className="nginx-result" aria-live="polite">
              <h3>{job.stage}</h3>
              <progress max={100} value={job.percent} aria-label="Nginx 升级进度" />
              <p>
                {job.percent}%{running ? ' · 请保持连接，等待检查完成' : ''}
              </p>
              <dl>
                <dt>备份目录</dt>
                <dd>{job.backupPath}</dd>
              </dl>
              {job.state === 'unknown' && (
                <p role="alert" className="certificate-error">
                  尚不能确认最终状态。请检查服务器进程、备份目录的 exit-code 和原程序
                  original，确认后再重试。
                </p>
              )}
              {job.error && (
                <p role="alert" className="certificate-error">
                  {job.error}
                </p>
              )}
              <pre ref={log}>
                {job.output
                  .replace(/^ELUSHELL_STAGE:\d+:/gm, '')
                  .replace(/^ELUSHELL_ROLLBACK_OK$/gm, '已恢复旧程序并通过健康检查')}
              </pre>
              {job.state === 'completed' && (
                <button className="primary" onClick={onCertificate}>
                  继续配置 HTTPS 证书
                </button>
              )}
              {!running && (
                <button
                  onClick={() => {
                    setJob(null);
                    setPreview(null);
                    setConfirmed(false);
                  }}
                >
                  返回检测
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
