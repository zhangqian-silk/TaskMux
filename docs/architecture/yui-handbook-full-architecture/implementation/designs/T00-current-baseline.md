# T00 实施证据｜当前代码、共享边界与采用顺序

本材料是 task-10 的交付入口，不是新运行时规范。源码与原始手册固定在
`bfdb32e7f705923886057f0907baedbadb8c7154`（0.15.0）；调查日期 2026-09-06。
T00 仅修改设计资料与按需隔离验证入口，不改变产品行为或存储版本。
源码路径均相对仓库根目录；函数名是该提交的定位锚点，不是未来目录承诺。

## 1. 结论及适用边界

- 复用 `TaskStore` / `SqliteTaskStore`、Controller、现有 CLI handler 和资源操作。
  七模块是职责归属，不是七个数据库、进程或新的 Service 层。
- 当前已经有 archived；目标补齐该终态。当前 retired 不等于目标 cancelled：
  前者含退休及隔离证明。后续采用必须保留有效历史，不在 T00 改枚举。
- 当前 Turn 原始结果已经独立保存，Role 有当前配置与实际 effective 快照。
  通用 Endpoint、CapabilityRegistry 和引用计数实例 Host 尚未实现。
- 当前有一致事务读与冻结 Turn Context，但不是手册承诺的通用 read/delta
  固定上界 API。现有 Context 中还有 nextAction 展示，不能标成目标已满足。
- T00 的 S39/S44 是当前基线证据和采用约束，不宣称完整插件切换、
  新 schema 升级、真实 Provider 或目标生命周期已经通过。

未读取 task-9 的私有工作区或执行。当前提交未包含在本任务启动后才可能产生的
task-9 修复；task-9 的最终提交／合并状态未获本 Turn 授权事实，故未验证。
T04 必须由 Operator 提供已核实的 nativeSessionId／pane_dead 修复引用并采用，
不能把本基线的离线协议映射当作该增量已验证，也不因此阻塞 T00–T02。

## 2. 从真实入口到唯一写入者

这里的“唯一”是每种事实只有一个语义所有者和持久化基础，不是所有 CLI
进程只允许调用一个函数。CLI、Controller 和 persistence worker 可建立连接，
但共享同一个 Home 的 `yui.db`；事务提交由 SQLite 串行化。目标模块划分不会
把现在聚合在 `taskCommands.ts` / `FileSchedulerStoreAdapter` 中的写入复制出去。

