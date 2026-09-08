# T07 ACP 接入实现与验证记录

Task：task-19；基线：`97ad88849c9a496230b134d2955f5f23e96deaa3`。日期：2026-09-08。
本文件记录实现位置、采用入口与隔离证据。精确交付提交、独立 Review 裁定和
接受状态以 Task 持久记录为准；不表示远端合并、共享环境升级或真实模型验收。

产品选择与无模型 CLI 探测证据由 Leader 单独记录在同目录的
`T07-cli-probe.md`（提交 `eeea9e8`，保留在集成分支）。本文件不重复也不改写
其结论，也不在本分支复制该文件。

## 1. 实现位置与唯一所有者

新增一个 `acp` adapter，不是每个产品一个。哪个 executable 在管道另一端
是启动描述的事实，因此第二个 ACP 产品复用同一份代码，Task、Controller
与结果归档都不增加产品分支。

- `src/runtime/acpProtocol.ts` 负责 v1 编解码与能力读取；
  `src/runtime/jsonLineChannel.ts` 是 NDJSON 载体；
  `src/runtime/acpSession.ts` 持有协议 Session 身份与提交／取消语义。
- `src/executor/agentAdapter.ts` 的 `AcpAdapter` 编译启动；
  `src/executor/agentConfigurationProbe.ts` 用一次 `initialize` 发现配置，
  不创建 Session、不发送 prompt。
- 六处原先按 adapter 名字判断的边界改为读取声明能力，因此同一修复对三个
  adapter 同时生效：`interruptDelivery`、`nativeSessionDiscovery`、
  `agentHost` recoverability、`canonicalLifecycleEvent` fence、
  `findAgentAdapter`、`defaultRoleAgentConfig`。
- `agentAdapterLabel` 取代四处重复的三元展示分支。

三个身份分开保存：JSON-RPC request id 只关联本管道上的一对消息；
Yui `attemptId` 是持久的本地请求；ACP `sessionId` 是 Agent 自己的原生
Session 身份。ACP v1 没有原生 Turn 身份，因此不生成 ID 冒称 native。

## 2. 六项审查发现的处置

`turn-2` 候选（`7dc9fa8`、`8c67b7c`）被裁定未通过。以下修复在同一 WorkItem
内一次完成，逐项独立复核根因后取最小一致改法，不是让夹具变绿：

| # | 发现 | 根因与处置 |
|---|---|---|
| P1-1 | `agentAdapter` 拒绝 `additionalDirectories`，而 planner 对 Project 绑定的配置无条件加入 | 拒绝改为 `validatePaths`。字段是 ACP 真实的 session 生命周期字段；是否发送由每次连接协商决定，在此拒绝会让所有多根 Project 启动在询问 Agent 之前就失败 |
| P1-2 | ACP `compileNew` 继承空 `launchContextArgs`，`developerInstructions`／manifest／skills 全部丢失 | ACP 不接受任何 Yui 参数，也没有 system prompt。新增 `acpSession.sessionBootstrap`，随首个 prompt 送达；manifest 形式仍是指针，正文经 manifest 自己的 Context API 读取 |
| P1-3 | terminal 不带 `output`，正常回答被归档为 `missing-result` | `agent_message_chunk` 按 attempt 累积为该 Turn 的答案。thought／tool-call／plan 解码为其他 kind，不进入答案；超过持久上限整条丢弃而非截断 |
| P1-4 | 管道写入被当作 `accepted`，断连后不更新为 unknown | 提交在收到 prompt 响应前不结算：长 Turn 由调用方自己的期限报 pending，先死的传输报 unknown。接受时 acceptance 由 `transport` 升为 `provider`——Agent 确实回答了这一请求 |
| P2-5 | 静态 Driver `exact` resume 与协商出的 `loadSession=false` 矛盾 | 静态表保留（`managedRuntimeAdmission` 在 adapter 级、握手之前运行，降级会挡住该 adapter 上的每个 Agent）；真实答案由 live Session 的 `conversationRecoverability` 在握手后给出，Endpoint 优先采用它 |
| P2-6 | 只要本地 `cancelRequested` 为真，任何 RPC 错误都被改写成 `cancelled` | 不再记忆本地取消意图。ACP 只有一种取消证据：成功响应上的 `stopReason: "cancelled"`。取消请求之后返回的错误仍是 Agent 报告的那个错误 |

## 3. 采用入口与能力矩阵

adapter 通过 T02 能力目录发现，用 T04 的普通执行请求创建 Turn，
结果沿同一归档路径保存。注册使用原有命令，没有 ACP 专用入口：

```text
yui config agent add <agent-id> --component claude-agent-sdk --command <acp-executable>
yui config agent add <agent-id> --adapter acp --command <acp-executable> --arg acp
yui config agent capabilities <agent-id>
yui task role add <task> <role> --agent <agent-id>
```

第一行是 WorkItem-2 之后的推荐写法：命名执行组件即可，连接方案由组件唯一
决定，无需再写 `--adapter`。第二行仍然有效，只声明连接方案而不声明产品，
记录为 `unknown-acp-agent`——这正是既有绑定的读法（见第 7 节）。

开发验证必须把上面的 `yui` 换成本 checkout 的绝对 launcher 并使用隔离 Home。
`capabilities` 走一次真实 `initialize`，据此报告该 Agent 的实际字段可用性，
不发送 prompt 也不创建 Session。ACP 的 `additionalDirectories` 目前只由
planner 从 Task 的 Project 绑定自动填入，没有面向 ACP 的手工 CLI 开关：
既有 `--add-dir` Role 选项仍限于 codex/claude 两个 first-class adapter。

| | codex | claude | acp |
|---|---|---|---|
| `interruptDelivery` | native | owned-process | native |
| steer | fenced | unsupported | 拒绝（ACP v1 无 Turn 内追加输入）|
| `nativeSessionDiscovery` | runtime | preallocated | runtime |
| managed Session 原生 Turn ID | 有（`turn/started` 的 `turn.id`）| 无 | 无 |
| Hook 路径原生 Turn ID | 有 | 有（`prompt_id`）| 不适用（ACP 无 Hook）|
| Conversation 恢复 | 静态 exact | 静态 | 按连接协商 `loadSession` |
| 权限 | 可配置 | 可配置 | 只能拒绝 |
| `additionalDirectories` | 支持 | 支持 | 按连接协商，未声明则不发送 |

`nativeTurnId` 一行更正 `turn-2` 的说法：它当时写作 codex/claude 都为 `yes`，
把 Hook 路径与 managed structured 路径混为一谈。实际上
`ClaudeStructuredProviderSession.activeTurnId` 恒为 `undefined`——
stream-json 的 `result.uuid` 是消息身份，不是执行身份。三者中只有 Codex 的
managed Session 有真正的原生 Turn 身份。ACP 的缺失因此不是该产品的短板，
而是协议事实：一个 Turn 就是一次 `session/prompt` 请求，它的响应就是终态。

声明为不支持的部分按实际表现返回：长 prompt 保持 pending；连接丢失是
`unknown` 且永不重发（重复提交被拒："Provider Conversation already has an
unsettled Turn"）；cancel 返回 `requested` 而不是停止证明；
提供 `allow_always` 的权限请求一律回 `reject`。

## 4. 存储版本与并行集成边界

本次新增可持久化的 `acp` adapter／配置合法值，包括可选的
`additionalDirectories`。Role 绑定与 effective launch 快照读取时会重新
校验，因此需要中央版本转换声明，不能以“没有 storage diff”代替版本判断。

