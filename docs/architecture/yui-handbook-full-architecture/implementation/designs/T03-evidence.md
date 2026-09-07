# T03 实现与采用说明

Task：task-15。基线：`b7d07394f68ac48a56bc8d03b6d91bf23be98051`。
日期：2026-09-07。精确最终提交、独立审查与接受状态以 Task 持久记录为准。
本文件不代表发布、合并或升级授权。

## 实现决定

Task、WorkItem、Brief、Role、Message 与 Turn 继续使用原 `TaskStore`。
没有第二份 Task 数据库、Review verdict、消息送达账本或 Context 缓存。

- Task 当前状态采用 draft／active／completed／cancelled／archived。
  `cancel` 表示停止追求目标，不证明进程停止；原 `retire` 保留显式隔离行为，
  其结果也是 cancelled，且保存隔离证据。归档仍是独立受权操作。
- WorkItem 状态采用 open／accepted／retired。执行失败保存在 Turn；
  `work update running/failed` 不再改变责任状态，`done` 提交 Candidate，
  需要明确 `work accept` 才接受。原 CLI 动词是当前原子操作，不双读旧 payload。
- Brief 修改要求 `--expected-revision`，创建使用 0。冲突返回当前 Brief、
  revision 和本次提交字段。修改方案、焦点或 WorkItem 定义不自动撤销结果；
  接受记录选择的 Candidate 和说明，撤回接受保留历史。
- Role 当前选择与 Turn effective 分开。当前 Worker 改为 B 后，原 A 的
  Assignment、结果来源和合法执行权限保留；下一次明确执行使用 B。
  Leader 换绑撤销旧管理 caller key，A→B→A 不复活旧入口，不重建 Worker。
- 失败沿 Worker／Reviewer→Leader、Leader→Operator 路由。修正可恢复
  Leader 失败、投递失败和仅有 terminal 的失败遗漏；复用原事件引用，
  不重复投递 structured error 与其 terminal，也不建立备用 Operator。

## Context 入口

`yui task context <task>` 与 `task context read <task>` 使用同一紧凑读取。
`context.delta`、`context.inspect` 也在 T02 能力目录中，可供后继 Surface 使用。
旧 `task next-action` 保留独立决策辅助入口，不再混入 Context。

```text
yui task context read <task> --json
yui task context delta <task> --after <coreCursor> --limit 100 --json
yui task context delta <task> --after <coreCursor> --continuation <token> --json
yui task context inspect <task> --store <store> --ref <id> --digest <digest> --json
```

以上命令用于已选择的实例；开发验证始终使用本 checkout 的绝对
`output/dev/bin/yui` 与一次性 Home，不使用裸全局 `yui`。

核心记录、计数、引用和 cursor 在同一数据库事务读取；查询不增加 revision，
不消费 mailbox。delta 是不可变 Task Event 页，不是冒充历史快照的当前
记录；第一页固定 throughCursor，continuation 保持相同上界。
后续 `read`／`inspect` 明确读取当前事实；digest 已变化时 inspect 返回冲突。

默认最多 256 个记录、128 KiB 记录页，超过 4 KiB 的正文给引用、摘要和
省略标记；inspect 上界 4 MiB。事件页最多 100 项，超大事件正文也给引用。
被省略的历史记录可通过领域查询定位，再按授权引用 inspect；省略不是删除。

受管调用者只读所属 Task，非 Leader 使用当前 Turn 的授权引用集合和自身
Role／Turn。消息正文、计数和引用先经过同一过滤；message list 也复用此过滤。
不完整 managed identity 不降为用户。Capability ingress 保持 T02 当前认证。

`withContextObservations` 是受信任装配端口，可由 `createKernelPorts` 提供
只读可选来源；不向来源暴露 Store 或凭据。它们仅接收冻结的受权核心视图。
每项观察独立标注 source／observedAt／coverage／status；默认预算 250 ms，
最多 8 项，每项 4 KiB。失败、超时或非法输出返回 unavailable，核心 cursor
不变。该端口不是不可信 JavaScript 沙箱，也不宣称 T09 插件 SDK 已实现。

## 存储采用

当前源码基线已经包含 storage version 3（包括已发布的 exact-attempt
迁移）；本次仅追加 3→4 的 `task-facts-and-explicit-acceptance`，
最低支持版本仍为 1。普通 Store 只接受当前合同，不解释旧状态。

迁移保留原 Task 退休时间、操作者、说明和隔离含义；WorkItem 旧执行状态、
诊断和结束时间保留为历史证据，completed 映为 accepted，其他未退休工作
映为 open。Candidate、Turn、Message、Review 原文及来源不被重写。
Brief 获得初始 revision，历史事实不因该并发令牌而失效。

采用走现有 `upgrade --dry-run`／`upgrade` 或 update 的受控握手，保持停写，
保留升级器生成的备份。未改已有迁移、最低版本或 update 握手。旧 binary
不能读取 version 4；切回源码不降 schema，恢复备份也不撤销外部效果。
本批并行 Task 如追加迁移，合并时必须顺序协调；version 4 是本候选的实际
迁移编号，不是预占号或跨 Task 账本。

## 验证证据与边界

开发专项均使用一次性 SQLite Home、合成 Session／Turn、临时本地 Git 和
受控端口，保留原实现的真实事务、CLI 与入口调用。专项脚本交付前移除，
不扩大永久 smoke。汇合候选的 build、lint 和核心 smoke 82/82 全部通过
（核心测试阶段约 4.28 秒，包含 packaged CLI 启动）；下列专项均在同一构建
上通过。手册生成与契约检查通过。独立 Task-final Review 尚待执行，
其原始结论及 Leader 裁决以 Task 持久记录为准。

- Context：实际双 SQLite 连接、固定上界分页、超长正文 inspect、读取不 ack、
  相同范围的消息正文／计数／引用、错误 identity、可选失败／超时及真实 CLI。
  Capability 真实认证入口可读取核心，附 unavailable；跨 Task inspect 拒绝。
  不完整身份测试先复现错误放行，修正后通过。
- Role：当前 B／effective A、显式模板重应用、旧 Leader key 撤销；实际 Job
  ingress、去重、取消和启动前鉴权；完整 workspace prepare 不退休仍工作的 A；
  active／accepted A 不隐式启动 B 或增加 Turn。修正前复现 Job 拒绝及 B 被 A 覆盖。
- 通知：调用实际 `saveRoleTurnDeliveryFailure`、`observeRuntimeObservation`、
  `observeRuntimeTurnTerminal`，覆盖三种角色、重复观察和 Operator 不可用；
  原失败事实保留，Task 不自动失败。先复现五项缺失路由，修正后十项通过。
- 生命周期与迁移：Brief 冲突、修改要求后接受原 Candidate、显式撤回、依赖、
  取消／重开、直接完成及归档、有效 v3 payload 到 v4 的历史保留。

迟到执行终态不重开 Task。若原 Turn 已终止，原结果保持不可变，迟到内容
按原 Turn/fence 保存为关联 observation，不伪称第一次执行成功。
归档要求相关执行已结清，archived 不作为继续接收新执行的入口。

未测试真实 Provider、付费 API、生产账户、共享 Home 或共享进程停止。
这些隔离证据不是“真实模型 E2E”。T04/T05 的后续合并仍须核对 typed
端口及迁移顺序；本候选不实现 Endpoint、通用 Artifact 或资源生命周期替代。
没有 push、PR、merge、tag、release、archive 或启动后续 Task。
