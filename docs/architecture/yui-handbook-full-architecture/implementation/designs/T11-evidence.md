# T11 Session 实现固定与使用边界热插拔

Task：task-27。基线：`013ffdc3154c18974f64c66b05ade018feb63c2b`（`feat(plugins): add
validated Task-local SDK and persistent enable intent (#320)`）。精确交付 commit 和
完成裁定以 Task 记录为准。本变更不包含发布授权。

本文件是对 candidate-1（`914073e`）与 candidate-2（`ed3968f`，均未被接受）的修正证据。
message-2 的 F1/F2/F3 与 message-4 的两项 P1 逐项处理见下；**前两版的部分结论已被实测
推翻，相应文字一并改正，不保留原先的过度声明**。

## 前两版被推翻的结论（先行更正）

| 原写法 | 实测 |
|---|---|
| "`yui doctor` 正确拒绝 fake proxy：缺少 `--config`、`resume` 能力"，据此判定公共入口全链路"受禁止付费验证约束未覆盖" | **错误。** doctor 的 Agent 检查是对 `--version` / `--help` 的只读探测：最低版本见 `agentAdapter.ts:223`（codex `0.150.1`），必需能力面是 `missingRequiredCapabilities`（`agentAdapter.ts:766-787`，codex 仅需 `--config` 与行首 `resume`）。绝对路径本地夹具实现这两个能力面后 doctor 全绿（`agent:faux:command ok version=0.150.1`、`agent:faux:capability ok`），不需要付费模型。公共入口全链路已真实覆盖 |
| 后续 Turn 的持久 Turn 发布"属 task23 边界"，仅断言"只允许在此拒绝" | **错误的归因。** 那是本 Task 自己的配置缺口，不是外部阻塞。已完整配置隔离 Task 并**真实完成了后续 Turn**，不再以拒绝充当通过 |
| `generation` = 四个手写模块字节摘要，"每进程只计算一次" | 手写清单无法声称覆盖完整；且首次调用才读盘时，加载 A 之后磁盘换成 B 会把自己标成 B。已改为发布包字节摘要 + 模块加载期一次解析（F3） |
| "`detectRunningRelease` … `packageDigest` 已是逐字节校验且 fail-closed" | **错误的归属。** `detectRunningRelease`（`runtimeRelease.ts:614-628`）只从运行脚本向上找到 manifest 并 `readReleaseManifest`，后者仅 `JSON.parse` + `validateManifest`（结构校验）。逐字节校验属 `verifyReleaseIntegrity`（`runtimeRelease.ts:169`），发生在 install/校验路径。见下方 F3 更正 |
| "start 失败后不遗留 lease"被写成生产已验证 | **不成立。** 生产 open 失败的 catch（`agentHost.ts:727-755`）只发布不可恢复性、更新快照并 `throw`，**没有立即 `release()`**；lease 的释放只发生在 `finally`。该结论仅在所有权层夹具成立，不能宣称生产已验证无残留 |
| "`ENDPOINT_DRAIN_TIMEOUT_MS` 到期后 Host 仍会退出并如实报告" | **错误。** 客户端持有继承的 stdio 管道时，Host 进程在超时后**并不退出**——这在基线 `013ffdc` 上同样如此（实测见下）。本轮把可保证的边界收紧为"最终清理有界返回、`control.close()` 可达"，不再声称进程退出 |

## 交付与复用边界

| 已有设计 | 本轮接入方式 |
|---|---|
| `src/kernel/instanceHost.ts` | 直接复用同一个 `InstanceHost` 类；attach/acquire/release/detach、引用计数、`drained`、一次性 `#dispose` 与身份保留语义全部沿用，**未修改该文件** |
| `src/release/runtimeRelease.ts` | 复用既有不可变发布与 `detectRunningRelease`；**未新建配置框架，未重做 T07 配置层** |
| `src/runtime/tmuxAdapters.ts` / `src/tmux/tmuxManager.ts` | 复用既有生产采用链，未新增第二套 Registry/Host |
| `src/runtime/agentEndpointIdentity.ts` | `generation` 改为运行发布包摘要（F3） |
| `src/runtime/agentEndpointOwnership.ts` | 真实退出驱动引用释放（F2）；在飞握手计入同一 Session 的真实持有、最终清理有界返回（P1-1/P1-2） |
| `src/executor/fileRoleLaunchPlanner.ts` | resume 携带 Session 既有 generation，由真正执行的 Host 裁定（F1） |

