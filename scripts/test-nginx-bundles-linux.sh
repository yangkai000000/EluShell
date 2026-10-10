#!/bin/bash
# Run in the isolated build directory; loopback-only TLS smoke tests.
set -euo pipefail
cd "$(dirname "$0")"
root=$PWD
test "$(id -u)" != 0
fixture=$(mktemp -d "$root/tls-check.XXXXXXXX")
server=''
cleanup() { if test -n "$server"; then kill -QUIT "$server" 2>/dev/null || :; wait "$server" 2>/dev/null || :; fi; }
trap cleanup EXIT
cat > "$fixture/openssl.cnf" <<'CONFIG'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = localhost
[ext]
subjectAltName = IP:127.0.0.1,DNS:localhost
CONFIG
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -config "$fixture/openssl.cnf" -keyout "$fixture/test.key" -out "$fixture/test.crt" 2> "$fixture/certificate.log"
for arch in x86_64 aarch64; do
  mkdir -p "$fixture/$arch/logs"
  port=19884
  command=("$root/bundle/nginx")
  if test "$arch" = aarch64; then
    port=19885
    command=("$root/qemu-aarch64-static" -L "$root/aarch64--glibc--bleeding-edge-2018.11-1/aarch64-buildroot-linux-gnu/sysroot" "$root/arm64/bundle/nginx")
  fi
  cat > "$fixture/$arch/nginx.conf" <<CONFIG
daemon off;
master_process off;
pid $fixture/$arch/nginx.pid;
error_log $fixture/$arch/error.log notice;
events { worker_connections 128; }
http {
  access_log off;
  server {
    listen 127.0.0.1:$port ssl;
    http2 on;
    ssl_certificate $fixture/test.crt;
    ssl_certificate_key $fixture/test.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    location / { return 200 "nginx/\$nginx_version\n"; }
  }
}
CONFIG
  "${command[@]}" -t -p "$fixture/$arch/" -c "$fixture/$arch/nginx.conf"
  "${command[@]}" -p "$fixture/$arch/" -c "$fixture/$arch/nginx.conf" > "$fixture/$arch/process.log" 2>&1 &
  server=$!
  for i in $(seq 1 20); do
    if curl --noproxy '*' --cacert "$fixture/test.crt" -fsS "https://127.0.0.1:$port/" > "$fixture/$arch/response" 2>/dev/null; then break; fi
    sleep 1
  done
  test "$(cat "$fixture/$arch/response")" = 'nginx/1.30.5'
  curl --noproxy '*' --tlsv1.2 --tls-max 1.2 --cacert "$fixture/test.crt" -fsS "https://127.0.0.1:$port/" >/dev/null
  curl --noproxy '*' --tlsv1.3 --cacert "$fixture/test.crt" -fsS "https://127.0.0.1:$port/" >/dev/null
  echo "PASS $arch: configuration, verified certificate, TLS 1.2 and TLS 1.3"
  kill -QUIT "$server"
  wait "$server"
  server=''
done
echo "Evidence: $fixture"
