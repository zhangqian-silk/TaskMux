# T11 Session 实现固定与使用边界热插拔

Task：task-27。基线：`013ffdc3154c18974f64c66b05ade018feb63c2b`（`feat(plugins): add
validated Task-local SDK and persistent enable intent (#320)`）。精确交付 commit 和
完成裁定以 Task 记录为准。本变更不包含发布授权。

本文件是对 candidate-1（`914073e`，未被接受）的修正证据。message-2 提出的
F1/F2/F3 与证据缺口逐项处理见下；**上一版的部分结论已被本轮实测推翻，相应
文字一并改正，不保留原先的过度声明**。

## 上一版被推翻的结论（先行更正）

| 上一版写法 | 本轮实测 |
|---|---|
| "`yui doctor` 正确拒绝 fake proxy：缺少 `--config`、`resume` 能力"，据此判定公共入口全链路"受禁止付费验证约束未覆盖" | **错误。** doctor 的 Agent 检查是对 `--version` / `--help` 的只读探测：最低版本见 `agentAdapter.ts:223`（codex `0.150.1`），必需能力面是 `missingRequiredCapabilities`（`agentAdapter.ts:766-787`，codex 仅需 `--config` 与行首 `resume`）。绝对路径本地夹具实现这两个能力面后 doctor 全绿（`agent:faux2:command ok version=0.150.1`、`agent:faux2:capability ok`），不需要付费模型。公共入口全链路本轮已真实覆盖 |
| 后续 Turn 的持久 Turn 发布"属 task23 边界"，仅断言"只允许在此拒绝" | **错误的归因。** 那是本 Task 自己的配置缺口，不是外部阻塞。本轮完整配置隔离 Task 并**真实完成了后续 Turn**（见下），不再以拒绝充当通过 |
| `generation` = 四个手写模块字节摘要，"每进程只计算一次" | 手写清单无法声称覆盖完整；且首次调用才读盘时，加载 A 之后磁盘换成 B 会把自己标成 B。已改为发布包字节摘要 + 模块加载期一次解析（F3） |

## 交付与复用边界

| 已有设计 | 本轮接入方式 |
|---|---|
| `src/kernel/instanceHost.ts` | 直接复用同一个 `InstanceHost` 类；attach/acquire/release/detach、引用计数、`drained`、一次性 `#dispose` 与身份保留语义全部沿用，**未修改该文件** |
| `src/release/runtimeRelease.ts` | 复用既有不可变发布与 `detectRunningRelease`；**未新建配置框架，未重做 T07 配置层** |
| `src/runtime/tmuxAdapters.ts` / `src/tmux/tmuxManager.ts` | 复用既有生产采用链，未新增第二套 Registry/Host |
| `src/runtime/agentEndpointIdentity.ts` | `generation` 改为运行发布包摘要（F3） |
| `src/runtime/agentEndpointOwnership.ts` | 真实退出驱动引用释放（F2） |
| `src/executor/fileRoleLaunchPlanner.ts` | resume 携带 Session 既有 generation，由真正执行的 Host 裁定（F1） |

## F1：真实生产采用边界

message-2 指出 candidate-1 只固定了同进程同 builtin 工厂，1→2 引用不能证明版本替换，
且 Planner 仍以 `requireBuiltin(既有 pin)` 会在 B 代码下拒绝 A。

按"先核实现有受支持 release/组件路径是否可消费"的要求，核实结果是**可消费**，
上一版"不能用"的假设不成立。既有生产采用链：

- `tmuxAdapters.ts:592-598`：新 Agent Host 由 Controller 自己正在运行的 `cli.js` 派生，
  因此新 Session 天然落在新代码上。
- `tmuxManager.ts:241-263`：`ensureRoleWindowAsync` 复用未 dead 的既有 pane 且不重启，
  旧 Host 路由在生产里已经成立。
- `tmuxAdapters.ts:654-663`：既有存活 Host 经自己的控制 socket 收 Turn。

唯一阻塞点是 Controller 侧 planner 在 resume 时调用
`requireBuiltinAgentEndpointImplementation`。修正为
`validateAgentEndpointImplementation`：planner 运行在 Controller，升级后它已是新代码，
无法代表仍在运行、真正拥有该 Session 的 Agent Host 发言；在此拒绝会让 Controller
升级终止存活 Session，改写成当前代码则会把 Session 静默搬到它从未启动过的代码上。
由真正执行实现的 Host 裁定：复用的存活 Host 接受自己的 generation，新启动的 Host
在代码不同时 fail closed。

实测（两个真实安装的发布，各自 dist）：

```
STAGE=$(cat /tmp/t11-ab-path)   # A=d0c109f74d01a319…（1312 文件）B=c8b2997a1d19c4cb…
node --test test/t11-f1-ab.test.mjs test/t11-ab-live.test.mjs
```

