# T03 技术方案｜任务事实、角色配置与 Context

硬依赖：T02。

任务定义：[交付范围与证据](../tasks/T03-task-context.md)。

## 1. 目标模型与现有记录

先定位当前 Task、Brief、WorkItem、Role、Turn 输出、Review、通知和 Context 的权威存储。通过公开接口提供目标视图，不为了让状态枚举变短立即删除已有历史或诊断字段。

Task 对外生命周期为 draft／active／completed／cancelled／archived；WorkItem 表达 open／accepted／retired，执行细节从 Turn 读取。已有复杂字段如果仍有证据价值可继续保存，但不成为新的业务必经路径。转换、归档授权、保留与不可重开规则以 [Task 模块](../../modules/02-task.md) 为准；当前 retired 到 cancelled 的采用走中央迁移并保留原隔离及结束证据，不能作为普通读写的双形态 adapter。

## 2. Task 与结果

Brief 在数据库事务内读取最新记录，只修改指定字段，不要求 expectedRevision。同一字段以后一次明确写入为准，更新前后值随事件在同一事务保存。Role 当前配置与实际执行配置分开。Assignment／Turn 保留实际输入说明；Candidate 固定提交结果与来源；Review 只引用 Candidate 和 Reviewer Turn。

结果适用性由 Leader 结合当前要求明确判断，不建立独立的自动失效版本体系。接受时保存明确选择和说明，不要求当前 Brief 与来源版本相等。Task／WorkItem 只保存当前结束和接受选择；历史由持久事件承载，不在对象内累计第二份历史数组。找回旧值后由 Leader 决定是否明确重写，不自动回滚。

直接完成 Task 支持 summary 和 artifact refs，不强制合成 WorkItem。完成和取消阻止后续自动派发，迟到结果仍归原 Turn。显式重开不自动重放所有过去的通知和未知输入。

## 3. Role 配置

为每个角色保存稳定身份、当前 Agent 选择、指令、Skills 和配置。模板应用为一次显式配置更新；需要动态继承的字段显示来源，执行时再解析为有效快照。

更换 Leader 的承载时撤销旧管理入口，保留原 Worker 分配与所有结果。Role 修改不被误用为“旧进程已经停止”的证据，实际停止交 T04／T05 的执行资源路径。

## 4. Context

一次数据库读取产生核心记录和 throughCursor，delta 分页固定上界。核心工作集包含目标、当前角色、WorkItem、结果、未答问题、未决输入与重要操作引用。长内容返回可展开引用和省略信息。

外部观察单独放 source／observedAt／coverage，不能与核心 cursor 混称原子快照。可选 Context 贡献只读、有限输出，失败不影响核心任务信息。

同一 caller 的访问范围同时作用于正文、计数和引用，避免只隐藏内容却泄漏其他 Task 的资源名称。

复用授权判断，不要求所有查询构造整份 Context：消息查询读取消息，delta 读取事件，inspect 按目标记录读取。可选观察保留现有最小端口，不扩展插件框架或缓存。

## 5. 消息与通知

复用现有 Message／Event／Turn 记录建立 batch、attempt 和 acceptedTurn 关系。Context read 不 ack；Provider 接受才记录送达；送达不等于已落实要求。

忙碌时保留同一输入，不启动竞争会话。未知批次换绑后仍需查证。故障通知只沿 Worker／Reviewer→Leader、Leader→Operator，Operator 自身问题由用户处理，不创建备用路由。

普通工具错误返回当前调用者即可；不要对每个校验错误都广播全局故障。重复观察合并到原事实引用。

## 6. 数据与兼容

接口可在当前契约上用边界包装提供，原记录仍是唯一事实；是否需要包装及删除条件按 [T00 基线](T00-current-baseline.md) 判断，不强制先做 adapter。必要数据变化使用明确 migration，保留历史输出和验收。不要通过双写新旧 Review result 来做兼容。

Core 不从自由文本推断“用户已经改变需求”。用户直接与 Leader 对话时，Role 指引要求持久化必要信息；无法观察原生对话的情况明确覆盖范围。

## 7. 验收

S03 验证 Role 切换；S05／S06 验证记录修改与结果判断独立；S07／S08 验证 Review opaque 和 WorkItem 不随执行失败；S15–S20 验证快照、消息和责任路由。

S36／S41 验证配置展示与管理干预；S43 验证终态和重开；S46 验证 Context 可选贡献失败。T04 尚未完成时可用契约端点测试数据，但真实会话交互要在对应集成验证中明确完成。