A/B 实际采用链与"由真正执行的 Host 裁定 pin"的设计经独立审查认可，本轮**未重开**，
未新增 Registry，未新增配置框架；本轮只修 P1-1 / P1-2 与本文件的三处归因。

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

## P1-1：最终清理必须有界返回

message-4：`stop(5000)` 之后 `agentHost` 的 `finally` 又 `await endpointOwner.close()`，
而 `close()` 是 `host.close()` → 对每个实例 `detach()` → `return instance.drained`
（`instanceHost.ts`，本轮未修改该文件）——正是有界 `stop` 刚刚放弃等待的**同一个**
promise，于是 `control.close()` 不可达。这不能归为"基线子进程存活"：新增的 await
阻断函数返回与控制清理，本身是本轮引入的新问题。

修正：`close(timeoutMs)` 自己有界。detach 全部已 attach 的实现（不再接受新获取），
共用一个截止时间等它们的 drain，到期即返回**每个实现的真实 drain 事实**，
既不假 release 无法证明的引用，也不杀掉不属于自己的共享 Provider。仍被持有的实现
按设计保持 detached 且未 dispose，事实继续可读，由调用方决定如何处理。
`agentHost.ts` 以 `ENDPOINT_DRAIN_TIMEOUT_MS` 调用它，并把仍被持有的引用与在飞握手
写进 Host 自己的 stderr（快照在 `control.close()` 前即不可达）。

**契约边界差分**（同一脚本跑两个构建的 dist，`stop(200)` 已超时于一个永不退出的已附着客户端）：

```
node test/t11-p1-close-differential.mjs /tmp/t11-rejected   # 拒绝构建 ed3968f
node test/t11-p1-close-differential.mjs "$PWD"              # 本轮

### t11-rejected (ed3968f)
  stop: quiescent=false refs=1 timedOut=true
  close: STILL PENDING after 1200ms (unbounded: waits on the same drain stop gave up on)
### work-item-1 (本轮)
  stop: quiescent=false refs=1 timedOut=true
  close: RETURNED after 201ms (bound 200ms)
```

**可保证与不可保证（按修正后的实际行为）**：有界的是"最终清理返回、`control.close()`
可达"。**Host 进程在客户端仍持有继承的 stdio 管道时并不退出**——基线 `013ffdc`
（其 `finally` 里根本没有 endpoint owner）在同一夹具下同样不退出，实测见下节。
本轮不声称修好进程退出，也不用假 release 或强杀共享进程去制造退出。

## P1-2：在飞握手计入同一 Session 的真实持有

message-4：正常初次 open 或 Codex resume 等待握手时收到 SIGTERM，`session/current`
仍为空，`release` 误判无依赖而归零，之后 `track` 迟到成功的客户端被漏记。

修正：`SessionHold` 增加 `opening` 计数，在 `await` 握手**之前**自增，因此停止落在
握手中途时该 Session 是真实持有者；`settle()` 仅在"已请求释放"且"无当前客户端"
且"无在飞握手"三者同时成立时才交还引用。握手迟到**成功**时客户端是真的，进入同一套
受控退出跟踪（若期间已请求停止，则 `detach()` 它，由它的真实退出释放持有）；迟到
**失败**时该持有不欠任何东西，按真实依赖立即释放。`AgentEndpointDrain` 增加 `opening`，
`quiescent` 要求它为 0——在飞握手不再能被当成静止。

未新增独立后台协议，未新增第二个 Host。

## P1 生产信号路径验证（不只测 owner helper）

夹具 `test/fixtures/t11-stallable-app-server.mjs` 是**可阻塞的假协议客户端**：
生产客户端在子进程 stdio 上讲真正的 WebSocket
（`structuredProviderHost.ts` 的 `new WebSocket("ws://localhost/rpc", { createConnection })`
over `ChildProcessDuplex`），所以夹具完成真实 WebSocket 握手，然后可以在
`thread/start` / `thread/resume` 上**扣住不答**，并可选择迟到成功、迟到失败、
或忽略 SIGTERM。

