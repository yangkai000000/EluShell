#!/bin/bash
# Cross build on Linux x86_64; QEMU runs configure probes against the ARM64 sysroot.
set -euo pipefail
cd "$(dirname "$0")"
test "$(id -u)" != 0
root=$PWD
sha256sum -c <<'CHECKSUMS'
6c20565aa2325cb82216ae804f4a4ff1875179014759a381c42ddc8e11c4906d  nginx-1.30.5.tar.gz
a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2  openssl-3.5.8.tar.gz
ebcc25aadf2a51fa1fefa9b8bc9e7a79b3dae86870a0f1152a22e42befd46888  pcre2-10.48.tar.gz
bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16  zlib-1.3.2.tar.gz
f79b82cb6c7d61fa1f75a44f9bb748a792279e7a14700377d5d7d468c281835f  arm-toolchain.tar.bz2
dce64b2dc6b005485c7aa735a7ea39cb0006bf7e5badc28b324b2cd0c73d883f  qemu-aarch64-static
CHECKSUMS
test -d aarch64--glibc--bleeding-edge-2018.11-1 || tar xjf arm-toolchain.tar.bz2
toolchain="$root/aarch64--glibc--bleeding-edge-2018.11-1"
if test -x "$toolchain/relocate-sdk.sh"; then (cd "$toolchain" && ./relocate-sdk.sh); fi
export PERL5LIB="$root/perl-rpm/usr/lib64/perl5:$root/perl-rpm/usr/share/perl5:$root/ExtUtils-MakeMaker-7.78/lib:$root/perl5${PERL5LIB:+:$PERL5LIB}"
export PATH="$toolchain/bin:$PATH"
cross=aarch64-buildroot-linux-gnu
export CC="$cross-gcc" AR="$cross-ar" RANLIB="$cross-ranlib"
chmod 700 qemu-aarch64-static
export NGX_RUN="$root/qemu-aarch64-static -L $toolchain/$cross/sysroot"
mkdir -p arm64
cd arm64
for archive in nginx-1.30.5 openssl-3.5.8 pcre2-10.48 zlib-1.3.2; do
  test -d "$archive" || tar xzf "../$archive.tar.gz"
done
cd nginx-1.30.5
# Only configure-time probes are adapted. No Nginx runtime code is modified.
perl -pi -e 's@/bin/sh -c \$NGX_AUTOTEST@\$NGX_RUN \$NGX_AUTOTEST@g; s@`\$NGX_AUTOTEST`@`\$NGX_RUN \$NGX_AUTOTEST`@g' auto/feature auto/types/sizeof auto/endianness
perl -pi -e 's@\./config --prefix=@./Configure linux-aarch64 --prefix=@g' auto/lib/openssl/make
perl -pi -e 's@\./configure --disable-shared@./configure --host=aarch64-linux-gnu --disable-shared@g' auto/lib/pcre/make
./configure --crossbuild=Linux::aarch64 --with-cc="$CC" --with-cc-opt='-march=armv8-a -mtune=generic' --prefix=/usr/local/nginx --with-http_ssl_module --with-http_v2_module --with-http_realip_module --with-http_stub_status_module --with-http_gzip_static_module --with-stream --with-stream_ssl_module --with-stream_ssl_preread_module --with-threads --with-file-aio --with-pcre=../pcre2-10.48 --with-pcre-jit --with-zlib=../zlib-1.3.2 --with-openssl=../openssl-3.5.8 --with-openssl-opt='no-shared no-tests' > ../configure.log 2>&1
nice -n 10 make -j2 > ../build.log 2>&1
"$cross-strip" objs/nginx
mkdir -p ../bundle
cp objs/nginx ../bundle/nginx
$NGX_RUN ../bundle/nginx -V
"$cross-readelf" --version-info ../bundle/nginx | grep GLIBC | sort -u
sha256sum ../bundle/nginx
