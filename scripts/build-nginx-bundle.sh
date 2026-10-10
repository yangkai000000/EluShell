#!/bin/sh
# Run only in an unprivileged build directory; never install into a running Nginx directory.
set -eu
cd "$(dirname "$0")"
export PERL5LIB="$PWD/perl-rpm/usr/lib64/perl5:$PWD/perl-rpm/usr/share/perl5:$PWD/ExtUtils-MakeMaker-7.78/lib:$PWD/perl5${PERL5LIB:+:$PERL5LIB}"
test "$(id -u)" != 0 || { echo 'Build as an unprivileged user'; exit 1; }
sha256sum -c <<'CHECKSUMS'
6c20565aa2325cb82216ae804f4a4ff1875179014759a381c42ddc8e11c4906d  nginx-1.30.5.tar.gz
a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2  openssl-3.5.8.tar.gz
ebcc25aadf2a51fa1fefa9b8bc9e7a79b3dae86870a0f1152a22e42befd46888  pcre2-10.48.tar.gz
bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16  zlib-1.3.2.tar.gz
CHECKSUMS
for archive in nginx-1.30.5 openssl-3.5.8 pcre2-10.48 zlib-1.3.2; do
  test -d "$archive" || tar xzf "$archive.tar.gz"
done
cd nginx-1.30.5
./configure --prefix=/usr/local/nginx --with-http_ssl_module --with-http_v2_module --with-http_realip_module --with-http_stub_status_module --with-http_gzip_static_module --with-stream --with-stream_ssl_module --with-stream_ssl_preread_module --with-threads --with-file-aio --with-pcre=../pcre2-10.48 --with-pcre-jit --with-zlib=../zlib-1.3.2 --with-openssl=../openssl-3.5.8 --with-openssl-opt='no-shared no-tests' > ../configure.log 2>&1
nice -n 10 make -j2 > ../build.log 2>&1
strip objs/nginx
mkdir -p ../bundle/licenses
cp objs/nginx ../bundle/nginx
cp LICENSE ../bundle/licenses/NGINX.txt
cp ../openssl-3.5.8/LICENSE.txt ../bundle/licenses/OPENSSL.txt
cp ../pcre2-10.48/LICENCE.md ../bundle/licenses/PCRE2.md
cp ../pcre2-10.48/deps/sljit/LICENSE ../bundle/licenses/SLJIT.txt
cp ../zlib-1.3.2/LICENSE ../bundle/licenses/ZLIB.txt
../bundle/nginx -V
ldd ../bundle/nginx
sha256sum ../bundle/nginx
