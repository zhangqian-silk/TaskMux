# 独立插件 SDK

独立目录可以通过现有 `capability` 入口贡献 Task-local 能力，无需修改 Yui
安装目录。SDK 管理仍只允许当前受认证的 global Operator；它不授予 Leader
自扩展权限，也不实现 T10、Endpoint 注册或 T11 自动升级。

这里的激活指当前 Controller 中的实例。验证记录及实际包内容持久保存在原
Store，Controller 重启后可以读取报告，但必须显式重新激活。不存在独立的
`active=true` 账本、自动执行作者代码、市场、签名平台或恢复 worker。

## 入口与环境

所有管理操作复用原 Controller、CapabilityRegistry、InstanceHost 和身份入口。
在已认证 managed Operator Session 中使用以下能力；普通终端不能靠声明
`scope:user` 获权。开发 checkout 必须使用其绝对 `output/dev/bin/yui`，
并明确选择自己的隔离 Home，不能用全局安装验证。

| 能力 | 输入（Task 由 `--task` 绑定） | 可观察结果 |
| --- | --- | --- |
| `plugin.create` | `preparationId, id, kind` | 新目录、manifest、示例；不执行作者代码 |
| `plugin.scan` | `preparationId, directory` | 数据型扫描的 manifest、文件名、SHA-256 |
| `plugin.validate` | `preparationId, directory` | 不可变 validation ID、源码/产物摘要、环境和已执行检查 |
| `plugin.validation` | `validationId` | 报告摘要，不启动代码；本 Task 的 `task:read` 调用者可读 |
| `plugin.activate` | `validationId` | 实际 Provider generation、产物摘要及完整贡献名 |
| `plugin.disable` | `id` | 停止发现/新调用，等待实际引用排空和 dispose |

`directory` 可以是环境内的相对路径或绝对规范路径，但不能是环境根、外部
路径或经 symlink 到达的目录。先通过 T05 的 `environment.prepare/adopt`
明确采用一个 writable 环境。scratch 是独立目录所有权，**不是 OS 沙箱**；
用户目录还需要 T05 的具体 Resource grant。每次新动作复核采用记录、Task
当前状态、目录 identity、资源意图及现行 Resource grant。

SDK 的实际构建、候选和活实例引用会阻止公开 `environment.release`。
先停用并排空；T05 仍不会删除用户目录，也不会强删非空 scratch。
插件停用不删除源码或验证证据，不提供自动卸载/GC。

示例（`T`、`P`、`V` 分别替换为实际 Task、adopted preparation、validation ID）：

```text
<checkout>/output/dev/bin/yui capability call plugin.create --task T --request-id create-1 --input '{"preparationId":"P","id":"demo","kind":"declarative"}'
<checkout>/output/dev/bin/yui capability call plugin.validate --task T --request-id validate-1 --input '{"preparationId":"P","directory":"demo"}'
<checkout>/output/dev/bin/yui capability call plugin.activate --task T --request-id activate-1 --input '{"validationId":"V"}'
<checkout>/output/dev/bin/yui capability call demo.echo --task T --input '{"hello":"world"}'
<checkout>/output/dev/bin/yui capability call plugin.disable --task T --request-id disable-1 --input '{"id":"demo"}'
```

`requestId` 对有副作用的能力必填，但 SDK 不另建通用幂等账本。验证重做生成新
报告，激活重做采用新 generation；发生通信错误后先查当前事实再决定是否重试。

## 包合同

目录扫描仅解析数据，不 import 作者代码。当前包最多 256 个 UTF-8 文件、
合计 4 MiB；拒绝 symlink、特殊文件和二进制依赖。所有文件都进入摘要及
验证产物，包括依赖，因此应提供小型、自包含、非秘密的目录，而不是包含
凭据、用户资料或整个开发环境的树。

