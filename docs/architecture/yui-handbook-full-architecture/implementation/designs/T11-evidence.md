# T11 Session 实现固定与使用边界热插拔

Task：task-27。基线：`013ffdc3154c18974f64c66b05ade018feb63c2b`（`feat(plugins): add
validated Task-local SDK and persistent enable intent (#320)`）。精确交付 commit 和
完成裁定以 Task 记录为准。本变更不包含发布授权。

本轮补齐的是长期 Session 真实持有实现与生命周期接线：`generation` 从固定标签
`"1"` 改为与实际运行代码绑定的摘要，Agent Host 进程按 Session 真实持有 Endpoint
实现引用，并在 Session 终止路径上真实释放与有界 drain。不新增第二套
Host/Registry/PluginManager、第二张引用表或后台回收协议。

## 交付与复用边界

| 已有设计 | 本轮接入方式 |
|---|---|
| `src/kernel/instanceHost.ts` | 直接复用同一个 `InstanceHost` 类；attach/acquire/release/detach、引用计数、`drained`、一次性 `#dispose` 与身份保留语义全部沿用，未修改该文件 |
| `src/runtime/agentEndpoint.ts` | 仅把原内联返回类型提取为导出的 `AgentEndpointFactory`；`createAgentEndpointFactory` 与 `startStructuredProviderSession` 调用不变 |
| `src/runtime/agentEndpointIdentity.ts` | `builtinAgentEndpointImplementation` 的 `generation` 改为运行代码摘要；`validateAgentEndpointImplementation`（仅形状）与 `requireBuiltinAgentEndpointImplementation`（当前代码）的既有分工保持不变 |
| `src/runtime/agentHost.ts` | 原 `createAgentEndpointFactory()` 直接调用改为按 Session 持有的 lease；open/resume/重连/退出/终止五处接线 |
| `src/runtime/runtimeDeadlines.ts` | 沿用既有 deadline 层级，新增 `AGENT_HOST_CLIENT_EXIT_GRACE_MS`（替换原字面量 `10_000`）与严格内含的 `ENDPOINT_DRAIN_TIMEOUT_MS` |
| 授权与撤权 | 复用已合并的 authority fence（`agentHost.ts` 每次 submit 重新校验）与 plugin grant 每次调用重校验；未新建第二套撤权机制 |

新增文件只有 `src/runtime/agentEndpointOwnership.ts`：Agent Host 进程内的
Endpoint 实现所有权。Controller 在自己的进程持有它自己的 Host 且从不持有
Endpoint client，因此 Session 的引用事实必须存在于 Session 真正运行的进程；
这是把同一个 Host 原语用在它 header 已声明的位置，不是第二套注册表。

## 实现身份与代码绑定

`generation` 是四个声明模块（`agentEndpoint.js`、`agentEndpointIdentity.js`、
`structuredProviderHost.js`、`codexAppServerRuntime.js`）字节的 sha256 前 32 位，
每进程只计算一次——这些文件已被加载，之后重读会报告本进程并未执行的构建。
读不到模块是安装损坏，直接抛错，不回退到会静默匹配另一构建的身份。

不采用发布 `buildId`：开发检出没有 `runtime/releases/`，那需要被明确禁止的静默
回退；也不采用整包摘要，否则无关改动都会轮换、令所有可恢复 Session 失效。

实测（隔离 Home、真实进程）：

- 就地改动 `structuredProviderHost.js` 字节 → `1d26963…` 轮换为 `bbb36757…`
- 还原后 → 回到 `1d26963…`（由字节可复现）
- 改动无关的 `sqliteStore.js` → 仍为 `1d26963…`（不误轮换）

## 公共入口与真实引用证据

全链路走生产入口，不注入实现句柄或身份：真实 Controller（`startFileTaskControllerRuntime`，
一次性 Home）→ 真实 launch ticket → `yui internal agent-host <ticket>` 独立进程
（与生产同一 CLI 入口）→ 真实控制 socket → fake App Server proxy 子进程。ticket 由
Host 经 IPC 向 Controller `runtime.launch-redeem` 兑换，`pendingCount()` 归零证明
恰好消费一次。断言全部读取 Host 自己上报的快照。

