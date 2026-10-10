# macOS 分支

本分支为 EluShell macOS 桌面版，支持 Apple 芯片 arm64 和 Intel x64。Windows 版见同仓库的 `windows` 分支；两者共享 Electron / React / TypeScript 实现。这不是 iPhone/iPad 的 iOS 应用。

## 开发与构建

在 macOS 上安装 Node.js 和 npm 后执行：

```sh
npm ci
npm run dev
npm test
npm run dist:mac
```

输出位于 `release/`。现有测试版使用 ad-hoc 签名，未完成 Apple Developer ID 签名、公证及 Mac 真机验收。详细安装和构建说明见 [docs/MACOS.md](docs/MACOS.md)。安装包、个人设置、服务器密码和本机测试数据不提交到 Git。

## 许可

PolyForm Noncommercial 1.0.0，非商业用途免费；商业使用需另行取得书面授权。详见 LICENSE 和 NOTICE。
