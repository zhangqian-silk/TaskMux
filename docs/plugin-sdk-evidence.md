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
