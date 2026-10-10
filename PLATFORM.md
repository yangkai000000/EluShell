# Windows 分支

本分支为 EluShell Windows x64 桌面版。macOS 版本见同仓库的 `macos` 分支；两者共享 Electron / React / TypeScript 实现。

## 开发与构建

安装 Node.js 和 npm 后执行：

```sh
npm ci
npm run dev
npm test
npm run dist
```

`npm run dist` 构建 Windows NSIS 安装版和便携版，输出到 `release/`。安装包、个人设置、服务器密码和本机测试数据不提交到 Git。

## 许可

PolyForm Noncommercial 1.0.0，非商业用途免费；商业使用需另行取得书面授权。详见 LICENSE 和 NOTICE。
