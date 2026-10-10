import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  certificateNames,
  configureTLS,
  opensslConfig,
  parseNginx,
  serverSummaries,
} from '../electron/nginx-config';
import { CertificateService } from '../electron/certificates';
import {
  CertificateOptionsSchema,
  httpSources,
  suggestedHttpSource,
  suggestedCertificateServer,
  type CertificateJob,
} from '../src/certificate-shared';

const config = `# server { ignored }
events {}
http {
  server {
    listen 8080;
    server_name service.internal;
    location / { proxy_pass http://upstream; add_header X-Test "brace } and # comments"; }
    set $example "\${request_uri}";
  }
  server { listen 8443 ssl; server_name other.internal; ssl_certificate /old/other.crt; ssl_certificate_key /old/other.key; }
}
stream { server { listen 1234; } }
`;

describe('Nginx certificate edits', () => {
  it('redirects a separate HTTP entrance while keeping TLS and other business sites intact', () => {
    const before = `http {
      server { listen 80; listen [::]:80; server_name app.internal; location / { return 200 http; } }
      server { listen 8443 ssl; server_name app.internal; location / { return 200 https; } }
      server { listen 8080; server_name other.internal; location / { return 200 other; } }
    }`;
    const data = serverSummaries(before);
    expect(suggestedHttpSource(data, 1)).toBe(0);
    expect(suggestedCertificateServer(data)).toBe(1);
    expect(httpSources(data, 1).map((s) => s.index)).toEqual([0, 2]);
    const enabled = configureTLS(before, 1, '/c', '/k', 8443, true, 0);
    const servers = parseNginx(enabled).servers;
    expect(servers[0].children![0].words[0]).toBe('if');
    expect(servers[1].children!.some((d) => d.words[0] === 'if')).toBe(false);
    expect(servers[0].children!.some((d) => d.words[0] === 'ssl_certificate')).toBe(false);
    expect(servers[1].children!.some((d) => d.words.join(' ') === 'ssl_certificate /c')).toBe(true);
    expect(enabled).toContain(
      'server { listen 8080; server_name other.internal; location / { return 200 other; } }',
    );
    expect(serverSummaries(enabled)[0].redirectHttp).toBe(true);
    expect(serverSummaries(enabled)[1].redirectHttp).toBeUndefined();
    expect(configureTLS(enabled, 1, '/c', '/k', 8443, true, 0)).toBe(enabled);
    const disabled = configureTLS(enabled, 1, '/c', '/k', 8443, false, 0);
    expect(disabled).not.toContain('return 308');
    expect(disabled).toContain('return 200 http');
    expect(disabled).toContain('return 200 https');
    expect(() => configureTLS(before, 1, '/c', '/k', 8443, true, 1)).toThrow('HTTP');
    expect(() => configureTLS(before, 1, '/c', '/k', 8443, true, 99)).toThrow('找不到');
    expect(() => configureTLS(before, 0, '/c', '/k', 443, true, 2)).toThrow('当前站点');
  });
  it('preserves and reports an existing standalone manual redirect, without guessing ambiguous names', () => {
    const manual = `server { listen 80; server_name app.internal; return 301 https://$host$request_uri; }
server { listen 443 ssl; server_name app.internal; location / { return 200 ok; } }`;
    expect(serverSummaries(manual)[0].manualRedirect).toEqual({
      status: 301,
      target: 'https://$host$request_uri',
    });
    const enabled = configureTLS(manual, 1, '/c', '/k', 443, true, 0);
    expect(enabled).toContain('return 301 https://$host$request_uri;');
    expect(enabled).toContain('return 308 https://$host$request_uri;');
    expect(parseNginx(enabled).servers[1].children!.some((d) => d.words[0] === 'if')).toBe(false);
    const disabled = configureTLS(enabled, 1, '/c', '/k', 443, false, 0);
    expect(disabled).toContain('return 301 https://$host$request_uri;');
    expect(disabled).not.toContain('return 308');
    const ambiguous = serverSummaries(
      manual + '\nserver { listen 8080; server_name app.internal; }',
    );
    expect(suggestedHttpSource(ambiguous, 1)).toBeUndefined();
    expect(
      suggestedHttpSource(
        serverSummaries(
          manual.replace(
            'listen 80; server_name app.internal',
            'listen 80; server_name other.internal',
          ),
        ),
        1,
      ),
    ).toBeUndefined();
  });
  it('redirects only HTTP before business rewrites, preserves requests and other sites, and toggles idempotently', () => {
    const enabled = configureTLS(config, 0, '/c', '/k', 8443, true);
    const site = parseNginx(enabled).servers[0];
    expect(site.children![0].words).toEqual(['if', '($scheme', '=', 'http)']);
    expect(site.children![0].children![0].words).toEqual([
      'return',
      '308',
      'https://$host:8443$request_uri',
    ]);
    expect(enabled).toContain('listen 8080;');
    expect(enabled).toContain('listen 8443 ssl;');
    expect(enabled).toContain('proxy_pass http://upstream');
    expect(serverSummaries(enabled)[0].redirectHttp).toBe(true);
    expect(configureTLS(enabled, 0, '/c', '/k', 8443, true)).toBe(enabled);
    const disabled = configureTLS(enabled, 0, '/c', '/k', 8443, false);
    expect(disabled).not.toContain('EluShell HTTPS redirect');
    expect(disabled).not.toContain('return 308');
    expect(disabled).toContain('listen 8080;');
    expect(disabled).toContain('listen 8443 ssl;');
    expect(disabled).toContain('proxy_pass http://upstream');
    expect(disabled).toContain(
      'server { listen 8443 ssl; server_name other.internal; ssl_certificate /old/other.crt; ssl_certificate_key /old/other.key; }',
    );
  });
  it('handles implicit HTTP, mixed IPv4/IPv6 listeners and default HTTPS port', () => {
    const implicit = configureTLS(
      'server { location / { return 200 ok; } }',
      0,
      '/c',
      '/k',
      443,
      true,
    );
    expect(implicit).toContain('listen 80;');
    expect(implicit).toContain('https://$host$request_uri;');
    expect(implicit).not.toContain('https://$host:443');
    const before =
      'server { listen 80 default_server; listen [::]:80; listen 443 ssl; listen [::]:443 ssl; location / { return 200 ok; } }';
    const after = configureTLS(before, 0, '/c', '/k', 443, true);
    expect(serverSummaries(after)[0].listens).toEqual(serverSummaries(before)[0].listens);
    expect(() => configureTLS('server {}', 0, '/c', '/k', 80, true)).toThrow('普通 HTTP');
    expect(() => configureTLS('server { listen 443 ssl; }', 0, '/c', '/k', 443, true)).toThrow(
      '没有 HTTP',
    );
  });
  it('does not overwrite manual or altered redirect rules, or turn a redirect entry into an HTTPS loop', () => {
    const manual = 'server { listen 80; return 308 https://app.internal$request_uri; }';
    expect(serverSummaries(manual)[0].redirectOnly).toBe(true);
    expect(() => configureTLS(manual, 0, '/c', '/k', 443, true)).toThrow('业务站点');
    const guarded =
      'server { listen 80; if ($scheme = http) { return 301 https://app.internal$request_uri; } location / { return 200 ok; } }';
    expect(configureTLS(guarded, 0, '/c', '/k', 443, false)).toContain(
      'return 301 https://app.internal$request_uri;',
    );
    const generated = configureTLS('server { listen 80; }', 0, '/c', '/k', 443, true);
    for (const edited of [
      generated.replace('= http', '= https'),
      generated.replace('return 308', 'return 301'),
      generated.replace('redirect end', 'redirect stop'),
    ]) {
      expect(() => configureTLS(edited, 0, '/c', '/k', 443, false)).toThrow('已被修改');
    }
    const crlf = generated.replaceAll('\n', '\r\n');
    expect(serverSummaries(crlf)[0].redirectHttp).toBe(true);
    expect(configureTLS(crlf, 0, '/c', '/k', 443, false)).not.toContain('return 308');
  });
  it('selects HTTP servers only and preserves comments, variables, nested locations and other sites', () => {
    expect(serverSummaries(config)).toEqual([
      { index: 0, names: ['service.internal'], listens: ['8080'] },
      { index: 1, names: ['other.internal'], listens: ['8443 ssl'] },
    ]);
    const result = configureTLS(config, 0, '/cert/my cert.crt', '/private/my key.key', 443);
    expect(parseNginx(result).servers).toHaveLength(2);
    expect(result).toContain('listen 443 ssl;');
    expect(result).toContain('listen 8080;');
    expect(result).toContain('ssl_certificate "/cert/my cert.crt";');
    expect(result).toContain(
      'server { listen 8443 ssl; server_name other.internal; ssl_certificate /old/other.crt; ssl_certificate_key /old/other.key; }',
    );
    expect(result).toContain('set $example "${request_uri}";');
    expect(result).toContain('add_header X-Test "brace } and # comments";');
  });
  it('replaces a selected existing TLS pair without duplicating or altering its listeners', () => {
    const result = configureTLS(config, 1, '/new.crt', '/new.key', 8443);
    expect(result).not.toContain('/old/other');
    expect(result.match(/ssl_certificate /g)).toHaveLength(1);
    expect(result).toContain('listen 8443 ssl;');
    expect(result).not.toContain('listen 443 ssl;');
    expect(() => configureTLS(config, 1, '/n', '/k', 443)).toThrow('现有 HTTPS');
    expect(() => configureTLS(config, 0, '/n', '/k', 8080)).toThrow('普通 HTTP');
  });
  it('keeps implicit HTTP listen and rejects malformed or multi-certificate configuration', () => {
    const result = configureTLS('server { server_name demo; }', 0, '/c', '/k', 443);
    expect(result).toContain('listen 80;');
    expect(() => parseNginx('server { server_name "demo; }')).toThrow('引号');
    expect(() => parseNginx('server {')).toThrow('未闭合');
    expect(() =>
      configureTLS('server { ssl_certificate /a; ssl_certificate /b; }', 0, '/c', '/k', 443),
    ).toThrow('多套证书');
  });
  it('writes correct SAN types for IPv4, IPv6 and DNS, rejecting configuration injection and invalid addresses', () => {
    const result = opensslConfig(['10.0.0.7', '2001:db8::7', 'App.Internal', '*.internal']);
    expect(result).toContain('IP.1 = 10.0.0.7');
    expect(result).toContain('IP.2 = 2001:db8::7');
    expect(result).toContain('DNS.3 = app.internal');
    expect(result).toContain('DNS.4 = *.internal');
    expect(result).toContain('extendedKeyUsage = serverAuth');
    for (const invalid of [
      'example.com\n[x]',
      '$(touch /x)',
      '10.0.0.999',
      'https://host',
      'host:443',
      'a..b',
      'a;b',
    ])
      expect(() => certificateNames([invalid])).toThrow();
    expect(certificateNames(['localhost', 'LOCALHOST'])).toEqual(['localhost']);
  });
});

