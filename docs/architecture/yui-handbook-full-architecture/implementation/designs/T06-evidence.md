# T06 Surface 实现与采用

Task：task-18。基线：`97ad88849c9a496230b134d2955f5f23e96deaa3`。
精确交付 commit 和完成裁定以 Task 记录为准。本变更不包含发布授权。
用户随后明确要求由 T06 直接补齐生产 Web 面板和准确错误反馈，Draft planning
继续留给 T08。下述当前实现已包含这两项；早期审查记录保留为历史证据。

## 交付与唯一事实来源

Web Task 主视图采用 T03 的紧凑 Context，优先展示要求、目标、责任、待答
问题、固定结果、消息和决策。执行细节单独展开。旧详情查询保留为可选
运行观察，不是核心读取的前提，也不成为第二套 Task 状态。

| Surface 入口 | 原应用所有者／效果 |
|---|---|
| `GET /api/tasks/:id/context` | `readTaskContext`，原 coreCursor、引用、裁剪及 read-no-ack 语义 |
| `GET .../delta` | `readTaskContextDelta`，保留 after 与 continuation 的固定上界 |
| `GET .../inspect` | `inspectTaskContext`，按 store/ref/digest 读取当前记录 |
| `POST .../metadata` | `updateTaskMetadataCommand`，复用 capability `task.update` 的输入 schema 与空值语义 |
| `POST .../messages` | `sendTaskMessageCommand`，CLI `task message send` 使用同一个 Message/Mailbox 事务 |
| `POST .../inputs/:input/answer` | 原 `task input answer` handler，未新增问题或回答状态 |
| `capability commands/panels` | 原受管 `capability.search` dispatcher 的描述投影 |
| `GET/POST .../panels` | Controller 的原 Registry/Host；受权目录、精确 Provider/generation，只读调用 |

本地修改回执返回原记录、记录版本及请求关联 ID。请求 ID 不被冒充为本地
修改的幂等账本：响应丢失时显示 unknown，页面不自动重发。进行中的重复
点击被阻止；重连只读事实，不重放写入。消息的 queued 仅说明已为 Leader
排队，不证明 Provider 接受或目标完成。Job 的外部操作身份、效果与终态仍
由 T01/T02 的原 Job 记录负责；Surface 不创建替代操作记录或恢复流程。
输入解析或 Store-only 事务回调失败且原错误在回滚后返回时，明确标为
`not-submitted`；提交/回滚基础设施错误、提交后通知故障、响应丢失仍保留
unknown。已知拒绝显示原因并允许用户修正后重新提交，不自动重试；已归档
任务的标题输入和保存控件禁用。消息、标题及回答复用同一反馈合同。

## 身份与对话目标

所有 HTTP API 使用实际本地页面 token；请求正文不能指定 actor、caller
或 Role。Controller 内的 Web 用户入口使用原本地用户 typed handler，不冒充受管 Session。
从 managed Session 启动用户 Web ingress 被拒绝；原 capability RPC 的
native Session 鉴权、跨 Task 限制和权限检查不变。

全局入口保留 Operator Session。Task 页面提供发送给 Leader 的消息表单；
发送者始终按原用户身份记录，不因文本要求修改全局配置而变成 Operator。
原 Task terminal 保持只读并明确标注。Draft 可以保存消息作为上下文，
但 planning Session 尚不可用；页面不创建或伪造 T08 的运行时。

## 读取、显示及贡献

- 静默轮询直接读取当前 Context，断线保留上次读取，重连重建快照；
  未提交表单不被后台渲染清空。独立 delta API 保持固定分页上界，但页面
  不再先拉取、丢弃全部事件页后又无条件读取 Context。
- Role 当前配置和 Turn effective 分开。正文省略或记录截断导致无法判断
  活动时显示 unknown，不填成 idle。旧运行观察选择 Turn 的实际 Agent
  Session，而不是当前选中的另一 Agent；返回原 native Session、Endpoint
  实现引用与观察时间，不改写历史。
- Context 可选观察失败独立显示 unavailable。旧运行面板异步读取、有独立
  客户端等待上限；核心视图和固定 Artifact 来源仍可读取。
- `CapabilityDescriptor.surfaces` 是可选进程内描述，不是新持久 schema。
  CLI name/help 映射明确 capability；面板仅允许纯文本、无凭据 HTTP(S)
  链接和 query 的 JSON renderer。默认查询也有通用数据面板描述。
- 注册校验在原 Registry 的原子发布前进行。贡献描述每次从当前受权目录
  派生，不维护独立实例表；实际调用继续走现有 `capability call`，
  生命周期沿原 Registry/Host。缺少专用面板不影响已保存结果。
- **Web 面板现在有生产装配方。** `startFileTaskControllerRuntime` 将 HTTP
  监听器和面板读取绑定到自己已有的 Kernel Registry/Host。内建 Task、
  Context、Artifact 等只读能力无需测试注入即可显示和读取。贡献描述由
  同一受权目录读取，停用/卸载及旧 generation 会在新查询时重新判断。
  面板只呈现文本、受控链接及 JSON，不执行任意前端代码。