`11/11` 通过（7 项发布层 + 4 项真实进程层）。真实进程层结论：

- 发布 B 后，**运行 A 的真实 Host 进程连续服务同一 Session 的 turn1 与 turn2**，
  两次都报 `d0c109f7…`，`nativeSessionId` 与 `processInstanceId` 连续。
- 由 B 启动的 Host 为**新** Session pin `c8b2997a…`。
- B 拒绝 A 的 pin（`unavailable; explicitly select a new Session`），不静默改用当前代码。
- 被篡改的发布副本被拒绝，因此 generation 无法伪造。

## F2：真实退出驱动引用释放

message-2 已复现：pending-exit 时 `endpoint.inspect` = attached + unknown 且
`waitForExit` 永不完成；`lease.release` 删除 holder 导致 `owner.stop` 谎报
`quiescent=true refs=0 sessions=[]`。

修正：`SessionHold` 自己持有 handle，`release()` 只置 `releaseRequested`，
真正释放发生在 `settle()`——仅当"已请求释放"且"当前 Endpoint 已退出"同时成立时。
`waitForExit` 完成时调用 `settle`。即：**真实退出（或必要的 pending 依赖）驱动释放**，
不是 stop 意图驱动，也不只是措辞变化。另外补齐 message-2 点到的两处：
start 失败后不遗留 lease；`release()` 之后 `open()` 被拒绝而非跑在已让出的 generation 上。

超时事实可观测：`AgentEndpointDrain` 增加 `waitedMs` / `timedOut` 与逐 Session 的
`releaseAwaitingExit`；`agentHost.ts` 的 detach→release→stop 顺序保持不变（让有界 stop
等在真实依赖上），并把 drain 明细写入 Host 自己的 stderr——快照在 `control.close()`
前即不可达，只写快照等于不可观测。

```
node --test test/t11-f2.test.mjs          # 5/5
node --test test/t11-drain-live.test.mjs  # 1/1，倔强子进程忽略 SIGTERM
```

真实输出：

```
Endpoint stop timed out after 5004ms (bound 5000ms); 1 reference(s) and
0 pending effect(s) may still be in use. Owned client resources are unknown.
```

对被拒绝的构建跑同一组夹具：`3/5` 失败（`quiescent: true !== false`），即该缺陷确被复现后修好。
不自动杀死不属于该 Endpoint 的共享 Provider；`forceKillTimer` 与基线 `013ffdc` 行为一致
（仅字面量 `10_000` 改为命名常量），Host 在子进程忽略 SIGTERM 时存活属既有行为，非本轮引入。

## F3：不可变加载与摘要边界

message-2 指出：首次调用才读盘不等于已加载的代码；加载 A 后若磁盘已是 B，首次 pin 会误标成 B。

边界明确定义为：**运行中发布包的整包字节摘要**，在**模块加载期解析一次**。
`detectRunningRelease` 从正在运行的脚本向上找到自己的 manifest，`packageDigest`
已是逐字节校验且 fail-closed，因此覆盖发布内每个文件，不再手写清单。
开发检出没有 manifest，显式取 `checkout-` 前缀（如本轮实测
`checkout-7ca4e4b317a628083ce7b7f`），**永远不可能与发布 generation 相等**，
不静默回退成"看起来像某个发布"。不为假想扩展搭框架。

```
node test/t11-f3-differential.mjs   # 加载后改盘身份不变；子进程 加载→改盘→pin
```

对被拒绝的构建复现了 message-2 描述的误标：加载 A 却在首次 pin 报 `05f1a3f0…`（B 的字节）；
修正后报告实际加载的构建。

## 公共入口真实 Task 与真实后续 Turn（本轮补齐的证据缺口）

完全隔离：`YUI_HOME=/tmp/yui-t11-cli-TnVD`，workspace `/tmp/yui-t11-ws-82mT`（均一次性），
`env -i` 清除会话继承的 `YUI_*`，Provider 是**绝对路径本地启动器**
`/tmp/t11-launcher-…sh`（回答 `--version`/`--help`，其余 exec 协议假 App Server）。
无真实 Provider、无付费模型、无共享 Home/Controller。

配置链（全部公共入口）：

```
node dist/cli.js config agent add faux2 --adapter codex --command /tmp/t11-launcher-…sh
node dist/cli.js config role add leader|operator|worker --agent faux2
node dist/cli.js config system set default-workspace /tmp/yui-t11-ws-82mT
node dist/cli.js task create "…" ; node dist/cli.js task activate task-N
node dist/cli.js task role bind task-N leader faux2
node dist/cli.js doctor
```

`doctor` 全绿（含 `git ok`、`tmux ok 3.4`、`agent:faux2:command ok version=0.150.1`、
`agent:faux2:capability ok`）。**这直接推翻上一版"必须付费模型"的判断。**

真实 Turn（`task work create` → `task work dispatch`，真实 tmux pane、真实 Agent Host、
真实 App Server 协议往返）：

