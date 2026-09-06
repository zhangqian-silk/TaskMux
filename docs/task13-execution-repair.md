# Task13 执行关联与结果收尾修复

## 决定与授权

2026-09-06，用户授权脱离失效的 Yui 派发链路，在 Task13 main 直接增量实现。
保留基线 `6c8ce1e39c5cb6cbafd3652d2f5fa0fa498b27ee`、main 的
`6cad36a23ed2394ba6e509b73f8d3fb8f953c2ea`、原实现 `72ed7f0` 和返修
`cacd145b980814910113662ba4480afa1259bb68`。本地 Git 集成不代表共享
Task 记录已验收，也不代表全局安装、发布或最终 Review 已完成。

## 单一身份及事实所有权

- managed Turn：TaskStore 的一次执行，保存 effective、输入及原始结果。
- attempt/receipt：提交前登记的一次输入尝试，准确绑定 managed Turn。
  新登记保留所用 Activation 的引用，detach 不会擦掉原请求的来源。
- nativeSessionId / conversationId：Provider 会话，不随 Host 退出销毁。
- nativeTurnId：只有 Provider 协议确实提供时才存在。Claude 专用串行流
  以 attempt 关联结果，result 消息 UUID 不冒充 native Turn。
  管道写入回执的 authority 明确为 transport，不声称是 Provider 原生确认；
  准确终态仍可补充 Provider 接受和完成证据。Claude 当前声明 steer unavailable，
  不把串行流中新写一条输入冒充对某 native Turn 的精确 steer。
  managed Claude 不再安装缺少 attempt 的 Yui observer Hook；旧会话残留 Hook
  不产出 Task 事实。工具权限和用户自有插件保留，全局原生 Hook 不变。
  代价是暂不采集无法准确归属的 managed Claude tool/subagent/waiting 遥测；
  不用当前 active Turn 猜测归属来维持表面功能。
- runtimeGenerationId / activationId：当前启动承载的身份。Provider Activation
  的数字 generation 是该 Conversation 的承载序号；Role launchRevision 是配置
  修订。它们不是 T04 将来的代码实现 generation，不新增持久化身份层统一命名。
- Host 快照是观察，不是 Task 结果权威；Provider binding 保留输入处置，
  immutable observation 是来源证据。Review/Candidate 消费 Turn 及来源引用，
  不解析结果文本推导验收结论。

## 结果流程与事务

可信入口携带准确 attempt/native 身份。Store 的统一关联边界验证 Role、Agent、
Session、Activation 与原请求，不能根据当前 active Turn 猜测。
准确终态可以证明先前 submitting/unknown 输入已经被接受。

Git 工作区证据在业务事务外有界读取，提交时复核原 Turn 工作区。
终态也不进入 inbox 的外层批量事务；非终态仍可批处理。Git 子调用有5秒超时
和512KiB输出上限，事务内再校验 managed workspace 的持久化所有权。
同一 Store 事务完成 Provider 输入结清、Turn 结果/终态、必要通知和原始观察。
任何写入异常整体回滚；文件 inbox 不确认该事件，后续显式处理同一事件可以
完成业务写入，不新增恢复 worker、applied 标志或第二协调协议。

事件已收到不等于业务结果已提交。终态不走入口快速去重；同一执行的重复内容
幂等，冲突内容拒绝覆盖。迟到结果依据原接受/终态证据保留，不能结清 successor
的 Session、Turn、Review 或 mailbox。历史失败保持不变。
若迟到结果仍对应当前保留的原 attempt，只结清该 Provider 输入并保留原 Task
失败及新观察；不把“后来确认执行完成”改写成“原操作当时成功”。

报告缺失与结果转换失败保留不同诊断；有输出但无法存储是 runtime-failed，
不是“Agent 没有报告”。调度器遇到 Provider 终态但业务结果未提交时不伪造
missing-result，不自动重新提交输入，暴露一致性诊断。

## 恢复、启动与所有权

resume 保持原生 Conversation；Host ended 不是创建新 Conversation 的授权。
已知不可恢复返回证据，由操作者明确选择新会话。same-generation 未就绪/失败
与身份 mismatch 分开，异常本身不授权终止现有资源。

