# 目标架构资料

本目录保存用户提供、供后续重构参考的最新版架构资料。当前基线为
2026-09-06 版 [Yui 架构与实施手册](yui-handbook-full-architecture/README.md)。
它描述目标架构，不表示当前源码已经实现这些契约；现有实现文档暂不替换。

## 阅读入口

- [总体架构](yui-handbook-full-architecture/architecture/01-overview.md)
- [完整架构分层图](yui-handbook-full-architecture/full-architecture.html)
- [离线完整阅读版](yui-handbook-full-architecture/index.html)
- [实施路线与任务](yui-handbook-full-architecture/implementation/README.md)

## 来源与保存边界

- 来源附件：`yui-handbook-full-architecture.zip`。
- 手册标注日期：2026-09-06。
- 原始压缩包 SHA-256：`7df7ea4d2adbbe0df67e95bda89760506b1472e53876efd1c82b0ecadf62ba84`。
- 原样导入位于 Git 提交 `bfdb32e7f705923886057f0907baedbadb8c7154`：
  附件 56 个文件（含原始 `MANIFEST.json`）在该提交中可恢复，导入时未修改内容。
- 自 T00/task-10 起本目录作为派生设计继续维护：2026-09-06 对齐用户要求的
  archived 生命周期，补充当前源码职责、接口采用与隔离证据。当前文件不再声称
  与附件逐字一致；原始压缩包摘要仅标识来源，不标识派生内容。
- 当前清单描述派生包，阅读版由同目录工具生成。T00 不实施运行时重构，
  不修改正在使用的 Home；具体执行权限来自 Task，不来自附件中的命令例子。
- 本目录是仓库中的设计资料，不替代 `YUI_HOME` 中由 Yui 维护的 Project Knowledge。