| 路径／权威事实（目标模块） | 当前入口 → 真正写入位置 | 主键、更新方式与消费者 |
|---|---|---|
| 配置、Agent、全局 Role（Agent & Context） | `setup/setupCommand.ts::runSetupCommand` → `saveMinimumConfiguration`；`commands/configCommands.ts` → Store | Config 单例；Agent id；GlobalRole name。配置事务保存，启动规划和配置查询消费；不导出密钥 |
| Task、Brief、Decision、完成（Task） | `commands/taskCommands.ts::createTaskAggregate/completeTaskCommand`；Brief/Decision 命令 → `SqliteTaskStore.saveTask/saveTaskBrief/saveDecision` | Task 全局 `task-N`；其局部记录以 taskId+id 标识。Task+Role+event+mailbox 在事务创建；Context、completion readiness、Surface 消费 |
| 激活及工作区采用（Task + Resource） | `cli.ts` preflight → `repository/taskWorkspacePreparer.ts::activateTaskWorkspace` → 同一 Store 采用 Task/cwd/ManagedWorkspace；再 `activateTaskCommand` 核验采用证明 | Task id 与 workspace owner。文件系统准备不是数据库提交；当前 Draft 创建无持久可写 main，激活事务才采用，激活不另造 Task |
| WorkItem、Candidate、验收（Task） | `taskCommands.ts` work create/update/submit/accept → `saveWorkItem`；`workItem/workItem.ts` 构造当前记录 | taskId+work-item-N；revision、候选 id 与源 Turn；Candidate 在 WorkItem 内，非独立目标 Artifact 表。Context、Review、Integration 消费 |
| Role 当前配置（Agent & Context） | `taskCommands.ts::updateTaskRole`、`commands/roleConfiguration.ts` → `saveRole`；切换使用 Session 控制入口 | taskId+name；activeAgentId、bindings、launchRevision。实际启动由 `executor/effectiveLaunch.ts::resolveEffectiveLaunch` 冻结，不能用当前 Role 回填历史 |
| Turn、原始结果（Execution） | `taskCommands.ts` 派发 → `saveActiveTurn`；`controller/fileSchedulerStoreAdapter.ts` → `lifecycle/exactTurnTerminalization.ts::terminalizeExactTaskTurn` → `saveTurn` | taskId+turn-N；active pointer 与 Turn 同事务，结果在 Turn.result 一份。精确 role/agent/turn 关联；Context、WorkItem、Review 只消费／引用 |
| 原生 Session／本地承载（Execution） | `controller/runtimeLaunchCoordinator.ts`；`FileSchedulerStoreAdapter` → `saveTaskRoleSessionSet/saveGlobalRoleSessionSet` | taskId+roleName（全局为 name），内含 Agent Session、native identity、runtime generation。Provider 状态不决定 Task 完成 |
| Message、InputRequest（Agent & Context） | `submitOperatorMessage`、task message/input handler → `saveMessage/saveInputRequest` + event/mailbox 事务 | taskId+message-N/input-N；正文和回答处置持久化。Leader/Operator 读；接收证据与落实要求是不同事实 |
| 投递、Wake（Execution） | `coordination/workMailboxQueue.ts`、`scheduler/activeRoleTurnDelivery.ts`、`leaderWakeupProcessor.ts` → Store mailbox/signal/Turn input | mailbox target key + sequence；接受仅消费已提交前缀。`FileSchedulerStoreAdapter` 折叠原生证据；Context read 不 ack |
| Project Knowledge（Project & Resource） | `commands/projectCommands.ts` 知识入口 → Project 的 Store 记录 | projectId 及知识局部 id；authority 在 YUI_HOME，仓库文档只是资料。Task Leader 可提案，不直接代替 Operator 写权威知识 |
| ChangeSet／Integration（Project & Resource） | `workspace/workItemChangeSetManager.ts`、`gitChangeSetCapture.ts`；`integration/gitIntegrationService.ts` → `saveChangeSet/saveIntegrationAttempt`，成功事务推进 `Task.projectBindings.currentCommit` | taskId+局部 id；固定 commit、checks 与实际 head 比较。工作目录可变，ChangeSet/候选 commit 是固定证据；不等于远端发布 |
| 软件资源与清理（Project & Resource） | `repository/taskWorkspacePreparer.ts`、`taskWorkspaceCoordinator.ts`、`repository/gitWorkspace.ts::NodeGitWorkspace`；`resources/liveReferences.ts/resourceGc.ts` | workspace owner、Home/Task workspace identity、规范化 Git 目标；注册/引用投影不能成为另一套 Task 状态 |
| 外部操作／运行回执（Kernel 基础，语义仍属原模块） | 当前有 `job/durableJob.ts` + `controller/jobControl.ts`、IntegrationAttempt、Provider submission、Store outbox 各司其职 | DurableJob taskId+job-N、idempotencyKey；Provider 原生关联；outbox requestId。不存在可覆盖一切的 OperationRecord 表，T01 先映射一个真实使用场景 |
| 发布事实（Task/Resource 边界） | `commands/taskPublicationCommands.ts` → `savePublicationReference` | taskId+publication id / external key；upsert/verify 事实与 Candidate、CI、部署分开。T00 未执行远端写入 |

`storage/sqliteStore.ts` 的 payload 与索引列是同一记录的表示，不是可独立改写的
两份权威。全局序列分配全局 id，Task 内序列分配局部 id；跨 Task 引用始终携带
taskId。`transaction` 用 BEGIN IMMEDIATE，`transactionWithRevisionCas` 比较
Home revision；worker 的 `transactionAsyncBatch` 复用该 CAS。它不是所有业务
对象已经提供 field-level expectedRevision 的证明。

