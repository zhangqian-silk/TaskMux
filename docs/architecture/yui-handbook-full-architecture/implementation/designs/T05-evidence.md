# T05 资源、环境与固定成果交接

Task：task-17；基线：`b7d07394f68ac48a56bc8d03b6d91bf23be98051`。
日期：2026-09-07。精确交付提交、独立 Review 和接受状态以 Task 持久记录为准；
本报告不表示远端合并、共享环境升级或最终验收。

## 1. 实际交付与唯一所有者

新增能力复用 T02 的认证入口、CapabilityRegistry 和同一 Host，不启动第二个
Controller，也不把 Project 可见性转换成资源授权。

- `src/resources/projectResource.ts` 定义 Artifact、固定引用、本地目录身份和
  EnvironmentPreparation；`projectResourceService.ts` 是对应的可信 typed owner。
- `TaskStore` / `SqliteTaskStore` 在原 `yui.db` 保存新增记录。
  Artifact 按 Task 分区，只可新增或原样重入，不能覆盖；保存内容时计算 SHA-256。
  历史读取不 acquire 原 Provider 或原 Runtime。
- Project Knowledge 仍在原 Project 记录里。新增 `resourceRefs` 和
  `defaultCapabilityProviders`，只保存资源与 Provider 标识，不保存 credential 值。
  `project.context` 返回背景与默认配置，不代替 T03 的配置解析或执行选择。
- Git ManagedWorkspace、ChangeSet、checks、Integration 保留原存储和语义所有者。
  `resource.workspaces` 读取原工作区，`resource.git.result` 从原 ChangeSet 投影固定
  commit 与验证来源，不复制 Git 账本。捕获、目标推进和清理仍通过原 typed/CLI 入口。

新增三个表各保护一个当前合同：不可变结果、具体目录身份、显式准备/采用归属。
目录别名规范化使用 realpath 与设备/inode 身份，唯一索引拒绝同一对象的重复身份。
没有 Resource 万能 CRUD、租约、自动修复、自动重试或资源编排引擎。

## 2. 调用与采用合同

所有新增公开能力版本为 `1`，属于现有 `yui:builtin-capabilities@1`。

| 能力 | 权限与效果 |
|---|---|
| `artifact.save` | 当前已认证 Task 调用者保存本 Task 的内容/版本证据/回执/参考资料；local-mutation |
| `artifact.read` / `artifact.list` | 本 Task 历史查询；list 不重放全部正文 |
| `environment.prepare` / `adopt` / `release` | Leader 或 global Operator；local-mutation |
| `environment.list` | 本 Task 准备与归属事实查询 |
| `resource.local.register` | global Operator 注册用户拥有的目录；不因此授予使用权 |
| `resource.local.read` | 本 Task 的明确 Resource read grant |
| `project.context` | 读取当前绑定 Project 背景，不附带 Resource grant |
| `project.resources.configure` | global Operator 更新现有 Project 的引用配置 |
| `resource.git.result` | 读取本 Task 原 ChangeSet 的固定版本投影 |

这些本地修改的 requestId 沿 T02 合同必填，但不是新建的幂等账本；
一次有意重做的 Artifact 保存会生成新 id。不得将通信失败解释为“肯定未保存”。
查询先看原记录，再由 Agent 决定后续动作。

### 环境

`prepare(taskId, plan)` 的 plan 为 `empty`、`scratch` 或
`local + resourceId + access`。返回 preparation 的 `id`、`resourceRefs`、
可选 `environmentRef` 和 `disposition: prepared`。空计划不创建目录，
没有 environmentRef；scratch 是该 preparation 新建的独立目录。

`adopt(taskId, preparationId)` 在同一 Store 事务内重读 Task 相关 Project/resource/
Provider 配置、当前 grant、真实目录身份和已有采用事实。采用后 disposition
为 adopted；后续启动失败或取消请求不会撤销它。
本地写 grant 必须明确 `resourceId` 参数范围，不能只声明 Project scope。
沿原 CapabilityGrant 检查撤销、到期、次数和参数限制，成功采用时消费一次；
同一已采用引用重读不重复消费，但撤权仍拒绝继续采用。