本分支基线为 storage 8，追加连续迁移 **8 → 9**
`acp-session-workspace-configuration`（`introducedIn=0.15.8`，最低支持仍为 1）。
迁移不改写任何载荷：storage 8 基线尚无 ACP 绑定，既有 Codex／Claude
配置及 Session 历史无需转换，既有迁移的 checksum 不移动。额外目录是否
真的送达某个 Agent 由连接协商决定，不增加第二份持久配置事实。

**编号 9 供并行集成协调**：T06（task-18）、T09（task-20）与本 Task 并行，
最终合并后的迁移链必须连续，编号由 Operator 统一协调；不得重写已发布迁移。
本 Task 没有升级共享 Home，没有重启共享 Controller，没有手工修复数据。

## 5. 实际证据

全部验证使用一次性 SQLite Home、可丢弃 Git 仓库和本地子进程；
**零真实模型、零外部资源、零付费配额**。临时夹具已在交付前删除，
不进入永久 suite；永久测试只更新当前存储版本预期。

### 受控 ACP 子进程链路

一个手写的 ACP Agent 子进程（无模型、无网络、无凭据，模式由 `argv` 决定）
驱动真实 Planner → AgentHost/Endpoint → 既有 Controller 发布／inbox／fold →
SQLite 原 Turn 结果。四个场景共 **31/31** 通过：

- **capable-normal（10/10）**：planner 把两个真实 Git Project 根作为 ACP
  workspace roots 送达，Agent 实际收到；Manifest bootstrap 实际到达模型输入；
  Controller 把 Host 的真实 Session fold 进持久状态；原 Turn 记录归档
  Agent 的真实答案（`status=completed`，
  `output="ACP-ANSWER-PART-1;ACP-ANSWER-PART-2"`），不是 `missing-result`；
  内部思考从不进入持久记录；进程 cwd 为 Project 工作区根。
- **minimal-normal（7/7）**：同一份 planner 输出、同一份代码，只换启动描述。
  未声明 `additionalDirectories` 的 Agent 在协议报文里确实没有收到该字段
  （`[wire] additionalDirectories=undefined`），`loadSession` 缺失被记为
  `unknown` 而非 recoverable，答案仍正常归档，bootstrap 仍送达。
  第二产品差异因此由协商能力产生，不是由产品名分支产生。
- **capable-hang（8/8）**：沉默的 Agent 让提交控制悬空；60001ms 后按 Host
  自己的 accept 期限结算为 `pending`（`state=starting`），从不报 accepted；
  在途输入持久绑定到该 Turn 与 attempt
  （`{"turnId":"turn-1","attemptId":"run:task-1/turn-1","status":"submitting"}`）；
  pending 的 Turn 不归档任何结果。
- **capable-die（6/6）**：Turn 中途断连报 `delivery-unknown`，不报“肯定未接受”；
  fold 自己写出的 `runtime.agent-error` 事件把 unknown 处置与该 Turn 持久关联
  （`turnId=turn-1 disposition=unknown`）；未观察到的答案不被归档为结果。

夹具不直接构造带 output 的 terminal，也不单独调用 SQLite store 伪造链路；
上述持久事实都是既有 fold 与 store 的输出。

### 采用入口实测

隔离 Home、绝对 launcher、`env -i` 清除继承环境，用真实 CLI 走完注册与发现：

- `config agent add ... --adapter bogus` 报
  `Supported adapters: acp, claude, codex`——`acp` 是一等 adapter 选项，
  不是隐藏路径。
- 同一份代码、同一条命令注册两个 ACP 产品，只有启动描述不同。
  `config agent capabilities` 对声明 `additionalDirectories` 的产品报
  `available`；对未声明的产品报
  `unavailable: This ACP Agent does not advertise ...`，并附带
  `session/load` 缺失的目录警告。差异完全来自握手协商，不来自产品名。
- 指向一个不是 ACP Agent 的可执行文件时，注册仍成功但明确降级为
  `Runtime capability request failed ... only fallback and custom values can be
  offered`，不伪装成一次成功探测。

### 存储连续性

Worker 的模拟证据：在一个含内容的新 Home 上，删除迁移行 9 后运行
`runStorageUpgrade({mode:"apply"})`，实际完成 8 → 9；升级后账本读作
`1,2,3,4,5,6,7,8,9`，head 为 `acp-session-workspace-configuration`，
既有 Task 原样保留。这是模拟前版本账本，不是真实旧版生成的 Home。

Leader 在 turn-5 补充了真实前版本证据：使用 Task main 的 storage 8
代码（`eeea9e8`）创建一次性 Home，保存 Task 和 Codex／Claude 两个配置，
关闭 Store 后由候选 `9fd17e2` 的升级入口执行 8 → 9。新 reader 在升级前
拒读；升级后 Task 标题与两种 Agent 配置均原样保留；旧 reader 拒读升级后的
Home。升级入口生成了备份。探针没有删除账本行，也没有操作共享 Home；
探针专属 Home 与备份已清理。

### 常规验证

最终候选上执行 `npm run build`、`npm run lint` 均通过；
`npm run test:core` **81/81**（约 4.44 秒）。这些检查未发现旧路径回归，
不代表重新验证了全部 Codex／Claude 真实 Provider 场景。

### turn-5 独立复审

原独立审查者复核 `8c67b7c → 9fd17e2` 的修复及直接调用关系，关闭六项
发现，未发现修复引入的重大运行缺陷。其临时内存协议探针确认两轮输出
隔离、foreign／thought 排除、bootstrap、未声明目录不发送、live recovery
unknown、响应前 pending、断连 unknown 和取消后保留真实 RPC 错误。
Leader 独立管道探针交叉验证了相同关键语义。两者均无模型调用。

受控集成 `integration-2` 经依赖准备、lint 和目标引用 CAS 成功，
保留 Task main 的 CLI 探测文档。此前 `integration-1` 因新集成工作区
没有依赖、`tsc` 不存在而以 127 退出，未推进目标；失败记录未删除。
Leader 随后同步额外目录的 TypeScript 类型及规范化副本，补正文档矩阵。
最终 `make install-local`（含 build）与 `npm run lint` 通过；
清除继承 YUI 环境、使用临时 Home，分别运行
`node --test test/core/core-smoke.test.js`（47/47）与
`node --test test/core/checkoutSwap.test.js test/core/project-lifecycle.test.js`
（34/34），覆盖全部 81 项而未重复已通过用例。额外目录规范化副本的
临时探针也通过。所有永久测试保持原规模。

## 6. 验收对照与未验证项

S11、S12 由 capable-hang／capable-die 与身份分离覆盖；S24 的 busy 与输入控制
由 unsettled-Turn 拒绝覆盖；S35 的“新 Session 选择实现”由两个产品共用同一
adapter、按连接协商能力覆盖。这些是隔离夹具证据，按统一验收说明的口径，
场景状态仍不由本 Task 单方面改判。

未验证项，按 T07 设计第 6 节“真实测试未执行时明确标注”如实列出：

1. **没有任何真实模型调用**，也没有认证过的 ACP Turn。本批次未授权把真实
   Provider／付费配额作为测试对象；task-16 的真实模型授权不转移到本批次。
