# T10：受权 Task-local 自扩展工程证据

日期：2026-09-08。Task：task-26。采用基线：
`013ffdc3154c18974f64c66b05ade018feb63c2b`（PR320）；开工时远端 master
与该提交一致。没有采用其他 Task 私有实现、修改原始 base 或执行发布。

## 交付与相对旧方案的更新

T09 已交付独立包、验证产物、精确执行 grant、持久启用意图和唯一 Host。
本次只补齐既有 `plugin:manage` 权限的 Task Leader 分支，并更新 SDK 与
Leader Skill 消费者。目标由已认证 context 绑定；没有新 CLI 管理入口、
Store、Host、Session 鉴权、自动恢复、reload 或迁移。存储仍为版本 11，
已发布迁移 1–11 未变，未占用并行 Task 的迁移号。

现有身份入口逐动作检查当前 Session，并保留本基线 capability 入口的 active
Turn 要求；本次不另建去 Turn 门槛的替代认证。task23 后续采用时应沿同一个
`createJobCallAuthority`／managed Session 边界合流。Task-local 插件仍禁止
声明 `plugin:manage`，Leader 不能借插件配置覆盖核心或下放 Operator 全部权限。
T11 的实现替换与 Session 长引用仍由其原责任方处理。

## 已运行的确定性验证

- `make install-local` 创建本 checkout 的绝对 launcher；私有 Home 通过
  交互 PTY 执行其 `setup`，随后测试自行承载私有 Controller。
- 原有插件 smoke 改为真实 SQLite 内的 Leader Session/Turn 主路径：
  创建、验证、激活、同 Session 动态发现与调用、保存 Artifact、停用后读取。
  未加第二条永久插件路径。修改权限前在 `plugin.create` 得到 unavailable，
  修改后通过。
- `npm run build`、`npm run lint`、`npm test` 通过：82/82，测试阶段约
  4.52 秒；单独插件 smoke 约 131ms。`git diff --check` 通过。
- 临时 `node output/t10-protocol.mjs` 通过。使用绝对 launcher、真实 Unix
  socket、SQLite、Registry/Host 和实际 Node 插件子进程。身份用正常 Role、
  Session、Turn 和 Manifest 生成器建立，无内部 authority/component 注入；
  grant 通过该私有 Home 的受认证 Operator CLI 签发与撤销，不是生产 grant。

专项同时覆盖声明式与 trusted-local 路径：Worker/Reviewer 不能执行五项管理
动作；Leader 不能读取全局配置、注册全局资源或自行签发 grant；跨 Task 和
失效 Session 被拒绝。声明式工具在另一 Task 不可见。可执行验证先因没有 grant
被拒绝，精确授权后报告语法错误与 selfTest 失败，保存原错误 Artifact，再修复。
修复后的源码摘要必须重新授权；有效摘要可验证、激活，并通过原 Session 查询、
调用。还验证 call phase 缺失、额度耗尽、到期、撤回、源码与 validation 不符、
核心 namespace 覆盖均拒绝；失败候选不改变当前实例。

两次合法 call 的 `usesUsed=2`，`useReservations=[]`，没有每次 call 的永久
key 增长。重启的是私有测试 Controller/Host：desired 仍为 enabled，
actual 为 null，目录没有旧工具，不执行作者代码；保存的报告和原失败仍可读。
专项脚本是临时工程证据，不进入永久 suite 或 CI。

## 合成业务结果及证据身份

本次是确定性协议 fixture，**不是真实模型自扩展验收**。其合成 Task 为
`task-1`，native Session 标记为 `fixture-task-1-leader`；codex 是 fixture
Role 的配置标签，没有 Provider 调用、实际模型或真实 native Session 回执。
固定的脚本实现不能用于声称真实 Agent 自行选择、编写或修复成功。

合成 ledger `[["Alpha",3,7],["Beta",2,4]]` 经新增 `report.convert` 得到：

```text
# Synthetic inventory
Rows: 2
Total: 29
```

通过公开 `artifact.save` 保存为
`artifact-aef9c097-bcc5-4569-b2b7-f8b57e048688`，验证记录为
`validation-2728dad6-a842-474c-9d22-23fd37829de2`，包摘要为
`62f6e537c29c62846ed0e9e5de2313dea5f29453f5eabff1d6497bfaced0819a`。
完整 CLI 响应、验证记录、grant 来源、调用 Provider 及业务结果保留在本 checkout
的 `output/t10-private-dW7Lpb/evidence.json` 和其私有 SQLite 中。
这是本地可复核定位，不是跨 checkout 的共享成果地址。

## 验收边界与剩余工作

S28/S45 的本次权限路径及 S42 的稳定桥协议已获得上述工程证据。S32/S33
以及 S42 的真实 Agent/native Session 场景仍未执行：本 Task 未授权把真实
Provider、付费模型或共享资源作为测试对象。不会用预写脚本冒充、不创建
InputRequest 索取未请求的测试资源，也不据此宣称完整真实场景验收完成。

trusted-local 不是 OS 沙箱；本次不承诺拦截任意作者代码绕过 SDK 的外部效果。
未改动既有嵌套操作回执 owner 或 unknown 语义，未重复宣称真实外部动作验收。
独立审查与最终裁定记录在 Task；交付说明须区分工程完成与真实场景缺口。
未 push、PR、merge、tag、release、archive，未升级共享安装/Home/DB 或重启共享服务。