链路全部是生产的：真实 Controller 派发 → 真实 tmux pane → 真实
`yui internal agent-host` 进程 → 真实协议客户端；SIGTERM 用 `process.kill` 直接投给
**我自己 Home 的** Host 进程（按 `/proc/<pid>/environ` 里的 `YUI_HOME` 认定，
绝不匹配其他 Task 的 Host）。`control.close()` 只在 `server.close()` resolve 之后才
`rmSync` socket，因此"socket 被移除"是 `finally` 跑完的直接证据。

```
node test/t11-p1-production-signal.mjs      # 4/4（连续两次独立运行均 4/4）
```

| 场景 | 真实结果 |
|---|---|
| 停止发生在握手完成**之前**，客户端永不作答且忽略 SIGTERM | `Endpoint stop timed out after 5000ms (bound 5000ms); 1 reference(s), 1 opening client(s)`（不是静止）；`Endpoint cleanup returned … 1 reference(s) and 1 opening client(s) still held`；`control.close() reached: true` |
| 握手**迟到成功** | Host 在 SIGTERM 后 `2420ms` 返回；该场景**自己的**客户端日志 `[app-server 2083750] late success for thread/resume id=2` |
| 握手**迟到失败** | Host 在 SIGTERM 后 `2317ms` 返回；`[app-server 2088329] late failure for thread/resume id=2` |
| 已附着客户端忽略 SIGTERM（P1-1 真正持有引用的条件） | `Endpoint stop timed out after 5004ms (bound 5000ms); 1 reference(s), 0 opening client(s)`；`Endpoint cleanup returned …`；`control.close() reached: true` |

断言确有鉴别力：把同一套夹具指向被拒绝构建（`ed3968f`，由其自己的 Controller 派生
它自己的 dist、自己的隔离 Home）时 **4 项里 3 项失败**，失败点正是被报告的两个 P1：

```
### t11-rejected (ed3968f)  1/4
FAIL 停止发生在握手完成之前 —— no bounded-stop diagnostic: a mid-handshake stop was
     treated as quiescent（P1-2：整条 drain 诊断都没有，Session 被当成静止）
FAIL 握手迟到成功 —— Host never returned after a late handshake success
FAIL 已附着客户端忽略 SIGTERM —— final cleanup never reported: it is still waiting on
     that same drain; control.close() NOT reached（P1-1，生产路径复现）
     其 stop 行也没有 `opening client(s)` 字段
```

本轮构建 4/4。第一个场景**故意不断言进程退出**，只断言本变更拥有的端点契约
（有界 stop 如实报在飞握手、最终清理返回到 `control.close()`）。原因见下节：
进程存活在基线上同样发生。

**夹具自身的一处缺陷（如实记录，曾产生假通过与假失败）**：初版 harness 共用一个
ready 文件与一个日志，并把"我这个 Home 的所有 agent-host"都当作被测对象。
但场景 1 和 4 故意制造"客户端忽略 SIGTERM"的 Host，它会滞留到下一个场景，
于是上一场景的残留既可能满足下一场景的等待（假通过：一次运行里被记为 PASS 的
"迟到失败"实际引用了 pid 更低的上一批客户端日志），也可能污染 pid 集合（假失败）。
同一份 harness 因此一度报出 `2/4`。修正：每个场景独立 ready/日志路径；夹具把
**自己的 pid** 写进 ready 文件，被测 Host 取该客户端的**父进程**；出现意外滞留 Host
时直接判为"场景未隔离"而不是继续测量；夹具集合按 `T11_LOG` 前缀限定，避免与另一个
隔离 Home（基线/拒绝构建差分用）的 app-server 混淆。**这是 harness 缺陷，不是产品缺陷**，
修正后连续两次 4/4，拒绝构建 1/4。原始 `2/4` 不作为结论保留，但缺陷本身在此记录，
因为"测量工具会把别人的进程记到自己账上"正是这类证据最容易出错的地方。

所有权层最小复现同时保留：

```
node test/t11-p1-repro.mjs
```

被拒绝构建：`close(): STILL PENDING after 30ms`、
`pending open -> release -> stop: quiescent=true references=0`，且迟到成功的客户端
`UNTRACKED by ownership`。本轮构建：`close(): returned`、
`pending open -> release -> stop: quiescent=false references=1`、迟到客户端 `tracked`。

