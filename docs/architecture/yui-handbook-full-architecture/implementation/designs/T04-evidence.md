# T04 执行接口、采用边界与验证记录

Task：task-16。共同采用基线：
`b7d07394f68ac48a56bc8d03b6d91bf23be98051`。日期：2026-09-07。
本文件记录实现及隔离证据；精确最终提交、独立审查裁定和完成状态以 Task
持久记录为准，不代表远端发布或真实 Provider 验证。

## 采用决定

现有 Codex App Server proxy 与 Claude stream-json 保持原协议实现，
通过 `src/runtime/agentEndpoint.ts` 的统一执行边界供 AgentHost 使用。
Endpoint 不创建第二份 Task、Turn、结果、Controller 或资源账本。
实际接受和原始终态仍经原 Controller 入口及精确 Turn 关联写回原 Store。
产品启动、协议解析和自有连接清理留在 runtime 内；不强制拆包。

Endpoint 提交区分 accepted、pending、not-submitted、unknown；transport
写入不是原生 Turn ID。稳定 attemptId 与 inputRef 指向原输入，重复未知请求
不能产生另一 Provider 写入。持续连接的长提交保留原响应关联；等待时间本身
不证明失败。Scheduler 对 pending 保留 active Turn 和待消费输入，迟到接受
回执再消费同一输入。

取消意图与资源停止证明分开。原有 Session termination guard、精确进程身份、
runtime observation 和资源引用扫描继续负责物理活动证据；Endpoint 的连接
退出不证明共享 daemon 或后台后代停止。未引入全 Task 资源锁或恢复 worker。
Endpoint cancel 与 Host control 是 typed primitive；本次未将原用户停止入口
替换为该取消操作，原停止入口仍要求其原有物理证明。

多路执行使用现有 Assignment、ExecutionGroup、Lane 和 Turn。Leader 通过
`task work synthesize` 或 `task review synthesize` 显式传入 `--source-turn`
选择原结果；完成或 settle Lane 不自动综合，也不以固定成功数判业务失败。
所选结果冻结在既有 Context Snapshot，重试仍保留原 Lane 和输入来源。
Task 层自行接受结果，不由 Endpoint 解析“通过”等文本。

## 调用方与边界

| 入口／消费者 | 采用位置及事实所有权 |
|---|---|
| managed Session 打开、恢复、事件、提交 | AgentHost → AgentEndpoint → 原 structured Provider codecs |
| Role 投递及 Leader steer | 原 runtime prompt port／ExecutorRegistry／Scheduler；pending 不 ack、不重发 |
| Session 恢复配置 | FileRoleLaunchPlanner 使用原 Session 实现引用；Role 当前配置不回填历史 effective |
| 结果采集 | 原 runtime observation → FileSchedulerStoreAdapter → exactTurnTerminalization；结果原文一份 |
| 多路综合 | 原 Task CLI handler 事务显式创建 main Turn，Context Snapshot 保存选定 source-turn |
| 停止与资源 | 原停止 guard 和资源观察，不将取消请求或 Host detach 当成物理零活动 |

T03 拥有 Task／Role 当前配置、Context 和验收；T05 拥有资源、环境及 Artifact。
本分支使用基线已有 typed ports，不从其他 Task 工作区复制内容。Task commands、
Context source refs、工作状态投影及中央迁移是并行合并时需核对的重叠点。
接口及迁移提议已在 task-16 message-2、message-3 记录供 Operator 转达。
尚未集成的并行成果不能据本报告宣称已完成真实集成验证。

## 存储 3 → 4

S14／S35 要求重启后也能辨认原 Session 的实现，单靠进程内对象不足。
因此在现有 RoleAgentSession 增加 `endpointImplementation`，复用 Kernel
`ImplementationRef`，Session payload 5→6；不保存可执行句柄或复制配置图。
同一原生 Session 不能改写该引用；原实现不可用时明确拒绝恢复，要求显式
选择新 Session，而不是把原请求移交另一实现。

