<p align="right"><a href="../README.md">English</a> | <strong>简体中文</strong></p>

# Yui

让 Agent 持续推进你的任务，而不只是回答一轮对话。

Yui 帮你把日常请求组织成任务，再协调 Agent 解决它们。你只需在对话中描述
目标：Agent 识别相关 Project，区分新任务与已有任务的补充，把相关需求放在
一起。每个 Task 由一个 Leader 负责规划，按需调用其他已配置的 Agent，
并把结果和需要你决定的事项带回来。

你不必为每个步骤手动建单，在多个终端之间搬运上下文，或记住哪个 Agent
正在处理哪条需求。Yui 把意图、进展和结果保存在单次对话之外，让继续工作
从任务本身开始，而不是依赖你的记忆。

[快速开始](#快速开始) · [通过对话管理工作](#通过对话管理工作) · [核心设计](#核心设计)

## 快速开始

需要 Linux x64 / glibc、Git、tmux，以及 Node.js `^20.17.0`、`^22.9.0` 或
`^24.0.0`。最简单的方式是先安装 Codex CLI 或 Claude Code CLI，并确保它
已经可以使用你自己的账号正常工作。Yui 负责协调 Agent，不提供模型访问额度。

Yui 传递 Claude 的认证环境并保留原生配置目录，由 Claude 自身按本地配置
选择 API key 或登录方式。更换 Session 不会重置登录或初始化记录。首次运行时，
Claude 自身的 key 确认、目录信任等交互仍可能需要你完成。

### 1. 安装

```sh
npm install -g @zq-silk/yui
```

### 2. 自己初始化，或交给 Agent

在终端中运行交互式初始化：

```sh
yui setup
```

也可以直接告诉你正在使用的编程 Agent：

> 我已经安装了 Yui。请在交互式终端中帮我执行 `yui setup`，选择可用的
> Agent，并用 `yui doctor` 检查结果。遇到账号或需要我决定的配置时问我。

Setup 会配置与你对话的 Operator 和默认任务 Leader，并启动本地 Controller。
先用这两个角色即可开始，Worker、Reviewer 可以之后再配置。如果 Agent
没有操作交互式终端的能力，就自己运行 setup；它只负责初始配置。

### 3. 开始对话

```sh
yui operator enter
```

告诉 Operator 你想做什么：

> 我的项目在 `/absolute/path/to/app`。帮我增加 CSV 导出，先明确范围，
> 然后实现并验证。不要发布。

Operator 可以帮你登记 Project、把请求整理成 Task，再由该 Task 的 Leader
在你的要求范围内规划和执行。之后可以继续提问、修改需求，或把另一个请求
交给同一个 Operator，不必先学习 Task ID 和内部命令。

## 通过对话管理工作

### 让 Agent 识别和整理任务

新需求、补充说明和问题可以像平常一样表达：

> CSV 导出还要保留账号开头的零。另外，单独排查一下登录慢的问题，
> 优先把导出做好。

Operator 会结合已有任务判断哪些属于同一个结果，哪些应该独立成 Task，
并按 Project、类型、优先级和标签组织工作。补充需求不必另起任务，
实现中的每一步也不需要拆成 WorkItem。

Leader 负责交付：小任务可以自己完成；有独立交付价值的需求可以安排给已配置
的 Worker；需要审查时再安排 Reviewer。Agent 决定计划与分工，Controller
负责自动投递已安排的工作、观察执行、把结果送回负责人，你不必在会话之间
充当传话人。

### 用对话修改配置

继续在 Operator 对话里提出你的偏好：

> 看看我有哪些可用的 Agent 和模型，给我一套规划、实现、审查的配置建议，
> 确认后帮我应用。

Operator 会先读取实际配置和受支持的选项，再执行修改。你可以让它切换模型、
绑定另一个 Agent、调整审查偏好，或解释某个设置。它应说明改了什么、影响
后续启动还是当前 Session，以及哪些选择需要你确认，不要求你手动编辑配置文件。

### 离开后，接着做

> 现在有哪些任务还在进行？哪些需要我决定？从保存的状态继续 CSV 任务，
> 告诉我还剩什么。

需求、决策和结果独立于原生聊天记录保存。Yui 将持久更新送给 Operator，
Agent 可以重新读取任务上下文，继续兼容的 Session，或在必要时选择新的执行。
进程失败不会抹掉任务，结果不确定的投递也不会被静默重复。

想直观看进展，可以在另一个终端运行 `yui web`。本地 Web 展示同一份任务与
待回答问题，不是另一套需要同步的任务系统。

## 核心设计

### Agent 做判断，Yui 保存工作事实

Yui 是本地控制面与上下文 API，不是固定流程引擎。Operator 识别和分流请求，
每个 Task 的 Leader 对结果负责，决定计划、委派、审查与恢复。Controller
处理投递和运行事实，不代替 Agent 判断一份回答是否足够好。

Task、消息、决策、原始执行结果和 Project Knowledge 构成持久上下文。
Agent 通过范围明确的小型 CLI 操作读取和更新它们。Session 和进程状态服务于
执行，但不替代“用户要求了什么、工作做到哪里”的任务记录。

### 把任务与对话分开

Task 表示目标，WorkItem 表示可独立验收的需求，Session 表示原生对话，
AgentRun 表示明确请求的一次执行。分开这些概念，你就能先讨论而不启动交付、
跨多次执行延续同一需求，并查看原始结果，而不把“Agent 说完了”当成“工作已验收”。

Draft 可以先保存规划，之后再采用交付工作区。涉及仓库时，修改发生在受管
worktree 中，而不是稳定的 Project checkout。Leader 对照实际范围判断结果，
组织审查和集成。

### 执行可以替换，权限保持明确

Codex CLI、Claude Code CLI 和 ACP 连接（包括 Claude Agent SDK 桥接）
通过统一执行边界接入，同时保留各自的原生能力与会话。配置里期望的值和
运行 Agent 实际回报的值分开记录，不假设不同接入方式完全等价。

Task 缺少某项能力时，Leader 可以在现有权限范围内创建、验证并显式激活
Task-local 插件。可执行插件仍需要具体执行授权；业务结果可以独立保存，
不依赖产生它的插件或 Session 一直存活。

Yui 面向一个受信任本地用户，不是 OS 沙箱，也不是远程多用户服务。发布、
授予新权限等外部效果仍需相应授权。

## 深入了解

[总体架构](../ARCHITECTURE.md)介绍端到端设计，
[文档导航](../docs/architecture/README.md)提供配置、执行、交付、存储和插件的
当前合同。想直接操作 CLI 时，使用 `yui --help` 查看命令。

Yui 默认将控制面数据保存在 `~/.yui`，通过 `YUI_HOME` 选择另一个实例。
切换构建或更新已有 Home 前，请查看[存储与升级](../docs/sqlite-control-plane-design.md)。

## 参与开发

源码 checkout 中从 `npm ci` 和 `npm test` 开始，阅读
`.agents/skills/develop-yui/SKILL.md` 与[验证策略](../docs/testing/verification-levels.md)。
源码构建还需要 Linux C 编译器和静态 libc 开发库，用于构建 Claude 子进程
监督器；发布的 npm 包已包含该可执行文件，安装使用时无需编译。

验证当前 checkout 时，先执行 `make install-local`，之后使用绝对路径
`<checkout>/output/dev/bin/yui`。它默认使用 checkout 内的隔离 Home，首次使用
状态命令前执行该 launcher 的 `setup`。不要用全局 `yui` 或 `make link`
验证本地修改。真实模型、付费或共享资源测试需要用户明确请求这些资源。

## 许可证

[MIT](../LICENSE)
