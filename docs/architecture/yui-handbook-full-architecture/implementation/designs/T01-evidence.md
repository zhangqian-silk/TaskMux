# T01 实现、验证与 T02 交接

Task：task-11。采用基线：
`6c8ce1e39c5cb6cbafd3652d2f5fa0fa498b27ee`（T00 经 PR #299 squash）。
日期：2026-09-06。实现提交与独立 Review 的精确引用以 Task 持久记录为准。
本报告不是远端合并或 Task 验收记录。

## 采用决定

首个真实采用者为现有 `job.start`，不是另造通用 Operation 表。
它已有请求、执行状态、checkpoint、exit 与日志；缺失的是调用者绑定、
独立请求身份及不随失败消失的效果证据。现在扩展同一 DurableJob payload，
仍由 Job Control 和现有 Supervisor 经同一个 SQLite Store 写入。
Integration、CLI 和 Controller Job RPC 继续共用这个写入者，没有旁路账本。

`effect` 在这里描述 **runner 发起这一外部操作**：
未尝试为 none，发出前提交 possible，观察到 runner 为 confirmed。
confirmed 不表示任意 shell 命令的所有业务效果均成功；
命令内部效果仍须读原始回执、step 结果及业务系统证据。不能据此声称
Provider 接受、邮件发送或远端发布已经成功。

Task 五态、archived 合同、Agent Runtime 协议、Provider Sessions 与
原 Turn 采集器未改。未采用 task-9 的私有增量。没有新调度器、恢复 worker、
备用 Operator、自动 Provider 切换或第二 Controller。

## T02 的最小公开入口

- `src/kernel/instanceHost.ts`：`attach`、`acquire`、句柄 `release`、
  `use`、`detach`、`close`。`use` 在 finally 释放短调用；Session
  保存具体句柄，关闭时释放。detach 当即拒绝新 acquire，等所有引用结束再
  调用拥有者 disposer。清理按逆序执行，某项失败不跳过其他清理。
- `src/kernel/kernelPorts.ts`：Controller 的唯一装配入口
  `createKernelPorts(store, runner)`；返回 `host`、固定的 Job Control /
  runner 引用与 `jobs`。生产 `startFileTaskControllerRuntime` 已使用它，
  返回的 `kernel` 供 T02 接入；不要在每个 capability call 再创建一个 Host。
  Controller 持有两个固定实现引用，关闭时释放。这里不杀 detached Job
  或共享 Provider daemon。
- `src/kernel/callAuthority.ts`：可信入口持有 `CallAuthority`，用该入口的
  认证器产生 `TrustedCallContext`，每个新动作调用 `authorize` 再读当前权限。
  JSON 复制、伪造 actor、跨实例的 context 不获授权。此对象不是插件沙箱；
  认证器、凭据和 Store 不能交给任意插件作者代码。
- `createJobCallAuthority` / `createDurableJobControl` 复用已有 Job 管理入口。
  `jobs.startJob({...params, requestId}, now)` 返回 `{job, created}`；
  `getJob` 与 `inspectJobOperation(job)` 直接读取原事实，无额外记录。
  `recordOperationEvidence` 是所属模块保存原记录时使用的纯函数，
  不是向插件开放的任意 Store 写权限。

用户 CLI 的本地原子修改继续使用原有认证/handler；Job socket 保留原来的
managed caller 要求，不因声明 `scope:user` 或 `actor:operator` 扩权。
T02 的插件/Surface 桥应从实际可信入口认证，不能把 capability input
转换为身份。新的通用插件认证协议不属于本次实现。

新请求身份在同一 Task 和调用主体内去重，目标或输入不同返回原 Job id
及明确冲突。原调用者、目标、具体 runner、输入摘要和绑定指纹不可改写。
Integration 检查以既有 IntegrationAttempt 为领域操作身份：
Controller 在同一事务中按 owner 找回唯一原 Job，再核对输入与目标，
跨 Leader / Operator 的 bind-window 恢复不会创建第二个 Job；
不一致返回冲突，已有多个 Job 返回诊断，不猜测应选哪个。
省略 requestId 的既有调用者使用内容身份；有意再执行必须显式提供新身份
或使用原有显式 retry 操作。未知结果、正常 pending 和输出失败均不自动重发。
重复请求读原记录不依赖当前 workspace HEAD 仍相同。