```json
{
  "id": "demo",
  "version": "1.0.0",
  "apiVersion": "1",
  "kind": "declarative",
  "entry": "entry.json",
  "capabilities": [{
    "name": "demo.echo",
    "contractVersion": "1",
    "summary": "Return JSON input.",
    "inputSchema": {},
    "outputSchema": {},
    "effect": "query",
    "requiredPermissions": []
  }],
  "required": [],
  "permissions": [],
  "reloadMode": "manual"
}
```

`id` 为小写字母开头、仅小写字母/数字/连字符的单段名字。能力名使用 Registry
的点分名字；核心 namespace（包括 `context`）和 Provider 身份不能覆盖。
Provider ID 由可信根按 Task + plugin ID 产生。不同 Provider 的同名能力保留
原 Registry 歧义规则，不按加载顺序覆盖；调用时可明确 `--provider/--version`。

`required` 是准确的 `{name, contractVersion}` 依赖，不是版本求解器。依赖缺失、
不可用、歧义或成环时拒绝激活。schema 使用 Registry 现有有界方言，未知关键词
拒绝。每项 `requiredPermissions` 必须属于 manifest `permissions`；scope 只是
可见性，权限仍来自当前调用者。Task-local 插件不能声明 `plugin:manage`。

声明式 `entry.json` 必须完整且仅包含 manifest 声明的能力：

```json
{ "demo.echo": { "type": "echo" } }
```

支持 `echo`、`constant + value`，以及
`call + name + contractVersion + 可选 providerId`。`call` 将原输入与 requestId
交给一个明确依赖，返回其 value，保留原 operations/effect；它不是多步流程引擎。
声明式包不能声明 build，也不会执行任意 JavaScript。

## 可执行合同与授信

`kind: trusted-local`、`entry: entry.mjs` 的包在独立 Node 子进程中执行，不进入
Controller。子进程使用明确采用的环境目录为 cwd，重新构造最小环境变量，
不继承 Yui Session、凭据、`NODE_OPTIONS` 或 `NODE_PATH`。

运行模块通过 `SourceTextModule` 从已捕获的字节加载，只支持包内相对模块依赖，
不支持裸包名、`node:` 或动态 import；需要的纯 JS 依赖应先打包。此加载器
限定代码来源，**不是恶意代码安全沙箱**。不能据此承诺宿主文件、网络、进程或
秘密绝不可访问。未经具体授信的自动生成代码应使用声明式路径或另选真正受限
环境；当前 SDK 不提供那种环境。

作者 entry 导出：

```javascript
const echo = input => input;
export function initialize() {
  return {
    handlers: { "demo.echo": async (input, api) => echo(input) },
    dispose() {}
  };
}
export function selfTest() {
  return echo("probe") === "probe";
}
```

初始化只能准备完整注册，不得发送、发布、修改业务资料或启动后台服务。
它得不到任何业务调用端口；初始化失败仅关闭候选子进程。trusted-local 作者
仍必须遵守这个合同，缺少端口不是对任意恶意代码直接宿主访问的隔离保证。
`selfTest()` 在验证时实际执行且必须返回 `true`，报告不把作者测试等同于安全认证。

handler 的 `api` 只包含原 `context` 的无凭据身份、`requestId` 与
`call({name,input,contractVersion?,providerId?,requestId?})`。没有 Store、Host、
Registry、鉴权器、可选 actor 或 `observe` 端口。每个嵌套调用重新检查原调用者
和当前执行 grant，权限不得超过父 descriptor 声明，效果不得超过父 effect。
对已完成的子动作，即使父输出 schema 错误、抛错或无法 JSON 序列化，也保留
原 operations、effect 和 receipt locator；真正的证据仍属于原 Job 等业务 owner。

