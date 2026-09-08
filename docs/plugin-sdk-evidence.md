# T09 实现、验证与交接

Task：task-20。精确基线：
`97ad88849c9a496230b134d2955f5f23e96deaa3`。
实施前已通过 Session Manifest 指定 CLI 加载并核对
`task-20/turn-1` 和 `context-snapshot-1` 摘要。精确交付 head 与 Task 完成事实
以受支持的 Task 记录为准；本文不是发布、合并或共享 Home 升级授权。

## 结果与采用

交付 [SDK 合同](plugin-sdk.md)：独立包经 `plugin.create/scan/validate/
validation/activate/disable` 和现有 capability CLI/RPC 贡献 Task-local 能力。
声明式解释器与明确授信的可执行 Node 子进程均已实现并验证，不只是 manifest
描述或 unavailable 占位。无需修改安装目录、建立第二个 Controller、Host、
Registry 或 Store。

验证保存源码摘要、实际产物完整字节及摘要、采用环境 identity、Node 版本和
实际执行检查。持久报告不是 grant；激活复核当前源码、权限、环境和依赖，只
初始化报告的确切产物。进程内发布完整贡献，旧调用保留原 generation；停用
停止新调用并在实际排空后 dispose。报告可以跨 Store 重开读取，重启不自动激活。

中央存储 8→9 `plugin-validation-evidence` 仅新增不可变报告表，最低支持仍为 1。
沿用 T05 环境与 CapabilityGrant 记录，不增加长期开发状态机、active 标志、
自动恢复、签名市场或 OS 沙箱。Operator 集成 T06/T07/T09 时应协调尚未发布
迁移的连续编号，不能重写已发布迁移或以本交付为授权升级共享 Home。

SDK 权限仍由 global Operator 管理。可执行的 build/validate/activate/call
分别要求精确 pluginId、源码/产物摘要、environmentRef、trust、phase 的现行
grant，并按真实尝试消费次数。因为 trusted-local 不能限制直接宿主效果，
执行 grant 必须允许 irreversible 能力上限；none/reversible 不冒充本机执行
授信。manifest scope/permissions 和 adopted 目录本身都不授予它。

T06 可沿既有 CapabilityDescriptor 消费能力；嵌套调用现在同时受父
requiredPermissions 和 effect 上限约束。未复制 T07 ACP/Endpoint。
T04 原生 Session 的 environmentRef 消费、T10 Leader 自扩展、Project/global
提升、T11 全面热插拔和自动升级不在本次实现内。

## 实际开发证据

全部使用一次性 SQLite Home、自有源码、临时 Git、独立 Unix socket、Node
子进程及 loopback HTTP fixture。测试进程移除继承的 YUI 身份/控制面变量，
CLI 使用本 checkout 的绝对 launcher，构建/执行不进入共享 Home。

已执行且退出 0：

- `make install-local`：当前 checkout 的本地 launcher，无全局链接。
- `npm run build`、`npm run lint`、`npm run test:core`：
  core 81/81，测试阶段约 4.23 秒。永久测试仅同步当前存储版本期望，
  没有加入专项或历史异常矩阵。
- `node --test output/t09-evidence.mjs`：最终 10/10，约 3.00 秒。
- `node output/t09-migration.mjs`：从精确基线构建出的真实 v8 loader 先验证
  旧 Home；新 loader 拒绝未迁移数据，显式 upgrade 生成备份并成功到 v9，
  原 Task 完全保留，新表为空，旧 loader 拒读升级后的 Home。
- `node scripts/assemble-runtime-package.mjs --output output/t09-runtime-package`
  及该包 `dist/cli.js --version`：组装/启动成功，含独立子进程实现及 SDK 文档。
  这是本地打包证据，不是发布产物或远端交付。

上述 `output` 脚本是临时开发证据，审查后移除，不是交付后的维护命令或 CI
要求。真实夹具和测试 Home 在各次完成后清理，原 Task 记录不受影响。

专项确认：

