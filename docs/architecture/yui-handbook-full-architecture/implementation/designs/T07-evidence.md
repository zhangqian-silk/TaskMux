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
yui config agent add <agent-id> --adapter acp --command <acp-executable> --arg acp
yui config agent capabilities <agent-id>
yui task role add <task> <role> --agent <agent-id>
```

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