可信代码应只使用这些受控端口产生业务效果。直接绕过端口的 trusted-local
宿主操作无法由 SDK 推导真实回执或效果范围，不在上述证据保证内。
默认单次子进程请求上限 30 秒；超时或异常结束返回失败并关闭自有子进程，不重试。
dispose 必须只释放自己的资源，不管理共享 daemon。任意作者派生进程或崩溃后的
宿主残留不被伪称为已回收，当前 SDK 不提供跨 Controller 进程恢复/清扫协议。

### 执行授权

T05 adopted 目录不授予执行作者代码。每次实际 `build`、`validate`、`activate`
或 `call` 尝试还需要现行 `plugin.execute` grant，同时明确限定全部五个参数：

| 参数 | 值 |
| --- | --- |
| `pluginId` | manifest id |
| `digest` | build/validate 使用 `plugin.scan` 的源码摘要；activate/call 使用报告的产物摘要 |
| `environmentRef` | `Task/preparation` |
| `trust` | `trusted-local` |
| `phase` | 明确选择的 `build,validate,activate,call` 子集 |

使用 Task scope；可附加精确环境路径的 home scope，不接受 Project/repository/
package scope 替代资源授信。因 trusted-local 不约束直接宿主效果，此 grant
必须允许 `irreversibilityCeiling: irreversible`：这是能力上限，不表示每次调用
实际产生不可逆效果。`none/reversible` 不得解释为无限本机执行权。

由获用户明确授权的 Operator 使用原 grant 入口，例如只允许一次验证：

```text
<checkout>/output/dev/bin/yui task grant issue T --action plugin.execute --param pluginId=demo --param digest=SOURCE_SHA256 --param environmentRef=T/P --param trust=trusted-local --param phase=validate --max-uses 1 --irreversibility-ceiling irreversible
```

grant 不由 SDK 自签发。次数按真实执行尝试消费，失败也不回退；一次 validate
包含 initialize/selfTest/dispose。build 是另一次执行。单次调用已消费的 reservation
允许该调用继续复核，但撤销/到期仍阻止其后续受控动作；耗尽次数不允许新调用。
普通 disable 不撤销已在执行的原调用，撤权也不抹除已发生效果。

### 构建与产物

可执行 manifest 可增加 `"build": ["build.mjs", "arg"]`。这是明确的 Node 脚本
及参数，不是 shell 字符串。build 脚本必须在捕获的源码包内；它在采用环境内
新建的自有临时副本中执行，可使用 Node API，因而同样需要 trusted-local 授信。
构建器不得依赖未声明的用户秘密或残留后台进程。

验证保存实际构建产物全部字节及摘要，记录源码摘要、Node 版本、环境 identity、
实际构建 cwd/argv 与执行检查。构建不能改变 manifest/权限；无 build 时直接
执行首次捕获的字节，不二次读取后再执行。构建不覆盖作者源码。验证结束复核
源目录，已变化则拒绝保存成功报告。

激活重新核对源目录摘要、环境及当前授权，然后只从报告中的产物字节初始化，
不会重建或改用同版本的另一个目录。构建后的验证授权针对已明确授信源码所产生
的产物，正式激活/调用则另用该实际产物摘要授权。

发布前再次检查完整贡献、依赖和权限。失败不改变现有目录；竞争 activate/disable
会使迟到候选拒绝发布。成功发布后旧 generation 只服务已有引用，排空才 dispose；
清理失败保留诊断 Artifact，不回滚新 Provider 或伪称当前实例仍未发布。

## 采用与迁移

新增不可变 `plugin_validations` 表，中央存储版本 8→9
`plugin-validation-evidence`，最低支持仍为 1；没有另一条版本兼容链。
此前有效数据保持原样，启用通过现有显式 upgrade/update 与备份机制。
采用本源码不等于授权升级共享 Home、重启 Controller 或执行任何插件。

T06 可以消费既有 CapabilityDescriptor，不需要复制 SDK Host；
T07 的 ACP/Endpoint 注册、T04 原生 Session 的 environmentRef 消费、
Project/global scope 提升及完整热插拔均不在本合同内。