中央迁移 `session-endpoint-implementation` 保留 Task／全局 Session 当前值、
历史、effective、原生身份和结果。有效旧记录使用仍保留的内建 Codex／Claude
协议，映射为对应 Endpoint generation 1。普通运行只读当前格式，不双读或
修复手改数据。最低支持 Home 版本仍为 1。

采用须先协调 T03／T05 的连续迁移编号，再用显式 upgrade/update 路径及备份。
本 Task 没有升级共享 Home、安装全局 binary 或重启共享 Controller。
旧 binary 拒读新 Home；恢复备份也不撤销已发生的外部效果。

## 已运行的隔离证据

- 本 checkout `make install-local` 构建成功，仅生成绝对本地 launcher，
  未使用 bare yui，也未创建或操作共享验证状态。
- Scheduler 临时 SQLite 探针：pending 后原 Turn 保持 active、mailbox 输入
  保留；一小时后的调度仍只有一次写入；迟到接受回执消费输入一次。
- 从精确基线独立构建的真实 v3 SQLite Home 迁移到 v4：两个 Provider 的
  Task／全局当前与历史 Session 均保留原值；当前 loader 拒绝未升级 Home，
  旧 loader 拒绝新格式，升级备份在独立目录由旧 loader 成功打开。
- Session 临时探针确认：续用不回写旧 effective，改写原实现引用被拒绝，
  请求不可用实现不会 fallback。

### Endpoint 实现与协议夹具

已执行以下命令，均退出 0；脚本仅为本次开发／审查证据，在审查完成后清理，
不进入永久 suite 或 CI。

```sh
npm run build
node output/t04-endpoint-contract-fixture.mjs
node output/t04-endpoint-fixture.mjs
```

- contract fixture 注入内存 Driver：同 attempt 的进行中提交只写一次；断开
  返回 unknown 后再次 submit 不重发；准确终态可澄清原 attempt；错误 Session
  事件不进入消费者；原始 output 不改写；native busy 保留同请求，明确拒绝
  返回 not-submitted；更改 inputRef 被拒绝；原启动参数及嵌套配置不受外部
  修改；不可用实现和错误恢复意图被拒绝；取消请求不等于附件退出或资源停止。
- protocol fixture 运行实际 `startStructuredProviderSession` 和 Endpoint 代码，
  仅将 Provider executable 替换为本地 Node 子进程。Claude 通过 stdin/stdout
  stream-json 返回原始结果，assert 本地 attempt 关联且没有虚构 nativeTurnId。
  Codex 通过子进程管道上的 WebSocket 运行 initialize、thread/start/read、
  turn/start/interrupt：确认接受前到达的终态归原 attempt；其重复终态在下一
  Turn 活跃期间不改变后继占用；取消 RPC 精确指向当前 nativeTurnId，收到
  interrupt 回执后仍等待独立 cancelled 终态。
- 长 pending 用压缩计时验证：仅将被测进程的 60,000ms observation timer
  映射为 5ms，模拟端点延迟 40ms 回复。20ms 时仍是 pending，之后原请求
  accepted，未因旧观察期限丢弃响应关联。不是实际等待一分钟的负载测试。

contract fixture 最初也以 `node --input-type=module` 内联探针运行；上述文件
将其恢复为可复跑脚本并已重新执行。protocol fixture 的输出分别包含
`claude real adapter fixture passed` 与 `codex real adapter fixture passed`；
这里的 real adapter 仅指仓库适配器代码，不是真实模型或已安装 CLI。
本专项未执行 `codex --version`／`claude --version` 等版本探测，因此不记录
或宣称任何已验证的 Provider CLI 版本、认证状态或真实模型兼容性。

### 独立审查与最终候选

Session pin／中央迁移独立审查未发现确认缺陷；实际恢复 planner 探针确认
不可用实现会在读取当前配置之前拒绝。两项运行路径问题由独立审查指出并修复：

- Review 综合 main 重试原先误走 Producer 重试。现在新 main attempt 复用
  原来源 Group、Context Snapshot 与 workspace，不重开已 settled Producer。
  临时红绿证据覆盖成功来源和包含失败 Producer 的情况；复审关闭该 P2。
