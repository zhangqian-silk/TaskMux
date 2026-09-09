# Leader Session、AgentRun 与通知合同

本合同统一 T03 的任务上下文和 T04 的执行证据边界。它不改变 Leader 对方案、
委派、验收和恢复的决策权，也不引入新的调度政策或结果存储。

## 正常入口

用户直接与当前有效、未撤权的 Leader native Session 协作是正常入口。
Leader 使用 `yui task context <task> --json` 读取当前事实，保存 Brief、
Decision、Message 或其他合法本地修改；不需要先创建执行记录或给自己发 wake。
Context 读取、消息送达和要求落实是三件不同的事。

明确委派的执行使用 **AgentRun（执行记录）**。Worker、Reviewer，以及需要单独追踪的
Leader 执行，通过 `yui task run context <task/run> --json` 加载其精确冻结上下文。
原生聊天、Goal 的后续原生回合和普通通知不自动生成 AgentRun。

Session 身份来自现有 Role/Session 绑定。跨 Task、被替换的 Session、显式撤权、
Worker 的 Assignment 范围以及实际资源授权仍在对应操作边界检查。
active Run 指针不是 Leader 的通用权限凭证，也不能证明当前本地命令来自该 Run。
没有准确关联的 Leader 修改记录 native Session 来源，不借用同 Session 的另一个 Run。

## 一份意图，一份投递证据

WorkItem、Task 和 Message 保留业务意图。Mailbox 保存尚未交付的输入批次；
Provider runtime binding 保存当前输入的实际准入和原生关联。两者不是第二套 Task 状态。

普通 Leader wake 使用已有 TaskWake 和 mailbox processing batch：

1. 聚合后认领一个固定批次和通知窗口，不创建 AgentRun。
2. 通过同一 AgentHost/Endpoint 向固定 native Session 提交通知。
3. 确认接受后，只结清该批次。期间新增的 Operator 消息或结果仍在 pending 后缀。

通知不要求自然语言最终报告，也不强制 steer 用户正在处理的原生会话。
存在当前原生执行时等待其可用；观察未知时保留原输入，不能换 Session 绕过它。
认领之后、提交证据产生之前崩溃，也不能仅因查不到接受记录就盲目重发。
不存在“读取 Context 即 ack”的路径。

Leader 自己的事实修改不在产生端新增自唤醒，仍保留业务事件和 Task 状态通知。
其他来源的输入不因 Leader 忙碌而被清空、忽略或自动确认。

### 已有负责人的 Message 续作

首次 Dispatch 建立负责人、Assignment、工作区与冻结 effective；后续澄清和继续要求
使用 `task message send <task> <body> --to <role> --work-item <id>` 或
`--review-round <id>`。能力桥的 `message.send` 复用同一身份和写入事务。
Message 保存原 Role、工作关联和 ownerRunId；底层自动生成的 continuation Run
只是后续投递/结果关联，不要求 Leader 修改业务状态或提交未完成 Candidate。

同 Role 忙时保存即可返回，原执行结束后检查待办。每批最多 16 条有序消息，与新 Run
和原 Mailbox 信号原子关联；重复终态不再次关联已分配输入。新 Snapshot 保持原 Assignment，
追加授权消息及前次原结果，原 effective、工作区和未提交文件不变。Context read 不 ack。
更换负责人不迁移旧消息；`task message handoff` 只将未分配输入显式交给同一工作已经
Dispatch 的继任者。已结束的 Task/WorkItem 或过期 Review 候选保留消息和明确未投递原因，
不自动重开。副本 Producer/综合 Assignment 仍通过原 Lane/Group 正式操作处理，
不由消息静默重写冻结血缘。

未知通知保留原固定 TaskWake、输入窗口和投递事件。`task wake show` 展示窗口之后的
接受/unknown/处置事实。确认共享原生执行已经静止后，Agent/Operator 可用
`task wake resolve <task> <wake> --reason <evidence>` 释放该批次认领，让独立后续输入继续。
它不重投、不把 unknown 当作 not-accepted、不标记落实；存在原生 active/unknown 效果时
仍拒绝释放相应资源边界。没有自动恢复 Worker、结果副本或独立 outbox。

### 准入处置

| 证据 | 行为 |
|---|---|
| 明确 busy / not-accepted | 保留原业务输入，后续用新的 attempt 恢复同一 Session |
| 原生接受 | 不重发，等待准确终态；通知批次可在接受时结清 |
| 仅 transport 写入 | 保存 transport 证据，不冒称 Provider 已接受，不重发 |
| 真正拒绝 | 结清相应执行或通知占用，保留原因和原消息 |
| 接受结果 unknown | 保留原 attempt 和资源约束，不自动重发或替换 Session |