it('binds inspection and preview to a session, consumes previews once, and reports remote failures', async () => {
  const emitted: CertificateJob[] = [];
  let fail = false;
  const client = {
    exec: (command: string, callback: Function) => {
      const stream = new EventEmitter() as any;
      stream.stderr = new EventEmitter();
      stream.close = () => {};
      callback(null, stream);
      queueMicrotask(() => {
        if (command.includes('readlink -f')) {
          stream.emit(
            'data',
            Buffer.from('/etc/nginx/nginx.conf\n' + Buffer.from(config).toString('base64')),
          );
          stream.emit('close', 0);
        } else {
          const bytes = Buffer.from(fail ? '配置校验失败' : '生成成功');
          stream.emit('data', bytes.subarray(0, 2));
          stream.emit('data', bytes.subarray(2));
          stream.emit('close', fail ? 1 : 0);
        }
      });
    },
  };
  const service = new CertificateService(
    () => client as any,
    (j) => emitted.push(j),
  );
  const source = await service.inspect('server1', {
    configPath: '/etc/nginx/nginx.conf',
    sudo: false,
  });
  const options = {
    inspectionId: source.id,
    serverIndex: 0,
    names: ['10.0.0.7'],
    days: 365,
    port: 443,
    applyNginx: true,
    mainConfigPath: '/etc/nginx/nginx.conf',
    nginxPath: 'nginx',
    certificateDirectory: '/certs',
    keyDirectory: '/private',
  };
  expect(() => service.prepare('server2', options)).toThrow('此服务器');
  expect(() =>
    CertificateOptionsSchema.parse({ ...options, certificateDirectory: 'relative/path' }),
  ).toThrow();
  const preview = service.prepare('server1', options);
  expect(preview.redirectHttp).toBe(false);
  const redirectPreview = service.prepare('server1', { ...options, redirectHttp: true });
  expect(redirectPreview.redirectHttp).toBe(true);
  expect(redirectPreview.after).toContain('return 308 https://$host$request_uri;');
  const separate = service.prepare('server1', {
    ...options,
    serverIndex: 1,
    port: 8443,
    redirectHttp: true,
    httpServerIndex: 0,
  });
  expect(separate.httpSource).toContain('service.internal');
  expect(parseNginx(separate.after).servers[1].children!.some((d) => d.words[0] === 'if')).toBe(
    false,
  );
  expect(() =>
    service.prepare('server1', { ...options, serverIndex: 1, port: 8443, redirectHttp: true }),
  ).toThrow('HTTP 入口');
  const onlyCert = service.prepare('server1', {
    ...options,
    applyNginx: false,
    redirectHttp: true,
  });
  expect(onlyCert.redirectHttp).toBe(false);
  expect(onlyCert.after).toBe(config);
  expect(preview.certificatePath).toMatch(/^\/certs\/elushell-.*\.crt$/);
  expect(preview.privateKeyPath).toMatch(/^\/private\/elushell-.*\.key$/);
  expect(preview.backupPath).toMatch(/^\/etc\/nginx\/\.nginx.conf/);
  await expect(service.start('server2', preview.id)).rejects.toThrow('预览已失效');
  await service.start('server1', preview.id);
  await expect.poll(() => service.isRunning()).toBe(false);
  expect(service.list('server1')[0].state).toBe('completed');
  expect(service.list('server1')[0].output).toBe('生成成功');
  await expect(service.start('server1', preview.id)).rejects.toThrow('预览已失效');
  fail = true;
  await service.start('server1', service.prepare('server1', options).id);
  await expect.poll(() => service.isRunning()).toBe(false);
  expect(service.list('server1')[0].state).toBe('failed');
  expect(service.list('server1')[0].error).toContain('配置校验失败');
  expect(service.list('server2')).toEqual([]);
  expect(() => service.prepare('server1', { ...options, inspectionId: randomUUID() })).toThrow(
    '过期',
  );
  expect(emitted.some((e) => e.state === 'running')).toBe(true);
});
