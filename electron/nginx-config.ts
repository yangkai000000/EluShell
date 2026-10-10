import { isIP } from 'node:net';
import type { CertificateServer } from '../src/certificate-shared';

type Token = { text: string; start: number; end: number; punctuation: boolean };
type Directive = {
  words: string[];
  start: number;
  end: number;
  open?: number;
  children?: Directive[];
};

// Tokenize before looking for server blocks: comments, quoted braces, regexes and
// ${variables} must never be mistaken for structural delimiters.
function tokens(text: string) {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (text[i] === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    const start = i;
    if ('{};'.includes(text[i])) {
      out.push({ text: text[i++], start, end: i, punctuation: true });
      continue;
    }
    let value = '',
      quote = '';
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        if (i + 1 >= text.length) throw Error('Nginx 配置末尾存在不完整的转义');
        value += text[i + 1];
        i += 2;
        continue;
      }
      if (quote) {
        i++;
        if (c === quote) quote = '';
        else value += c;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        i++;
        continue;
      }
      if (c === '$' && text[i + 1] === '{') {
        const end = text.indexOf('}', i + 2);
        if (end < 0) throw Error('Nginx 变量未闭合');
        value += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (/\s/.test(c) || '{};#'.includes(c)) break;
      value += c;
      i++;
    }
    if (quote) throw Error('Nginx 配置中的引号未闭合');
    out.push({ text: value, start, end: i, punctuation: false });
  }
  return out;
}
export function parseNginx(text: string) {
  const ts = tokens(text);
  let i = 0;
  function parse(nested = false): Directive[] {
    const result: Directive[] = [];
    while (i < ts.length) {
      if (ts[i].punctuation && ts[i].text === '}') {
        if (!nested) throw Error('Nginx 配置存在多余的右括号');
        i++;
        return result;
      }
      const start = ts[i].start,
        words: string[] = [];
      while (i < ts.length && !ts[i].punctuation) words.push(ts[i++].text);
      const end = ts[i++];
      if (!words.length || !end || ![';', '{'].includes(end.text))
        throw Error('无法解析 Nginx 指令');
      if (end.text === ';') result.push({ words, start, end: end.end });
      else {
        const children = parse(true);
        result.push({ words, start, open: end.start, end: ts[i - 1].end, children });
      }
    }
    if (nested) throw Error('Nginx 配置中的代码块未闭合');
    return result;
  }
  const tree = parse();
  const servers = tree.flatMap((n) =>
    n.words[0] === 'http'
      ? (n.children || []).filter((c) => c.words[0] === 'server' && c.children)
      : n.words[0] === 'server' && n.children
        ? [n]
        : [],
  );
  return { tree, servers };
}
export function certificateNames(values: string[]) {
  const names = [...new Set(values.map((n) => n.trim().toLowerCase()))];
  if (!names.length || names.length > 30) throw Error('请填写 1–30 个 IP 或域名');
  for (const name of names) {
    if (isIP(name)) continue;
    const host = name.startsWith('*.') ? name.slice(2) : name;
    if (
      name.length > 253 ||
      !host ||
      !host.split('.').every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) ||
      /^[\d.]+$/.test(host)
    )
      throw Error('无效的 IP 或域名：' + name + '（请勿填写协议、端口或路径）');
  }
  return names;
}
export function serverSummaries(content: string): CertificateServer[] {
  return parseNginx(content).servers.map((s, index) => ({
    index,
    names: s.children!.filter((d) => d.words[0] === 'server_name').flatMap((d) => d.words.slice(1)),
    listens: s
      .children!.filter((d) => d.words[0] === 'listen')
      .map((d) => d.words.slice(1).join(' ')),
    ...(managedRedirect(content, s) ? { redirectHttp: true } : {}),
    ...(redirectOnly(s) ? { redirectOnly: true } : {}),
    ...(manualRedirect(s) ? { manualRedirect: manualRedirect(s) } : {}),
  }));
}
const redirectBegin = '# EluShell HTTPS redirect begin';
const redirectEnd = '# EluShell HTTPS redirect end';
function redirectOnly(server: Directive) {
  return server.children!.some(
    (d) => d.words[0] === 'return' && /^(301|302|303|307|308)$/.test(d.words[1]),
  );
}
function manualRedirect(server: Directive) {
  const action = server.children!.find(
    (d) => d.words[0] === 'return' && /^(301|302|303|307|308)$/.test(d.words[1]),
  );
  return action ? { status: Number(action.words[1]), target: action.words[2] || '' } : undefined;
}
// Only remove or replace our own intact, server-level rule. User-authored
// redirects and includes remain untouched; edited markers require review.
function managedRedirect(content: string, server: Directive) {
  const body = content.slice(server.open! + 1, server.end - 1);
  const markers = [...body.matchAll(/^[ \t]*# EluShell HTTPS redirect (begin|end)[ \t]*\r?$/gm)];
  if (!markers.length) return null;
  const invalid = () => Error('此站点的 EluShell 跳转规则已被修改，请先手动核对配置');
  if (markers.length !== 2 || markers[0][1] !== 'begin' || markers[1][1] !== 'end') throw invalid();
  const start = server.open! + 1 + markers[0].index!;
  const end = server.open! + 1 + markers[1].index! + markers[1][0].length;
  const nodes = server.children!.filter((d) => d.start >= start && d.end <= end);
  const condition = nodes[0];
  const action = condition?.children?.[0];
  if (
    nodes.length !== 1 ||
    condition.words.join(' ') !== 'if ($scheme = http)' ||
    condition.children?.length !== 1 ||
    action?.words.length !== 3 ||
    action.words[0] !== 'return' ||
    action.words[1] !== '308' ||
    !/^https:\/\/\$host(?::\d+)?\$request_uri$/.test(action.words[2])
  )
    throw invalid();
  return { start, end };
}
const nginxString = (s: string) => '"' + s.replace(/[\\"$]/g, '\\$&') + '"';
export function configureTLS(
  content: string,
  index: number,
  cert: string,
  key: string,
  port: number,
  redirectHttp = false,
  httpServerIndex?: number,
) {
  const servers = parseNginx(content).servers;
  const server = servers[index];
  if (!server) throw Error('找不到选择的 HTTP server 配置块');
  if (redirectOnly(server))
    throw Error('此站点仅返回重定向，请选择实际提供页面和接口的 HTTPS 业务站点');
  const children = server.children!;
  const replacements: { start: number; end: number; text: string }[] = [];
  const additions: string[] = [];
  for (const [directive, value] of [
    ['ssl_certificate', cert],
    ['ssl_certificate_key', key],
  ]) {
    const existing = children.filter((d) => d.words[0] === directive);
    if (existing.length > 1) throw Error('此站点配置了多套证书，请先手动整理证书配置');
    const text = `${directive} ${nginxString(value)};`;
    if (existing[0]) replacements.push({ start: existing[0].start, end: existing[0].end, text });
    else additions.push(text);
  }
  const listens = children.filter((d) => d.words[0] === 'listen');
  const ssl = listens.filter((d) => d.words.includes('ssl'));
  const hasHttp = !listens.length || listens.some((d) => !d.words.includes('ssl'));
  const httpIndex = httpServerIndex ?? (hasHttp ? index : undefined);
  const httpServer = httpIndex === undefined ? undefined : servers[httpIndex];
  if (httpIndex !== undefined && !httpServer) throw Error('找不到选择的 HTTP 入口，请重新读取配置');
  if (hasHttp && httpIndex !== index)
    throw Error('当前业务站点已有 HTTP 监听，请使用当前站点作为 HTTP 入口');
  if (
    httpServer &&
    ((!hasHttp && httpIndex === index) ||
      (httpIndex !== index &&
        httpServer.children!.some((d) => d.words[0] === 'listen' && d.words.includes('ssl'))))
  )
    throw Error('请选择只监听 HTTP 的入口，不能修改其他 HTTPS 业务站点');
  if (redirectHttp && !httpServer)
    throw Error('此站点没有 HTTP 监听，请在下方选择对应的 HTTP 入口');
  const managed = httpServer ? managedRedirect(content, httpServer) : null;
  if (!ssl.length) {
    const samePort =
      (!listens.length && port === 80) ||
      listens.some((d) => d.words[1] === String(port) || d.words[1]?.endsWith(':' + port));
    if (samePort) throw Error(`端口 ${port} 已用作普通 HTTP，请选择另一 HTTPS 端口`);
    // An implicit HTTP listener would otherwise disappear when adding the first listen.
    if (!listens.length) additions.push('listen 80;');
    additions.push(`listen ${port} ssl;`);
  } else if (!ssl.some((d) => d.words[1] === String(port) || d.words[1]?.endsWith(':' + port))) {
    throw Error('此站点已配置 HTTPS，请填写现有 HTTPS 监听端口');
  }
  const lineStart = content.lastIndexOf('\n', server.end - 2) + 1;
  const closeIndent = /^\s*$/.test(content.slice(lineStart, server.end - 1))
    ? content.slice(lineStart, server.end - 1)
    : '';
  const indent = closeIndent + '    ';
  if (managed) replacements.push({ ...managed, text: '' });
  if (redirectHttp) {
    const rule = `${redirectBegin}\n${indent}if ($scheme = http) {\n${indent}    return 308 https://$host${port === 443 ? '' : ':' + port}$request_uri;\n${indent}}\n${indent}${redirectEnd}`;
    if (managed) replacements[replacements.length - 1].text = indent + rule;
    else
      replacements.push({
        start: httpServer!.open! + 1,
        end: httpServer!.open! + 1,
        text: '\n' + indent + rule + '\n',
      });
  }
  if (additions.length)
    replacements.push({
      start: server.end - 1,
      end: server.end - 1,
      text: '\n' + additions.map((s) => indent + s).join('\n') + '\n' + closeIndent,
    });
  let result = content;
  for (const edit of replacements.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
export function opensslConfig(names: string[]) {
  const safeNames = certificateNames(names);
  return (
    `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = server_cert\n[dn]\nCN = ${safeNames[0].slice(0, 64)}\n[server_cert]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @names\n[names]\n` +
    safeNames.map((n, i) => `${isIP(n) ? 'IP' : 'DNS'}.${i + 1} = ${n}`).join('\n') +
    '\n'
  );
}