新出现的 unknown 不提前伪造执行终态；Run 保持未结清，直到准确证据到达。
旧版本已经写入的失败记录仍不可变，不在迁移时猜测或改写。

已封存 attempt 不改写成成功。`deferred` 是明确未接受的现有输入处置，
不是另一套业务重试工作流。首次尝试可能已经创建 Session；重试不能重复原始
`new` launch。`run.session-prepared` 保留该执行确实准备过的 Session 关联。

原生可用状态及明确的 Controller `SESSION_BUSY` 是结构化事实。
不通过错误文案中的 “busy”“active turn”等词推断可重试性。
没有可靠否定证据的 RPC 错误保留为 unknown。

## 原生关联与结果

AgentRunResult 保留自动采集的原始可见输出、错误、准确的 Provider/attempt 身份。
文件成果仍归 Artifact。ReviewRound 只关联候选和 Reviewer Run，不复制报告，
不从自由文本推导自动验收结论。

运行时在原有终态事务内保存结果并生成一次 `role-result` Message：

```ts
resultRef: { type: "agent-run-result", runId: "run-12" }
```

Message.body 是简短通知，不是第二份报告。`task message show <task/message>` 和
Context 的 `task-message` inspect 可有界展开同一份结果。历史普通消息的
`runId` 关联不自动解释为新的 resultRef。

重复终态在原执行身份上去重；迟到事件不会取得继任 Run 的 active 指针。
用户原生回合 A 与 Yui 请求 B 共用 Session，不代表 A 的结果属于 B。
已知 nativeTurnId 必须匹配；没有 nativeTurnId 的专用 stream 使用经过验证的
local attempt correlation，不把消息 UUID 伪装成执行 ID。

准确观察到的原生输入 item ID 可追加 `provider/visible-input` 来源；
Yui steer receipt 可追加 `yui/input-response` 来源。原始请求不被改写。
未暴露可靠输入身份的 Provider 不做全量聊天镜像或自动语义提取。
取消请求不等于已停止：只有准确终态才结清对应 Run，保留可见部分输出，
不自动取消 Task，也不撤销 Leader Session 身份。资源是否静止仍单独判断。

## Planning 与正式交付

`EffectiveLaunchSnapshot.executionAuthority` 是该 Session 实际获得的
`planning | delivery` 权限，不能从 Task 当前 status 动态推导。
兼容 Session 检查包含此字段。普通本地规划写入仍可用；正式派发、候选采用、
集成和 managed-workspace Job 检查 delivery 权限。

采用 T08 后，`resolveEffectiveLaunch({ ..., purpose: "planning" })` 自动捕获
planning 权限，并拒绝显式请求 delivery。首次 Draft 讨论建立 planning AgentRun；
后续已有会话上的普通消息保持通知语义，不强制创建执行报告。
当前 planning 执行通过 `task activation request` 原子保存意图，立即返回
`afterPlanningRun` 引用，不同步等待自己结束。准确终态释放激活请求，Controller
重新检查当前意图、资源与权限后采用；取消的请求不会恢复。

采用环境与 Task 激活沿 T08 唯一事务边界完成。需要改变物理启动配置时，
保留原始执行和 planning 权限快照，通过现有 Host detach/handover 边界准备
delivery Session；不能直接修改活跃 Session 的实际权限。Leader 发起的请求
采用时保留来源，不添加自唤醒。scratch/local/empty 资源计划复用现有资源能力。
此权限不是 OS sandbox 声明；用户选用宽权限 native Agent 时，不能声称 Core
能够阻止它绕过 CLI 直接操作用户文件。

## 当前 API 与兼容边界

| 旧称 | 当前合同 |
|---|---|
| `Turn` / `TurnResult` | `AgentRun` / `AgentRunResult` |
| `turnId` / `reviewerTurnId` | `runId` / `reviewerRunId` |
| `activeTurns` / `currentTurnId` | `activeRuns` / `currentRunId` |
| `getTurn` / `saveTurn` / `listTurns` | `getRun` / `saveRun` / `listRuns` |
| `turn/turn.ts` | `agentRun/agentRun.ts` |
| `turnContextPack` / `turnInputContract` | `runContextPack` / `runInputContract` |
| `task turn ...` | `task run ...` |
| Context `turn` / `source-turn` | Context `run` / `source-run` |
| Yui `turn.*` Task events | Yui `run.*` Task events |