Caller 明文 key 不进入 Job 或输入摘要；Task authorityRef 是 caller-key
哈希、当前 Agent/adapter 和 native Session 的组合指纹，
不可用作 bearer。管理入口要求 live Session；发送前重新核对，
Session 结束、更换或 caller key 轮换均拒绝旧请求，不能只凭残留 key 哈希执行。
Host generation 是可丢弃的执行身份：同一 Session 的 Host detach/重新绑定
不撤销已经接受的排队 Job；新管理请求仍通过原入口的当前身份认证。
此处是现有 opaque authorityRef 的当前绑定计算，无新存储字段或版本。

Job 规格只支持可持久化的非秘密 command/env；可信调用方不能提交凭据值。
入口在计算摘要与保存前拒绝已识别的凭据参数、秘密变量名
（含 SSH_PRIVATE_KEY）、PEM 私钥内容与带 userinfo 凭据的 URL。
这些检查是常见误用防护，不是对任意字符串的秘密识别证明，
也不是不可信插件的隔离边界。没有凭据解析或秘密输入 API；
需要凭据的后续 capability 必须采用独立的引用/执行时解析设计，
不能把凭据复制到现有 Job 规格或输出中。

发起新 runner 前重新检查绑定、Task 执行权限、managed workspace 写权限、
owner 和实际 HEAD；明确拒绝的未尝试请求保留原记录和 effect:none，
以 failed 保存诊断，并在同一事务唤醒 Leader。不会因每次调度重复报错，
也不擅自重试。非领域拒绝（例如存储异常）仍返回运行错误，不推断为撤权。
采集原 runner 的
回执不经过这道管理授权，不因原调用者撤权丢失既有结果。

## 存储 1 → 2

唯一 Home 版本由 1 升为 2，最低支持仍为 1（0.15.0 起）。
在 `sqliteSchema.ts` 追加 migration `job-operation-facts`，不修改已发布
version 1。DurableJob 当前 payload 为 schemaVersion 2，普通运行不双读旧格式。
同表唯一索引保护调用主体与 requestId。

有效历史 Job 保留全部旧状态、结果、checkpoint、日志位置和幂等键。
旧版本没有记录调用主体及效果证据，因此迁移标记 historical:unrecorded /
possible，不伪造凭据或回执。旧 queued Job 若没有可证明的发起证据，
升级后可成为 unknown 而不会擅自执行；意图仍在原 Job 中。
旧内容身份再次提交时返回原 Job 的诊断，需要先检查，不会隐式改用新身份重做。

采用必须经现有 `upgrade --dry-run` / `upgrade` 或 update 的 staged-binary
升级握手。保持停写，使用升级器生成的同级 `<home>-backups` SQLite 备份，
迁移后严格校验。旧 binary 拒绝 version 2；代码换回去不降 schema。
恢复旧备份不撤销外部效果，也会丢失备份后的本地事实，应独立授权并核对。
本 Task 没有升级共享 Home，也没有更改 update preflight/apply 握手字段。

## 实际隔离证据

专项脚手架仅用于开发，不加入永久测试/CI；报告保留在此。
使用临时 SQLite Home、本地 Git 仓库、loopback HTTP fixture、实际
EventTarget listener/timer，以及一次真实 detached Job runner。
HTTP 场景通过受控 process/artifact port 注入故障，不冒充真实 Provider。

| 故障位置/状态 | fixture 收到请求 | fixture 内部效果 | 重入并重新打开 Store 后 |
|---|---:|---:|---|
| 发送前中断 | 0 | 0 | unknown，不新增请求 |
| 接受后断开 | 1 | 0 | unknown，仍为 1 |
| 效果发生后、回执前断开 | 1 | 1 | unknown，仍为 1 |
| 回执输出 schema 错误 | 1 | 1 | failed，仍为 1，保留 exit 与部分日志引用 |
| 正常 pending | 1 | 1 | running，仍为 1 |

另已检查：

- S25：A 的调用尚未结束时注册 B，新调用使用 B；A 的 Session 未释放时
  不 dispose；最后引用结束才移除实际自有 listener/timer，共享 listener 仍响应。
- S45：伪造 context 拒绝，撤回 fixture grant 后旧 context 也拒绝；
  轮换 durable caller binding 后 queued/new Job 没有发出新请求，
  原 running Job 的迟到回执仍成功归档。
- S10：两个真实 SQLite 连接提交过期 CAS，返回 `currentRevision` 且不覆盖
  首个 Brief；嵌套 CAS 与 persistence-worker RPC 也保留冲突与当前版本。
  Job/operation 查询未增加 revision 或账本。