本地读写环境均明确标为 `trusted-local`：access 是已授予的动作范围，
不是 OS 只读挂载、网络隔离或秘密隔离。scratch 只隔离目录所有权。
T04 的实际执行安全性仍由其已验证的承载环境负责；T05 不自动放宽权限。

同一路径或嵌套目录存在冲突 adopted 引用时拒绝新的冲突采用，Agent 可以选择
另一 scratch 继续无关工作。通用本地写不能覆盖 Home、Project 稳定目录或
已有 managed workspace 的所有权；这些位置必须走原 Git/工作区入口。

`release` 只移除 preparation 自己拥有且身份未变化的空目录。
非空目录返回诊断并保留，Agent 先保存成果再处置文件；永不删除用户目录。
已采用的实际目录还要求调用者提交实际 quiescence 证据，并检查本 Task
可见的 active Turn / queued、running、unknown Job 引用。
证据随 released 记录保存；它是 Agent 的明确声明，不是 Core 凭取消推导的
进程静止证明。未知外部子进程必须由负责人确认，不能假称这里已枚举所有进程。
文件操作后数据库提交失败会保留可诊断的不一致，不自动重建或再次破坏性清理。

### Artifact 与历史读取

`content` 保存最多 8 MiB UTF-8 正文及摘要；
`external-version` 保存 resourceId、明确版本和生产者提供的验证证据；
它不是 Core 自动访问外部系统的验证结果。
`receipt` 必须引用本 Task 原 Job 已记录的 receiptRef，且只能复制该 Job
artifact 目录内的文件；副本连同摘要留在 Home。
普通可变 URL 使用 `reference + observedAt`，不能通过 `resultRefs` 变成固定结果。
输入与正文必须是可持久化的非秘密内容；没有隐式收集运行时环境或凭据的步骤。

T03 可调用 `resultRefs(taskId, artifactIds)` 得到带 Task、artifactId、kind 和
可用摘要的固定引用，缺失、跨 Task、普通 Reference 都被拒绝。
Candidate/Acceptance 的唯一所有者仍是 T03；T05 不另建验收、Review verdict
或 Task result 账本。无 Git direct Task 可用原完成入口保存完成说明及固定引用。

本地用户或 Operator 不需要原 Runtime 就能调用：

```text
yui task artifact save <task> <artifact-json>
yui task artifact list <task>
yui task artifact show <task> <artifact-id>
```

开发验证必须将上面的 `yui` 替换成本 checkout 的绝对 launcher，
并使用隔离 Home。JSON 输入的例子：

```json
{"kind":"content","displayName":"报告","content":"固定的一版结论","provenance":"本 Task 的材料分析"}
```

共享 RPC 仍受 T02 的 1 MiB 单消息上限约束；大正文使用本地读取入口，
本次没有引入二进制对象服务或分页传输协议。

## 3. 迁移与并行集成边界

本分支最初在 storage 3 上开发。同步远端 `c655cc6` 后，保留其
`session-and-process-identity` migration 4，追加中央 migration
`project-resource-artifacts`：storage 4 → 5（目标版本标记 0.15.8），
最低支持仍为 1。Project payload 从 5 → 6，已有 Knowledge、路径、Git 配置、
历史 Tasks/Turns/结果保留，新增资源引用为空、默认 Provider 映射为空。
新表为空，不迁移或重写既有 Git 事实。普通读取严格要求当前 Project 格式，
不双读历史 payload。旧 binary 拒绝新 Home，换代码不会降 schema。

Operator 必须协调 T03/T04/T05 的未发布迁移编号，使合并后的链连续；
不得重写已发布迁移。采用通过原 upgrade/update 的停写、备份及验证机制，
不允许运行时启发式补字段。此 Task 没有升级共享 Home 或重启共享 Controller。

