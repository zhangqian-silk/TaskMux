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
- Brief 在事务内读最新值并修改指定字段，不要求版本令牌；同一字段以
  后一次明确写入为准，前后值同事务保存为事件。修改方案、焦点或 WorkItem 定义不自动撤销结果；
  接受记录选择的 Candidate 和说明，撤回接受保留历史。
- Role 当前选择与 Turn effective 分开。当前 Worker 改为 B 后，原 A 的
  Assignment、结果来源和合法执行权限保留；下一次明确执行使用 B。
  Leader 换绑撤销旧管理入口，A→B→A 不复活旧入口，不重建 Worker。
  同步 T04 后使用实际 native Session 身份及绑定事件中的明确撤权事实，
  不恢复已移除的 caller key／启动 generation。
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

原开发基线为 storage version 3。同步远端 `129801f` 后，原样保留其
迁移 1–6，本地未发布迁移顺延为 6→7 的 `task-facts-and-explicit-acceptance`
和 7→8 的 `event-owned-edit-history`；目标发布标记为 0.15.8。
最低支持版本仍为 1。普通 Store 只接受当前合同，不解释旧状态。

迁移保留原 Task 退休时间、操作者、说明和隔离含义；WorkItem 旧执行状态、
诊断和结束时间保留为历史证据，completed 映为 accepted，其他未退休工作
映为 open。Candidate、Turn、Message、Review 原文及来源不被重写。
7→8 将 Task `outcomeHistory` 和 WorkItem `acceptanceHistory` 原文转存为
每个受影响 Task 一条 `history.imported` 事件，再删除重复数组及 Brief
专用 revision。导入事件标注源存储版本，不伪称当时发生的新业务操作，
不派发工作；旧事件原文不变，事件序号从既有高水位继续。

采用走现有 `upgrade --dry-run`／`upgrade` 或 update 的受控握手，保持停写，
保留升级器生成的备份。未改已有迁移、最低版本或 update 握手。旧 binary
不能读取 version 8；切回源码不降 schema，恢复备份也不撤销外部效果。
本分支早期隔离试验 Home 的迁移 4/5 与远端正式链不同，不能仅按数字
升级或重写账本；保留其匹配 binary 和原数据，必要时明确导出成果。
当前合并候选验证的是远端正式链 6→8，不加入分叉账本兼容或启发式修复。

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
- Role（首轮）：当前 B／effective A、显式模板重应用、旧 Leader key 撤销；实际 Job
  ingress、去重、取消和启动前鉴权；完整 workspace prepare 不退休仍工作的 A；
  active／accepted A 不隐式启动 B 或增加 Turn。修正前复现 Job 拒绝及 B 被 A 覆盖。
- 通知：调用实际 `saveRoleTurnDeliveryFailure`、`observeRuntimeObservation`、
  `observeRuntimeTurnTerminal`，覆盖三种角色、重复观察和 Operator 不可用；
  原失败事实保留，Task 不自动失败。先复现五项缺失路由，修正后十项通过。
- 生命周期与迁移（首轮）：Brief 冲突、修改要求后接受原 Candidate、显式撤回、依赖、
  取消／重开、直接完成及归档、有效 v3 payload 到 v4 的历史保留。

迟到执行终态不重开 Task。若原 Turn 已终止，原结果保持不可变，迟到内容
按原 Turn/fence 保存为关联 observation，不伪称第一次执行成功。
归档要求相关执行已结清，archived 不作为继续接收新执行的入口。

未测试真实 Provider、付费 API、生产账户、共享 Home 或共享进程停止。
这些隔离证据不是“真实模型 E2E”。T04/T05 的后续合并仍须核对 typed
端口及迁移顺序；本候选不实现 Endpoint、通用 Artifact 或资源生命周期替代。
没有 push、PR、merge、tag、release、archive 或启动后续 Task。

## 首轮审查修正

`review-round-1 / turn-2` 对 `80c7051` 提出拒绝操作的空候选解引用问题。
Leader 复现后采用现有 `requireWorkItemCandidate` 返回有界错误，不回退选择
历史 Candidate，也不修改迁移语义。一次性实际 SQLite 检查确认：新 Home
第二次拒绝，以及有效 v3 failed-with-candidates 迁移后首次拒绝，均保留
原 WorkItem 与候选历史并返回 `DATA_ERROR`。修正前复现 `TypeError`。
按 Project 验证政策移除专项脚本，不新增永久异常回归用例；构建与 lint
通过。修复的独立增量 Review 及最终裁决仍以 Task 记录为准。

## 用户要求的简化