- 实际 runner：经生产 Host/process port 执行一次非 shell argv 本地文件追加，
  只有一行效果，原 Job 成功并保留回执，重复 start 返回 created=false。
- S44：从精确基线代码构建的有效 version-1 Home/Job 升级到 2；
  当前 loader 在升级前拒绝，旧 loader 在升级后拒绝。
  升级备份在另一目录被旧代码成功打开；注入迁移后校验失败，
  升级器恢复原始 version-1 数据库及原 Task/Job。
- S20：完整差异直接检查，无 Operator 自动恢复机制。

交付检查：`make install-local`、`npm run build`、`npm run lint`、
`npm test` 均通过。现有测试 82/82，测试阶段约 4.23 秒（build 另计）；
没有扩大 T00 已指出的现有测试规模，仅更新当前版本断言。
包装配与启动检查通过；未执行真实模型、付费 API、生产资源或共享安装验证。

独立最终 Review 单独由 Task 配置的 Reviewer 对固定提交执行，结果与 Leader
接受写回 Task；本报告的自查和通过测试不能代替它。
后继仅由 Operator 核实完成与合法采用路径后启动。本成果未授权
push/merge/release/archive；本地 commit 不代表远端 master 已包含。

## 独立审查修复

review-round-1 / turn-2 独立审查 `e53018e3af00ed435a039b2f164e76a4b32a3726`，
未发现 P1，发现一项需修复 P2：撤权后 queued Job 只有运行错误，
没有持久诊断，持续占用 active 列表。Leader 接受该发现并直接修复：
复用 failed 结果与原子终态唤醒，不引入新状态、字段、迁移或恢复机制。
本次仅允许 effect:none 的 queued 请求走明确拒绝路径；
possible/confirmed 的既有请求仍由原采集路径处理。

临时 Supervisor port 验证先在原实现重现 queued 未收敛，再验证修复后四个场景：
启动前撤权、第二次发送前检查撤权、已 possible 请求、非领域存储异常。
每个场景执行十次 reconcile；前两者均零 spawn、一次 failed/持久唤醒，
保留请求和效果事实；possible 不重发；存储异常不误写失败。
`npm run build`、`npm run lint`、`npm run test:core` 与
`git diff --check` 通过；core 82/82，测试阶段 4.26 秒。
专项脚本交付前移除，最终修复提交的复审状态以 Task 持久记录为准。

审查的凭据过滤建议保留为边界说明：环境变量名过滤是启发式，
会拒绝部分非秘密名称，不能识别任意伪装或编码的秘密。
调用方必须提供非秘密规格；本次不扩展凭据服务或声称完整秘密检测。

review-round-3 / turn-7 的四项发现已由 Leader 核实：
Task Session 失效、合成私钥持久化、Integration 跨调用者重复 Job、
以及离线阅读版/清单缺项。新增的临时 port 探针在修复前复现缺失拒绝
与第二个 Job；当时修复后验证 Session 结束、generation 改变、
私钥环境变量/argv、URL 凭据、Integration 换调用者恢复共六个场景。
Integration 原请求返回 created=false，输入改变返回冲突；
秘密输入零 Job 保存。探针只使用合成数据和临时 Git，无真实凭据或外部效果。
文档包按其官方生成与检查脚本同步，结果见 `tools/verification.json`。
该自查不代替修复候选的独立复审，最终处置仍以 Task 持久记录为准。

review-round-4 / turn-12 在 `9d05604355fe142598011f1636af65607d798b4b`
给出 0 P1、1 P2：Host detach 保留 native Session，却因 generation 被纳入
authorityRef 而误拒排队 Job。Leader 接受该发现，修正前述 generation
绑定判断：已接受 Job 绑定耐久调用者身份，不绑定可丢弃 Host。
Task 与 Global 指纹均移除 runtimeGenerationId；入口认证、目标检查和
迟到结果采集不变，无新增字段、迁移或恢复协议。

临时 port 探针调用真实 startJob、authorizeJobStart、Session 创建与 detach
函数，使用一次性本地 Git 和内存 Store port。旧构建在 detach 后复现
CoreJobError；修复后两种 scope 的完整目标检查均通过，detach/重新绑定
允许，native Session 更换/缺失拒绝，Task caller key 轮换拒绝。
Job 保持 queued/effect=none，无 spawn；该探针交付前移除。
既有隔离 runner、迁移备份/恢复证据保留，未重复执行未改变的路径；
Reviewer 未复跑的项目由 Leader 基于原始自查证据承担验收判断，
不把本地 install-local 或一次性 runner 误当成真实 Provider 验证。