## 进程存活是既有行为（实测，不作推断）

`test/t11-p1-baseline-differential.mjs` 用**基线自己的隔离 Home**
（`/tmp/yui-t11-base-home-BIkG`）跑基线 `013ffdc` 自己的 dist、自己的 Controller、
自己的 launcher，夹具与信号完全相同：

```
T11_DIFF_HOME=/tmp/t11-base-home \
  node test/t11-p1-baseline-differential.mjs /tmp/t11-baseline "BASELINE 013ffdc (no endpoint owner)"

=== BASELINE 013ffdc (no endpoint owner) ===
  handshake stalled; agent-host pid(s)=2222528
  host exit: STILL RUNNING after 30000ms
  control socket removed (control.close reached): true
  stubborn client still alive: true
{"label":"BASELINE 013ffdc (no endpoint owner)","tree":"/tmp/t11-baseline",
 "exitedMs":null,"controlCloseReached":true,"clientAlive":true}
```

输出里**没有** `Endpoint stop` / `Endpoint cleanup` 行，这本身就是身份证明：
基线 dist 里 `endpointOwner` 与 `opening client` 的出现次数均为 `0`
（`grep -c` 实测），它不可能打印这些字符串。基线的 `finally` 只有
`session?.detach()` 与 `await control.close()`，因此进程存活只能来自客户端持有的
继承管道，与本轮改动无关。

**一次差分执行错误（如实记录）**：每个 Home 只有一个 Controller，而 Controller 用
**它自己正在运行的 `cli.js`** 派生 Agent Host。我曾把基线脚本指向 p1 Home 直接运行，
于是那个 Home 早已运行的 Controller 派生的是**我的** dist，输出里出现了
`opening client(s)`——这个字符串只有本轮构建才有，因此该次结果是我的构建而非基线，
已作废。修正后脚本要求显式传入 `T11_DIFF_HOME`（该树自己的 Home），并在结束时做
来源校验：若被测树不含 `opening client` 而 pane 里出现了它，直接判为"跑错树"并以
退出码 4 作废结果。该校验本身经反向对照验证——故意把基线树配上 p1 Home：

```
  ERROR: pane shows "opening client(s)" but /tmp/t11-baseline never emits it.
  A Controller derives Agent Hosts from the cli.js IT runs, so this Home's
  Controller served the dispatch from a different tree. Result discarded.
  real exit=4
```

本轮修好的是"新增 await 阻断最终清理与控制清理"，不是进程退出；两者分开描述，
不互相冒充。

## F2：真实退出驱动引用释放

message-2 已复现：pending-exit 时 `endpoint.inspect` = attached + unknown 且
`waitForExit` 永不完成；`lease.release` 删除 holder 导致 `owner.stop` 谎报
`quiescent=true refs=0 sessions=[]`。

修正：`SessionHold` 自己持有 handle，`release()` 只置 `releaseRequested`，
真正释放发生在 `settle()`——仅当"已请求释放"且"当前 Endpoint 已退出"同时成立时。
`waitForExit` 完成时调用 `settle`。即：**真实退出（或必要的 pending 依赖）驱动释放**，
不是 stop 意图驱动，也不只是措辞变化。另外补齐 message-2 点到的一处：
`release()` 之后 `open()` 被拒绝，而不是跑在已让出的 generation 上。

关于"start 失败后不遗留 lease"：该结论**只在所有权层夹具成立**。生产 open 失败的
catch（`agentHost.ts:727-755`）只发布不可恢复性、更新快照、清理 Turn 状态并 `throw`，
**没有立即 `release()`**；lease 的释放发生在同一函数的 `finally`。因此本文件不再宣称
生产路径已验证"无残留"，只记录夹具层事实与生产路径的实际释放位置。

超时事实可观测：`AgentEndpointDrain` 增加 `waitedMs` / `timedOut` / `opening` 与逐
Session 的 `releaseAwaitingExit`；`agentHost.ts` 的 detach→release→stop 顺序保持不变
（让有界 stop 等在真实依赖上），并把 drain 明细写入 Host 自己的 stderr——快照在
`control.close()` 前即不可达，只写快照等于不可观测。

