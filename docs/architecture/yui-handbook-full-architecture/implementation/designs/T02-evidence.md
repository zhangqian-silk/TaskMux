# T02 能力入口、验证与后继交接

Task：task-12。采用的 T01 合并基线：
`06fc9cf8fb3e3a922d38bda92a5c8fcd70d6d118`。日期：2026-09-06。
精确候选提交、独立最终 Review 和 Leader 裁定以 Task 持久记录为准；
本文是实现与开发证据，不是验收、远端合并或发布事实。

## 1. 采用决定

Controller 在现有 `createKernelPorts` 中装配一个 CapabilityRegistry。
Registry 仅保存可重建 descriptor，不创建另一个 Host、Controller、Task Store
或 Operation 表。内建实现仍调用原业务函数，原 typed 入口继续可用。
一次 capability call 只取得一个明确 generation 的句柄，不重试或 fallback。

公开入口是 `yui capability search/describe/call` 和同名 Controller RPC
`capability.search`、`capability.describe`、`capability.call`。
它们可供 Agent、CLI 和后续受信任 Surface adapter 共用。
当前生产身份适配器只接入已有 managed Task/global Session 认证；
普通终端或浏览器不能通过声明 `scope:user` 获得权限。
本次没有新增 Web UI、浏览器身份签发、可执行插件加载器或 T09 SDK。

新入口对可信边界的依赖与 T01 相同：Controller 及其装配代码可信，
第三方实现仅得到一次调用的 context、嵌套调用和 evidence locator 端口。
这不是同进程任意 JavaScript 的安全沙箱；不能向插件代码交出 Host、
Registry、Store、认证器、调用者凭据或完整 ingress dispatcher。

## 2. 实际能力映射

全部内建 descriptor 的契约版本为 `1`，Provider 为
`yui:builtin-capabilities@1`。`source` 指向原权威入口。

| 名称 | 效果分类 | 原入口及事实所有权 | 当前范围 |
|---|---|---|---|
| `task.read` | query | `TaskStore.getTask`，与 `task show` 读同一 Task | 已认证的当前 Task |
| `task.update` | local-mutation | `runTaskCommand/updateTaskCommand` 原事务，Task、Event、Mailbox 各由原模块写一次 | Leader/Operator；title、description、priority、tags |
| `config.read` | query | `runConfigCommand`，与 `config <domain> show` 共用有效值投影 | 已认证 global Operator |
| `resource.workspaces` | query | `TaskStore.listManagedWorkspaces`，与 `task workspace list` 共用 managed workspace 事实 | 当前 Task 的工作区资源；不是 GC 或物理进程扫描 |
| `job.get` | query | `DurableJobControlPort.getJob`，`inspectJobOperation` 是原 Job 的读模型 | 当前 Task 的原结果、效果与回执 |
| `job.start` | external-operation | `DurableJobControlPort.startJob` 原事务及既有 Supervisor/runner | 原 managed workspace/Project/HEAD/调用者授权边界 |
| `plugin.create/validate/activate/disable` | local-mutation | 无现有 SDK 事实入口 | 对受权 Operator 描述为 unavailable，不执行空实现 |

仍未包装 Task 创建/生命周期、Role/WorkItem 派发、配置写入、资源 GC、
Agent Driver 和 Skill 的管理命令。它们保留已有 typed/CLI 入口；
不存在可以透传任意 CLI 字符串的能力。该范围提供查询、本地写、外部请求
三条真实链，不提前替代 T03/T04/T05 或实现 T09。

`job.start` 公共 schema 对齐现有 Job RPC：step 支持 name、command、
timeoutMs；内部 typed Job 支持的 argv/cwd/env 扩展不因此成为公共参数。
秘密规格、目标、幂等身份与发送前的当前授权继续由原 Job owner 检查。

## 3. 调用与权限契约

Controller envelope 包含 `taskId`、已有 managed `caller` 凭据，
以及 search 的 `query` 或 describe/call 的 `request`。
caller 来自 CLI 的 `resolveJobCaller`；它不属于 capability input。
任何 input 中的 actor/caller 注入、未声明参数或跨 Task 目标均拒绝。

调用示例（在已认证 managed Session 内；开发时使用本 checkout 的绝对 launcher）：

```text
yui capability search task --task task-12
yui capability describe task.update --task task-12
yui capability call task.read --task task-12 --input '{"taskId":"task-12"}'
yui capability call task.update --task task-12 --request-id edit-1 --input '{"taskId":"task-12","patch":{"title":"新的标题"}}'
```

effectful call 必须携带 requestId。Job 将它交给原 Job 去重事务，
同一调用主体和 requestId 重入返回原记录，参数冲突仍由原 owner 拒绝。
Task 元数据修改保持原事务语义；requestId 不新建本地修改账本，
也不承诺跨请求去重，重复明确修改仍会产生原有 Event。

Registry 校验输入 snapshot、当前权限和效果上限之后才 acquire。
每个嵌套调用复用原 TrustedCallContext 并重新认证；子调用的效果不得超过
父调用，query 无法借下游 local-mutation 或 external-operation 写入。
父调用返回或抛错时等待已发起的子调用收敛到调用结果，再释放句柄；
保留的 invocation 不能在父调用结束后作为新的 ingress。
这不等待异步 Job 执行结束，只等待已发起的能力调用返回其原 Operation。

目录按已认证当前 Task 及它引用的 Project 过滤；Global/Project/Task
scope 仅增加或减少可见候选，不授予权限。必要权限由受信任装配器检查。
未获权的 descriptor 不出现在 search 中；撤权后旧 context 也不能发起新动作。