- Leader steer 在 pending 之后的迟到回执原先仅留在 Host 内存。现在原
  accepted／rejected／delivery-unknown 事件经过既有 inbox 持久化，Controller
  仅结算精确原 mailbox batch，重复回执不重复追加输入，后继 Turn 不受影响。
  steer 接受或未知不改变父 Turn 的执行投影。复审发现的同步 unknown 响应
  被当作拒绝释放 claim 也已按精确 inputDisposition 修复；复审关闭该 P2。

Leader 接受上述修复及复审裁定，不以子 Agent 的完成声明代替实际候选验证。
构建和 lint 通过；核心 suite 82/82 通过，测试阶段约 4.2 秒，未增长 suite。
真实基线迁移、Scheduler pending、Endpoint contract／codec 和 Review main
重试专项探针均在修复后重新执行通过。

`output/t04-steer-settlement-fixture.mjs` 也已运行通过：真实 publication helper
写隔离 inbox，再以真实 Controller fold 重放 accepted／rejected／unknown；
确认精确 batch、重复幂等、原输入及投影不变。同步 unknown 使用本地 Unix
socket 返回 `ready + rejected + failure.inputDisposition=unknown`，经实际
AgentHostPromptPushAdapter 和 Scheduler 后保留 claim、不重发。该证据使用
Host 响应夹具，不是启动完整 AgentHost／Controller 或真实 Provider。

## turn-1 未覆盖与交付停止线

未运行真实 Codex／Claude 模型、付费 API、生产账户或共享资源 E2E。
协议 fixture、SQLite 和本地进程证据不等于真实模型验证；S18／S19／S41／S43
涉及的 T03 生命周期整合及 T05 资源能力须在合法合并后补充验证。
未接入第三 Agent／ACP、透明会话迁移或动态插件加载。
未 push、创建 PR、merge、tag、release、archive 或启动后续 Task。

## turn-2：已授权真实 Provider 补充验证

2026-09-07，Operator 的 task-16 message-6 明确授权独立环境中的少量真实
Provider 请求，覆盖先前“不运行真实 Provider”的限制，其余停止线保持。
请求模型固定为 Codex `gpt-5.6-luna`、Claude `opus`；不修改开发 Agent、
全局配置、认证或共享服务，不切换模型、Provider、路由或服务档位。

### 隔离与验证范围

源码初始为 `bec6ba81efa143d0f29bf2339c9f9306f725ad2c`；Codex 预检修复后
使用 `3a2432ec19c27c6a748f3a0c4afde3d61762f928`。
重新执行 `make install-local`，所有测试 CLI 均使用该 checkout 的绝对
`output/dev/bin/yui` 路径、清除继承的 YUI 会话环境并显式指定独立 Home。
临时根目录为 `/tmp/yui-t04-live-*`，workspace 与 Home 分离。

使用实际 Adapter compiler、Endpoint、Codex App Server proxy／Claude
stream-json codecs、structured publication、独立 Controller RPC、
FileSchedulerStoreAdapter 与 SQLite。Controller 只处理回执及 inbox 排空，
不启用 scheduler 自动调度；因此不宣称完整 AgentHost 启动／调度 E2E。
setup 自动启动的测试 Controller 在接管前正常停止，无共享 Controller 操作。

Codex 启动自有 App Server，proxy 通过 `--sock` 连接该测试 Unix socket，
不连接或停止共享 daemon。Claude 使用 `--safe-mode`、空工具与 MCP 集合、
短 system prompt，避免加载真实业务上下文。既有合法认证由原 CLI 使用，
未打印或复制密钥。两个提示只要求输出 `T04-CEDAR-728` 及在后续 Turn
回忆该标记，不授权工具、文件或业务外部操作。

### 实际结果