两个需留意的源码事实：`work_item_candidates` 表虽在 schema 中存在，
当前 `saveWorkItem` 保存的候选在 WorkItem payload 内，不能据表名推导另一写入者；
`resources/resourceRegistryStore.ts` 在有效当前 Home 选择同库
`SqliteResourceRegistry`，还残留无 yui.db 时的 File fallback。后者不是有效
旧 Home 迁移合同，不应被 T01 扩展。T00 不清理这些非本任务运行时代码。

仓库指导“创建时获得 main”与该固定源码的“激活才采用”存在差距。当前事实以上述
preparer 和 CLI 调用链为证据，T00 不改任一方来掩盖差异；T03/T05/T08 采用时
应明确对齐职责及 Project Skill，不能让 T01/T02 意外改变工作区创建时机。

## 3. 请求、副作用与回执

| 动作 | 何时发生／如何确认 | 中断后原事实与边界 |
|---|---|---|
| Operator enter | `cli.ts` → `runtime.prepareGlobalRoleEnter` → `RuntimeLaunchCoordinator` / `agentHost`，最后 tmux attach | attach 是显示，不是新 Task；`operatorSessionHistory.ts` 记录当前与历史对话，native identity 由 Provider 证据建立 |
| Task enter／Leader wake | CLI 与 `leaderWakeupProcessor` 使用配置与 Task main，创建/续用承载并发送精确 Context 指针 | 当前 Draft planning 入口并非目标 T08 的完整能力；不要用 fixture Active 冒充 Draft 对话验证 |
| WorkItem dispatch | `taskCommands.ts` work dispatch 分支保存 Assignment/Turn；`fileRoleLaunchPlanner.ts` 构造 launch；mailbox 交付 | 已接受输入不能因进程消失假定未执行。unknown 保留原 Turn/证据，不自动换 Provider 再发 |
| Codex | `agentHost.ts` + `codexAppServerRuntime.ts`，共享 App Server 的代理连接；thread/turn 返回与订阅关联 | 启动、resume、submit、inspect、interrupt 与原生身份分开。本地代理不拥有共享服务进程，停止附件不等于销毁 Provider |
| Claude | `structuredProviderHost.ts` / `providerControl.ts`；`builtinAgentDrivers.ts` 的 Claude hook、stream 结果映射 | 预分配 Session 与观察到的接受/终态有不同证据。CLI 支持矩阵只按源码描述；离线 hook 输入不证明真实服务接受 |
| 结果采集 | Runtime event inbox → processor → FileSchedulerStoreAdapter → exact terminalization | 结果一次关联到原 Turn，重复或过时目标受 exact fence 限制；Turn 结束不自动 complete Task |
| Role 切换 | Role 配置修改与 Session new/resume 是不同入口，运行 guard 检查活动 | 不回写旧 effective；当前对活动承载修改的限制需 T03/T04 有意识调整，不承诺编辑立即生效 |
| Git 准备／集成 | 准备实际 worktree；检查实际 branch/head、checks；成功后事务采用 | prepared 目录不是 adopted 事实；失败返回冲突/检查结果。不能在 CAS 失败时仍声称目标 head 已采用 |
| 清理／归档 | `TaskWorkspaceCoordinator` 先核验停止、干净工作区及 integrated/discarded 处置；`archiveTaskCommand` 在事务复查未决资源与活动 | 清理不删除 Task。当前 archive 清理 mailbox 运行状态，保留业务历史；归档不能据完成自动授权 |

隔离报告的 setup/Operator/Leader/Turn 是受控 fixture 或 handler 证据，
本地 Git worktree 是真实可丢弃资源操作。实际原生窗口、模型执行、付费权限、
共享服务停止和 task-9 修复均未验证。

## 4. 七模块与 Plane 的实现差距

状态按明确能力划分，不给整个模块一个含混“完成”标签。

