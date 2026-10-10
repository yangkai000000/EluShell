import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Client, ClientChannel } from 'ssh2';
import {
  CertificateSourceSchema,
  CertificateOptionsSchema,
  type CertificateSource,
  type CertificateOptions,
  type CertificateInspection,
  type CertificatePreview,
  type CertificateJob,
  hasHttpListener,
  certificateSiteLabel,
} from '../src/certificate-shared';
import { quote } from '../src/shared';
import {
  certificateNames,
  configureTLS,
  opensslConfig,
  parseNginx,
  serverSummaries,
} from './nginx-config';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
type Inspection = {
  sessionId: string;
  source: CertificateSource;
  data: CertificateInspection;
  at: number;
};
export type CertificatePlan = {
  sessionId: string;
  source: CertificateSource;
  configPath: string;
  options: CertificateOptions;
  preview: CertificatePreview;
  at: number;
};
const writeEncoded = (text: string, target: string) =>
  `printf '%s' ${quote(Buffer.from(text).toString('base64'))} | base64 -d > ${quote(target)}`;

export function certificateScript(plan: CertificatePlan) {
  const { options: o, preview: p } = plan;
  const config = plan.configPath;
  const nginx = `${quote(o.nginxPath)} -c ${quote(o.mainConfigPath)}`;
  const lock = o.applyNginx
    ? path.posix.join(
        path.posix.dirname(config),
        '.' + path.posix.basename(config) + '.elushell-https.lock',
      )
    : '/tmp/.elushell-certificate-' + p.id;
  // All new output names are unique. Existing certificates and private keys are
  // never truncated, and no private key material is returned to the renderer.
  return `set -eu
umask 077
command -v openssl >/dev/null || { echo '服务器缺少 OpenSSL，请先安装'; exit 1; }
command -v sha256sum >/dev/null || { echo '服务器缺少 sha256sum'; exit 1; }
command -v base64 >/dev/null || { echo '服务器缺少 base64'; exit 1; }
${o.applyNginx ? `${quote(o.nginxPath)} -V 2>&1 | grep -q -- '--with-http_ssl_module' || { echo '此 Nginx 未启用 HTTP SSL 模块。请先在工具包的 Nginx 升级中检测，或使用管理员提供的 SSL 版本。尚未生成证书或修改配置。'; exit 1; }` : ''}
config=${quote(config)}
lock=${quote(lock)}
backup=${quote(p.backupPath)}
test -f "$config" && test ! -L "$config" || { echo '配置路径已变化，请重新读取'; exit 1; }
test "$(sha256sum < "$config" | cut -d ' ' -f 1)" = ${quote(digest(p.before))} || { echo '配置已被修改，请重新读取并预览'; exit 1; }
mkdir -m 700 -- "$lock" || { echo '另一个证书任务正在处理此配置，或没有目录写入权限'; exit 1; }
changed=0
keywork=''
certwork=''
key_created=0
cert_created=0
remove_generated() {
  if test "$key_created" = 1; then rm -f -- ${quote(p.privateKeyPath)}; fi
  if test "$cert_created" = 1; then rm -f -- ${quote(p.certificatePath)}; fi
}
cleanup() {
  code=$?
  set +e
  trap - EXIT HUP INT TERM
  keep_generated=0
  if test "$changed" = 1 && test "$code" != 0; then
    if test -f "$config" && test ! -L "$config" && test "$(sha256sum < "$config" | cut -d ' ' -f 1)" = ${quote(digest(p.after))}; then
      if cp -p -- "$backup" "$lock/rollback" && mv -f -- "$lock/rollback" "$config"; then
        echo '已恢复原 Nginx 配置'
        remove_generated
        if ${nginx} -t && ${nginx} -s reload; then echo '原配置已重新加载'; else echo '原配置重载失败，请检查 Nginx 运行状态'; fi
      else keep_generated=1; echo "恢复失败，已保留证书，请使用备份：$backup"; fi
    else keep_generated=1; echo "配置被其他操作修改，未自动覆盖，已保留证书，请核对备份：$backup"; fi
  fi
  if test "$code" != 0 && test "$keep_generated" = 0; then remove_generated; fi
  rm -f -- "$lock/request.cnf" "$lock/nginx.dump" "$lock/config.next" "$lock/rollback" "$lock/new.crt" "$lock/new.key"
  if test -n "$keywork"; then rm -f -- "$keywork/key"; rmdir -- "$keywork" 2>/dev/null || true; fi
  if test -n "$certwork"; then rm -f -- "$certwork/cert"; rmdir -- "$certwork" 2>/dev/null || true; fi
  rmdir -- "$lock" 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
${
  o.applyNginx
    ? `echo '检查 Nginx 主配置及站点引用'
${nginx} -t
${nginx} -T > "$lock/nginx.dump" 2>&1
if ! grep -Fqx -- ${quote('# configuration file ' + config + ':')} "$lock/nginx.dump" && ! grep -Fqx -- ${quote('# configuration file ' + plan.source.configPath + ':')} "$lock/nginx.dump"; then
  echo '所选配置未被此 Nginx 主配置加载，请核对主配置路径和 include'; exit 1
fi`
    : ''
}
echo '生成 RSA 2048 位内网自签名证书'
mkdir -p -m 700 -- ${quote(o.certificateDirectory)} ${quote(o.keyDirectory)}
test ! -L ${quote(o.certificateDirectory)} && test ! -L ${quote(o.keyDirectory)} || { echo '证书存放目录不能是符号链接'; exit 1; }
test ! -e ${quote(p.certificatePath)} && test ! -L ${quote(p.certificatePath)} && test ! -e ${quote(p.privateKeyPath)} && test ! -L ${quote(p.privateKeyPath)} || { echo '目标证书文件已存在，请重新预览'; exit 1; }
${writeEncoded(opensslConfig(p.names), lock + '/request.cnf')}
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days ${o.days} -config "$lock/request.cnf" -keyout "$lock/new.key" -out "$lock/new.crt"
chmod 600 -- "$lock/new.key"
chmod 644 -- "$lock/new.crt"
keywork=$(mktemp -d ${quote(path.posix.join(o.keyDirectory, '.elushell-key.XXXXXX'))})
certwork=$(mktemp -d ${quote(path.posix.join(o.certificateDirectory, '.elushell-cert.XXXXXX'))})
cp -p -- "$lock/new.key" "$keywork/key"
cp -p -- "$lock/new.crt" "$certwork/cert"
ln -T -- "$keywork/key" ${quote(p.privateKeyPath)}
key_created=1
ln -T -- "$certwork/cert" ${quote(p.certificatePath)}
cert_created=1
openssl x509 -in ${quote(p.certificatePath)} -noout -subject -dates
${
  o.applyNginx
    ? `echo '备份并更新指定站点配置'
test "$(sha256sum < "$config" | cut -d ' ' -f 1)" = ${quote(digest(p.before))} || { echo '生成期间配置被修改，请重新预览；证书文件已保留'; exit 1; }
test ! -e "$backup" && test ! -L "$backup" || { echo '备份路径已存在'; exit 1; }
cp -p -- "$config" "$backup"
cp -p -- "$config" "$lock/config.next"
${writeEncoded(p.after, lock + '/config.next')}
changed=1
mv -f -- "$lock/config.next" "$config"
echo '校验新配置'
${nginx} -t
echo '重载 Nginx'
${nginx} -s reload
changed=0
printf '配置备份：%s\\n' "$backup"`
    : ''
}
printf '证书：%s\\n私钥：%s\\n' ${quote(p.certificatePath)} ${quote(p.privateKeyPath)}
echo ${quote(o.applyNginx ? '证书已生成，Nginx 配置检查及重载命令成功' : '证书已生成，Nginx 配置未修改')}
`;
}