| 项目 | Claude | Codex |
|---|---|---|
| CLI 版本 | `2.1.258 (Claude Code)` | `codex-cli 0.153.4` |
| 请求模型 | `opus` | `gpt-5.6-luna` |
| 原生配置回报 | init：`model_hub/es1_orange_o50` | thread response：`gpt-5.6-luna`，Provider `metabridge` |
| 实际结果模型标签 | assistant：`claude-opus-5`；usage：`model_hub/es1_orange_o50` | 无成功模型结果；路由返回 `404 Model not found` |
| 接受与归档 | 两次 transport 接受，随后真实 completed 终态均精确归档 | provider 接受及 nativeTurnId 已取得，随后 failed 终态精确归档 |
| 同 Session 恢复 | 自有进程退出后 resume 原 native Session，正确回忆标记 | 未运行：当次请求 404 后停止，身份修复复测见下文 |
| Store 关闭后 CLI 读回 | 两个原 Turn 的输出与 attempt 均通过 | 原 failed Turn、nativeTurnId 和错误均通过 |

上述模型字符串只是原始回报标签，不能据此推断官方产品版本或模型等价性。
未设置 fallback，也未因错误换模型或路由。

Claude native Session：`0ce6456f-62b7-4803-806a-7a06723711b4`。
隔离 Turn 的原始回执（时间为 UTC）：

- `turn:task-102/turn-1`：accepted `09:33:15.464Z`，
  completed `09:33:20.104Z`，Store `09:33:20.112Z`。
- `turn:task-102/turn-2`：resume 后 accepted `09:35:18.352Z`，
  completed `09:35:21.344Z`，Store `09:35:21.351Z`。

两个输出均为 `T04-CEDAR-728`。Claude 没有可靠 nativeTurnId，使用原
attempt 与 client-owned transport 精确关联，未用 result UUID 虚构 Turn。
第一次验证脚本同步 CLI 调用阻塞了自身 Controller；这不是 Provider 失败。
修正夹具后直接恢复原 Session，未重发已完成输入；两条历史结果最终均读回。

Codex native Session：`01a07b3a-6724-7363-a3cb-3f8b8476ec39`；
native Turn：`01a07b3a-685c-7780-9d00-d9f55b8b1838`；
attempt：`turn:task-101/turn-1`。provider accepted `09:37:00.515Z`，
failed `09:37:09.308Z`，Store `09:37:09.316Z`。
原始诊断：`unexpected status 404 Not Found: Model not found`；
路由为本机 `localhost:8318/v1/responses`，
request id：`20260907173709815550DC4814E15E758C`。
模型目录可见或 thread/start 接受模型名不等于实际推理可用。

### 发现、修复与审查

两个新 Codex Session 在模型输入写入前收到
`-32601: list_turns is not supported yet`，Endpoint 明确返回 not-submitted。
根因是提交前忙闲检查不必要地请求全部历史 Turns。现在该检查仅请求
`thread/read(includeTurns:false)`：active 即使无 Turn ID 仍阻止默认提交，
unknown／notLoaded／systemError／读取异常均零写入。历史结果读取保持原合同；
未把不支持历史读取的错误忽略为成功，也未添加重试或 fallback。

临时 `t04-read-status.mjs` 先复现红灯、修复后通过；独立 Agent 复审未发现
确认缺陷，Leader 接受该裁定。依赖历史读取的 steer／continuation／历史恢复
在该路由上仍可能不可用，不能由本次修复推断通过。
修复后 build、lint、核心测试 82/82 通过（测试阶段 4.24 秒），未增加永久测试。

### 消耗、清理与未覆盖

Claude 两个 result 的 CLI 报告费用合计 USD `0.009875`，不是账单确认：
主请求 input/output tokens 分别为 `210/12` 与 `247/12`。
首次 CLI 另报告 `model_api/experimental_0821` 的 `988/82` tokens、
USD `0.00699` 辅助用量（包含在上述总额内，`costBasis=unknown`）。
该辅助用量不算 Opus 主请求证据；后续启动明确指定测试名称，第二次只报告
Opus 路由用量。Codex 未返回 token／费用用量，不能断言消耗为零。
实际发送了两个 Claude 主输入与一个 Codex 主输入，没有循环重试。