- Web query context 只在 Controller 内部、HTTP token 验证后签发；
  受管 capability RPC 的 `scope:user` 仍被拒绝，不能用 JSON 伪造上下文。
  query-only 权限也在 Registry 每次调用/委派时检查，面板不能调用写能力。
  这是实际用户入口的独立凭据来源，不是伪造 Operator/Leader。

### 运行方式

`yui web --port <port>` 通过现有私有 Controller 控制 socket 请求启动一个
loopback HTTP 监听器；它要求匹配当前构建的 Controller 已在运行，不自动
启动 Controller/Agent，也不在旧 Controller 不支持时回退到第二个 Host。
CLI 保持前台等待，Ctrl-C 仅停止自己的监听器；`yui web --status` 查询
当前监听器，`yui web --stop` 根据精确监听器 id 停止它，不停止 Controller
或 Agent。每个 Home 一个监听器，可供多个浏览器页面使用。
Controller 关闭时同时释放其监听器；监听器及 id 仅属进程资源，不保存为
第二份 Task 状态。旧 Controller 需在受授权维护窗口切换到新构建，本次未
升级或重启共享实例。

没有新增数据库字段、迁移、确认阶段、后台重试或自动评审策略。
既有 CLI 命令及可读输出保留；不强制所有内部调用 JSON 化。

## 首轮验证与独立审查（候选 `77503111…`）

验证只使用本 Task 构建、一次性 Home、真实 SQLite/HTTP、合成 Task/Role/Turn
和浏览器。测试 CLI 使用本 checkout 的绝对 `output/dev/bin/yui`，清除继承
的 `YUI_*` 后指定隔离 Home。未使用当前 Task 的共享 Home 做测试。

- HTTP 专项：token 拒绝、伪造 actor 零写入、Web/typed CLI 同一记录、
  Message/Mailbox 排队且不升级身份、Context read-no-ack、超过 100 事件的
  固定分页上界、optional 失败/超时/卸载、卸载后 Artifact 和绝对 CLI 读取。
- 贡献专项：真实 Registry/Host 与 dispatcher、CLI parser 的隔离集成；
  非法脚本描述拒绝、原子发布、明确映射、歧义/不可用、generation、撤权、
  detach、disable、正在执行调用的释放。未增加永久回归矩阵。
- 真实浏览器：400px 窄屏 current B/effective A、跨两轮轮询保留草稿、
  发送消息的 queued 回执、标题保存回执、已知 query 面板、Draft 仅保存
  上下文；1280px 宽屏、键盘焦点、optional 运行面板不可用、断线保留核心、
  unknown 提交不自动重发、重连后重新读取变化。窄/宽屏无横向溢出。
- 独立只读审查指出三项 P2：后台更新清空输入、省略 Turn 误显示 idle、
  Messages/Reviews 导航缺失。修复后独立复审关闭全部三项，未发现新增
  重大问题。Leader 另完成 HTTP 和真实浏览器验证，接受该复审裁定。

运行命令：`make install-local`、`npm run build`、`npm run lint`、
`npm run test:core`，以及临时 `node output/t06-evidence.mjs` 和 Browser Use
本地 server 流程。专项脚本交付前删除，不进入永久 suite 或 CI。
最终 build/lint 通过；核心测试 81/81，测试阶段约 4.37 秒。
上述面板调用、超时和浏览器 query 面板证据使用注入夹具，不能证明它们在
生产入口可达；该代码现已删除。此前子 Agent 审查没有可核验 Claude 身份，
不能称为 Claude 审查。

## 正式 Claude 审查及修正

用户补审要求对应 `review-round-1 / turn-2`，冻结候选为
`project-1@77503111a9509eb19ea4b2faa2eab9560a2dd641`。
该 Turn 的 effective 为 `agentId=claude`、`adapterId=claude`、
`model=opus`、`effort=max`，原报告保存在 TurnResult.output。
Reviewer 独立构建、lint、核心 81/81、HTTP/SQLite 检查通过，报告两项 P2：

- A：生产入口未装配 Web 面板。Leader 接受可达性发现，选择移除未装配
  调用通路而非制造新用户鉴权／Host，保留真实描述查询。首轮隔离调用证据
  不被抹除，但也不证明生产可用。
- B：每轮完整拉取 delta 后丢弃。Leader 接受并删除该循环，采用已有
  当前快照读取；没有改变 delta 服务自身的合同。

两项均由 Task-main 局部修正，不创建 Repair WorkItem，不集成上游。
`review-round-2 / turn-5`（Claude opus/max）复核 `43bb4bb2…` 后关闭两项
P2，Leader 曾接受该冻结候选。此阶段没有生产 Web 面板，不能据此宣称
最终架构的面板能力已经齐备；后续用户补齐要求见下节。