2. **Kimi 的实际证据止于 `initialize`。** Leader 的 `T07-cli-probe.md` 记录了
   真实进程的版本、help 与一次 `initialize` 响应，包括它声明的
   `loadSession`、`sessionCapabilities.additionalDirectories` 与 `authMethods`。
   `turn-2` 曾把 `session.new`／permission／cancel 也写成“real-process
   verified”，这是把真实 Kimi 证据与夹具证据混在了一起：这三条路径**只有
   fixture 证据**，Kimi 上没有原始证据。产品文档描述支持，但文档不是本机
   已执行行为。
3. **Turn 归档的证据等级已提升但仍非真实产品。** `turn-2` 称归档只在库级别
   （`SqliteTaskStore` + `createCanonicalLifecycleEvent`）验证过，未跑 Controller；
   本轮的链路夹具确实驱动了真实 Controller 与原 Turn 结果路径，该项不再成立。
   但驱动它的仍是手写协议对端，不是任何真实产品。
4. **pending／unknown／取消／无原生 Turn ID 的全部行为均为 fixture 证据。**
   手写 Agent 是忠实的协议对端，不等于真实产品在负载下的表现。
5. 未真实验证 `session/load` 的实际 resume 行为、并发原生输入竞态、
   权限交互的真实产品往返，以及取消后的物理静止。

如后续获得针对性资源授权，建议单独验证一条受控本地资料输入的真实 Turn
结果归档，并按需要选择恢复、取消与权限交互的精确范围。这不是索取授权的
请求，也不构成阻塞项。

本节自查不代替独立最终 Review。本授权不包括 push、PR、merge、tag、release、
archive 或启动后续 Task。

## 7. WorkItem-2：执行组件与连接方案分离

基线 `e0fcd244fe659e155a50265747641d683ae3b9ee`。本节只记录本 WorkItem 的
改动，不改写前六节的裁定。

本节为 turn-10 返工稿。turn-8 候选
`e8466d2f3a22da80818941cbd99085d3780fb25a` 被 message-10 以四项确定缺陷
驳回：迁移 10 漏掉 `turns.payload.effective` 与两处 ExecutionLane（真实
v9 Home 升级必失败回滚）、Role 创建／切换丢弃 component、component 变更
错绑、`handshake` 被 `validateCatalog` 丢弃。四项均已修复，且每一项都先在
改动前的构建上复现缺陷再验证消失；旧候选与审查记录保留。

### 7.1 为什么加一个轴而不是改名

`adapterId` 混装了两件事：产品是谁，以及 Yui 用什么协议／载体连上去。
第二件事它答得准确，第一件事答不了——Claude Code CLI、Claude Agent SDK
和任意第三方 Agent 都从 `acp` 进来。把 `adapterId` 改名成产品名会同时
损坏它答得准确的那件事，而它在 60 个文件、653 处被引用。

因此保留 `adapterId` 作为**连接方案 id**，另加一条 `component` 轴。
组件唯一决定方案（单向、全量），所以**只有一份权威绑定可写**，不存在
可自由拼装的组合图。命名用实际执行的 CLI 或 SDK，不用 "native"。

- `src/agent/executionComponents.ts`：`codex-cli`、`claude-code-cli`、
  `claude-agent-sdk`、`unknown-acp-agent`，各自声明所属方案与 `identified`。
- `src/agent/connectionPlan.ts`：protocol／protocolVersion／transport／
  handshake 四元组。不协商的方案显式写 `handshake: "none"`，不是省略。
  `launchBroker` 原本自带的 transport 表已删除，改为向该模块求值。

Claude Code CLI 的 stream-json 与经 `claude-agent-acp` 的 Claude Agent SDK
是**两套接入实现**：不同可执行文件、不同启动与认证面。本改动只给它们各自
的身份，不假设两者配置或能力等价。Codex 目前只有 AppServer 一个运行时，
因此只登记 `codex-cli` 一个组件，不臆造第二个引擎。

### 7.2 调用链

```text
config agent add --component X
  → resolveAgentExecutionComponent(adapterId, X)   # 唯一解析点，跨方案即报错
  → createConfiguredAgent(... component)           # ConfiguredAgent.schemaVersion 3
  → createRoleAgentBinding(agent)                  # RoleAgentBinding.component
  → resolveEffectiveLaunch(role)                   # EffectiveLaunch.schemaVersion 4
  → sessionContinuitySnapshot(...)                 # 含 component → 旧 Session 固定
  → roleSessionMayContinue(existing, desired)
```

### 7.3 字段与迁移契约

| 记录 | schemaVersion | 新字段 |
|---|---|---|
| `ConfiguredAgent` | 2 → 3 | `component` |
| `RoleAgentBinding` | 不变 | `component` |
| `EffectiveLaunchSnapshot` | 3 → 4 | `component` |

storage **9 → 10** `agent-execution-component`（`introducedIn=0.15.8`），
一条连续中央迁移，不改 1–9，不双读旧形状。回填规则只有三条：
`codex→codex-cli`、`claude→claude-code-cli`、**其余一律
`unknown-acp-agent`**。命令字符串不作为证据——名叫 `claude-agent-acp` 的
可执行文件可能是包装器或别的东西，据此猜成 ClaudeSDK 就是给未经验证的
事实贴确定标签。配置变更只影响**新** Session；旧 Session 由自己的 effective
快照固定，`component` 进入连续性快照正是为此。

迁移覆盖面以**升级校验器实际重放的校验器清单**为准，共 8 张表：
`configured_agents`、`task_roles`、`global_roles`、`role_session_sets`、
`global_role_session_sets`（`sessions` 与两种形状的 `history`）、`turns`、
`work_items.executionGroups[].lanes[]`、`review_rounds.executionGroup.lanes[]`。
`turns` 与两处 Lane 是 message-10 指出的遗漏：`validateEffectiveLaunchSnapshot`
要求 `schemaVersion 4`，任何存有 Turn 历史的真实 v9 Home 都会因此升级失败并回滚。
未派发的 Lane 没有 `effective`，必须保持缺席。`context_snapshots` 由摘要锁定，
`AgentProfile` 与 `TaskFinalReviewContract` 不带 component，三者均不迁移。

**变更与拒绝**：`component` 与 `adapter` 同属身份轴。被 Role 绑定或 Profile
引用的 Agent **拒绝**变更任一者，提示新建 Agent 显式绑定；未被引用的可自由
变更。仅给 `--adapter` 时 component 按新方案重解（ACP 得
`unknown-acp-agent`）。schema 10 之后 loader 不再把缺失 component 当历史
兼容：`ConfiguredAgent` 与 `RoleAgentBinding` 各自在读取时拒绝该记录；
而构造函数仍允许省略参数——操作者只声明方案是受支持的请求，与读取已写入的
损坏记录是两回事。

`catalogFingerprint` 补入 `component`。**更正**：先前称"否则两个 ACP 产品会
共用同一条能力缓存"是错的——该指纹本就含 `command` 与 `baseArgs`，两个产品
只要可执行文件不同就已分属不同缓存条目（在改动前的构建上实测，缓存目录确为
两条）。`component` 的真实作用是覆盖命令相同而产品声明不同的情形，并让缓存
条目按产品身份显式失效，而不是修一个原本不存在的串用缺陷。

`handshake` 由 `validateCatalog` 校验并**保留**（此前被重建对象丢弃，
live 与缓存回读两条路径都取不到）。三态显式区分：`unsupported`（该方案
不协商）、`observed`（已协商，能力可为空）、缺席（从未尝试）；
无法识别的 status 拒绝而非放行。