- 独立声明式包完整注册/调用/停用，Task-2 无法发现 Task-1 贡献；普通 user
  scope 和输入 actor 注入不能升权。验证记录跨 Store 重开仍可读，拒绝覆盖。
- A 验证后源码改为同版本 B，激活拒绝，已有 A 仍服务调用。并发修改时
  验证只执行捕获且已授信的 A，最终检测源目录变化，不运行未授信 B。
- 实际 Node build 在自有临时源码副本运行，生成不同产物及包内依赖；
  原源码不被覆盖。子进程实际 initialize/selfTest/call/dispose，通过捕获字节
  加载依赖；缺授信时 build 不运行。maxUses 按 build/validate 两次执行消费，
  之后激活与调用分别授信；次数耗尽和撤权阻止新执行。
- none/reversible 的执行 grant 被拒绝且不消费；明确的 irreversible 上限
  可用于安全 fixture。它验证授权语义，不证明 OS 隔离。
- 保留旧 Provider 时，新包的保留 namespace 或初始化失败不留下半套目录；
  异步激活遇到 disable 后拒绝迟到发布并清理候选。
- 普通 disable 立即从目录移除贡献，但正在执行的原调用完成后才释放 Host
  与环境引用；环境释放入口在活引用存在时拒绝。
- query 不能借 nested call 写入；未声明下游 permission 的包装器不能使用它。
  原调用 actor 保持不变，作者代码没有可提交任意原 receipt 的 observe 端口。
- 真实 authenticated dispatcher、独立 Unix socket 与绝对 CLI 完成 create、
  validate、activate、call、disable；不是仅调用私有 helper。
- 原 `DurableJobControl`、实际 runner 与 supervisor 执行一次 loopback 请求，
  形成原 start/exit receipt。相同 requestId 仍只有原 Job 和一次效果。
  SDK 包装器读取该原 Job 后故意输出错误 schema，结果为
  invalid/confirmed，原 receiptRefs、原 jobId 和真实 exit.json 保留；
  插件停用后原 Job 证据仍可读。没有重发外部动作。

## 独立审查与裁定

独立原生子 Agent 先只读评估设计，再审查完整限定差异。发现 P1：无 build
分支二次读目录，可能按 A 的授信执行并发修改后的 B。审查者在自有临时 Home
复现 `UNGRANTED_B_EXECUTED`；Leader 加入同一临时红/绿证据，并将路径修正为
直接使用首次捕获的 source。结束时仍复核源目录，拒绝保存过时成功报告。

独立复核确认 P1 关闭，并检查新增环境引用保护。独立重跑捕获产物授权、
disable 后实际调用排空、真实认证入口/环境释放保护三项通过，未发现新的
material finding，`git diff --check` 通过。最后的 grant 上限调整经同一审查者
确认语义，两处检查共用同一请求；Leader 的 none/reversible 红/绿证据通过。
最终限定复核还确认两处 grant 检查及 SDK/证据文档一致，接受交付，无剩余
material finding。
Leader 据完整审查、修复复核和最终本地验证接受该限定实现，不把子 Agent
的文字报告当作 Task 生命周期更新。

## 明确未覆盖

未运行真实模型/Provider、付费 API、生产账户、共享环境或真实用户资源 E2E。
只在自有可丢弃代码上验证 trusted-local 执行；没有获得也没有索取真实资源
验证授权。这不妨碍交付上述可执行合同，但不能称为强隔离验证通过。

模块来源限制、无初始化业务端口及净化 env 都不是恶意代码沙箱。
任意 trusted-local 代码的直接宿主访问、后台后代及 Controller 崩溃残留不在
本次受控效果/正常生命周期保证内。没有实现通用 sandbox 或跨进程恢复。
报告固定包本身，不保证构建器的系统依赖可在另一台机器重现。

未 push、PR、merge、tag、release、archive，未升级全局安装或共享 Home，
未重启共享 Controller/Provider，未启动后续 Task。采用需由 Operator 另行
集成代码及协调迁移；本 Task 完成不扩大这些授权。

## 持久启用意图增量（turn-6）

