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

## 未覆盖与交付停止线

未运行真实 Codex／Claude 模型、付费 API、生产账户或共享资源 E2E。
协议 fixture、SQLite 和本地进程证据不等于真实模型验证；S18／S19／S41／S43
涉及的 T03 生命周期整合及 T05 资源能力须在合法合并后补充验证。
未接入第三 Agent／ACP、透明会话迁移或动态插件加载。
未 push、创建 PR、merge、tag、release、archive 或启动后续 Task。