### 7.4 协议事实更正

原文案称 "ACP negotiates no model or reasoning effort" 与 "ACP does not
expose a model catalog"。核对 ACP v1 规范后确认这是**错的**：协议定义了
`session/set_mode` 与 `session/set_config_option`，Session Setup 返回的
`configOptions` 含 `mode`／`model`／`model_config`／`thought_level` 语义类别。
当时限制在 Yui 这一侧，文案先改为陈述实现现状（"Yui's ACP client does not
implement session/set_config_option"）。

**turn-13 起该实现限制已不存在**：客户端接通了
`session/set_config_option`（旧式 Agent 走 `session/set_mode`），
`AcpAgentConfig` 因此接受 model／effort／`configured` 模式与显式 bypass。
推送点固定在 Session 建立之后、首个 prompt 之前——ACP 只在 Session 存在后
才报告可配置面，而 prompt 一旦先发就会以 Agent 默认值运行却显示用户的选择。
任一拒绝直接中止启动：**被拒的配置对应零个 prompt**，不降级、不换模型。
每个轴在轮到它时对 Agent 当前的完整选项列表解析，全部步骤落地后再按
Agent 最后一次报告的列表校验所有显式请求值；"调用成功但当前值不同"按替换
处理并失败。（turn-13 的实现只按初始列表一次性定好步骤，因此后一次调用重置
前一个轴时报告与事实不符——见 §10.1、§10.3。）

权限同理：ACP 定义了权限选项，Yui 未接通交互式同意，因此**保留对
`session/request_permission` 的显式拒绝，不自动放行**——API 授权与工具
权限是两件事。bypass 仅在用户显式选择时生效；`default` 一律不发送任何 mode，
既有 `default` 绑定的语义不被加宽。bypass 的具体 mode id 是产品事实，
按执行组件声明为数据（`claude-agent-sdk` → `bypassPermissions`）；
`unknown-acp-agent` 故意不在表内，因此对未识别产品请求 bypass 是显式拒绝，
**不按 mode 名称猜测**。model 列表需要真实 Session 才能枚举，
普通能力查询因此停在 `initialize`，不为了填菜单制造可能计费的远端副作用。

`AgentHandshakeObservation` 把真实握手与静态支持分开：不协商的方案是
`{status:"unsupported", reason}`，ACP 是 `{status:"observed", ...}` 并带
protocolVersion／能力／authMethods；缺失值显式为 `unknown`，不留空。

### 7.5 证据

全部使用一次性 Home、绝对 launcher、`env -i` 清除继承 YUI 环境；
**零真实模型、零凭据、零外部资源**。临时夹具已删除，未新增永久历史回归测试。

验证方法统一为：**先在改动前的构建上复现缺陷，再在改动后的构建上以同一串
命令确认缺陷消失**。下文一律以"断言通过／断言失败"直述，不把失败的断言
写成通过的验收。

**（1）迁移 10 —— 真实 v9 Home 原地升级**

夹具用**基线构建自己的工厂函数**写入 3 个 Agent（含命令字面为
`claude-agent-acp` 的旧 ACP 绑定）、1 个全局 Role（对象形 history）、
2 个 Task Role、经 `resolveEffectiveLaunch → createTurn → saveTurn`
的 2 条真实 Turn、2 组 Task Session（数组形 history），以及 1 个含
双 Lane ExecutionGroup 的 WorkItem（两条 Lane 分属不同连接方案）。
不是"删账本行"的模拟。

改动前：`upgrade` **退出码 5**，
`Effective launch snapshot must use schemaVersion 4`，Home 从备份回滚，
复现了复审所述失败。改动后同一夹具：

```text
Storage upgraded through 9->10 agent-execution-component.
TURN turn-1  sv=4 acp/unknown-acp-agent      TURN turn-2  sv=4 codex/codex-cli
SESS  live+hist ×3 组（数组形与对象形 history 各自覆盖）  sv=4
LANE work-item-1 acp-worker sv=4 acp/unknown-acp-agent
LANE work-item-1 codex-worker sv=4 codex/codex-cli
AGENT legacy-acp acp/unknown-acp-agent cmd=claude-agent-acp
```

应迁移的表由 `upgradeOrchestrator.validateCurrentStore` 实际重放的校验器
清单确定，不是按字段名扫描用户数据；`context_snapshots` 摘要锁定、
`AgentProfile`／`TaskFinalReviewContract` 不带 component，均**未**编造迁移。
未派发的 Lane 保持无 `effective`（`json_set` 会造出被 Lane 校验器判为残缺的
半快照）。命令字面为 `claude-agent-acp` 的旧绑定**保持
`unknown-acp-agent`**。升级后 `doctor` 全绿
（`storage schema ok current=10 latest=10`，`agents=3 tasks=1 roles=2
globalRoles=1`），重跑幂等；专用差分器比对升级前后 8 张表 12 行：
**非 component 差异 0**。

**（2）Role 创建／切换保留 component —— 真实 CLI**

经真实 `yui` 可执行文件而非构造对象：`config agent add sdk-agent
--component claude-agent-sdk` → `task create` → `task role add`。
改动前，Agent 记录为 `claude-agent-sdk`，而 `leader` 与 `sdk-worker`
两条绑定均被降级为 `unknown-acp-agent`（复现）；改动后同一串命令，
两条绑定均为 `claude-agent-sdk`。`task role bind` 切换路径同样覆盖：
三个不同产品（`claude-agent-sdk`／`unknown-acp-agent`／`codex-cli`）
各自如实落库，通用 ACP Agent 未被命令字符串猜成产品。
`createRoleAgentBinding` 的参数由 `component?` 收紧为必填，
使遗漏调用点成为编译错误而非静默默认。

**（3）component 变更：引用中拒绝，未引用可改**

真实 CLI 矩阵（退出码为实测值）：

| 操作 | 结果 |
| --- | --- |
| 被 Role 引用的 Agent 改 component | **拒绝**，退出码 2，库内 Agent 与绑定均未变 |
| 被 Role 引用的 Agent 改 adapter | 拒绝，退出码 2（原有行为未回归） |
| 未被引用的 Agent 仅 `--adapter` 切换 | 成功，退出码 0，component 按新方案重解 |
| 未被引用的 Agent 改 component | 成功，退出码 0 |
| 被引用 Agent 的非身份变更（`--arg`） | 成功，退出码 0 |

改动前，前者静默成功——Agent 变为 `unknown-acp-agent` 而两条 Role 绑定
仍宣称 `claude-agent-sdk`（复现）；`--adapter` 单独使用则因保留旧
component 而报
`component codex-cli is reached over the codex connection plan, not claude`，
连未被引用的 Agent 也无法换方案（复现）。现改为：引用中一律拒绝并提示
新建 Agent 显式绑定，旧 Session 由自己的 effective 快照固定不变；
`--adapter` 单独使用时按新方案重解 component（ACP 得
`unknown-acp-agent`，不从命令猜产品）。
`fileRoleLaunchPlanner.#compile` 增加 component 一致性检查，
使"新命令配旧产品标签"在启动前即失败。

**（4）loader 不再把缺失 component 当历史兼容**