新启动以本次持久化 reservation 为依据；恢复和既有事件采用各自精确绑定；
迟到终态优先原执行来源。旧 Session 不遮蔽本次 reservation，新 reservation
不夺取旧执行。管理授权与旧结果采集不同，仍校验来源和工作区。
unknown 保留占用与同一 attempt；busy 不抢占、不偷发。只释放本次确实拥有且
已证明安全的附件，不停止共享 Provider 服务。
新 Conversation 在启动规划和持久化替换两处校验旧承载已释放且输入已明确结清；
不会把无 native ID 的 accepted/unknown 改成 rejected 来满足替换条件。

## 存储与历史采用

中央 storage 1→2 声明 additive payload 合同：accepted 输入可无 nativeTurnId；
结果可使用 exact attemptId，新登记保留原 Activation 引用。合法 v1 历史仍可读，不改写旧合成 ID、failed Turn
或事件。旧 binary 应拒绝 v2 Home；升级须在受控停写窗口经既有 upgrade 入口
备份并迁移，回退数据库备份需要核对备份后的事实，不能只回退 binary。

Task13 event-4725 是原 implementer 报告，不是最终 Review。保留 turn-20 的
失败和报告来源；本地核对并集成 cacd145 是代码采用，不修改共享任务数据库。
共享任务的 Candidate 若要求 completed 来源 Turn，不能伪造完成或重放事件绕过。
可由后续合法执行明确引用 event-4725 与 cacd145，验收精确集成提交并产生新的
交付结果；历史报告作为来源而非替代新的独立审查。此步骤需恢复合法任务入口。

## 验证及交付边界

临时 Home、真实 SQLite/Controller/Host 与 fake Provider 验证异常链，临时脚手架
不加入永久 suite。build/lint/core 加最终精确提交的独立原生 Reviewer，
不得把该 Review 声称为共享 Home 的 ReviewRound。
验证结果另附实际命令、断言和局限，不将计划写成通过。

与 T04 对齐的是 attempt/Session/Host 分离、精确结果关联、幂等与恢复边界；
仍不实现完整 AgentEndpoint、ACP、SDK、热更新、通用恢复机制或 Task12 T02。
未授权真实 Provider 测试、共享 Home 数据修复、全局安装、共享 Controller
重启、push/merge/release/archive。历史第一次恢复失败的最内层原因已丢失，
本修复不能声称还原其底层原因。

## 已执行证据（最终 Review 前）

- `npm run build`、`npm run lint`、`npm test`：通过；现有 core 82/82，
  最近一次 test 阶段 4.20 秒，未增加永久测试数量。
- 临时 `node --test test/task13-evidence.mjs`：14/14；真实 SQLite、inbox、
  processor，包含接受前终态、无 native ID、重复/冲突、三处事务中断、迟到报告、
  detach 前未确认输入、1→2 升级及 v1 备份的实际读取。报告与 failed 记录不变。
- 临时 `node test/task13-host-chain-evidence.mjs`：两个真实 Host 子进程、
  Controller socket、Store 与 fake Claude 子进程，58 断言通过。每个 Task
  Provider 接收数=1、完成事件数=1、重复 attempt 被拒绝；故意延迟回执150ms，
  实际输出顺序确认 terminal 先到。不是实际 Provider E2E。
  真实 socket 断连注入验证登记明确失败/提交后补偿/确认未知时 Provider 接收数均为0；
  管道写入后回执落库失败则接收数为1、unknown 保留且重复 attempt 不重发。
- 临时 `node test/task13-hook-publisher-evidence.mjs`：20 断言通过；
  旧 managed Hook 不猜身份，全局 Hook 和工具权限保留，重建附件按原 Activation
  采集旧结果、错误来源拒绝，真实 publisher 区分报告缺失与 NUL 转换失败。
- 临时 `node test/task13-error-evidence.mjs`：32 断言通过；Digest/GitHub token
  脱敏、unknown steer 两次请求一次 Provider 调用、失败不串单、登记结清失败
  保留占用和 cause、UTF-8 大消息 raw 首尾及标记、公开 Controller 错误脱敏。
- 恢复子 Agent 另执行真实临时 SQLite＋Coordinator/Host port 证据：同 generation
  与 mismatch 不 cleanup、reservation 不被旧 Session 覆盖、resume 原会话、
  detach 保留 submitting/unknown/accepted、原 Activation 归属；不是完整 Provider 测试。

这些临时脚本仅用于本次开发，handoff 前删除。最终精确提交和独立审查记录在交付说明补齐。