| 场景 | 命令与结果 |
|---|---|
| A/B 发布 + 真实请求 | task-2/turn-1 `Mode: new` `Status: completed` `Result: Fake Provider completed turn 1.` |
| **真实后续 Turn** | task-2/turn-2 `Mode: resume` `Status: completed` `Result: … turn 2.`；turn-3 亦 completed；三个 Turn 同一 pane `pid=1728551`、同一 `fake-thread-1` |
| 新 Host 接续既有 Session | task-3 fence 前 `pid=1742184` → 后 `pid=1745141`，turn-2 `Mode: resume` `Status: completed` |
| 普通 disable | `task execution stop --force` → `Progress was preserved; 0 active attempt(s) were terminated and 0 DurableJob(s) were cancelled.`；随后 dispatch 被拒：`Task execution is stopped: task-2. Run "yui task execution start task-2" before dispatching work.` |
| 恢复 | `task execution start` → dispatch 重新可用并 completed |
| 历史报告独立可读 | 清理后 `task turn list task-2` 仍列 6 个 Turn，`task turn show task-2/turn-1` 仍返回 `completed` 与原始 Result |
| 初始化/注册失败 | 见所有权层夹具（候选 `checkRegistration` 拒绝后 A 继续服务） |
| 新短工具桥接进旧 Session | 见所有权层夹具（可见且可调用，且不轮换该 Session 的 Endpoint generation） |
| stop 非静止 | 见 F2 真实 drain 输出 |

夹具自身的一处缺陷（如实记录）：初版假 App Server 的 turn id 在进程内自增，
Host 重启后重发 `fake-turn-1`，与已完成 Turn 的持久记录冲突，表现为
`delivery-unknown`。改为按 pid 唯一后同一 fence 循环 completed——**这是夹具缺陷，
不是产品缺陷**，未作为发现上报。

## 覆盖层级（据实标注）

| 层级 | 内容 |
|---|---|
| 真实生产入口、真实多进程 | F1 A/B 双发布真实 Host；真实 Task 的 new + resume Turn；fence/恢复；doctor 全绿；drain 真实输出 |
| 真实单元（真实 `InstanceHost`/`CapabilityRegistry`，非 fake） | 短调用 A/B 重叠、候选注册失败、短工具桥接、disable 与撤权、清理后历史可读（`test/t11-boundaries.test.mjs` 5/5） |
| **未覆盖** | 真实 Provider 推理与付费模型；真实全局 Operator 认证会话——因此 `task grant revoke` 的**CLI 层**撤权未验证，撤权仅在上述真实单元层覆盖；生产或共享 Controller/资源；`session enter` 交互式 PTY 全链路 |

未覆盖项一律不写成完成。

## 检查结果

`npm run build`、`npm run lint` 通过；`npm test` 核心 `82/82` 通过（4.51 秒）。
T11 专项夹具合计：F1 发布层 7 + F1 真实进程 4 + F2 5 + F2 真实 drain 1 + F3 差分 1 +
所有权/边界 5 + 真实 Task 1 = **24 项全部通过**。这些夹具是临时脚手架，交付前移除，
未扩大永久回归矩阵；本文件保留可审计的精确命令、真实结果与场景描述。

## 存储

不新增迁移，存储保持 version 11。迁移 6 回填的 `generation = '1'` 属于已消亡的进程记录；
重写它会谎称旧记录来自当前代码。缺失旧实现的恢复请求由运行期明确拒绝。
未改动已发布迁移 1–11，未占用 10 或声称 12。

## 剩余风险

- 开发检出的 `checkout-` generation 由 4 个模块字节派生；发布路径覆盖整包，
  但检出路径仍是有限清单——检出不是可审计的交付形态，发布路径才是契约边界。
- `ENDPOINT_DRAIN_TIMEOUT_MS` 到期后 Host 仍会退出并如实报告"可能仍在使用"，
  它有界而非保证静止；下游若需要真实静止必须读该报告，不能假定 stop 即静止。
- 未验证真实 Provider 的退出时序，真实 CLI 的 SIGTERM 行为可能与夹具不同。

## 消费者注记

`AgentEndpointFactory` 为导出类型；Agent Host 进程内所有权入口是 `createAgentEndpointOwner`。
`generation` 不再是稳定字面量 `"1"`：发布形态下等于发布包摘要前 32 位，
检出形态下带 `checkout-` 前缀。任何依赖它为 `"1"` 的假设都不再成立。

不包含 push、PR、merge、tag、release、archive、全局安装更新或共享服务重启。
未继承 task16/19 授权，未自行签发 grant，未启动其他 Task，未修改共享
Home/DB/全局安装/认证/Controller/Provider 服务，未强杀共享进程。
不声称受信任的本地任意用户代码获得 OS 级隔离。最终候选继续交由 Leader 独立复核。
