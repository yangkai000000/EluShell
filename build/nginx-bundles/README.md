# Embedded Nginx packages

Nginx 1.30.5, OpenSSL 3.5.8, PCRE2 10.48 and zlib 1.3.2.
OpenSSL, PCRE2 and zlib are linked into each binary. The target Linux server
provides glibc (2.28 or newer), libcrypt.so.1 and the standard dynamic loader.
The candidate is executed and configuration-tested before replacing any program.

- `x86_64/nginx`: GCC 8.5, Linux x86_64, glibc 2.28 build environment.
- `aarch64/nginx`: GCC 8.2, ARMv8-A generic, Bootlin Buildroot glibc toolchain.
- `manifest.json`: package sizes, SHA-256 digests and inherited default paths.
- `sources.json`: source archive provenance and verified digests.
- `licenses/`: redistribution notices for Nginx and linked dependencies.

ARM toolchain:
https://toolchains.bootlin.com/downloads/releases/toolchains/aarch64/tarballs/aarch64--glibc--bleeding-edge-2018.11-1.tar.bz2
SHA-256: f79b82cb6c7d61fa1f75a44f9bb748a792279e7a14700377d5d7d468c281835f

QEMU is used only for build probes and tests; it is not distributed in EluShell:
https://github.com/multiarch/qemu-user-static/releases/download/v7.2.0-1/qemu-aarch64-static
SHA-256: dce64b2dc6b005485c7aa735a7ea39cb0006bf7e5badc28b324b2cd0c73d883f

Rebuild using `scripts/build-nginx-bundle.sh` and
`scripts/build-nginx-arm64.sh` in an unprivileged isolated Linux directory.
Dependencies: GCC/make, Perl with standard development modules (including
IPC::Cmd, ExtUtils::MakeMaker and Time::Piece), tar and binutils. There is no
installation into the running Nginx directory. Run
`scripts/test-nginx-bundles-linux.sh` in the build directory to verify both
packages with certificate verification and TLS 1.2 / 1.3.

ARM64 TLS testing uses QEMU with the toolchain sysroot. This is not a Kylin
physical-hardware or vendor-certification claim. Kylin security-policy behavior
must be checked on the deployment machine; EluShell never disables those policies.
