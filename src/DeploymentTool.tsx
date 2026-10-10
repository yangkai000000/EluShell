import { useEffect, useRef, useState } from 'react';
import { Pencil, Play, Plus, Rocket, Square, X } from 'lucide-react';
import {
  DeploymentPlanSchema,
  deploymentRunning,
  type DeploymentPlan,
  type DeploymentJob,
} from './deployment-shared';
import CommandTextEditor from './CommandTextEditor';
import './commands.css';
import './deployment.css';
const states = {
  preparing: '准备中',
  uploading: '上传中',
  executing: '执行中',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
};
export default function DeploymentTool({
  sessionId,
  profileId,
  name,
  address,
  connected,
}: {
  sessionId: string;
  profileId: string;
  name: string;
  address: string;
  connected: boolean;
}) {
  const [plans, setPlans] = useState<DeploymentPlan[]>([]),
    [jobs, setJobs] = useState<DeploymentJob[]>([]),
    [draft, setDraft] = useState<DeploymentPlan | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [deleting, setDeleting] = useState(false),
    [discarding, setDiscarding] = useState(false),
    [selected, setSelected] = useState('');
  const baseline = useRef('');
  const consoleRef = useRef<HTMLPreElement>(null),
    follow = useRef(true);
  useEffect(() => {
    let alive = true;
    const updates = new Map<string, DeploymentJob>();
    let latestPlans: DeploymentPlan[] | undefined;
    const offPlans = window.elu!.onDeploymentPlans((plans) => {
      latestPlans = plans;
      if (alive) setPlans(plans);
    });
    const off = window.elu!.onDeployment((job) => {
      if (job.profileId !== profileId) return;
      updates.set(job.id, job);
      setJobs((old) =>
        [job, ...old.filter((j) => j.id !== job.id)]
          .sort((a, b) => b.started - a.started)
          .slice(0, 30),
      );
    });
    window
      .elu!.deploymentState(sessionId)
      .then((state) => {
        if (alive) {
          setPlans(latestPlans ?? state.plans);
          setJobs(
            [...new Map([...state.jobs, ...updates.values()].map((j) => [j.id, j])).values()].sort(
              (a, b) => b.started - a.started,
            ),
          );
        }
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
      off();
      offPlans();
    };
  }, [sessionId, profileId]);
  const job = jobs.find((j) => j.id === selected) || jobs[0];
  const running = jobs.some(deploymentRunning);
  useEffect(() => {
    if (follow.current && consoleRef.current)
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [job?.output]);
  const open = (plan?: DeploymentPlan) => {
    const value = plan
      ? { ...plan }
      : {
          id: crypto.randomUUID(),
          name: '',
          localPath: '',
          remoteDirectory: '/home/EluShell',
          commands: '',
          timeoutMinutes: 10,
        };
    baseline.current = JSON.stringify(value);
    setDraft(value);
    setDeleting(false);
    setDiscarding(false);
    setError('');
  };
  const close = () =>
    JSON.stringify(draft) !== baseline.current ? setDiscarding(true) : setDraft(null);
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
  const save = () =>
    act(async () => {
      const result = DeploymentPlanSchema.safeParse(draft);
      if (!result.success)
        throw Error('请填写方案名称、本地完整路径、远程绝对目录和部署命令，超时范围为 1–60 分钟。');
      const saved = await window.elu!.deploymentSave(sessionId, result.data);
      setPlans((old) => [saved, ...old.filter((p) => p.id !== saved.id)]);
      setDraft(null);
    });
  return (
    <section className="deployment-tool" aria-label="部署工具">
      <header>
        <Rocket size={21} />
        <div>
          <h2>快捷部署</h2>
          <span>
            执行目标：{name} · {address}
            {!connected && ' · 已断开'}
          </span>
        </div>
        {plans.length > 0 && (
          <button className="primary" onClick={() => open()} disabled={busy}>
            <Plus size={14} />
            新建方案
          </button>
        )}
      </header>
      {error && !draft && (
        <div className="editor-error" role="alert">
          {error}
        </div>
      )}
      <div className="deployment-body">
        {!ready ? (
          <p>正在读取部署方案…</p>
        ) : !plans.length ? (
          <div className="deployment-empty">
            <button className="primary" onClick={() => open()}>
              <Plus size={16} />
              新建方案
            </button>
          </div>
        ) : (
          <div className="deployment-list" role="list" aria-label="部署方案列表">
            {plans.map((plan) => {
              const latest = jobs.find((j) => j.planId === plan.id);
              return (
                <div className="deployment-row" role="listitem" key={plan.id}>
                  <strong title={plan.name}>{plan.name}</strong>
                  <span
                    className="deployment-summary"
                    title={`${plan.localPath}\n→ ${plan.remoteDirectory}`}
                  >
                    {plan.localPath.split(/[\\/]/).pop()} → {plan.remoteDirectory}
                  </span>
                  <button
                    className={'deployment-status ' + (latest?.state || '')}
                    disabled={!latest}
                    title="查看执行输出"
                    onClick={() => setSelected(latest?.id || '')}
                  >
                    {latest ? states[latest.state] : '未执行'}
                  </button>
                  <button
                    className="primary"
                    disabled={busy || running || !connected}
                    onClick={() =>
                      void act(async () => {
                        const result = await window.elu!.deploymentStart(sessionId, plan.id);
                        setSelected(result.id);
                        follow.current = true;
                      })
                    }
                  >
                    <Play size={13} />
                    执行
                  </button>
                  <button
                    title={`编辑方案 ${plan.name}`}
                    disabled={busy || (!!latest && deploymentRunning(latest))}
                    onClick={() => open(plan)}
                  >
                    <Pencil size={13} />
                    编辑
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {job && (
          <section className="deployment-output">
            <header>
              <strong>
                {job.name} · {states[job.state]}
              </strong>
              <span>{job.host}</span>
              {deploymentRunning(job) && (
                <button
                  disabled={busy}
                  onClick={() => void act(() => window.elu!.deploymentStop(job.id))}
                >
                  <Square size={13} />
                  停止任务
                </button>
              )}
            </header>
            <div className="deployment-steps">
              {(['preparing', 'uploading', 'executing', 'completed'] as const).map((state, i) => (
                <span className={job.state === state ? 'active' : ''} key={state}>
                  {i + 1}. {['检查文件与目录', '上传文件', '执行命令', '完成'][i]}
                </span>
              ))}
            </div>
            <pre
              ref={consoleRef}
              onScroll={() => {
                const el = consoleRef.current!;
                follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {job.output || '正在准备…'}
            </pre>
            {job.error && <p className="editor-error">{job.error}</p>}
            <small>输出保留最近 128,000 个字符。停止任务不回滚已上传的文件或已执行的命令。</small>
          </section>
        )}
      </div>
      {draft && (
        <div
          className="modal-backdrop"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <section className="modal deployment-dialog" role="dialog" aria-label="编辑部署方案">
            <div className="modal-header">
              <h2>{plans.some((p) => p.id === draft.id) ? '编辑部署方案' : '新建部署方案'}</h2>
              <button title="关闭部署方案编辑" disabled={busy} onClick={close}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-content">
              <label>
                方案名称
                <input
                  value={draft.name}
                  maxLength={100}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="例如 订单服务发布"
                />
              </label>
              <label>
                本地文件或目录
                <input
                  value={draft.localPath}
                  onChange={(e) => setDraft({ ...draft, localPath: e.target.value })}
                  placeholder="选择文件，或输入包含文件名的完整路径"
                />
              </label>
              <div className="deployment-pickers">
                {(['file', 'directory'] as const).map((kind) => (
                  <button
                    key={kind}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const path = await window.elu!.deploymentPick(kind);
                        if (path) setDraft({ ...draft, localPath: path });
                      })
                    }
                  >
                    {kind === 'file' ? '选择文件' : '选择目录'}
                  </button>
                ))}
              </div>
              <label>
                上传目录
                <input
                  value={draft.remoteDirectory}
                  onChange={(e) => setDraft({ ...draft, remoteDirectory: e.target.value })}
                />
              </label>
              <p>
                上传后路径：
                <code>
                  {draft.remoteDirectory.replace(/\/$/, '')}/
                  {draft.localPath.split(/[\\/]/).pop() || '文件名'}
                </code>
                。同名文件覆盖，目录合并；使用当前账户权限。
              </p>
              <div className="deployment-command-label">部署命令</div>
              <div className="deployment-command-editor">
                <CommandTextEditor
                  label="部署命令"
                  value={draft.commands}
                  onChange={(commands) =>
                    setDraft((current) => current && { ...current, commands })
                  }
                  fontSize={13}
                  wordWrap
                  maxLength={64000}
                />
              </div>
              <p>
                使用当前终端会话的用户、环境变量和工作目录，按脚本顺序执行；命令失败时停止。
                执行前请让终端回到命令提示符。需要切换目录时，在脚本中填写 cd 命令。
                <code>$ELUSHELL_UPLOAD_PATH</code> 是上传文件完整路径，
                <code>$ELUSHELL_UPLOAD_DIR</code> 是上传目录。
              </p>
              <label>
                超时（分钟）
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={draft.timeoutMinutes}
                  onChange={(e) => setDraft({ ...draft, timeoutMinutes: +e.target.value })}
                />
              </label>
              {error && (
                <p className="editor-error" role="alert">
                  {error}
                </p>
              )}
              {discarding && (
                <p className="editor-confirm">
                  方案修改尚未保存。<button onClick={() => setDraft(null)}>放弃修改</button>
                  <button onClick={() => setDiscarding(false)}>继续编辑</button>
                </p>
              )}
              {deleting && (
                <p className="editor-confirm">
                  删除此本地方案？服务器文件不会删除。
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await window.elu!.deploymentRemove(sessionId, draft.id);
                        setPlans((p) => p.filter((item) => item.id !== draft.id));
                        setDraft(null);
                      })
                    }
                  >
                    确认删除方案
                  </button>
                  <button onClick={() => setDeleting(false)}>取消删除</button>
                </p>
              )}
            </div>
            <footer>
              {plans.some((p) => p.id === draft.id) && (
                <button className="danger" disabled={busy} onClick={() => setDeleting(true)}>
                  删除方案
                </button>
              )}
              <span />
              <button disabled={busy} onClick={close}>
                取消
              </button>
              <button className="primary" disabled={busy} onClick={() => void save()}>
                {busy ? '处理中…' : '保存方案'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
