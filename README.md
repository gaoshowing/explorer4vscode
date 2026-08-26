# 自定义资源管理器

一个以 VS Code Webview View 实现的资源管理器扩展。它展示当前工作区的文件和文件夹，并支持：

- 展开、折叠并按“文件夹优先”排序资源
- 打开文件
- 新建文件和文件夹
- 重命名、移至回收站删除与刷新
- 通过 `customResourceExplorer.showHiddenFiles` 控制是否显示隐藏文件
- 通过 `customResourceExplorer.fontWeight` 设置文件树字体粗细（`400`、`500`、`600` 或 `bold`）
- 将 Java JDT LS 的 Source Path，以及包含 `mod.rs`、`lib.rs`、`main.rs` 或同名 `.rs` 文件的 Rust 模块目录以粗体标识；其余 Rust 源目录使用 `cargo metadata` 判断

界面由 React 构建并打包为 Webview 资源；扩展宿主仍通过 VS Code 文件系统 API 读取和操作资源。

Rust 目录识别优先使用文件系统检查 Rust 模块约定，其余目录会调用 `cargo metadata`；后者仅在受信任工作区执行。

## 本地运行

```bash
npm install
npm run compile
```

在 VS Code 中打开本目录，按 `F5` 启动“扩展开发宿主”；在资源管理器侧栏中即可找到“资源管理器”视图。