用户经 message-5 明确授权在原 Task 补齐持久启用/停用选择。增量基线为已接受的
`faf09fb642c76553f765fd8efb75daa739e83755`；原正式 Claude
`review-round-1/turn-2` 只覆盖该旧候选，不能作为本节新代码的审查结论。

### 合同变化

- 原 Store 新增 `plugin_intents`，保存 Task、plugin、enabled、确切 validation
  引用、选择 revision/时间，以及可选的该选择最近管理失败。没有持久 active/
  draining 标志；实际选择由 SDK 的目录引用关联唯一 Host，实际引用观察也只读
  Host。版本和摘要从原不可变 validation 派生。
- `plugin.inspect/list` 区分 desired、actual、instances、needsActivation。
  查询不加载作者代码、不消费 grant、不写 Store；重启保留选择但 actual 为 null。
- 激活的静态输入/归属、内容、环境、权限/依赖准入先于意图写入；可执行 grant
  消费与合法启用选择同事务提交。准入拒绝或事务失败不写选择、不启动候选。
  初始化/发布失败保留期望 B、原实际 A 和诊断。失败响应仍为 `kind: failed`，
  在可读取时附带当前视图；不把管理失败变成业务成功。
- 意图 revision 替换了原进程内 `changes` token。迟到候选只能对仍匹配的选择
  发布，失败诊断也仅能更新该 revision；没有新 lease、工作流阶段或外部 CAS
  参数。停用先提交选择并阻止新 acquire，原调用和清理仍按 Host 生命周期结束。
- 本分支中央链追加 9→10 `plugin-enable-intent`。原 1–9 不重写；
  旧验证没有表达启用意图，因此新表为空，不根据历史报告或进程猜测回填。
  与主线的编号冲突仍按用户要求留到合入协调，不访问/升级共享 Home。

### 证据

本节为 Leader 实际执行的增量验证，不冒充独立 Review：

- `make install-local`、`npm run build`、`npm run lint`、
  `npm run test:core` 通过；core 81/81，测试阶段约 4.25 秒，
  永久用例仅同步当前迁移版本期望。
- 临时 `node --test output/t09-intent-evidence.mjs` 最终 11/11，约 3.22 秒。
  使用真实隔离 SQLite、原 authenticated dispatcher、Node 子进程、自有代码、
  原 grant Store，以及真实 Unix socket/绝对本地 launcher。
- 临时 `node output/t09-intent-migration.mjs` 通过：从精确旧提交导出并构建
  v9 loader，创建合法 Task、环境、真实验证报告并激活；关闭后由旧 loader
  确认 current v9。新 loader 先拒绝普通打开，显式 upgrade 产生备份并进入
  v10，原 Task/验证逐值相同、意图表为空，旧 binary 拒读新 Home。
- `node scripts/assemble-runtime-package.mjs --output output/t09-intent-runtime`
  与组装包 `dist/cli.js --version` 通过；新实现文件与 SDK 文档包含在包内，
  文档链接/代码围栏及 `git diff --check` 通过。临时组装包随后清理，未发布。

专项覆盖启用/停用后的重开 Store、读取不执行代码、Task scope、非法字段/
跨 Task/无 grant 不写意图、事务失败不发布/不停用并回滚未执行的 grant 消费、
失败 B 保留 desired B/actual A/诊断、撤权后重启不自动或显式执行、
停用期间的真实引用数、迟到候选/清理失败不覆盖更新选择。
正常停用后原报告仍可读；本增量未修改原 Job/receipt owner 或重跑完整旧
loopback 效果专项，不能把这轮查询检查冒充旧外部效果链的新 E2E。

最初的两项契约检查分别以缺少 `plugin.inspect` 和缺少失败视图失败，随后变绿。
故障注入还复现了新增响应读取在发布后出错时会误入候选回滚的问题：
已选中实例被卸载，actual 变为 null。修正将发布后的诊断读取移出候选回滚
边界，同一探针确认错误响应不会撤销已发生发布，后续实际调用仍成功。