export class CertificateService {
  private inspections = new Map<string, Inspection>();
  private previews = new Map<string, CertificatePlan>();
  private jobs: CertificateJob[] = [];
  private running = new Set<string>();
  constructor(
    private client: (id: string) => Client,
    private emit: (job: CertificateJob) => void,
  ) {}
  isRunning() {
    return this.running.size > 0;
  }
  hasSession(id: string) {
    return this.running.has(id);
  }
  list(id: string) {
    return structuredClone(this.jobs.filter((j) => j.sessionId === id));
  }
  private execute(
    id: string,
    script: string,
    sudo: boolean,
    output?: (s: string) => void,
    seconds = 15,
  ) {
    return new Promise<string>((resolve, reject) => {
      let stream: ClientChannel | undefined,
        text = '',
        ended = false;
      const finish = (error?: Error) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        if (error) {
          stream?.close();
          reject(error);
        } else resolve(text);
      };
      const timer = setTimeout(
        () => finish(Error('证书操作超时，请核对服务器任务输出和配置备份')),
        (seconds + 10) * 1000,
      );
      // The server-side timeout also bounds lifetime if the desktop disconnects.
      const command = `${sudo ? 'sudo -n -- ' : ''}timeout -s TERM -k 10 ${seconds} sh -c ${quote(script)}`;
      try {
        this.client(id).exec(command, (e, channel) => {
          if (e) {
            finish(e);
            return;
          }
          stream = channel;
          if (ended) {
            channel.close();
            return;
          }
          const stdout = new StringDecoder('utf8'),
            stderr = new StringDecoder('utf8');
          const receive = (part: string) => {
            text += part;
            output?.(part);
            if (text.length > 1_500_000) finish(Error('证书操作输出过大'));
          };
          channel.on('data', (b: Buffer) => receive(stdout.write(b)));
          channel.stderr.on('data', (b: Buffer) => receive(stderr.write(b)));
          channel.on('error', finish);
          channel.on('close', (code?: number) => {
            receive(stdout.end());
            receive(stderr.end());
            finish(
              code === 0 ? undefined : Error(text.slice(-6000) || '服务器连接中断或证书操作失败'),
            );
          });
        });
      } catch (e) {
        finish(e instanceof Error ? e : Error(String(e)));
      }
    });
  }
  async inspect(sessionId: string, value: unknown): Promise<CertificateInspection> {
    const source = CertificateSourceSchema.parse(value);
    const result = await this.execute(
      sessionId,
      `set -eu
p=$(readlink -f -- ${quote(source.configPath)})
test -f "$p" || { echo '请选择普通 Nginx 配置文件'; exit 1; }
test "$(wc -c < "$p")" -le 262144 || { echo '配置文件超过 256 KB，请选择独立站点配置'; exit 1; }
printf '%s\\n' "$p"
base64 < "$p"`,
      source.sudo,
    );
    const newline = result.indexOf('\n');
    const configPath = result.slice(0, newline).trim();
    const content = Buffer.from(result.slice(newline + 1), 'base64').toString('utf8');
    if (
      !configPath.startsWith('/') ||
      /[\x00-\x1f]/.test(configPath) ||
      content.includes('\0') ||
      content.includes('\uFFFD')
    )
      throw Error('配置文件必须是 UTF-8 文本，且路径不能包含控制字符');
    const servers = serverSummaries(content);
    if (!servers.length) throw Error('此文件没有 HTTP server 块，请选择实际的站点配置文件');
    if (servers.every((s) => s.redirectOnly))
      throw Error('此文件只包含跳转入口，请选择实际提供页面和接口的业务站点配置');
    const data: CertificateInspection = {
      id: randomUUID(),
      configPath,
      content,
      servers,
      mainConfigPath: parseNginx(content).tree.some((n) => n.words[0] === 'http')
        ? source.configPath
        : undefined,
    };
    this.prune();
    this.inspections.set(data.id, { sessionId, source, data, at: Date.now() });
    return data;
  }
  prepare(sessionId: string, value: unknown): CertificatePreview {
    const options = CertificateOptionsSchema.parse(value);
    this.prune();
    const inspection = this.inspections.get(options.inspectionId);
    if (!inspection || inspection.sessionId !== sessionId)
      throw Error('读取结果已过期，请重新读取此服务器配置');
    const names = certificateNames(options.names);
    const id = randomUUID();
    const basename = 'elushell-' + id.slice(0, 8);
    const certificatePath = path.posix.join(options.certificateDirectory, basename + '.crt');
    const privateKeyPath = path.posix.join(options.keyDirectory, basename + '.key');
    const businessServer = inspection.data.servers.find((s) => s.index === options.serverIndex);
    const httpIndex =
      options.httpServerIndex ??
      (businessServer && hasHttpListener(businessServer) ? businessServer.index : undefined);
    const httpServer = inspection.data.servers.find((s) => s.index === httpIndex);
    const after = options.applyNginx
      ? configureTLS(
          inspection.data.content,
          options.serverIndex,
          certificatePath,
          privateKeyPath,
          options.port,
          options.redirectHttp,
          httpIndex,
        )
      : inspection.data.content;
    const preview: CertificatePreview = {
      id,
      before: inspection.data.content,
      after: options.applyNginx ? after : inspection.data.content,
      certificatePath,
      privateKeyPath,
      backupPath: path.posix.join(
        path.posix.dirname(inspection.data.configPath),
        '.' + path.posix.basename(inspection.data.configPath) + '.elushell-' + id + '.bak',
      ),
      names,
      days: options.days,
      applyNginx: options.applyNginx,
      redirectHttp: options.applyNginx && options.redirectHttp,
      httpSource: httpServer ? certificateSiteLabel(httpServer) : undefined,
      originalRedirect: httpServer?.manualRedirect
        ? `${httpServer.manualRedirect.status} → ${httpServer.manualRedirect.target}`
        : undefined,
    };
    this.previews.set(id, {
      sessionId,
      source: inspection.source,
      configPath: inspection.data.configPath,
      options,
      preview,
      at: Date.now(),
    });
    return structuredClone(preview);
  }
  async start(sessionId: string, previewId: string) {
    this.prune();
    const plan = this.previews.get(previewId);
    if (!plan || plan.sessionId !== sessionId) throw Error('预览已失效，请重新生成预览');
    if (this.running.size || this.running.has(sessionId))
      throw Error('已有证书任务正在执行，请等待完成');
    this.client(sessionId);
    this.previews.delete(previewId);
    this.running.add(sessionId);
    const job: CertificateJob = {
      id: randomUUID(),
      sessionId,
      state: 'running',
      output: '',
      certificatePath: plan.preview.certificatePath,
      privateKeyPath: plan.preview.privateKeyPath,
      backupPath: plan.options.applyNginx ? plan.preview.backupPath : '',
    };
    this.jobs = [job, ...this.jobs].slice(0, 20);
    this.emit({ ...job });
    void this.execute(
      sessionId,
      certificateScript(plan),
      plan.source.sudo,
      (text) => {
        job.output = (job.output + text).slice(-64000);
        this.emit({ ...job });
      },
      180,
    )
      .then(() => {
        job.state = 'completed';
      })
      .catch((e) => {
        job.state = 'failed';
        job.error = String(e instanceof Error ? e.message : e);
      })
      .finally(() => {
        this.running.delete(sessionId);
        this.emit({ ...job });
      });
    return { ...job };
  }
  private prune() {
    for (const items of [this.inspections, this.previews]) {
      for (const [id, item] of items) if (Date.now() - item.at > 30 * 60_000) items.delete(id);
      while (items.size >= 30) items.delete(items.keys().next().value!);
    }
  }
}