所有测试 Endpoint 自有进程均取得退出回执；Codex 自有 daemon 退出码 0。
Claude 在 completed 后 detach，进程退出码 143；这是承载退出，不是取消
真实 Turn 的验证。隔离 Controller 已关闭；核对无这些测试目录关联的进程。
必要脱敏回执保留在本节，临时夹具与隔离 Home 清理不影响真实 Task。

未真实验证取消、故意制造 unknown／迟到结果、原生多客户端竞态或长负载，
这些仍仅有 turn-1 隔离夹具证据。Codex 成功输出、同 Session 后续请求及
恢复在当次 404 后未覆盖，不宣称两 Provider 全场景真实 E2E 通过。
T03/T05 合并集成和中央迁移编号协调仍由 Operator 后续处理。

### Codex 初始化身份修复与 Luna 复测（2026-09-07）

当次 404 不能证明 Luna 不可用。历史 `01f0afb4` 使用
`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_exec` 保持非交互执行身份；
改为连接 daemon 的 proxy 后，proxy 进程的环境变量不能决定 daemon
发出的请求头。失败 Session 的原生日志确认为 `originator=yui`。

使用 Codex CLI `0.153.4`、自有 daemon、实际 proxy 与本地假 HTTP
服务捕获请求头（无真实模型调用），得到以下证据：

- 首次初始化 `clientInfo.name=yui`，即使 proxy 环境覆盖为 `codex_exec`，
  实际请求仍为 `originator=yui`。
- 同一 daemon 随后初始化 `codex_exec`，请求仍保留首次的 `yui`；
  不能将后续连接初始化视为对现存 daemon 的修复。
- 新 daemon 首次使用修复后的统一初始化，实际请求为
  `originator=codex_exec`，User-Agent 主身份同样为 `codex_exec`。

修复将 managed Session、配置探测、Thread 命名统一使用
`clientInfo.name=codex_exec`，保留 Yui title/version，
保持 `requestAttestation=false`，删除无效的 proxy 环境覆盖。
不伪造 attestation、不改认证、模型名或 relay，不新增状态与恢复协议。
独立只读审查未发现需修改的问题。修复后 build、lint 与核心 82/82
通过（测试阶段 4.24 秒），未增加永久回归夹具。

在此前明确授权范围内，仅追加一个真实 Luna 输入，经实际
AgentEndpoint → App Server proxy → 自有 daemon → 原有 metabridge 路由：

- native Session：`01a07b59-a521-70f3-8571-d1808464cb47`。
- native Turn：`01a07b59-a8b0-7231-8293-f2bb2d5025b2`；
  attempt：`identity-luna-1`。
- provider accepted：`2026-09-07T10:11:08.599Z`；
  completed：`2026-09-07T10:11:16.819Z`。
- client-owned 终态输出精确为 `T04-LUNA-IDENTITY-OK`。
- 原生日志：`originator=codex_exec`，Provider `metabridge`，
  Turn model `gpt-5.6-luna`。这是配置与原生回报标签，
  不独立证明 relay 后端模型权重身份。
- 原生 token_count：input `35320`（cached `3328`），output `28`
  （reasoning `13`），total `35348`；未报告费用，不推断账单。

本次只复测改变的 Endpoint 初始化与真实推理路径，未重跑完整
Controller／Store 归档、resume、取消或 Claude；这些证据仍按上文分别界定。
自有 Endpoint 与 daemon 均退出码 0。未重启或改变共享 daemon；
若共享实例已被旧身份初始化，部署代码本身不会清除其进程内身份，
需由 Operator 在安全维护窗口处理，不能宣称现存共享实例已修复。

### 主线集成（2026-09-07）

同步 `origin/master` 至 `36bf511`（含 `c655cc6`），保留主线以 Session／Process 身份
替代启动 generation 的设计。Endpoint cancel、迟到 steer 结算及 pending
投递路径改用当前身份合同；未恢复已移除的 activation／generation 状态，
也未重新引入自动 synthesis。