schema 10 之后，缺 component 的记录是损坏而非陈旧。在真实升级后的 Home 上
剥掉字段实测：改动前 `config agent show` 照常输出且
`Component: undefined (undefined)`；现在 Agent 与 Role 绑定各自以自己的
消息拒绝（`Agent is missing its execution component`／
`Role Agent binding is missing its execution component`），
仅剥绑定时 Agent 仍可正常读取，健康 Home 无误报，`test:core` 未因此失败。
构造函数允许省略参数是另一回事（操作者只报方案是受支持的请求），
两者已分开处理。

**（5）handshake 贯通 —— 真实 `CatalogService.resolve` 与缓存回读**

注入 discovery 以免联网，其后的校验、缓存落盘、指纹、缓存回读全是发布代码；
共 11 条断言。改动前 **6 条失败**（live 与缓存回读均取不到 handshake、
`unsupported` 被抹去、非法 status 被原样放行）；改动后 **11 条全部通过**：
live 与 cache 两条路径取到的 handshake 逐字节相同，`unsupported`
与"已观测但能力为空"保持可区分，"从未尝试"仍为缺席第三态，
无法识别的 status 被拒绝并降级为 fallback。

**缓存条目更正**：见 7.3。"两个 ACP 产品会共用同一条缓存"的原说法有误——
在**改动前**的构建上实测，命令不同即已分属两条缓存条目（该断言在改动前后
均通过，因此它证明的是原说法有误，不是本次修复的成果）。

**常规验证**：`npm run build`、`npm run lint`（`tsc --noEmit`）通过；
`npm run test:core` **81/81 通过、0 失败**，规模未变。

### 7.6 本 WorkItem 未验证项

1. **没有任何真实 Provider 调用。** 真实 Claude ACP 测试由 Leader 单独授权
   与执行；本 WorkItem 只产出代码与隔离夹具，不安装、不认证、不调模型。
   上文 ENOENT 降级来自本机确实没有这些可执行文件，属预期。
2. `claude-agent-sdk` 组件的真实握手、认证面与能力矩阵**未经真实进程验证**。
   计划中的 `@agentclientprotocol/claude-agent-acp` 0.75.1
   （ClaudeSDK 0.3.257 / ACP SDK 1.4.0）是届时的测试对象，**不作为内核
   永久版本限制**写入代码。
3. 组件轴不改变任何 codec 行为，因此未重新验证 Codex／Claude 的真实
   Provider 场景；`test:core` 通过只说明既有路径未回归。
4. 上一候选（turn-8）的 7.5 曾把"本改动 4/4 **失败**"写成验收通过。
   该表述已删除：那是断言失败，不是验收。本次全部证据改为直述实测退出码与
   通过／失败条数，并且每一条都在改动前的构建上先行复现过缺陷。
5. `review_rounds` 的 Lane 迁移由隔离 SQL 与真实升级校验器覆盖，
   但夹具 Home 中没有 ReviewRound 行（WorkItem 组要求每条 Lane 都有
   launch facts，未派发 Lane 的情形属于 review 组）；该路径**未经真实
   ReviewRound 数据端到端验证**。

### 7.7 手册 HTML 未重新生成

本节只改了 Markdown 源与 `MANIFEST.json` 校验和。`index.html` 与
`full-architecture.html` 由 `tools/build_html.py` 从 Markdown 生成，需要
`pandoc` 与 `beautifulsoup4`，本机两者都不存在，本 WorkItem 也不安装系统包。
因此两个 HTML 仍是上一版内容，**不包含第 7 节与第 3 节新增的
`--component` 采用行**；Markdown 源是权威。
`tools/check_docs.py --write-manifest --typecheck --write-result` 通过
（`typescript: passed`，`errors: []`）——该校验核对包完整性与 Markdown 结构，
不比对 HTML 与 Markdown 的正文差异。取得 pandoc 后重新生成即可消除该滞后。

## 8. turn-11：集成、复审与已授权 Claude ACP 真实验证

本节记录用户追加要求后的交付，不把此前无模型探测或 Worker 夹具升级为
真实证据。用户在原 Leader 会话明确要求按组件／协议划分修改并运行
Claude ACP 真实测试；该授权与第三方 API、模型及隔离边界记录在
task-19 message-7，Operator 的 message-6 要求按这一具体授权接续。
真实验证只使用 Claude，不继承其他 Task 授权，也没有使用 Kimi 资源。

### 8.1 修复与最终代码候选

`e8466d2` 的四项审查问题由原 Worker 在 `6e7cac6` 修复。
原独立审查者复核完整修复及直接关系，四项均关闭，未发现本修复引入的
重大问题。其内存 SQLite 验证覆盖 Turn、WorkItem Lane、Review Lane，
确认未派发 Lane 不会被制造出 effective，也不会被聚合为 JSON 字符串。

Leader 另外使用真实 storage 9 构建创建带已完成 Turn 和 Role 的一次性
Home，再使用候选执行 9 → 10 升级：原 Turn 输出逐字保留，Role 和 Turn
均获得正确组件，旧 reader 拒读新版。原先同一场景的失败已消除。

`integration-3` 通过显式依赖准备、lint 后，以 CAS 快进至
`6e7cac6236daa379b49b8ceb6e312a78166c9067`。
本 checkout 的 `make install-local`（含 build）成功；清除继承的 YUI
变量、使用临时 Home，完整 `node --test test/core/*.test.js` 对应的三个
文件一次执行，**81/81 通过，0 跳过**（测试阶段约 4.28 秒）。
手册 HTML／Manifest 在 Leader 收尾时重新生成，消除 §7.7 的历史滞后。

### 8.2 固定版本、配置来源和测试范围

| 项目 | 实际值 |
| --- | --- |
| Yui 代码 | `6e7cac6236daa379b49b8ceb6e312a78166c9067` |
| 配置的执行组件 | `claude-agent-sdk` |
| 连接方案 | `acp`，ACP v1，stdio |
| ACP 实现包 | `@agentclientprotocol/claude-agent-acp` `0.75.1` |
| SDK | `@anthropic-ai/claude-agent-sdk` `0.3.257` |
| SDK 捆绑的运行组件 | Claude Code `2.1.257` |
| 用户既有模型选择 | `opus[1m]` |
| 用户既有 Opus 路由映射 | `model_hub/es1_orange_o50` |
| 两次实际选择回报 | 均为 `opus[1m]` |

依赖只安装在 Task main 的临时 `output` 工具目录，没有全局安装。
认证使用用户现有 Claude settings 的 API 环境项；在测试前只比较了
进程与该配置中的 API 地址／凭据一致性，没有输出密钥。测试子进程使用
空的独立 HOME、CLAUDE_CONFIG_DIR、TMPDIR 和工作目录；没有复制共享
hooks、插件、历史 Session 或 OAuth 登录。
API 环境值只在进程内传递，没有写进 Yui Agent 配置或证据文档。

受控启动包装器调用已安装包公开的 `runAcp`，只通过该包的
`_meta.claudeCode.options` 配置 Session：固定标题、固定既有模型、
`settingSources: []`、`tools: []`、`maxTurns: 1` 和短测试 system prompt。
未修改已安装的 ACP／SDK 代码，也没有伪造任何 Provider 输出。
固定标题用于避免 ACP 包默认的额外小模型标题生成；原生 transcript
确实保存了测试标题。没有执行模型回退或更换网关。

这验证的是明确配置的 SDK 接入路径，不是默认 Claude Code CLI
全部功能或全部配置等价性。因为禁用了工具，本次不验证编码工具权限交互。

### 8.3 实际结果与归档链