`task execution start/stop` 仍是 Task 的执行准入开关，不是单次 Run 操作。
Provider 原生 `nativeTurnId`、Provider `turn.*` observation kinds 和原生协议方法不改义。
`AgentEndpoint.inspect().activeNativeTurnId` 明确表示原生身份，而不是 Yui Run ID。

旧 Session Manifest 已使用 `task turn`，所以 CLI 入口暂留一个同处理器别名；
旧 Manifests 全部退役后可删除。返回数据不提供双字段或双鉴权。

Host 控制协议升级至 v5，拒绝旧协议连接；存储升级需使用既有离线维护边界，
先处理旧 Host 客户端，不能把断开客户端当作原生执行已取消。
已部署 inbox v1 的私有文件 wire key `turnId` 由单一 codec 保留，以读取升级前
尚未消费的原生事实；in-process/API 值统一是 runId。仅在 v1 生产者与 pending
文件全部排空、引入后续 inbox 协议时删除该 codec，不在普通领域 Store 中双读旧数据。

## 存储迁移与回退

本任务采用主线 `48ffca4` 后使用中央迁移：storage **12 → 13**；
最低支持版本仍为 **1**，主线既有 1–12 迁移不变。迁移重命名结构化引用、
重算受影响的 ContextSnapshot resource/parent digest。T08 已存在合法 planning
记录，因此 Run 以原 purpose 判定，Session 以同 Task 的准确 planning launch
证据保留 planning；不能统一回填 delivery 或从 Task 当前状态推测权限。
Message 可选的 recipient/continuation/handovers 也属于同一未发布的 12→13 合同；
旧消息不猜负责人、不补发、不产生历史续作。

历史 `turn-N`、receipt ID、native ID、原始报告和正文保持原值；新记录分配 `run-N`。
SQLite 的 `turns`、`active_turns` 和 `turn_id` 是保留的物理表/列名，不是公开双模型。
历史 rejected/unknown 不按文案猜测为成功、空闲或可重试。

升级后的 Home 不交给旧二进制写入。回退使用中央 upgrade 保存的迁移前数据库备份，
并保留原 inbox 事实；不尝试手动逆向改字段或删除执行历史。
本任务不升级共享 Home，不发布或重启共享服务。

## 消费者采用

- **T07**：按 AgentEndpoint 的准确接受、终态和 local correlation 提供事实；
  不在 ACP 适配器内另建 Run/Result 存储或以 Session ID 代替执行关联。
- **T08**：复用 captured executionAuthority、Session 当前 Context、
  Message.resultRef 与不自等待的 activation；不要通过自唤醒补权限。
- **T09**：能力桥先验证当前 Session，再检查操作权限与资源 grant。
  插件不能通过 actor 参数、伪造 TrustedCallContext 或原始结果文本取得管理身份。

验证采用当前源码的 Host、Endpoint、假 WebSocket/stream-json Provider、原始收件箱、
Controller 和真实 SQLite；迁移使用基准版本二进制生成的旧 Home。
真实 Provider/model 作为测试对象未获授权，不属于本次证据。

### 本次隔离验证记录（2026-09-08）

以下是本次开发证据，不增加永久异常测试矩阵。临时脚手架在交付前移除。

| 验收 | 实际检查 |
|---|---|
| A | 无 Run 的有效 Leader 保存 Decision、合法 reopen；不新增自派发 |
| B | submitting、rejected、deferred、unknown 旧请求存在时，本地事实写入仍可用，原处置不变 |
| C | Leader 自写和 reopen 保留外部消息；通知接受只消费固定批次，后来消息保留 pending |
| D | CLI/capability 的跨 Task、替换 Session、撤权、伪造调用上下文和无 Assignment Worker 拒绝；规划交付与资源权限检查 |
| E | 实际 AgentHost→Endpoint→假协议→Controller/SQLite；busy 重试、Host 重启、注册后写入前崩溃、接受回执丢失、拒绝和 unknown 不重放 |
| F | Worker/Reviewer 原始结果经真实采集链保存并生成引用消息；重复终态不重复；缺报告 Review 失败而非自动验收 |
| G | 同 Session 的 A 原生结果不结清 B；原生输入 item、steer receipt、取消及部分输出；Claude 消息 UUID 不冒充 nativeTurnId |
| H | 基准二进制 `c432ad719e17d3b615829db9d2ec0a9115697220` 生成 storage 9 Home；升级保留报告字节、候选、接受关联、倒序 pass 时间的 Context 依赖和原 inbox v1 文件 |
| I | CLI/Context/Web 显示记录状态与准入证据；本地浏览器 1280/390 宽度、键盘展开报告及容器溢出检查 |
| J | 正在执行的 planning Session 发起真实 Gitless activation，无自等待/自 wake；Session、原目录和 planning 权限保持，正式交付仍拒绝 |