| 模块／位置 | 已满足（源码或离线证据） | 需调整 | 缺失／尚未验证 |
|---|---|---|---|
| Kernel／Minimal Kernel | 单 Home SQLite 事务、版本准入、managed caller、Controller 发现与既有操作记录 | 公共可信调用上下文、必要效果语义统一；不重复账本 | 通用 Host acquire/release 缺失；真实切换/撤权效果未验证 |
| Task／Capability | Task/Brief/WorkItem、opaque Turn 引用、直接完成与归档入口 | retired→cancelled、WorkItem 状态简化、结果适用性与业务门禁解耦 | 目标五态完整迁移、cancelled 重开尚未实现 |
| Agent & Context／Intelligence 配置 + Capability | Profile 应用、launchRevision/effective、事务 Context、冻结 Pack、read 不消费消息 | 当前 Context 附 nextAction；通用固定上界 delta 与可选观察需拆清 | 插件 Context provider 降级未实现；并发分页承诺未验证 |
| Execution／Execution + 控制能力 | Driver registry、结构化承载、精确 Turn 结果、mailbox | 固定多路成功数量/自动综合转 Leader 判断；Provider 协议边界收敛 | 通用 AgentEndpoint 与 ACP 未实现；真实 Provider 恢复未验证 |
| Project & Resource／Capability + Execution | Project Knowledge、managed worktree、ChangeSet/Integration、资源引用清理 | 将 Git 特性移到资源公开边界但沿用事实写入者 | 通用 Artifact、空环境目标未完整接入；外部版本资源未验证 |
| Plugin & Capability／Capability + 横向 Fabric | 内建 AgentDriver/Adapter registry 可复用为描述来源 | 增加少量 typed handler 包装，保持当前入口可用 | search/describe/call、scope provider 歧义、实例贡献尚缺；不是将 Driver registry 改名即可 |
| Surface／Experience | CLI JSON/文本、Web 既有查询与命令 | 共用应用入口、配置与实际执行标注 | 插件展示贡献与卸载尚缺；本次不做浏览器 E2E |

Intelligence 的规划、拓扑与验收在 `skills/yui-leader`、Project Skill 和 Task
上下文，不在新增 scheduler 中实现。当前 `execution/workItemExecution.ts` 的
`MINIMUM_WORK_ITEM_SYNTHESIS_RESULTS = 2` 及 `workItemMainTurn.ts` /
`reviewMainTurn.ts` 的自动综合是现状，不是未来 Kernel 必须保留的规则。

## 5. 后续共享最小契约与首个采用者

已有 [model.ts](../../contracts/model.ts) 是目标数据示意，不是发布 SDK。
以下只冻结跨任务职责和可观察返回，不预先冻结全部能力名、Provider 配置、
私有表或异步框架。接口实现任务拥有具体类型；出现不一致时先改唯一契约，
不在两个模块各造一份实体。

| 边界 | 实现所有者 → 首个消费者 | 最小输入／返回与固定规则 |
|---|---|---|
| Store/Authority/必要 Operation | T01 Kernel → T02 调用入口 | 可信 actor+scope+当前授权；查询值、本地原子结果或既有 operationRef。相同请求不同内容冲突；outcome 与 effect 分开；unknown 不自动重做 |
| 实例句柄 | T01 Kernel Host → T02 Registry | attach implementation；acquire 返回固定 implementation+value+release；detach 停新使用、最后引用结束 dispose。短调用 finally release，Session 长持有；句柄不持久化成第二目录 |
| Capability descriptor/call | T02 Plugin & Capability → T03/T04/T05 的公开入口 | name/version/schema/effect/provider/scope；input 与可信 context 分离；明确选择或 ambiguous/unavailable。只在公共边界做协议包装，内部 typed call 合法 |
| Task 原子操作 | T03 Task → T04 dispatch、T06 Surface | taskId/workItemId + 被声明的操作；并发更新带 expectedRevision；返回当前记录/冲突或执行请求引用，不等待 Agent 完成、不解析 Review |
| Role 当前配置／实际快照 | T03 Agent & Context → T04 Session | 当前 Role 与不可变 effective 分开；T04 保存实际 Agent、实现、环境与 Assignment 来源；不从后来模板重建过去 |
| Context read/delta/inspect | T03 Agent & Context → T04 bootstrap、T06 Surface | 精确 Task 权限；核心快照+同一读视图 cursor；delta 固定 through 上界；observations 独立来源和时间。read 不 ack；展开只读授权 ref |
| AgentEndpoint | T04 Execution → T03 的 dispatch 请求调用方 | 复用 model.ts open/resume/submit/inspect/cancel/events/detach；attemptId 不冒充 nativeTurnId；pending/unknown/not-submitted/accepted 明确；结果含 exact Turn 关联 |
| Resource/Environment/Artifact | T05 Project & Resource → T04 Execution、T03 Candidate | prepare 返回 preparationId、resourceRefs、可选 environmentRef；采用与释放显式。固定 Artifact 或外部版本/receipt，与参考 URL 分开；空计划合法 |