日期：2026-09-08；以下时间均为 UTC。
两次请求使用同一原生 Session：
`ca8ecadf-cb8d-4ece-9a61-4ef1900f01d9`。

| 隔离 Turn | 行为 | 接受／终态观测时间 | 原 Turn 结果 |
| --- | --- | --- | --- |
| `task-1/turn-1` | 新建会话，要求记住并输出指定标记 | `07:08:08.984Z` | completed，输出精确为 `T07-CLAUDE-ACP-CEDAR-914` |
| `task-1/turn-2` | 第一进程退出后 `session/load` 原 Session，要求回忆标记 | `07:08:12.347Z` | completed，输出精确为同一标记 |

执行链为：实际 Agent 配置与编译器 → 原 AgentEndpoint／ACP codec →
上述受控启动的真实 ACP 包 → SDK／捆绑运行组件 → 既有第三方 API →
原 `publishStructuredProviderAccepted`／`publishStructuredProviderTerminal` →
真实隔离 Controller RPC → 原 `FileSchedulerStoreAdapter` fold → SQLite。
两个结果不是由夹具构造的 terminal，也没有直接向数据库填充输出。
关闭并重新打开 Store 后，两个原 Turn 均保留完整输出和
`component: claude-agent-sdk`；ACP 的 `nativeTurnId` 保持缺失，没有伪造。

测试显式创建隔离 Task／Role 并调用编译器与 Endpoint；Controller 仅服务
真实 observation RPC 和生产 fold，没有启动自动调度。因此本次不声称
完整 Scheduler／AgentHost 自动派发或模型实际读取 Yui Context 的端到端验收。
这些与此前的受控完整链路夹具是不同的证据范围。

### 8.4 用量、清理与剩余边界

只提交了 **两个真实主输入**。原生 transcript 记录两个 assistant 消息，
回报模型标签均为 `claude-opus-5`，input/output tokens 分别为
`261/23` 和 `344/23`，没有 tool call、WebSearch 或 WebFetch。
这些是路由返回的标签和计数，不独立证明网关后端模型权重身份。
ACP 的两次结果分别回报费用 USD `0.00188` 和 `0.002295`；
这是 Provider 报告，不是账单确认，不据此推断完整账户消费。

两个自有 ACP 进程退出码均为 0，隔离 Controller 已关闭；
进程检查未发现相关测试进程残留。测试 Home、原生测试历史、临时脚本和
工具依赖在保留本节脱敏证据后清理，未影响共享 Home、认证或服务。
前置夹具第一次因测试程序漏用 `saveActiveTurn` 而被 writer fence 拒绝，
发生在任何模型输入之前；修正夹具后先通过本地对端，再进行上述真实请求。

已真实覆盖：初始化、同模型新会话输出、跨进程恢复原 Session、第二 Turn、
实际结果经 Controller 归档和 Store 重开读回。
仍未真实覆盖：取消／物理静止、工具权限往返、原生并发输入竞态、
长负载下的 pending／unknown、完整自动调度和共享配置等价性。
不将本次两请求验证描述为全场景 E2E，也没有开展 Codex 或 Kimi 模型测试。

## 9 ACP 运行配置接通（turn-13，work-item-3）

> 本节的候选已被独立复审驳回。§9.2、§9.5、§9.6 有越界结论，
> 已在 **§10.1** 逐条更正；返工与新证据见 §10。

### 9.1 本轮改的是什么

不是改名，是把普通 Yui 配置入口接到真实协议效果上。此前 `AcpAgentConfig`
一律拒绝 model／effort／非 `default` 权限，理由写成"Yui 的 ACP 客户端未实现
`session/set_config_option`"。本轮实现了该方法（旧式 Agent 走
`session/set_mode`），因此该限制不再存在，四条入口命令改为被接受并真实生效。

`selectedComponent`／`connectionPlan` 的唯一绑定未动，用户的 `Agent.id` 未变。

### 9.2 推送点与拒绝语义

配置在 `AcpStructuredProviderSession.open()` 内、`session/new`／`session/load`
之后、任何 `submitTurn` 之前推送。这不是巧合而是唯一正确的位置：ACP 只在
Session 存在后才报告可配置面，而先发 prompt 会以 Agent 默认值运行却显示
用户的选择。任一拒绝直接抛出，因此**被拒配置对应零个 prompt**。

通用轴由 ACP 自己的 `category` 元数据解析（`model`／`thought_level`／`mode`，
以 id 兜底），Yui 从未见过的 Agent 走同一段代码。唯一的产品事实是 bypass 的
mode id，按执行组件声明为**数据**而非分支（`claude-agent-sdk` →
`bypassPermissions`）；`unknown-acp-agent` 故意不在表内。Task／Controller
不含任何产品特判。

Agent 返回的完整选项列表逐项确认；"调用成功但当前值不同"按替换处理并失败，
不吞字段、不静默换值、不靠显示伪造。

### 9.3 存储迁移 10 → 11

持久契约确实变宽（ACP 绑定可携带 model／effort 与 `bypass`／`configured`
+`mode`），因此追加迁移 11 `acp-session-run-configuration`，1–10 未改。

按迁移 9 的先例做**声明式加宽**，不重写任何 payload——这是实质决定而非省略：
v10 的 ACP 绑定持 `permission.strategy = "default"`，其含义原本就是"Yui 不发送
任何 mode，Agent 自己的默认成立"，改写它等于授予用户从未选择的权限。
effective 快照无需变更：`model`／`effort` 本就在共享基类上可选，ACP 权限就是
适配器规范化的同一对象，历史快照在 schemaVersion 4 下继续通过校验，覆盖
Session、Session history、Turn、WorkItem Lane 与 ReviewRound Lane。

真实 v10 Home 原地升级（一次性 Home，`env -i`，绝对 launcher）：升级前
`doctor` 三项 `unsupported`（`current=10 latest=11 migration=available`），
`upgrade` 报 `10 → 11 acp-session-run-configuration` 并留备份；升级后账本
`1..11`，`doctor` 全绿（`current=11 latest=11`，`agents=1 tasks=1 roles=2`），
重跑为 `already-current`（幂等）。关键一项：升级后经真实 Store 读回，
`leader` 与 `worker` 两条既有 ACP 绑定仍为
`permission={"strategy":"default"}`、`model=undefined`、`effort=undefined`
——**旧默认权限未被加宽**。随后在同一升级后的 Home 上，用户显式
`--model opus --effort high --permission-strategy bypass` 被接受，而未被触碰的
`leader` 仍是 `default`。

### 9.4 红→绿（同一串真实 CLI 命令）

基线为 `git archive HEAD` 解出的**干净 HEAD 构建**，不是只回退两个文件的
半改动树（后者一度给出全部"接受"的假绿，已弃用）。两次均为一次性 Home。

| 命令 | 改动前（HEAD，v10） | 改动后（v11） |
| --- | --- | --- |
| `--model opus` | 拒绝："does not implement session/set_config_option…" | 接受，`model=opus` |
| `--effort high` | 同上拒绝 | 接受，`effort=high` |
| `--permission-strategy bypass` | 拒绝："supports only the default permission strategy…" | 接受，`bypass` |
| `--permission-mode acceptEdits` | 拒绝："only supported by Claude." | 接受，`configured`+`mode` |
| 不带选项 | 接受，`default` | 接受，`default`（未变） |

### 9.5 隔离协议对端测试

