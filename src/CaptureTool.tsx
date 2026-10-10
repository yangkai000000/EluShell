import { useEffect, useState } from 'react';
import { Activity, Download, FolderOpen, Play, RefreshCw, Square } from 'lucide-react';
import { captureRunning, type CaptureCheck, type CaptureOptions } from './capture-shared';
import type { CaptureModel } from './capture-model';
import './capture.css';
export default function CaptureTool({
  sessionId,
  name,
  host,
  connected,
  model,
}: {
  sessionId: string;
  name: string;
  host: string;
  connected: boolean;
  model: CaptureModel;
}) {
  const options = model.draft(sessionId);
  const [check, setCheck] = useState<CaptureCheck | null>(null),
    [checking, setChecking] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [removing, setRemoving] = useState('');
  const latest = model.jobs.find((j) => j.sessionId === sessionId),
    running = latest && captureRunning(latest);
  const change = (patch: Partial<CaptureOptions>) =>
    model.setDraft(sessionId, { ...options, ...patch });
  const refresh = async () => {
    setChecking(true);
    model.setError('');
    try {
      setCheck(await window.elu!.captureCheck(sessionId, options.sudo));
    } catch (e) {
      setCheck({ interfaces: [], error: String(e) });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    let alive = true;
    if (!connected) return;
    setChecking(true);
    setCheck(null);
    void window
      .elu!.captureCheck(sessionId, options.sudo)
      .then((value) => {
        if (alive) setCheck(value);
      })
      .catch((e) => {
        if (alive) setCheck({ interfaces: [], error: String(e) });
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, options.sudo, connected]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    model.setError('');
    try {
      await fn();
    } catch (e) {
      model.setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const status = {
    starting: '准备采集',
    running: '正在采集',
    stopping: '正在停止',
    completed: '已完成',
    failed: '失败',
  };
  return (
    <section className="capture-tool" aria-label="抓包工具">
      <header>
        <Activity size={23} />
        <div>
          <h2>网络抓包</h2>
          <span>
            {name} · {host}
            {!connected && ' · 已断开'}
          </span>
        </div>
        <b>{running ? status[latest.state] : '按需采集'}</b>
      </header>
      <div className="capture-body">
        <div className="capture-configuration">
          <div className="capture-dependencies">
            <span>
              {checking
                ? '正在检查网卡与远端依赖…'
                : check?.error || '使用服务器 tcpdump，通过 SSH 保存到本机'}
            </span>
            <button
              title="重新检查抓包依赖"
              disabled={checking || !connected || !!running}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <fieldset disabled={busy || !!running}>
            <div className="capture-fields">
              <label>
                网卡
                <select
                  aria-label="抓包网卡"
                  value={options.interface}
                  onChange={(e) => change({ interface: e.target.value })}
                >
                  {[...new Set([options.interface, ...(check?.interfaces || [])])].map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
              </label>
              <label>
                协议
                <select
                  aria-label="抓包协议"
                  value={options.protocol}
                  onChange={(e) =>
                    change({ protocol: e.target.value as CaptureOptions['protocol'] })
                  }
                >
                  {['all', 'tcp', 'udp', 'icmp'].map((v) => (
                    <option value={v} key={v}>
                      {v === 'all' ? '全部协议' : v.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                源 IP
                <input
                  aria-label="抓包源 IP"
                  placeholder="可选，IPv4 / IPv6"
                  value={options.source}
                  onChange={(e) => change({ source: e.target.value })}
                />
              </label>
              <label>
                目标 IP
                <input
                  aria-label="抓包目标 IP"
                  placeholder="可选，IPv4 / IPv6"
                  value={options.destination}
                  onChange={(e) => change({ destination: e.target.value })}
                />
              </label>
              <label>
                端口
                <input
                  aria-label="抓包端口"
                  placeholder="例如 443"
                  value={options.port}
                  onChange={(e) => change({ port: e.target.value })}
                />
              </label>
              <label>
                时长（秒）
                <input
                  aria-label="抓包时长"
                  type="number"
                  min={5}
                  max={600}
                  value={options.duration}
                  onChange={(e) => change({ duration: +e.target.value })}
                />
              </label>
            </div>
            <details>
              <summary>高级条件与采集限制</summary>
              <div className="capture-fields">
                <label>
                  包数上限
                  <input
                    aria-label="抓包包数上限"
                    type="number"
                    min={1}
                    max={1000000}
                    value={options.packets}
                    onChange={(e) => change({ packets: +e.target.value })}
                  />
                </label>
                <label>
                  文件上限（MB）
                  <input
                    aria-label="抓包大小上限"
                    type="number"
                    min={1}
                    max={256}
                    value={options.maxMB}
                    onChange={(e) => change({ maxMB: +e.target.value })}
                  />
                </label>
                <label>
                  每包保留字节
                  <select
                    value={options.snaplen}
                    onChange={(e) => change({ snaplen: +e.target.value })}
                  >
                    {[96, 256, 1500, 65535, 262144].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="capture-filter">
                  额外 BPF 条件
                  <input
                    aria-label="抓包过滤表达式"
                    placeholder="例如 host 10.0.0.1"
                    value={options.filter}
                    onChange={(e) => change({ filter: e.target.value })}
                  />
                </label>
              </div>
            </details>
            <label className="capture-check">
              <input
                type="checkbox"
                checked={options.excludeSSH}
                onChange={(e) => change({ excludeSSH: e.target.checked })}
              />
              排除当前 SSH 管理连接
            </label>
            <label className="capture-check">
              <input
                type="checkbox"
                checked={options.sudo}
                onChange={(e) => change({ sudo: e.target.checked })}
              />
              使用 sudo -n（仅限已具备免密权限的账号）
            </label>
          </fieldset>
          <p>采集目标固定为此连接。HTTPS 内容仍然加密；抓包可能包含业务数据，请限定目标和时长。</p>
          <div className="capture-actions">
            {running ? (
              <button
                className="primary"
                disabled={busy || latest.state === 'stopping'}
                onClick={() => void act(() => window.elu!.captureStop(latest.id))}
              >
                <Square size={14} />
                停止并保存
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || checking || !connected || !!check?.error || !check}
                onClick={() => void act(() => window.elu!.captureStart(sessionId, options))}
              >
                <Play size={14} />
                开始抓包
              </button>
            )}
            <small>最多同时 2 个任务 · 数据流式写入本机</small>
          </div>
        </div>
        <div className="capture-results">
          <h3>采集状态与结果</h3>
          {latest && (
            <div className="capture-stats">
              <div>
                <strong>{latest.packets.toLocaleString()}</strong>完整数据包
              </div>
              <div>
                <strong>{(latest.bytes / 1048576).toFixed(2)} MB</strong>已保存
              </div>
              <div>
                <strong>{status[latest.state]}</strong>
                {latest.reason || `最长 ${latest.options.duration} 秒`}
              </div>
            </div>
          )}
          {model.error && (
            <p role="alert" className="capture-error">
              {model.error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {!model.jobs.length && (
            <div className="capture-empty">
              <Activity size={36} />
              <p>设置条件后开始一次限时采集</p>
              <small>启动软件时不会启动抓包进程</small>
            </div>
          )}
          {model.jobs.map((job) => (
            <article key={job.id} className="capture-result">
              <div>
                <b>
                  {job.name} · {status[job.state]}
                </b>
                <small>
                  {new Date(job.started).toLocaleString()} · {job.packets} 包 ·{' '}
                  {(job.bytes / 1048576).toFixed(2)} MB
                </small>
              </div>
              {job.error && <p className="capture-error">{job.error}</p>}
              {job.filter && (
                <details>
                  <summary>采集条件</summary>
                  <code>{job.filter}</code>
                </details>
              )}
              {!captureRunning(job) && (
                <div>
                  {removing === job.id ? (
                    <>
                      <span>删除本机采集文件？已导出的副本保留。</span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            model.setJobs(await window.elu!.captureRemove(job.id));
                            setRemoving('');
                          })
                        }
                      >
                        确认删除
                      </button>
                      <button onClick={() => setRemoving('')}>取消</button>
                    </>
                  ) : (
                    <button onClick={() => setRemoving(job.id)}>删除记录与本机文件</button>
                  )}
                </div>
              )}
              {!captureRunning(job) && job.bytes >= 24 && (
                <div>
                  <button
                    onClick={() =>
                      void act(async () => {
                        const file = await window.elu!.captureExport(job.id);
                        if (file) setNotice('已下载：' + file);
                      })
                    }
                  >
                    <Download size={13} />
                    下载 PCAP
                  </button>
                  <button
                    title="请将 Wireshark 设为 PCAP 的默认打开程序"
                    onClick={() => void act(() => window.elu!.captureOpen(job.id))}
                  >
                    <FolderOpen size={13} />
                    用分析工具打开
                  </button>
                </div>
              )}
            </article>
          ))}
          <small>
            最多保留 20
            次采集结果，达到上限后需下载并删除旧记录。切换标签不停止任务；关闭工具或连接时停止采集。
          </small>
        </div>
      </div>
    </section>
  );
}