T03 → T04：受权 Task 操作给出目标、Assignment/context refs 与资源范围，
Execution 建立 Turn、固定实际配置并执行。T04 → T03：Execution 保存原输出，
返回 turn/result 引用；Task 通过公开入口形成 Candidate/Acceptance，
不直接改 Session/Turn 表。T05 → T04：资源端口返回采用的环境引用，
Execution 使用它；T03 只接收 Artifact，不要求理解 Git。反向清理先查询
真实使用和引用，再执行具体资源操作，不由 Task 猜进程已死。

## 6. 当前到目标的语义决定

| 问题 | 当前事实 | T00 决定及后续责任 |
|---|---|---|
| archived | 当前五态含 retired/archived；archive 只接 completed/retired 且不可重开 | 目标五态用 cancelled；归档规则以 [Task 模块](../../modules/02-task.md) 为准；T03 迁移保存结束来源和原隔离证明 |
| WorkItem | pending/running/awaiting_acceptance/completed/failed/retired | 目标 open/accepted/retired；历史 failed 的尝试证据不删，不能把一次失败视为责任退休。由 T03 明确映射及迁移 |
| 多路综合 | 至少两个成功、等待各 lane settle 后创建 main synthesis | 目标由 Leader 显式选择来源与综合；T04 保留 replica/attempt 关系及防重复写边界，不把重试当第三意见 |
| Role 生效 | launchRevision 与 effective 已分开，修改/切换有运行 guard | 新配置不改历史；T03/T04 共同确定兼容 Session 是否可续用，不移除 authority fence |
| Context | taskContext/turnContext 在事务读，Pack 有 frozen refs；通用 Context 附 nextAction | read 不 ack 已有机制继续；固定上界分页/可选观察由 T03 实施，不把 snapshot digest 等同通用 cursor |
| 重开 | 当前只 completed→active，入队新的 reopened wake；不允许 archived 重开 | 目标 cancelled 恢复要用户/Operator；只提示新的显式意图，不自动重放旧 pending/unknown；T03/T04 保留旧结果与投递证据 |
| 两份实现／adapter | 手册允许阶段并存，仓库禁止泛化 legacy fallback | 仅限同一当前持久化契约、确有分阶段采用需求的接口包装。一个请求只选一个实现，包装调用旧权威入口，不双写、不自动 fallback、不增加开关平台 |

并存准入与删除条件：实施任务必须列出仍使用旧 handler 的具体消费者、唯一写入
位置、不能一次切换的当前理由。新入口完成该能力的全链路证据后，所有消费者
均改用该入口且没有需续用的 Session/未决调用，移除多余包装／旧实现；
旧历史可读不以保留可执行代码为前提。若不能证明当前需要两份实现，就直接实现
唯一当前合同。历史 payload 的解释仅在中央迁移中，普通运行不双读或启发修复。

## 7. S39/S44 可重复证据及局限

按需入口：[隔离基线构造器](../../tools/capture_baseline.mjs)。在仓库根目录：

```sh
make install-local
node docs/architecture/yui-handbook-full-architecture/tools/capture_baseline.mjs
```

它创建专用临时 Home、fixture Agent 配置和本地 Git 仓库，使用当前 domain
构造器与 Store，不复制真实配置、不伪造共享数据库、不调用 Provider。
CLI 使用本 checkout 的绝对 `output/dev/bin/yui`，显式传临时 YUI_HOME，
清除继承的 managed Session 环境；只有假 setup 依赖探测，不执行模型。
结果仅输出必要关系和检查结论，临时 Home/fixture 在 finally 删除。
它是 T00 用户明确要求的按需证据入口，不加入 npm test/CI；
异常数据和故障注入测试不长期保存。