首轮完成后，用户明确选择数据库事务、字段更新和可查历史，不将规划编辑
冲突做成 Agent 必经步骤。本轮移除 Brief 的强制 expected-revision，
保留现有事务及具体执行／验收边界。Task 元数据、WorkItem 定义和 Role
配置编辑补齐更新前后值；仅记录相关字段或 Role 配置，不复制执行历史。
Task 和 WorkItem 当前记录不再累加历史数组；完成事件补齐 artifact refs、
接受事件补齐 ReviewRound 引用，重开事件保留被清除的结束字段。
历史由 `task event list` 和按引用 inspect 查询，是否恢复由 Leader 明确决定。
旧版日志没有保存的内容无法通过迁移凭空补全。

Context 复用授权判断后按消息、事件或目标记录读取，不再为这些查询构造
整份 Context；完整 read 保持原语义。Worker／Reviewer 仍通过原 Turn
Context Pack 确定授权，未另建授权账本。可选观察端口及预算保留，不扩展
插件框架。

临时证据已验证双 SQLite 写入的字段保留、同字段覆盖可追溯、事务回滚、
接受与重开历史，以及 4→5 导入完整性、幂等性与序号连续性。
Context 专项验证定向读取不访问无关记录、inspect 等价、固定分页上界、
相同授权过滤和读取不写入。独立只读 Agent 审查本轮完整差异并重跑这两组
证据，未发现新增实质问题。build、lint、core 82/82（约 4.23 秒）和
手册生成／契约检查通过；临时脚本交付前移除。该补充是用户直接要求的
本地简化，不冒充先前 Task-final Review 已覆盖新提交，也未更新共享实例。

## 同步 T04／T05 后的集成

远端 `129801f` 包含 Session 身份调整、T05 `36bf511`（PR #314）和
T04 Endpoint（PR #315）。当前 Task 分支以 merge 保留原 T03 提交，
没有重置 Task 的起始基线、更新远端分支或升级共享 Home。

- 接受 T04 的实际 native Session 身份和显式 synthesis 来源选择。
  Worker／Reviewer current B、effective A 的命令、Job 与进度 Hook 仍识别 A；
  Leader 换绑事件明确撤销原 native Session 的管理入口，旧排队 Job 同样拒绝。
  撤权不伪造 Session ended，不阻止原执行结果归档，也不增加凭据／租约。
- `task work update ... done --artifact-ref <artifact-id>` 将 T05 固定引用
  保存进 Candidate；接受时再次核对同一 Task 的不可变 Artifact。
  `task complete ... --artifact-ref <artifact-id>` 同样解析保存的固定结果。
  普通 Reference Artifact 不可充当固定结果；既有 HTTP(S) 完成引用仍只代表
  参考链接，不被升级为固定版本。
- Context read／inspect 显示 Artifact、EnvironmentPreparation、ManagedWorkspace
  和 ChangeSet。Worker／Reviewer 仅获得其授权 Candidate 的固定 Artifact，
  快照保存对应内容和来源；清理工作区后仍可读取。
- Git 复用原所有者：Task main 是独立 clone，WorkItem 是 Task 内的隔离
  worktree；固定 Candidate 经 capture 形成 ChangeSet，再由 Integration
  推进 Task main。具体 Git 写入仍保留目标 commit 比较，不能以后写覆盖
  的 Brief 语义取代。Project 参考仓库及远端不会随本地集成隐式变化。

隔离证据已通过：远端 schema6→8 且前六项账本／资源／Session 原文保持；
固定 Artifact→Candidate→接受→完成→重开 Store 后读取，缺失／跨 Task／
Reference 拒绝；native 身份与 A→B→A 撤权；受管 Context 授权；真实
Git clone/worktree/capture/Integration/cleanup 后保留 Task、WorkItem、
ChangeSet。build、lint、core 81/81（约 4.39 秒）通过；用例数变化来自
远端移除 generation 的既有调整，本次没有增加永久异常矩阵。

独立审查发现普通多 WorkItem 的 `candidate-1` 会发生 Context 引用碰撞；
现已统一为 `work-item-N/candidate-M`，read、定向 inspect 和最终 Review
快照使用同一作用域，不改变 Candidate 的持久编号。两工作项同名候选
隔离证据及独立复核通过，无剩余实质发现。五份临时专项脚本按 Project
Skill 清理，最终核心仍为 81/81。

要求判断：T03 的任务事实、明确验收、受权 Context 及 Git 工作区主路径
已接通。T05 的通用 environment prepare/adopt/release 已存在且可读，
但采用的 `environmentRef` 尚未作为 T04 原生 Session／Turn 的实际启动
环境选择；保留原 managed workspace 启动路径，不能宣称空环境／任意
本地环境已端到端驱动原生 Agent。真实 Provider、付费／生产资源 E2E
也未运行。这些边界不通过新增工作流或隐式切换 cwd 掩盖。