事务、注册和清理故障使用受控 port 注入；重启验证包含真实 Store 重开和
全新 Host/Registry/SDK，CLI/socket 验证保持自有控制连接，不宣称完整生产
Controller 崩溃恢复。临时脚本在交付前移除，不进入永久 suite 或 CI。

### 审查与停止线

本增量须针对新精确候选请求正式 Claude Opus 审查，并由 Leader 完整读取原
Turn 报告后裁定；审查身份、ReviewRound/Turn、精确候选及裁定以 Task 持久记录
为准。本节不预先声称独立审查通过，也不改写旧审查事实。

没有扩展 T10、T11、Project/global 提升、OS 沙箱、后台恢复或控制面自身的
唤醒/busy 修复。未测试真实模型/生产/付费/共享资源；未 push/PR/merge/release/
archive，未同步上游或升级共享安装/DB、重启共享服务。

## review-round-2 修正（turn-8）

正式 Claude `review-round-2/turn-7`（effective `claude/opus/max`）完整审查
`43c2cd9b23ca68f7666939ca121dbbbd44334b67`，结论为无 P1、建议接受但有两个
P2，以及作者运行环境说明缺口。Leader 完整读取原报告后作以下裁定：

- 接受每次 call 永久追加 reservation 的增长问题。本地红证据确认 1000 次
  调用追加 1000 个 key。修正后 `call` 只原子递增 usesUsed；原调用持有的绑定
  闭包证明它已消费额度，并继续复核 grant 是否存在、撤权、到期、参数与上限。
  不导出该闭包，也不将调用当作可跨进程恢复的步骤。管理阶段继续记录 key；
  既有历史 key 保持原样，不截断，不添加清理 worker。
- 现行 grant v2 与 Store 早已允许 reservation 数量小于 usesUsed，且允许
  计数递增时原 reservation 数组不变；此次没有改变持久布局或验证规则，无需
  新迁移。原 release workflow、environment adopt 继续显式提供自己的 key。
- 部分采纳永久覆盖建议：按照 Project Skill 对缺失基础主路径的例外，新增
  一条 `test/core/plugin-smoke.test.js`，覆盖真实认证入口下独立声明式包的
  创建、验证、激活、调用、选择查询、停用及持久读取。没有把增长、撤权、
  异常和竞态矩阵转成永久测试；不能仅按代码行数要求保留所有临时探针。
- 接受文档缺口，补充 `docs/plugin-sdk.md` 的作者全局 API 表，区分 ECMAScript
  内建值、缺失的 Node/Web/定时器 API 与 `api.call`。未改变运行环境或增加
  API，更未把变量缺失解释成 OS 沙箱。

本次实际运行：

- `make install-local`、`npm run build`、`npm run lint`、`npm run test:core`
  通过；core 从 81 增至 82/82，测试阶段约 4.23 秒。新增单条 smoke 独立运行
  约 87ms，不包含模型或外部 API。
- 临时 `node --test output/t09-call-grants.mjs`：5/5，通过真实已认证入口、
  自有子进程和隔离 SQLite。1000 次 call 后 usesUsed 从 1 到 1001，
  reservation 仍只有原历史 key，grant JSON 从 566 到 569 字节（仅数字位数）。
  不以单机耗时声称通用吞吐保证。
- 最后一次 `maxUses=1` 的合法调用仍能完成嵌套 query，下一调用被拒绝；
  进行中撤权拒绝其后续嵌套动作。执行失败仍消费一次，消费事务失败不消费。
  build/validate/activate 的原 key 方式与既有历史保留保持不变。
- 通过实际作者模块确认文档中的 globals：Promise/JSON/Math/Date 与 console
  可见，列出的 Node/Web API 和定时器不提供。未把这项检查称为安全隔离验证。

增长/失败等临时脚本在交付前移除；仅上述正常主路径 smoke 常驻。本轮未改
迁移链，因此复用原精确历史迁移证据，不重复或伪造迁移。新修正候选仍需正式
Claude 复核；精确 ReviewRound/Turn、candidate 和最终裁定由 Task 记录保存，
本节不预先宣称复核通过。所有原停止线不变，未同步上游、发布或使用真实资源
作为测试对象。
