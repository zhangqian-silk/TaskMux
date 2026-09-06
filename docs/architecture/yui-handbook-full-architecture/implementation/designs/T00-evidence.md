# T00 验证记录

对象：task-10；源码基线 `bfdb32e7f705923886057f0907baedbadb8c7154`。
本记录随本交付提交保存，交付精确 SHA 另写入 Task 完成记录，避免文档自引用哈希。
执行日期：2026-09-06（PRC）。没有运行 Provider 模型、真实账号验证、
远端 push/merge、发布、共享 Home 升级或 archive。

## 已执行

| 检查 | 实际结果 | 能说明什么 |
|---|---|---|
| `make install-local` | 成功；npm ci、TypeScript build、本 checkout launcher | 未替换全局 yui；未启动共享 Controller |
| `npm test` | 82/82 通过；测试阶段 4352.49 ms，build 另计 | 现有完整本地测试通过；并非项目规范描述的“四项、两秒内”测试规模，T00 未修改默认测试 |
| `node docs/architecture/yui-handbook-full-architecture/tools/capture_baseline.mjs` | 隔离基线通过；最终入口重复执行验证关系一致 | 下表六组可观察关系；临时 Home/fixture 均删除 |
| 手册 HTML 构建、文档/类型/清单检查 | 见同提交 `tools/verification.json` 的结构检查结果 | 派生阅读版同步；不证明真实运行或目标场景通过 |
| 完整变更直接审查 | Leader 对最终文档、契约、构造器和源码定位冷读核对 | 未请求独立 Reviewer；本任务不改产品运行逻辑，直接审查与隔离证据足够 |

文档工具依赖原环境不具备 Pandoc / Beautiful Soup，已仅在本 checkout
`output/t00-tools` 安装构建依赖；未改全局 Python、产品依赖或构建脚本语义。
可用已配置的 Pandoc、Python、tsc 执行：

```sh
python docs/architecture/yui-handbook-full-architecture/tools/build_html.py
python docs/architecture/yui-handbook-full-architecture/tools/check_docs.py --write-manifest --typecheck --write-result
git diff --check
```

## 按需隔离基线的六组证据

1. Context handler 读取前后 Message 与 Leader mailbox 内容相同，没有隐式 ack。
2. 同步 Store 与 persistence worker 读取同一 Turn；worker 写 Brief 后同步
   Store 读到该唯一记录，不存在影子 Task Store。
3. 本地绝对 launcher 对同一临时 Home 执行 config show、operator status、
   Draft/Active task show、Leader role show、精确 turn show，均返回 ok。
4. Codex/Claude Driver 从 fixture 提取原生 Session 字段并映射 Stop 终态；
   只证明源码映射，未执行真实 Agent。
5. NodeGitWorkspace 在新建临时仓库 prepare worktree，核对固定 base commit、
   clean，再移除自身创建的工作区。没有向真实远端写入。
6. 当前 version 1 的 dry-run/execute 升级返回 already-current；SQLite backup
   在另一个 Home 打开后仍含 Draft/Active、成功结果、失败 Turn、消息、未答
   InputRequest、queued Job。不是新 schema 迁移／数据库降级／外部效果撤销证据。

fixture 明确边界：setup 的 tmux 探测是假实现；Agent 仅供路径发现；
Active 经 domain 构造而非 CLI 激活；Turn 结果来自构造器而非采集器。
未决 Job 保存但从未执行。现场生成的 fixture 不作为生产数据库保存，
也不加入永久 core 回归；按需入口服务于本任务明确要求的可重复基线。

## S39 / S44 的接受判断

S39（T00 份额）：当前 handler、同步/worker Store 共用事实的链路和
单 Controller 设计定位已明确，隔离 fixture 没有创建第二 Controller。
目标实现替换、通用 Host drain 和 unknown 时不 fallback 的全链路行为
仍属 T01/T02/T04 的验收，不能把本报告升级为整个 S39 已通过。

S44（T00 份额）：当前最低/最高均为 1，支持线自 0.15.0 起；源码升级、
备份及严格校验入口已追踪，隔离备份恢复验证通过。当前没有有效 1→2 链，
因此不伪造“真实历史迁移成功”。T01 引入新存储时必须补齐连续迁移和实际失败恢复证据。
旧 binary 可读性、Provider/文件系统副作用回滚不在本结果内。

归档设计已在架构、Task 模块、类型、示例、能力目录及 S43
Markdown/JSON 一致定义；场景索引仍为 planned。当前 retired 的历史与隔离
保护、archived 不可重开、完成/取消不自动授权归档均在交接中明确。

## 后继采用与剩余范围

[实施基线](T00-current-baseline.md) 是 T01/task-11 的首要读取入口；
T02/task-12 在采用 T01 后继续。Operator 必须核实精确本地交付提交、
Task completed 及后继可用基线，不能把完成当作 master 已合并。
未授权 push/merge/release/archive，本任务不执行这些操作。

task-9 私有工作区未读，其最终增量未验证；T04 通过 Operator 获得并采用。
真实 Provider/native UI、完整 Draft Leader 对话、通用 Capability/Endpoint、
新 schema 升级与目标 cancelled 运行时均未实施，也不是 T00 完成阻碍。