本次冻结的是资源端口，不声称并行分支已接通：

- T03 负责将 ArtifactRef 接到其 Candidate/Acceptance 和通用 Context 中。
  当前 Project catalog 保留 Git 结构和已有 Task Project 绑定；
  本次不发明第二套非 Git Project/Task 关联账本。
- T04 消费采用后的 environmentRef，并在实际 Session/Turn 快照中记录。
  本报告的资源端口交付时原生 launcher 尚未消费它；后续连接实现及验证见
  [T04 实现证据](T04-evidence.md)的“采用环境执行集成”。
- 空环境 prepare/adopt 已独立验证，不表示现有原生 Runtime 已能无 cwd 启动。
  T03/T08 的通用 Activation 应消费此空采用事实，而不凭目录存在猜测采用。
- S22 的副本、重试、综合选择属于 T04；T05 只保证独立目录与资源冲突边界。
  外部 Provider/连接插件、credentials resolver、SDK 与热加载仍由 T09+ 实施。

## 4. 实际证据与审查

临时专项使用一次性 SQLite Home、本地目录、真实 Unix socket 与可丢弃 Git。
不接触用户资源、真实模型、共享 Home 或生产/付费 API。
专项不进入永久 suite 或 CI，交付前移除；保留以下观察结果：

- S04/S37：无 Project、无 WorkItem、无 Git 的 Task 经原 `runTaskCommand complete`
  完成；重开 SQLite 后由绝对本地 CLI 读取固定正文，不启动原插件。
- S13：保存文件 v1 后将原文件改为 v2，Artifact 仍为 v1；
  覆盖保存被拒绝，Reference 不能作为固定 resultRef，外部版本证据保留。
- S26/S28：symlink 别名注册得到同一 resourceId；未获明确 grant 不能 prepare，
  撤权后不能重新 adopt；maxUses=1 的原采用重读不重复消费。
  自查另以 Project 的 symlink 路径复现通用本地写绕过原所有者检查，
  将受保护路径也按真实目标比较后，同一专项从失败转为通过。
- S23/S27：空 prepare/adopt 没有目录；未采用空 scratch 可释放；
  非空 scratch 保留；已采用目录无 quiescence 不能释放；
  用户目录始终保留；独立 scratch 不因另一已采用环境被整体阻塞。
- T02 入口：真实 authenticated dispatcher 和 Unix socket 保存/读取同一 Artifact；
  伪造 context 和跨 Task 目标被拒绝。
- Git 主路径：真实 `captureManagedGitChanges` 生成固定提交，
  原 `GitIntegrationService` 将该提交推进原目标及 Task binding；
  `resource.git.result` 读取原 ChangeSet，没有第二份 Git 写入者。
- 迁移：可丢弃 fixture 先通过基线版本自身的 schema 校验确认 storage 3，
  新 loader 在升级前拒绝；显式 `runStorageUpgrade` 成功到 4，
  Project 历史字段与 Task 保留，新引用配置为空。

已执行 `make install-local`、`npm run build`、`npm run lint`、
`npm run test:core`：core 82/82，测试阶段约 4.28 秒。
临时 `node --test output/t05-evidence.mjs`：最终 7/7，约 1.19 秒；
别名修复后重新 build/lint 通过。
core 子进程去除继承的 `YUI_*`，未连接真实控制面。
永久测试仅更新当前存储版本预期，没有新增异常回归矩阵。
离线阅读版由仓库脚本重新生成，文档链接、manifest 与契约 TypeScript 检查通过；
缺失的打包依赖只安装于本 Task 的临时 output 目录，不修改全局环境。

Leader 的这些自查不代替独立最终 Review。审查发现与逐项裁定、Task 完成和
精确候选 head 由受支持的 Task 操作记录；未完成前不声称 Task 已交付。
本授权不包括 push、PR、merge、tag、release、archive 或启动后续 Task。