```
node --test test/t11-f2.test.mjs          # 5/5
node --test test/t11-drain-live.test.mjs  # 1/1，倔强子进程忽略 SIGTERM
```

真实输出（本轮起额外报在飞握手数）：

```
Endpoint stop timed out after 5005ms (bound 5000ms); 1 reference(s), 0 opening client(s)
and 0 pending effect(s) may still be in use. Owned client resources are unknown.
Endpoint cleanup returned with 1 reference(s) and 0 opening client(s) still held across
1 implementation(s) (bound 5000ms); those implementations stay detached and undisposed.
Owned client resources are unknown.
```

对被拒绝的构建跑同一组夹具：`3/5` 失败（`quiescent: true !== false`），即该缺陷确被复现后修好。
不自动杀死不属于该 Endpoint 的共享 Provider；`forceKillTimer` 与基线 `013ffdc` 行为一致
（仅字面量 `10_000` 改为命名常量），Host 在子进程忽略 SIGTERM 时存活属既有行为，非本轮引入
（基线实测见上）。

## F3：不可变加载与摘要边界

message-2 指出：首次调用才读盘不等于已加载的代码；加载 A 后若磁盘已是 B，首次 pin 会误标成 B。

边界明确定义为：**运行中发布包的整包字节摘要**，在**模块加载期解析一次**。
`detectRunningRelease`（`runtimeRelease.ts:614-628`）从正在运行的脚本向上找到自己的
manifest 并 `readReleaseManifest`——**它只做读取与结构校验**（`JSON.parse` +
`validateManifest`），不做逐字节校验。逐字节校验是 `verifyReleaseIntegrity`
（`runtimeRelease.ts:169`），发生在 install / 完整性校验路径。因此 generation 的
覆盖面来自 manifest 里已登记的整包摘要（不再是手写模块清单），而"这些字节此刻仍与
磁盘一致"由 install 期的 `verifyReleaseIntegrity` 保证，不由加载期这次读取保证。
本文件不再把两者混为一谈。

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

本轮（P1 修正）为验证生产信号路径另建了一个同样一次性的隔离 Home
`YUI_HOME=/tmp/yui-t11-p1-home-6hBW`、workspace `/tmp/yui-t11-p1-ws-ooEU`，
Agent 名为 `faux`，Provider 仍是绝对路径本地启动器 `/tmp/t11-p1-launcher.sh`。
其 doctor 同样全绿：

```
  yui home               ok       /tmp/yui-t11-p1-home-6hBW
  storage schema         ok       current=11 latest=11 minimum=1
  git                    ok       git: git version 2.43.0
  tmux                   ok       tmux: tmux 3.4
  agent:faux:command     ok       command=/tmp/t11-p1-launcher.sh adapter=codex version=0.150.1
  agent:faux:capability  ok       start resume interrupt nativeSession=runtime
```

上一版 Home（`faux2`）与本轮 Home（`faux`）是两个独立的一次性隔离环境，
名字不同是真实差异，不是笔误；两者都无真实 Provider、无付费模型、无共享 Home/Controller。
基线与被拒绝构建的差分另用 `/tmp/yui-t11-base-home-BIkG`、`/tmp/yui-t11-rej-home-1rB0`。

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
| 真实生产入口、真实多进程 | F1 A/B 双发布真实 Host；真实 Task 的 new + resume Turn；fence/恢复；doctor 全绿；drain 真实输出；**P1 生产信号路径 4/4**（真实 Controller 派发 + 真实 tmux pane + 真实 `internal agent-host` + 真实 SIGTERM，覆盖握手完成前停止、迟到成功、迟到失败、已附着客户端拒绝退出） |
| 真实多进程差分（同夹具跨构建） | 被拒绝构建 `ed3968f` 生产路径 1/4（`control.close()` 不可达）；基线 `013ffdc` 生产路径进程存活实测；`close()` 有界性 201ms vs 仍挂起 |
| 真实单元（真实 `InstanceHost`/`CapabilityRegistry`，非 fake） | 短调用 A/B 重叠、候选注册失败、短工具桥接、disable 与撤权、清理后历史可读（`test/t11-boundaries.test.mjs` 5/5）；P1 所有权层最小复现（`test/t11-p1-repro.mjs`） |
| **未覆盖** | 真实 Provider 推理与付费模型；真实全局 Operator 认证会话——因此 `task grant revoke` 的**CLI 层**撤权未验证，撤权仅在上述真实单元层覆盖；生产或共享 Controller/资源；`session enter` 交互式 PTY 全链路；**真实 Codex CLI 在握手中途收到 SIGTERM 的时序**（本轮用可阻塞假客户端精确制造该窗口，真实 CLI 行为可能不同）；**Host 进程在客户端不退出时的最终退出**（基线同样不退出，本轮未修） |