- 新 Session 启动后 Host 上报 `endpointImplementation.generation` 等于本构建摘要，
  匹配 `^[0-9a-f]{32}$` 且不等于 `"1"`；随后 `status` 仍报告同一实现。
- 同一 Session 的后续 Turn 由它已持有的那份实现服务：native Session 与
  `processInstanceId` 都连续，未在其下被重启或重新选择。
- 固定引用命名本进程未运行的代码时，明确拒绝恢复（`unavailable; explicitly select
  a new Session`），绝不静默改用当前代码。
- Host 关闭时释放 Session 的持有并完成有界 drain，在 client exit grace 内正常退出。

所有权层（真实 `InstanceHost` 计数，可阻塞 A/B 夹具）：

- 旧 Session 连续两个 Turn 始终 1 个引用且实现不变；新 Session 独立取得当前实现
  使引用变为 2；分别释放后回到 1、0。
- stop 请求不等于物理静止：报告 `quiescent: false`、真实 `references: 1`、真实 pending
  计数与 `resources: "unknown"`；此时新的独立 acquire 被拒绝，已有句柄仍可用；
  真实释放后旧实现才 dispose。不自动杀死不属于该 Endpoint 的共享 Provider。
- 候选初始化失败后，正在运行的 Session 仍持有并继续被服务。

## 检查结果

`make install-local`、`npm run build`、`npm run lint` 通过；核心 82/82 通过（约 4.46 秒）。
上述 T11 专项为临时脚手架（4 项全链路 + 4 项所有权层，均通过），交付前已全部移除，
未扩大永久回归矩阵。全程使用一次性 Home 并显式隔离 `YUI_HOME`，不继承真实 Home。

自检发现并修正的三处真实缺陷：`track` 曾把同一 lease 的 open→resume 记成两个持有，
使 stop 高报在用 Session（Codex 重连正是该路径）；drain 曾以 `sessionPayload` 的
adapter 取键，与实际 pin 的 adapter 不一致时会静默跳过 drain 报告；drain 的超时
计时器曾 `unref()`，无其他 handle 时进程会在报告"仍在使用"之前退出。

## 存储

不新增迁移，存储保持 version 11。迁移 6（`session-endpoint-implementation`）回填的
`generation = '1'` 属于已消亡的进程记录；重写它会谎称旧记录来自当前代码。缺失旧实现
的恢复请求由运行期明确拒绝，这正是所需语义，不需要持久化变更。未改动已发布迁移 1–11，
未占用 10 或声称 12。

## 剩余边界与并行任务

未验证真实 Provider 推理、付费模型、真实 Operator 交互、生产或共享 Controller/资源；
没有把协议夹具当作真实模型 E2E。`session enter` 全链路需要真实 Provider CLI
（`yui doctor` 正确拒绝 fake proxy：缺少 `--config`、`resume` 能力），受禁止付费验证
约束未覆盖；因此改用同一生产 CLI 入口直接驱动 Agent Host 进程，覆盖层级如上区分。

同一 Session 后续 Turn 的持久 Turn 发布需要完整配置的 Task（Run/生命周期语义属
task23），该边界在证据中显式断言为"只允许持久 Task 生命周期在此拒绝"，未伪装成通过。
task26/T10 的插件管理策略、task19 的 ACP 配置、task22 的显式环境 adopt 保持各自边界；
只消费已合并的公共路径，未读写其私有工作区或复制未合并代码。

消费者注记：`AgentEndpointFactory` 现为导出类型；Agent Host 进程内的
Endpoint 所有权入口是 `createAgentEndpointOwner`。`generation` 不再是稳定字面量，
任何依赖它为 `"1"` 的假设都不再成立——它按上述四个模块的字节轮换。

不包含 push、PR、merge、tag、release、archive、全局安装更新或共享服务重启。
最终候选继续交由 Leader 独立复核。
