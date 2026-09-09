# T07 第三产品选择与无模型 CLI 证据

Task：task-19。探测时间：2026-09-08（PRC；UTC 2026-09-07）。
源码基线：`97ad88849c9a496230b134d2955f5f23e96deaa3`。
本记录不是 ACP 适配器实现、完整集成或真实模型验收报告。

## 选择与官方输入

选择本机已存在的 Kimi Code CLI，不安装新产品、不改变认证。
它不是旧 Python Kimi CLI；不能把两个项目的版本或支持矩阵混用。

官方来源（本次读取，无模型调用）：

- `https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/README.md`
- `https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/docs/en/reference/kimi-acp.md`
- `https://agentclientprotocol.com/protocol/v1/initialization.md`

产品 README 明确将 `kimi acp` 作为 ACP stdio 入口，使用已有登录。
产品文档描述 JSON-RPC、Session 生命周期、prompt、permission reverse RPC，
以及不支持方法的明确错误。ACP v1 规定初始化协商、未声明能力视为不支持。
在线 main 文档是阅读材料，不代表本机版本的已执行行为；以下以实际响应为准。

## 已执行证据

可执行文件：`/data00/home/zhangqian.0326/.kimi-code/bin/kimi`。

在新建临时 Home 中，以 `env -i` 清除继承环境、仅保留临时 HOME/XDG
和基础 PATH，分别执行：

```sh
kimi --version
kimi acp --help
```

实际输出版本 `0.33.0`；help 明确表示 ACP server over stdio，
提供 `--login` 和 `--help`。没有执行 `--login`。
上述相对命令仅为易读展示，探测实际使用前述绝对可执行路径。

随后用 Node 子进程和管道启动同一二进制 `["acp"]`：

- `cwd`、HOME、XDG 配置和缓存均位于一个新建的临时目录；
- 不继承用户认证或 YUI 环境；代理设置为 `127.0.0.1:1`，不连接真实服务；
  代理不是网络沙箱，不据此宣称操作系统级网络隔离；
- stdin 只发送下面一条 JSON-RPC 请求，不发送 Session 或模型请求；
- 取得响应后发送 SIGTERM，观察到进程关闭，stderr 为空；
- 清理该子进程专属临时目录；没有修改用户 Home、登录、共享服务或仓库内容。

```json
{
  "jsonrpc": "2.0",
  "id": "t07-initialize-1",
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {"name": "yui-t07-probe", "version": "1"},
    "clientCapabilities": {}
  }
}
```

响应同一个 request ID，`result.protocolVersion` 为 `1`，
`agentInfo` 为 `{"name":"Kimi Code CLI","version":"0.33.0"}`。
原始能力声明如下：

```json
{
  "loadSession": true,
  "promptCapabilities": {
    "image": true,
    "audio": false,
    "embeddedContext": true
  },
  "sessionCapabilities": {
    "list": {},
    "resume": {},
    "close": {},
    "delete": {},
    "fork": {},
    "additionalDirectories": {}
  },
  "mcpCapabilities": {"http": true, "sse": true},
  "auth": {"logout": {}}
}
```

`authMethods` 返回 `id: "login"`、`type: "terminal"`、
`name: "Login with Kimi account"` 和 `args: ["--login"]`，
并带 legacy `_meta["terminal-auth"]` 描述。
这仅是认证方法发现，不是认证成功证据；Yui 不自动执行它。

## 支持与证据边界

| 能力 | 本机事实 | 尚未证明 |
| --- | --- | --- |
| executable/version/stdio | help、版本和真实子进程响应通过 | Yui 产品目录与完整启动链 |
| ACP 初始化 | request ID 精确匹配，协商 v1 | 模型可用性 |
| 原生 Session 身份 | 尚未创建 Session | Session ID、跨进程恢复 |
| loadSession 等可选能力 | initialize 声明支持 | 实际 load/resume 行为 |
| prompt/update/permission | 官方文档描述支持 | 真实请求、输出和权限交互 |
| cancel | 官方文档描述支持 | 真实取消、物理静止 |
| usage/native Turn ID/并发输入 | 未取得实际证据 | 不从产品名或注册成功推断 |

适配器 fixture 可以证明解析、pending、unknown、local-correlation、
取消语义及结果归档，但不能把这些结果升级为本机真实模型证据。
本次授权不包含将第三 Provider/模型作为测试对象；没有发送 prompt，
没有消费模型的主动验证请求，不声明真实集成全量通过。
后续若获得特定资源授权，另行验证一条受控本地资料输入的原 Turn
结果归档，并按实际需要选择恢复、取消及权限交互的精确范围。
这不是索取验证授权的 InputRequest，也不是切换模型或重试的许可。