扩展贡献不得使用核心 namespace，亦不得借用核心 Provider ID 替换目录。
没有隐式 scope 优先级；多 Provider 或多个未指定版本返回 ambiguous，
可通过 `--provider`、`--version` 明确选择。结果记录实际 provider/generation
与 explicit/unique 选择来源。required 仅检查明确名称和契约版本，
缺失返回 unavailable，不下载、执行或求解依赖。

## 4. 返回与效果证据

返回 kind 为 `value`、`operation`、`unavailable`、`ambiguous`、`denied`、
`invalid` 或 `failed`，携带 effect 和 operations。
`operation` 是已有操作的观察值，不表示业务成功；必须读取其中原
state/outcome。pending、running、unknown 和 confirmed runner 观察均保持原义，
不转换为 capability 成功，也不发出另一 Provider 请求。

外部实现必须通过 invocation.observe 或嵌套调用提供原 owner 的 operationRef。
包装器输出 schema 不匹配、输出无法 JSON 序列化、父包装器抛错时，
已经观察到的 effect、receiptRefs、partialResultRefs 仍出现在返回中；
实际回执仍由原 Job 持久化。未取得任何操作证据的 effectful 异常保守报告
possible；没有 evidence 的 external-operation 不返回 value 成功。
observe 不是持久化 API，也不授予写原 Job 的权限。

schema 是明确的有界 JSON Schema 方言：type、properties、required、
additionalProperties、items、enum、const、anyOf、minLength、minItems。
未知 keyword 在注册时拒绝，不能静默声称完整 JSON Schema 支持。
输出采用实际 JSON 投影校验，避免序列化失败绕过效果返回边界。

## 5. 注册与生命周期

可信装配者先在唯一 Host 准备实现，再原子发布该 Provider 完整贡献。
descriptor、schema、namespace、身份和实现检查失败不修改旧目录。
Registry 不执行插件初始化代码；候选初始化及自有资源清理由装配者负责，
本次没有新增插件激活或恢复协议。

同一非核心 Provider 发布新 generation 只影响新调用；已有调用保持旧句柄。
装配者先发布新目录，再对旧 generation detach；最后引用释放才清理。
停用时先从 Registry disable，再 detach；Registry 不另存实例状态。
已有句柄不能当授权缓存，后续受控动作仍需通过当前认证入口。

## 6. 隔离验证

开工先对合并基线执行 `make install-local`、`npm run lint`、
`npm run test:core`：构建通过，core 82/82，测试阶段约 4.27 秒。
没有把 T01 原提交的验证冒充合并后证据。

专项脚手架只用于本次开发，不进入永久 suite 或 CI。使用一次性 SQLite Home、
本地 Git 仓库、合成 managed Session/Turn、真实 Unix socket、绝对本地 launcher、
一个 detached runner 和 loopback HTTP fixture：

- S39：旧 Task handler、本地能力桥、真实 CLI/socket 修改同一 Task；
  每次明确修改只有一个 `task.updated` Event，无第二份 Task。
  search、describe、call 均通过真实 CLI/socket。
- 查询：Task/workspace 读取来自原 Store；Task Session 看不到 global config。
  合成的已认证 global Operator 可读原配置有效值，插件 SDK describe 明确
  unavailable。原 Job 查询返回同一 operationRef。
- 外部链：能力 `job.start` 与旧 Job Control 重入同一 requestId，
  SQLite 只保存一个 Job；实际 runner 仅发送一次 loopback 请求，
  fixture 的一次效果及 HTTP 回执文件均可读，原 Job 为 succeeded/confirmed。
- S34：在真实 runner 已产生回执后，扩展包装器经 `job.get` 读取原证据，
  随后故意输出错误类型；返回 invalid/confirmed，receiptRefs 未消失。
  另以定向 port 验证 unknown、父调用抛错、未 await 的子调用和非 JSON 输出；
  不重发、不丢已观察证据。
- S30：两个同名 Provider 返回 ambiguous；显式选择命中指定实现；
  缺 required、隐藏 Task scope、未知 schema keyword、半套注册失败均可读，
  旧目录保持可用。
- S25：A 尚未返回时发布 B，新调用得到 B；A 的 disposer 等旧调用释放才执行。
- S45：复制/伪造 context、跨 Task 参数、input actor、核心名字和核心 Provider ID
  均不能获得权力；query 嵌套 write 被拒绝。轮换 SQLite caller-key hash 后，
  旧 context 发起新 Job 被拒绝，既有回执仍保留。

定向测试中先复现了核心 Provider ID 覆盖、父失败早于子结果、
非 JSON 输出逃出 evidence 边界三个缺口，再验证修复。
最终 `npm run build`、`npm run lint`、`npm run test:core` 均通过，
core 82/82，测试阶段约 4.19 秒；专项 8/8，约 1.44 秒。
永久 core 测试数量保持原样。独立审查结果见 Task 持久记录。

## 7. 采用与停止边界

本次无持久 schema/payload 变更，不新增 migration；继续使用 T01 已合入的
当前存储版本和中央迁移链。有效较旧 Home 仍只能经既有 upgrade/update
显式迁移，不允许借能力目录自动修复数据。Task 五态与 archived 目标、
Agent Runtime 协议和 Session 生命周期未修改。

后继只需采用包含该候选的 Git 成果，重建兼容 binary 并在自己的隔离 Home
使用原 Controller。不得以本报告为授权升级共享 Home、全局安装或重启共享实例。
新 CLI 指向尚未采用本实现的 Controller 时，缺少 capability 方法会明确失败，
不偷偷改走本地 handler 或第二 Host。

未验证真实 Agent Provider、付费 API、生产账户或共享资源。
本地 runner/loopback 证据不是“真实模型 E2E 通过”。未 push、merge、
release、archive 或启动 T03+。T02 经独立 Review 和 Leader 裁定后，
由 Operator 汇总本序列；完成不授权后续任务或归档。