修正验证：`make install-local`、`npm run build`、`npm run lint` 通过；
`npm run test:core` 81/81，测试阶段约 4.39 秒。临时
`node output/t06-review-fixes.mjs` 经实际本地 launcher 的 `task activate`
前置准备／原子工作区采用，再经 `task complete` 达到真实 completed 状态，
真实 HTTP 与 CLI 写入比较如下：

| 当前状态 | 修改标题（HTTP / CLI） | 发送新消息（HTTP / CLI） | Context 读取 |
|---|---|---|---|
| active | 均允许 | 均允许，原 user 身份 | 不 ack |
| completed | 均允许 | 均拒绝且无新 Message | 不 ack |
| archived | 均拒绝且不改记录 | 均拒绝且无新 Message | 不 ack |

因此 completed 并不意味着所有写入都拒绝；metadata 编辑是原合同允许的。
archived 行用合法 `archiveTask` 领域转换建立夹具后比较真实入口，不代表
CLI 归档清理验证：Gitless CLI 归档另暴露既有缺少 workspaceIdentity 的
清理拒绝，本轮未改该路径。测试没有直接更新 SQL 或构造假的 active 状态。

真实 Browser Use 使用独立服务、250 条事件历史验证连续两次轮询：至少
三次 Context 请求、零 delta／panels 请求；后台事实变化时未提交草稿保留，
断线后保留已有视图，重连清除草稿后显示新快照。400px 无横向溢出。
本轮没有重复未变动的完整宽屏交互矩阵。临时脚本和 Home 验证后清理。

Reviewer 标明未复现首轮浏览器、未跑 live Controller 的 contribution
命令往返、未运行真实 Provider：这些证据边界保留，不用 Node 夹具冒充。
其提及的既有 Markdown fenced-code 渲染风险也未在本轮改动，留给 Operator
另行判断；不将其算作本候选新增缺陷。

## 用户要求补齐 1/2：生产链路证据

本轮不恢复原先未使用的调用框架，而是交付真实 Controller 装配：
`yui web` → Controller HTTP listener → HTTP token → query-only context →
原 Registry/Host → 原只读能力。当前用户修改仍走原 typed Store 操作；
它们不是面板查询权限的隐式扩大。没有迁移、第二个 Host、用户自报 Role、
自动重发或 SDK 实现的复制。

临时 `t06-panels-check.mjs` 先在缺少受信任 Web 查询入口时失败，接通后通过：
普通 user 声明拒绝、Web 上下文不可伪造、Task/Context 查询成功、写能力拒绝。
临时 `t06-production-check.mjs` 启动真实生产 Controller factory，并以绝对
本地 launcher 启动 `yui web`，没有给 Web 注入替代面板端口：

- 内建面板直接可见、可查询；在同一个实际 Host 注册的受控贡献也可读取。
- 拒绝伪造 actor、跨 Task 输入和将面板引用改成写能力；无 token 为 403。
- Host detach 后旧查询不再执行，Registry disable 后目录不再列出贡献。
- 原实例 disposer 执行一次；替换为同 id 的新 generation 后，旧引用明确拒绝，
  新引用可查询。面板查询失败时核心 Context 仍可读取。
- 已归档修改、非法 JSON 和空白标题明确返回 not-submitted，记录不变化。
  提交后通知故障不会被错标为未提交，真实记录已保存。
- `web --status` 可读当前 URL，`web --stop` 后原 Controller/Kernel 仍存活。

真实 Browser Use 经上述生产链路验证：空白标题显示明确拒绝原因，修改
输入后无需重载即可保存；内建面板读取真实 Task 值；网络断开产生 unknown，
重连后保持锁定而不重发；归档编辑控件禁用。400px/1280px 页面无横向溢出。
测试发现普通领域校验也可能抛出 Error 而非 CliError，因此采用回滚边界
证明是否提交，而不按异常类名猜测效果。
关闭专项先复现了打开浏览器终端时 Web stop 被阻塞，再验证显式释放 WebSocket
后监听器及时关闭、恰好释放一个自有假终端连接；没有停止真实 Provider。
`make install-local`、build、lint 和核心 81/81 通过，最终核心测试阶段约 4.43 秒。

这些证据只使用隔离 Home、独立 Controller、合成 Task 和受控贡献，不启动
Provider。SDK 外部包激活仍由 T09 负责；本轮验证的是其应消费的实际
Surface/Registry 接入，而非声称已集成尚未合并的 SDK。临时脚本不进入
永久测试，最终候选继续交由 Claude 正式复核。

## 剩余边界

未验证真实 Provider 推理、真实 Operator 交互、付费 API、生产、共享
Controller 或资源。没有把截图、协议夹具或合成 Session 当作真实模型 E2E。
T07 ACP、T08 Draft planning、T09 SDK 激活与 environmentRef 原生启动消费
保持各自任务边界。不包含 push、PR、merge、tag、release、archive、全局
安装更新或共享服务重启。