未覆盖项一律不写成完成。

## 检查结果

`npm run build`、`npm run lint` 通过；`npm test` 核心 `82/82` 通过（4.437 秒）。
T11 专项夹具合计：F1 发布层 7 + F1 真实进程 4 + F2 5 + F2 真实 drain 1 + F3 差分 1 +
所有权/边界 5 + 真实 Task 1 + **P1 生产信号 4（连续两次 4/4）+ P1 所有权复现 1 +
`close` 有界性差分 1 + 基线差分 1（另加"跑错树"反向对照 1，期望失败并退出 4）**
= **31 项按预期通过 + 1 项按预期失败**。这些夹具是临时脚手架，交付前移除，
未扩大永久回归矩阵；本文件保留可审计的精确命令、真实结果与覆盖层级。

## 存储

不新增迁移，存储保持 version 11。迁移 6 回填的 `generation = '1'` 属于已消亡的进程记录；
重写它会谎称旧记录来自当前代码。缺失旧实现的恢复请求由运行期明确拒绝。
未改动已发布迁移 1–11，未占用 10 或声称 12。

## 剩余风险

- 开发检出的 `checkout-` generation 由 4 个模块字节派生；发布路径覆盖整包，
  但检出路径仍是有限清单——检出不是可审计的交付形态，发布路径才是契约边界。
- `ENDPOINT_DRAIN_TIMEOUT_MS` 到期后有界的是**函数返回**：有界 stop 与有界最终清理都会
  返回，`control.close()` 可达，且如实报告"可能仍在使用"的引用与在飞握手。
  **它不保证静止，也不保证 Host 进程退出**——客户端持有继承的 stdio 管道时进程仍存活，
  这在基线 `013ffdc` 上同样如此（实测在上）。下游若需要真实静止必须读该报告，
  不能假定 stop 或 cleanup 返回即静止；若需要进程一定消失，需要在此之外另行处理，
  本轮未修、也未声称修。
- 仍被持有的实现按设计保持 detached 且未 dispose，其客户端资源状态为 unknown：
  这是有意的诚实上报，不是泄漏被掩盖，也不是通过假 release 或强杀共享 Provider 消除。
- `detectRunningRelease` 只读取并结构校验 manifest；"磁盘字节仍与 manifest 一致"依赖
  install 期的 `verifyReleaseIntegrity`，加载期这次读取不重新验证字节。
- 未验证真实 Provider 的退出时序，真实 CLI 的 SIGTERM 行为（尤其握手中途）可能与夹具不同。

## 消费者注记

`AgentEndpointFactory` 为导出类型；Agent Host 进程内所有权入口是 `createAgentEndpointOwner`。
`generation` 不再是稳定字面量 `"1"`：发布形态下等于发布包摘要前 32 位，
检出形态下带 `checkout-` 前缀。任何依赖它为 `"1"` 的假设都不再成立。

`AgentEndpointDrain` 新增 `opening`（在飞握手数），且 `quiescent` 要求
`references === 0 && opening === 0`：读取 `quiescent` 的消费者会正确地把
"停在握手中途"视为非静止。`AgentEndpointOwner.close(timeoutMs = 0)` 现在有界并返回
`readonly AgentEndpointDrain[]`；默认值 `0` 表示不等待，调用方必须自己选择截止时间，
不存在"无限等待"的默认。

不包含 push、PR、merge、tag、release、archive、全局安装更新或共享服务重启。
未继承 task16/19 授权，未自行签发 grant，未启动其他 Task，未修改共享
Home/DB/全局安装/认证/Controller/Provider 服务，未强杀共享进程。
不声称受信任的本地任意用户代码获得 OS 级隔离。最终候选继续交由 Leader 独立复核。
