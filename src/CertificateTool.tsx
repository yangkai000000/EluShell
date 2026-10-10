import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type {
  CertificateInspection,
  CertificatePreview,
  CertificateJob,
} from './certificate-shared';
import './certificate.css';
import {
  httpSources,
  suggestedHttpSource,
  suggestedCertificateServer,
  certificateSiteLabel,
  hasHttpListener,
} from './certificate-shared';

export default function CertificateTool({
  sessionId,
  name,
  host,
  connected,
  onUpgrade,
}: {
  sessionId: string;
  name: string;
  host: string;
  connected: boolean;
  onUpgrade?: (initial: Partial<import('./nginx-upgrade-shared').NginxUpgradeSource>) => void;
}) {
  const [configPath, setConfigPath] = useState('');
  const [sudo, setSudo] = useState(false);
  const [mainConfigPath, setMain] = useState('/etc/nginx/nginx.conf');
  const [nginxPath, setNginx] = useState('nginx');
  const [inspection, setInspection] = useState<CertificateInspection | null>(null);
  const [serverIndex, setServer] = useState(0);
  const [names, setNames] = useState(host);
  const [days, setDays] = useState(365),
    [port, setPort] = useState(443);
  const [certificateDirectory, setCertDir] = useState('/home/EluShell/certificates');
  const [keyDirectory, setKeyDir] = useState('/home/EluShell/certificates');
  const [applyNginx, setApply] = useState(true);
  const [redirectHttp, setRedirect] = useState(false);
  const [httpServerIndex, setHttpServer] = useState<number | undefined>();
  const [preview, setPreview] = useState<CertificatePreview | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [job, setJob] = useState<CertificateJob | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!preview || !results.current) return;
    results.current.scrollTop = 0;
    if (window.innerWidth <= 1150) results.current.scrollIntoView({ block: 'start' });
  }, [preview]);
  useEffect(() => {
    let alive = true,
      updated = false;
    const off = window.elu!.onCertificate((j) => {
      if (j.sessionId === sessionId) {
        updated = true;
        setJob(j);
      }
    });
    void window
      .elu!.certificateList(sessionId)
      .then((jobs) => {
        if (alive && !updated) setJob(jobs[0] || null);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
      off();
    };
  }, [sessionId]);
  const running = job?.state === 'running';
  const selectedServer = inspection?.servers.find((s) => s.index === serverIndex);
  const separateHttp = selectedServer && !hasHttpListener(selectedServer);
  const sources = inspection ? httpSources(inspection.servers, serverIndex) : [];
  const httpServer = sources.find((s) => s.index === httpServerIndex);
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
  const selectServer = (data: CertificateInspection, index: number) => {
    setServer(index);
    const server = data.servers[index];
    const httpIndex = suggestedHttpSource(data.servers, index);
    setHttpServer(httpIndex);
    setRedirect(data.servers.find((s) => s.index === httpIndex)?.redirectHttp || false);
    const found = server.names.filter((n) => n && !/[~$\s]/.test(n) && n !== '_');
    setNames([...new Set([...found, host])].join('\n'));
    const listen = server.listens.find((s) => /\bssl\b/.test(s));
    setPort(Number(listen?.split(' ')[0].match(/(?:^|:)(\d+)$/)?.[1]) || 443);
  };
  return (
    <section className="certificate-tool" aria-label="HTTPS 证书工具">
      <header>
        <ShieldCheck size={22} />
        <div>
          <h2>HTTPS 证书</h2>
          <span>
            {name} · {host}
          </span>
        </div>
        <small>内网自签名</small>
      </header>
      <div className="certificate-body">
        <div className="certificate-form">
          <p className="certificate-note">
            在当前服务器直接生成证书和
            KEY，无需联网。浏览器默认不信任自签名证书，需要在客户端导入信任。
          </p>
          {!connected && <p role="alert">此服务器已断开，请重新连接后打开工具。</p>}
          <fieldset disabled={busy || running || !connected} onChange={() => setPreview(null)}>
            <label>
              Nginx 配置文件
              <input
                placeholder="例如 /etc/nginx/conf.d/internal.conf"
                value={configPath}
                onChange={(e) => {
                  setConfigPath(e.target.value);
                  setInspection(null);
                }}
              />
            </label>
            <label className="certificate-check">
              <input
                type="checkbox"
                checked={sudo}
                onChange={(e) => {
                  setSudo(e.target.checked);
                  setInspection(null);
                }}
              />
              使用 sudo（需要当前 SSH 用户已配置免密权限）
            </label>
            <button
              className="primary"
              disabled={!configPath.trim()}
              onClick={() =>
                act(async () => {
                  setPreview(null);
                  setInspection(null);
                  const data = await window.elu!.certificateInspect(sessionId, {
                    configPath,
                    sudo,
                  });
                  setInspection(data);
                  selectServer(data, suggestedCertificateServer(data.servers));
                  if (data.mainConfigPath) setMain(data.mainConfigPath);
                })
              }
            >
              {busy ? '处理中…' : '读取配置'}
            </button>
            {inspection && (
              <>
                <label>
                  选择站点
                  <select
                    value={serverIndex}
                    onChange={(e) => selectServer(inspection, Number(e.target.value))}
                  >
                    {inspection.servers.map((s) => (
                      <option key={s.index} value={s.index} disabled={s.redirectOnly}>
                        站点 {s.index + 1} · {s.names.join(', ') || '未设置 server_name'} ·{' '}
                        {s.listens.join(', ') || '默认端口'}
                        {s.redirectOnly ? ' · 跳转入口（请选择业务站点）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  证书适用的 IP / 域名
                  <textarea
                    rows={3}
                    placeholder="每行一个，可同时填写 IP 和内网域名"
                    value={names}
                    onChange={(e) => setNames(e.target.value)}
                  />
                </label>
                <div className="certificate-fields">
                  <label>
                    有效期（天）
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    HTTPS 端口
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label>
                  证书存放目录
                  <input
                    value={certificateDirectory}
                    onChange={(e) => setCertDir(e.target.value)}
                  />
                </label>
                <label>
                  KEY 存放目录
                  <input value={keyDirectory} onChange={(e) => setKeyDir(e.target.value)} />
                </label>
                <label className="certificate-check">
                  <input
                    type="checkbox"
                    checked={applyNginx}
                    onChange={(e) => setApply(e.target.checked)}
                  />
                  生成后写入所选站点配置并重载 Nginx
                </label>
                {applyNginx && (
                  <div className="certificate-redirect">
                    <label className="certificate-check">
                      <input
                        type="checkbox"
                        checked={redirectHttp}
                        onChange={(e) => setRedirect(e.target.checked)}
                      />
                      HTTP 自动跳转 HTTPS
                    </label>
                    {separateHttp && (
                      <label>
                        HTTP 入口
                        <select
                          aria-label="HTTP 入口"
                          value={httpServerIndex ?? ''}
                          onChange={(e) => {
                            const next = e.target.value === '' ? undefined : Number(e.target.value);
                            setHttpServer(next);
                            setRedirect(
                              (enabled) =>
                                enabled ||
                                sources.find((s) => s.index === next)?.redirectHttp ||
                                false,
                            );
                          }}
                        >
                          <option value="">请选择与此 HTTPS 站点对应的 HTTP 入口</option>
                          {sources.map((s) => (
                            <option key={s.index} value={s.index}>
                              {certificateSiteLabel(s)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <p>
                      {separateHttp && !httpServer
                        ? sources.length
                          ? 'HTTP 与 HTTPS 分开配置，请选择要设置跳转的 HTTP 入口。入口的域名 / IP 应与此 HTTPS 站点对应。'
                          : '当前文件未找到 HTTP 入口。请读取包含 HTTP 与 HTTPS 两个站点的配置文件，或先在此文件中添加 HTTP 入口，再重新读取。'
                        : redirectHttp
                          ? `所选 HTTP 入口的请求将以 308 跳转至 HTTPS ${port} 端口，保留访问域名 / IP、路径、参数和请求方法。`
                          : '保持现有访问方式；取消勾选只移除本工具添加的跳转，手动配置的规则保持不变。'}{' '}
                      跳转不会消除自签名证书的信任提示。
                    </p>
                    {httpServer?.manualRedirect && (
                      <p className="certificate-existing-redirect">
                        已有手工跳转：{httpServer.manualRedirect.status} →{' '}
                        {httpServer.manualRedirect.target}。 勾选后优先使用本工具的 308
                        规则；取消后仍保留原跳转。
                      </p>
                    )}
                  </div>
                )}
                {applyNginx && (
                  <details open>
                    <summary>Nginx 检查与重载</summary>
                    <label>
                      Nginx 主配置文件
                      <input value={mainConfigPath} onChange={(e) => setMain(e.target.value)} />
                    </label>
                    <label>
                      Nginx 程序路径
                      <input
                        value={nginxPath}
                        onChange={(e) => setNginx(e.target.value)}
                        placeholder="nginx 或 /usr/local/nginx/sbin/nginx"
                      />
                    </label>
                    <p>
                      主配置需包含上面选择的站点文件。HTTP 访问方式由上方选项控制； HTTPS
                      继续使用所选站点的页面和接口配置。
                    </p>
                    {onUpgrade && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpgrade({
                            binary: nginxPath.startsWith('/')
                              ? nginxPath
                              : '/usr/local/nginx/sbin/nginx',
                            config: mainConfigPath,
                            sudo,
                          })
                        }
                      >
                        检查 / 升级 Nginx 的 SSL 支持
                      </button>
                    )}
                  </details>
                )}
                <button
                  className="primary"
                  disabled={applyNginx && redirectHttp && !httpServer}
                  onClick={() =>
                    act(async () => {
                      setPreview(null);
                      const result = await window.elu!.certificatePrepare(sessionId, {
                        inspectionId: inspection.id,
                        serverIndex,
                        names: names.split(/[\s,，]+/).filter(Boolean),
                        days,
                        port,
                        certificateDirectory,
                        keyDirectory,
                        mainConfigPath,
                        nginxPath,
                        applyNginx,
                        redirectHttp: applyNginx && redirectHttp,
                        httpServerIndex,
                      });
                      setPreview(result);
                      setShowBefore(false);
                    })
                  }
                >
                  预览生成结果
                </button>
              </>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="certificate-error">
              {error}
            </p>
          )}
        </div>
        <div className="certificate-results" ref={results}>
          {preview ? (
            <>
              <h3>生成预览</h3>
              <dl>
                <dt>适用地址</dt>
                <dd>{preview.names.join('、')}</dd>
                <dt>有效期</dt>
                <dd>{preview.days} 天</dd>
                <dt>证书文件</dt>
                <dd>{preview.certificatePath}</dd>
                <dt>KEY 文件</dt>
                <dd>{preview.privateKeyPath}</dd>
                {preview.applyNginx && (
                  <>
                    <dt>配置备份</dt>
                    <dd>{preview.backupPath}</dd>
                    <dt>HTTP 访问</dt>
                    <dd>
                      {preview.redirectHttp
                        ? '自动跳转 HTTPS（308）'
                        : preview.originalRedirect
                          ? '保留原有手工跳转，移除本工具的跳转'
                          : '保持原规则，移除本工具的跳转'}
                    </dd>
                    {preview.httpSource && (
                      <>
                        <dt>HTTP 入口</dt>
                        <dd>{preview.httpSource}</dd>
                      </>
                    )}
                    {preview.originalRedirect && (
                      <>
                        <dt>原有跳转</dt>
                        <dd>{preview.originalRedirect}（保留）</dd>
                      </>
                    )}
                  </>
                )}
              </dl>
              {preview.applyNginx && (
                <>
                  <div className="certificate-preview-tabs">
                    <button
                      className={!showBefore ? 'active' : ''}
                      onClick={() => setShowBefore(false)}
                    >
                      修改后配置
                    </button>
                    <button
                      className={showBefore ? 'active' : ''}
                      onClick={() => setShowBefore(true)}
                    >
                      原配置
                    </button>
                  </div>
                  <pre
                    className="certificate-code"
                    aria-label={showBefore ? '原 Nginx 配置' : '修改后 Nginx 配置'}
                  >
                    {(showBefore ? preview.before : preview.after).split('\n').map((line, i) => (
                      <div key={i}>
                        <span>{i + 1}</span>
                        <code>{line || ' '}</code>
                      </div>
                    ))}
                  </pre>
                </>
              )}
              <button
                className="primary"
                disabled={busy || running || !connected}
                onClick={() =>
                  act(async () => {
                    const started = await window.elu!.certificateStart(sessionId, preview.id);
                    setJob((old) => (old?.id === started.id ? old : started));
                    setPreview(null);
                  })
                }
              >
                {preview.applyNginx ? '生成证书并应用到 Nginx' : '仅生成证书文件'}
              </button>
              <p>KEY 仅保存在服务器，权限为 600；新文件使用独立名称，不覆盖已有证书。</p>
            </>
          ) : (
            <div className="certificate-placeholder">
              <ShieldCheck size={32} />
              <p>先读取配置，再核对证书信息和配置变更。</p>
            </div>
          )}
          {job && (
            <div className="certificate-job" role="status">
              <h3>
                {running ? '正在生成与配置…' : job.state === 'completed' ? '已完成' : '操作失败'}
              </h3>
              <pre aria-label="证书操作日志">{job.output || '正在连接服务器…'}</pre>
              {job.error && <p className="certificate-error">{job.error}</p>}
              {job.state === 'completed' && (
                <>
                  <p>证书：{job.certificatePath}</p>
                  <p>KEY：{job.privateKeyPath}</p>
                  {job.backupPath && <p>配置备份：{job.backupPath}</p>}
                  <p>可在文件管理中下载 .crt 文件，分发给需要导入信任的客户端。</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
