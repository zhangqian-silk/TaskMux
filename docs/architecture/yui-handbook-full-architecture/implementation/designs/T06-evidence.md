# T06 Surface 实现与采用

Task：task-18。基线：`97ad88849c9a496230b134d2955f5f23e96deaa3`。
精确交付 commit 和完成裁定以 Task 记录为准。本变更不包含发布授权。

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
| 可选 `GET/POST .../panels` | 受信任根绑定的 `SurfaceContributionPort`，调用原 Registry/Host |

本地修改回执返回原记录、记录版本及请求关联 ID。请求 ID 不被冒充为本地
修改的幂等账本：响应丢失时显示 unknown，页面不自动重发。进行中的重复
点击被阻止；重连只读事实，不重放写入。消息的 queued 仅说明已为 Leader
排队，不证明 Provider 接受或目标完成。Job 的外部操作身份、效果与终态仍
由 T01/T02 的原 Job 记录负责；Surface 不创建替代操作记录或恢复流程。

## 身份与对话目标

所有 HTTP API 使用实际本地页面 token；请求正文不能指定 actor、caller
或 Role。Web 用户进程直接使用现有本地用户 typed 入口，不冒充受管 Session。
从 managed Session 启动用户 Web ingress 被拒绝；原 capability RPC 的
native Session 鉴权、跨 Task 限制和权限检查不变。

全局入口保留 Operator Session。Task 页面提供发送给 Leader 的消息表单；
发送者始终按原用户身份记录，不因文本要求修改全局配置而变成 Operator。
原 Task terminal 保持只读并明确标注。Draft 可以保存消息作为上下文，
但 planning Session 尚不可用；页面不创建或伪造 T08 的运行时。

## 读取、显示及贡献

- 静默轮询现在刷新已打开的 Task。delta 分页完整保留首次上界，随后重建
  当前 Context；无效 cursor 使用当前 read，不把当前值冒充历史事件。
  断线保留上次读取，重连补读；未提交表单不被后台渲染清空。
- Role 当前配置和 Turn effective 分开。正文省略或记录截断导致无法判断
  活动时显示 unknown，不填成 idle。旧运行观察选择 Turn 的实际 Agent
  Session，而不是当前选中的另一 Agent；返回原 native Session、Endpoint
  实现引用与观察时间，不改写历史。
- Context 可选观察失败独立显示 unavailable。旧运行面板异步读取、有独立
  客户端等待上限；核心视图和固定 Artifact 来源仍可读取。
- `CapabilityDescriptor.surfaces` 是可选进程内描述，不是新持久 schema。
  CLI name/help 映射明确 capability；面板仅允许纯文本、无凭据 HTTP(S)
  链接和 query 的 JSON renderer。默认查询也有通用数据面板描述。
- 注册校验在原 Registry 的原子发布前进行。贡献每次从当前目录派生，
  不维护独立实例表。停用、detach、撤权、旧 generation 与 in-flight drain
  沿原 Registry/Host；缺少专用面板不影响已保存结果。
- `createSurfaceContributionPort(registry, trustedContext)` 为受信任装配方
  提供绑定身份的 listPanels/loadPanel；Web 不接受凭据或创建第二个 Host。
  当前独立 `yui web` 尚未连接 Controller 的动态插件目录，明确显示其
  unavailable。T09 负责 SDK 激活与相应装配；本次验证了真实消费端口和
  隔离贡献，不宣称 SDK 已端到端接通。接口已在 task-18 message-2 转达。

没有新增数据库字段、迁移、确认阶段、后台重试或自动评审策略。
既有 CLI 命令及可读输出保留；不强制所有内部调用 JSON 化。

## 验证与独立审查

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

## 剩余边界

未验证真实 Provider 推理、真实 Operator 交互、付费 API、生产、共享
Controller 或资源。没有把截图、协议夹具或合成 Session 当作真实模型 E2E。
T07 ACP、T08 Draft planning、T09 SDK 激活与 environmentRef 原生启动消费
保持各自任务边界。不包含 push、PR、merge、tag、release、archive、全局
安装更新或共享服务重启。