主线迁移 4 `session-and-process-identity` 和迁移 5 `project-resource-artifacts`
原样保留；本任务尚未发布的 Endpoint 迁移顺延为 6，
`introducedIn=0.15.8`。因此上文的 3→4 是独立分支验证时的编号，
最终集成合同为 3→4→5→6。内存 SQLite 验证升级后保留原生身份、模型快照及当前／历史 Session，
正确移除旧运行身份并写入 Endpoint 实现引用。

集成后的独立只读审查未发现阻断问题；不以合并或发布授权代替真实模型
验证授权，未重复调用 Provider，也未操作共享 Controller／App Server。
build、lint 与集成后核心测试 81/81 通过（测试阶段 4.37 秒）；
数量变化来自主线移除旧 generation 回归，并非跳过失败测试。

### 采用环境执行集成（2026-09-07）

在 `129801f` 对应主线内容上补齐 T04×T05：`task role update --environment`
或认证能力 `environment.bind` 显式选择已经 adopted 的目录 preparation。
`--managed-environment`／null 明确清除选择。绑定只改变 Role desired，
Session／Turn effective 冻结 preparation、environmentRef、目录身份与访问
限制；原生 Session 不能因 desired 改动而切换环境。

启动规划、Host 原生启动／恢复及每次 Yui 输入检查现行采用、资源意图、
grant 原 reservation 和 path/device/inode。Codex Thread 与 Claude 子进程
使用选定目录作为 cwd，不自动附加原 managed Git 根；Yui 的原 managed
workspace 继续承载控制上下文和 Git 所有权，不被改写成第二份资源记录。
目录被替换、released 或授权撤销时明确拒绝，不回退或自动重新 adopt。

release 检查精确 Session／Turn 环境引用，复用原 Provider 未结算输入及
continuation 投影：Host ended 不等于 native quiescent。复审指出的
“Host 已退出而输入 accepted/unknown 仍可释放”路径已纳入释放检查。

中央 migration 7 `adopted-agent-execution-environment`（目标 0.15.8）
为可选绑定合同，已有 migration 1–6 不变。有效 v6 隔离 SQLite 迁移后
旧 Role 和已 adopted preparation 保持原值，没有隐式选择；普通旧格式
读取明确要求升级。

隔离证据使用真实 Store、Adapter compiler、Endpoint 和本地假 Provider，
不请求真实模型：Codex 协议 Thread cwd 与子进程 cwd 一致；Claude 子进程
cwd 一致；两个协议完成输入并在 detach/resume 后继续使用原环境，
即使 Role desired 已解绑。目录替换拒绝、grant 撤销拒绝、同一采用不重复
消耗 grant、跨 Task／Global 绑定拒绝、CLI 原子回滚和释放检查均有临时证据。

边界：empty 没有原生 cwd，拒绝选择并提示 scratch；read 环境仅允许显式
Codex read-only/never，Claude 不伪造文件系统只读能力；write 保持既有
原生权限，是 trusted-local 而非强沙箱。此集成不控制桌面端等外部原生
客户端直接发出的后续输入，不接入远程环境或凭据解析器。

最终 build、lint、核心 81/81 通过（4.33 秒），没有新增永久专项测试。
独立复审通过；释放回归使用实际资源服务／Provider Binding／continuation
投影与轻量 Store 替身，验证 ended Host、无 turnId 的未结算输入、
history Session、detached continuation 均阻止释放，exact quiescent 后允许
释放。该项不冒充 SQLite 集成；启动／恢复和迁移另使用真实隔离 SQLite。
未运行真实模型、未升级共享 Home、未发布或重启共享服务。

2026-09-08 PR 集成同步至 `97ad888`（T03 #316）。主线迁移 1–8 原样
保留，环境绑定迁移由独立开发时的 7 顺延为 9；普通旧数据仍不自动绑定。
代码从最新主线仅移入本次环境提交，避免重复包含已经 squash 合入的 T04
历史。此集成未运行真实模型、升级共享 Home 或重启服务。