`npm run build`、`npm run lint`、`npm run test:core` 通过；core 为原有规模
81 项，测试阶段约 4.6 秒。文档包、54 篇离线 HTML、119 个相对链接和契约
TypeScript 检查通过。正式 Claude Opus 固定候选审查由 Leader 在集成后另行安排。

### Message 续作增量的隔离证据（2026-09-09）

临时协议 fixture 使用公开 CLI、真正的 Controller daemon、SQLite、Codex App Server
协议接受与原始结果采集，不手写 AgentRunResult。合成 Task 与所有 native 进程均在独立
可丢弃 Home 中，未读取 task19 工作区，未调用真实模型作为测试对象。

- 忙时先保存两条消息，原 Run 结束后有序合并为一次续作；未提交文件、原 WorkItem
  `open` 状态、空 Candidate 列表及冻结 effective 保持。
- Controller 重启不重复已接受输入；终态后新的消息自动续作。Provider 发出重复终态和
  不相干 native Turn 的结果，仍只有每个准确 Run 的一份原报告及一条结果引用消息。
- fixture 用自己的真实受管 Session CLI 读取后续 Run Context；新消息和前次结果在有限
  授权集中。Worker 的 `message.send` capability（显式 requestId）复用同一存储和 Leader
  通知入口，不产生隐式 Leader Run。
- 改负责人后旧消息显示 owner-changed；显式停止原 idle Session、正式建立继任执行再
  handoff，原消息保留来源并在同一 WorkItem 继续。退役后迟到消息保留但不执行。
- 同 ReviewRound 的澄清续作保持候选与 effective，Context 的 reviewerRunId 指向新执行，
  两份原报告分别保留。新 Round 接管物理 Review workspace 后，旧 Round 消息不可抢占。
- P1 另以有界 SQLite 状态 fixture 建立 unknown 通知认领（不冒充真实 Provider 故障）：
  原 unknown 仍被保留时，另一 Role 的真实消息执行链可以完成；公开 `wake resolve`
  仅释放认领，原 wake 仍未 consumed、原 unknown 事件不变，后续输入使用新窗口且不重投。
- 补充有界门禁检查：消息续作复用 `requireManagedTaskCaller`，同 Agent 的 revoked
  Leader Session 即使保留 active 标记也被拒绝；替换 native Session 不静默取得原 Assignment。
  已验证 Leader 可在原 Run 仍 active 时修改 open WorkItem 的 objective/acceptance，
  `work.edited` 保留前后值，原 Run、冻结 Context/effective 与业务状态不变；原有资源/
  负责人变更门禁未放宽，已接受或退役的 WorkItem 定义不可改写。

`npm run build`、`npm run lint`、`npm run test:core` 通过，原有 81 项 core 全通过，
测试阶段约 4.34 秒。新增消息卡片元信息复用现有布局；本增量未追加浏览器交互验证。
临时 fixture/scripts 与私有测试进程在交付前清理，未增加永久回归矩阵。
组合候选的正式独立审查仍由 Leader 在固定新 commit 后安排；旧审查不覆盖此增量。

### 采用最新主线后的边界验证（2026-09-09）

采用 `48ffca457d40e8be394d81bbb3435064fa5c31c7`（T08/T09/T10/T11）时，
将本分支未发布的迁移移至 13，原 1–12 的内容与校验保持不变。
用该主线真实构建生成 storage 12 Home 后验证升级：旧 planning Run、其 Session
快照保持 planning，延后激活的 `afterPlanningRun` 仍指向原不透明 ID，
重复 requestId 仍返回原请求。新 planning launch 拒绝 delivery 覆盖。
首次 Draft 请求产生 planning Run，已有 planning Session 的后续通知不新增 Run。

Controller 只携带 Session 已记录的 Endpoint pin；实际 Host 才验证该 pin 是否
属于自己加载的代码。隔离检查覆盖原 pin 重用、异版本 pin 拒绝和引用释放，
未调用真实 Provider。激活遇到已知未结清的原生输入时保留请求并返回冲突，
不以“没有 active Run”冒充原生已经静止。

本轮核心 smoke 为主线已有的 82 项（含插件主路径），未增加永久异常矩阵。
早先 9→10 的验证记录只描述当时的独立开发候选，不是当前部署升级指引。