临时对端 `fake-acp-agent.mjs`（无凭据、零模型），逐条记录收到的方法、
被要求应用的配置值，以及**prompt 到达时生效的配置**。每例都从真实入口出发
（`yui` 子进程或 `runTaskCommand`）→ 落库 → 重开 Home 读回 → 编译 →
对端实际所见，不用理想内存对象绕过入口。10 项全通过：

CLI 配置的 model／effort／mode 三项均以 `session/set_config_option` 到达对端，
且顺序被断言为 transcript 事实（`session/new` < 三次 set < `session/prompt`）；
`session/prompt under mode=acceptEdits,model=opus,effort=high`。
对端拒绝 effort 时零 prompt；对端"成功但保留旧值"被判为替换并失败；
`default` 一个 set 都不发；显式 bypass 以 `bypassPermissions` 到达；
对端不提供 bypass 时显式拒绝；`unknown-acp-agent` 即使对端存在字面名为
`bypassPermissions` 的 mode 仍拒绝（不按名猜测）；旧式对端走 `set_mode`
而不发 `set_config_option`；`session/load` 恢复后两个 prompt 均在正确配置下；
clear+`default` 回到"不发任何请求"；codex 专属选项在 ACP 上被 CLI 拒绝且未落库。

绿测试单独不算证据，故做变异验证：给 `unknown-acp-agent` 加上 bypass 映射
→ 仅"不按 mode 名猜测"一例失败；跳过配置推送 → 8 项协议用例失败、2 项纯 CLI
用例正确保持通过；吞掉 plan 拒绝 → 2 项 plan 侧拒绝用例失败（对端 JSON-RPC
错误走请求路径，由另一用例覆盖，两类拒绝各有归属）；跳过确认 → 仅替换用例失败。
四次变异后均已还原并复验全绿。

### 9.6 一致性与边界

能力面：model／effort／`permission.mode` 为 `degraded`（可配置，取值按
Session 协商），`permission.strategy` 为 `available` 且列出三值；ACP 无
`settingsFile`／`settingsSources`／工具规则字段。离线兜底目录返回 ACP 自身形状
（`adapterId: "acp"`），`permission.mode` 不预填候选——modeid 来自实时 Session，
在此列举等于凭构建期猜测编造 Agent 词汇表。向导对 ACP 只问 mode 且选项来自
目录，不再生成固定 bypass；权限策略取自能力字段而非硬编码。

model 列表需要真实 Session 才能枚举，普通能力查询因此停在 `initialize`：
为填菜单去建 Session 会造成可能计费的真实远端副作用。这是"静态可配置"与
"协商后可用"的区别，按真实原因陈述，不伪装成产品无此能力，也不吞掉请求值。

删除 `src/cli/roleOptionCatalog.ts`：经完整 importer 追踪，除 `orderRoleOptions`
外全部导出零引用，是无人读取的第二配置权威。仅存的展示助手移入
`roleOptionOrder.ts` 并注明不持有配置权威。真实权威仍是
`commands/roleConfiguration.ts`，未新增第二处。顺带修掉两个真实缺陷：
`permissionPatch` 的兜底原为硬编码 `{strategy:"bypass"}`（改为
`defaultRoleAgentConfig(...).permission`），且 ACP 原会落入 Claude 分支被写入
工具数组；向导探测绑定原会对 ACP 构造非法配置。

`runtimeEventInbox` 对 ACP 的排除**未改**，经核为正确：`RuntimeTurnTerminalInput`
的 `adapterId` 类型为 `"codex" | "claude"`，ACP 按设计无原生 Turn id。

本轮**未做真实模型测试、未读共享凭据**；此前两次 Claude ACP 真实测试不因本次
泛化而被重新授权。仅本 W3 工作区、本地 launcher 与隔离 Home；未改共享 Home、
Controller、认证或全局安装；未 push／PR／远端合并／打标签／发布。
不声称与产品完整功能等价：本轮验证的是配置推送与确认路径，工具权限往返、
取消与并发竞态仍未真实覆盖。

收尾：`npm run lint` 干净，`npm test` **81/81 通过**（维持既有规模，
未新增永久回归测试），临时夹具与临时测试在交付前删除。
手册 HTML 由 Leader 重新生成，本节只更新 Markdown。

## 10 turn-15：驳回后的三处返工（work-item-3）

turn-13 的候选被独立完整复审驳回。本节先更正 §9 越界的结论，再给出穿透
Planner 的新证据。同 Role／同 Session，无新 WorkItem。

### 10.1 对 §9 结论的更正

§9.5 称"每例都从真实入口出发……不用理想内存对象绕过入口"。**这句话当时不成立**，
必须按下列三点读：

1. **那 10 项测试没有穿透 Planner。** 它们在 Session 夹具里手工提供了
   `providerControl.component`。而真实的 `FileRoleLaunchPlanner` 两个分支
   都没有填这个字段，`structuredProviderHost` 于是转发 `undefined`，ACP 侧解析为
   未识别产品。也就是说：**一份普通的 `claude-agent-sdk` + bypass 配置在真实
   Session 里必然失败**，而测试因为自己补了这个字段而看不到。§9.5 的"从真实入口
   出发"只覆盖了 CLI 到落库这一段，没有覆盖落库到启动载荷这一段。
2. **§9.2 的"逐项确认"只在单步内成立。** 当时 `#applyConfiguration` 依据
   `session/new` 的初始列表一次性定好全部步骤，之后不再重算。所以后一次调用
   重置前一个轴时，每一步的确认都通过、`open` 成功、`appliedConfiguration`
   仍报告用户请求的值——报告与事实不符。反向同样错：只有换了模型才出现的
   effort 取值会被提前拒绝。
3. **§9.6 关于能力面的描述与代码不一致。** 探针把 model 轴报为
   `models=[] + available=true`（延迟枚举、允许自定义输入），但
   `validateCatalog` 仍以"models 为空"判定不完整，于是真实的
   `AgentConfigurationCatalogService.resolve` 落到兜底目录并附
   "Agent configuration model catalog is incomplete"，把实时握手与探针给出的
   真实原因一起丢掉。§9.6 描述的是意图，不是当时的行为。

另外，§9.5 缺少动态选项列表与目录校验两类覆盖，本轮补上。

### 10.2 P1(1) Planner 携带执行组件

`fileRoleLaunchPlanner.ts` 的 start 与 restore 两个分支各补
`component: binding.component`。取值可信不靠约定：`binding` 来自本次启动
所依据的固定快照（`activeRoleAgentBinding`），且此前已有
`configured.component !== binding.component` 的显式校验。

按要求遍历该字段的**全部实际消费者**，而不是只加一个接口字段。第三处消费者
`runtime/agentHost.ts` 的 Codex 重连路径原本从零重建 control 并丢掉该字段——
一个 Session 生命周期中途悄悄丢掉产品身份——已一并修正为透传。
`launchBroker.validateProviderControl` 原有的一致性校验未动：非法组件、
或组件与 `adapterId` 相互矛盾，仍然拒绝。

**未**在测试里补 `component` 来掩盖问题：新证据一律从真实 CLI 配置取值。

### 10.3 P1(2) 按最新状态解析，并在 prompt 前校验全部值

`planAcpSessionConfiguration` 与 `AcpConfigurationPlan`（一次性计划）删除，
改为每个字段在**轮到它时**对当前完整列表解析
（`resolveAcpConfigurationField`），全部步骤落地后再按 Agent 最后一次报告的
列表校验**所有显式请求值**（`verifyAcpConfiguration`）。顺序是有界且固定的
`model → effort → permission`：model 会重定义其他轴，permission 放最后因为
它的错值等于授出权限。**没有无界重试或自动修复循环**——有界显式顺序加一次
最终确认即可。