报告应区分：实际 CLI/SQLite/Git 操作、受控 handler/Driver fixture、
未运行的真实 Endpoint。重复执行须得到相同关系与检查结果，
临时路径/时间/id 摘要不要求字节相同。只有查询、事务、保存和重新打开 Store
能够证明的行为才列为通过；静态映射不算完整目标验收。

存储权威：`storage/storageVersions.ts` 当前与最低均为 1，0.15.0 起支持。
`storage/sqliteSchema.ts` 的 schema_migrations 是唯一版本轴；
record.schemaVersion 只是当前 payload 标签。当前不存在有效的 1→2 迁移，
不能伪造版本 0 当作“受支持历史”证明 S44。T00 不追加无意义 migration。

升级入口：`upgrade --dry-run`、`upgrade` 和 update 的 staged binary
`upgrade --update-preflight` / `--update-apply`。
`storage/upgrade/upgradeOrchestrator.ts::runStorageUpgrade` 在静止窗口
备份 SQLite，路径为 Home 同级 `<home-name>-backups/`，执行完整线性链并严格校验；
迁移/校验失败尝试恢复数据库，恢复失败要求保持静止并人工处置。
T01 若改变持久化，追加下一个连续版本，不重写已发布 version 1；
保留最低支持版本以来 updater 的字段和 parent-owned handover-lock 证明。

隔离恢复验证只证明 SQLite backup 文件能在新的独立目录打开，Task、
消息、结果和未决记录保持一致；不是迁移失败回滚测试，也不恢复外部 Git
或 Provider 效果。真正升级前要有对应版本的停写、备份、迁移及失败恢复证据。
不要复制活动 WAL Home 的单独 yui.db 冒充一致备份；不要让新旧 Controller
管理同一 Home。新格式旧 binary 必须拒绝，换代码不降 schema；
恢复旧备份会丢失备份后的本地事实，需要独立授权和效果核对。

实际执行结果见 [T00 验证记录](T00-evidence.md)；统一场景索引保持 planned，
避免把一次基线读取标成 T02/T04 或未来 migration 的完成。

## 8. T01/T02 可直接采用的交接

T01/task-11：从本提交继续，先复用 `currentTaskStore.ts`、`sqliteStore.ts`、
`storeRpc.ts/persistenceWorker.ts`、`runtime/managedCaller.ts`、
`runtime/providerAuthorityFence.ts`、`core/controllerServer.ts`、
`controller/runtime.ts`、`runtime/agentHost.ts` 和已有 DurableJob/Integration
回执。Host 管理实现引用，不替代 Controller/AgentHost，也不杀共享 App Server。
选一个确需外部效果记录的能力，先说明已有记录为何不足，再决定扩展方式。
交付 T02 能调用的最小句柄和效果端口，任何 schema 改动明确 version 1→下一版本。

T02/task-12：在已采用 T01 成果后，以 `commands/taskCommands.ts` 的
Task show/Brief update、`taskContextCommand.ts`、`operatorCommands.ts`、
`commands/resourcesCommands.ts` 为包装候选。先打通查询、一项本地修改、
一项已有请求型操作；通过同一入口认证和 handler，不为目录创建第二 Store。
`builtinAgentDrivers.ts` 和 `executor/agentAdapter.ts` 是已有描述来源，
不是通用能力发现完成的证明。unknown 结果引用透传，schema 输出错误不得清零效果。

Operator 只在核实本 Task 的真实 completed 状态、完成摘要与精确 commit 后启动
task-11，再按同样规则启动 task-12；Turn 结束不放行。T00 不 push/merge/release/archive。
本地 managed branch 提交不代表 master 已包含成果。后继若仍固定在原基线，
须由 Operator 用受支持交付引用/集成将精确提交纳入其可用基线；不要直接改
其他 Task worktree 或绕过 managed ref。若没有该采用路径，报告实际采用阻塞，
不能启动后假设文件已经存在。task-12 完成后停止本授权序列。