对只能应答的旧式 mode-only 对端，如实区分"确认过"与"仅被接受"：
`confirmation` 有 `already`／`observed`／`acknowledged` 三态，
`session/set_mode` 不返回选项列表，因此只记 `acknowledged`，
且**不把请求值写回缓存列表**——那样做等于制造协议本身拒绝给出的确认，
最终校验会把 Yui 自己的假设当成 Agent 的报告读回来。**从不伪造 `observed`。**

### 10.4 P2(3) 目录完整性按当前字段契约判定

`validateCatalog` 中"models 为空即不完整"改为
`models.length === 0 && !modelAxisIsAccountedFor(fields)`。判据是 `model`
字段**是否明确陈述了 `available`**：

- `available: false` —— 该轴不存在，`reason` 说明原因；
- `available: true` —— 该轴存在但取值延迟枚举（ACP：列出模型需要真实
  可能计费的 Session）；
- **未陈述** —— Codex／Claude 的形状，它们成功时把模型写进 `models`，
  所以空列表确实意味着发现失败，仍然拒绝。

判据不能用 `allowCustom` 或"是否可自定义"：Codex（probe:113）与
Claude（probe:192）同样是 `allowCustom: true`，那样会把它们真正损坏的目录
判为合格。实时握手与 `reason` 的透传、以及缓存读回路径共用同一段校验，
因此三条路径一致。**没有 all-catch 或兜底遮蔽**：真正缺失的目录仍然落兜底
并带原因。

### 10.5 证据（穿透 Planner，共 21 项，全部通过）

两个临时测试文件，均为一次性 Home、临时 HOME、绝对 launcher、无凭据对端；
**零真实模型、零凭据读取**。命令：

```
node --test test/tmp/acp-run-configuration.test.mjs        # 14 项
node --test test/tmp/acp-catalog-resolution.test.mjs        #  7 项
```

链路是完整的：真实 `yui config agent add --component` ／
`yui config system set` ／ `yui task create` ／ `yui task role update
--model --effort --permission-strategy` → 重开 Store
（`openConfiguredTaskStore`）→ 真实 `resolveEffectiveLaunch` → 落 Turn →
**真实 `FileRoleLaunchPlanner.plan`** → 真实
`validateAgentHostLaunchPayload` → 真实 `startStructuredProviderSession` →
无凭据 ACP 对端。**start 与 resume 两半都走完**（resume 通过真实
`createRoleSessionSet` + `recordRoleAgentSession` 记录 Session 后再规划，
因为 Planner 拒绝凭空造 Session）。

P1(1)：真实规划的 start 载荷携带 `component=claude-agent-sdk`
与 `desiredConfiguration={model:b,effort:high,permissionBypass:true}`；
resume 的 restore 载荷携带同一 component；broker 拒绝与 adapter 矛盾的组件；
bypass 以该产品自己的 `bypassPermissions` 到达对端，三轴均 `observed`；
`unknown-acp-agent` 请求 bypass 被显式拒绝。

P1(2)：effort 先被满足、换 model 后被重置 → 以
`set model=b` 在前、`set effort=high` 在后重新下发，prompt 在
`<model=b,effort=high,mode=normal>` 下发生；只有新 model 才提供的 effort
**未被提前拒绝**；`mode` 重置了已确认的 model → 报
`ACP Session run configuration did not hold.` 且 **零 prompt**；
替换值在其所在步骤失败；对端不提供的 mode 被拒并列出真实取值
（`Offered values: normal, plan`）；旧式对端得到且仅得到
`[["permission","acknowledged"]]`，`observed` 一次都没有出现。

新增/resume 与报错覆盖：resume 经 `session/load` 后按重载 Session 的当前
状态应用配置，prompt 在 `<model=b,effort=high,mode=bypassPermissions>` 下
发生；resume 的失败与 start 同形且零 prompt；拒绝信息同时给出轴、请求值
与 Agent 自己的取值列表。

P2(3)：真实 `AgentConfigurationCatalogService.resolve` 对
`models=[] + available=true` 返回 `source=live`（此前是 `fallback`），
`failure=undefined`，实时握手完整保留
（`agentName=fake-acp-agent`、`protocolVersion=1`、`capabilities=[loadSession]`），
且不含兜底目录的 "Runtime configuration catalog is unavailable."；
每个延迟轴的 `reason` 都到达调用方（`available: false` 与 `true` 都被接受，
且仍然是两种不同的答复）；缓存写盘后令发现失败 → `source=cache`
且握手与 `available` 原样读回；一份 Codex／Claude 形状（未陈述 `available`
且 `models` 为空）仍然被拒并落 `fallback`。
**向导实测**：真实 `resolveRoleWizardArguments` + 真实 `agent.capabilities`
端口，脚本化终端选到自定义模型，产出
`--agent acp-fake --model sonnet-x --effort high`（该命令随后真实执行并读回
生效），全程**没有出现** "Runtime capability request failed"／
"Runtime configuration catalog is unavailable"；同一段脚本在探针真的不可用时
**会**打印这两条警告——所以前一例的"没有出现"是解析结果的事实，
不是脚本化终端的假象。

绿测试单独不算证据，故做六次变异，每次都重建 `dist` 后复跑：

| 变异 | 结果 |
| --- | --- |
| 删掉 Planner 两处 `component` | 11 项中 **7 项失败**（含 start／resume／bypass 到达／旧式对端） |
| 删掉最终全值校验 | 仅"mode 重置已确认 model"失败 |
| 改回按初始列表一次性解析 | 恰好复审点名的两项失败（effort 被重置、effort 仅新 model 提供） |
| 旧式分支把 `acknowledged` 写成 `observed` | 仅旧式对端一项失败 |
| `validateCatalog` 恢复"models 为空即不完整" | 目录 7 项中 **4 项失败** |
| 判据改用 `allowCustom` | 仅"Codex／Claude 空目录仍被拒"失败 |

第一次变异即是复审的结论本身：普通配置在真实 Session 里必然失败。
六次变异后全部还原并复验 21/21 全绿。

### 10.6 边界

迁移 11 经复审无缺陷（未重写 payload、旧 `default` 未加宽、快照往返与
方向明确），本轮**未改动**；1–10 未改。之前怀疑的 grouped options
本轮**未被确认为缺陷**，因此不处理，也不为推测中的未来矩阵扩面。
`runtimeEventInbox` 对 ACP 的排除仍然未改。

本轮**未读共享凭据、未调用真实模型、未改共享服务或全局配置、
未 push／PR／远端合并／发布／归档**。默认权限未放宽，bypass 仍必须显式；
model／effort／权限的 Session 副作用失败时不发 prompt、不换值、不换模型、
不换路由。仅本 W3 受管工作区、临时 HOME 与绝对本地 launcher。

不声称与产品完整功能等价：本轮验证配置推送、确认与目录解析路径，
工具权限往返、取消与并发竞态仍未真实覆盖。

收尾：`npm run lint` 与 `npm run build` 干净，`npm test` 81/81 通过
（未新增永久回归测试），临时夹具与临时测试在交付前删除。
手册 HTML 由 Leader 重新生成，本节只更新 Markdown。
