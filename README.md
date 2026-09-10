<p align="right"><strong>English</strong> | <a href="./i18n/README.zh-CN.md">简体中文</a></p>

# Yui

Give your Agents work to carry forward, not just another chat to answer.

Yui helps you turn requests into organized tasks and coordinate Agents to solve
them. Describe what you want in conversation: an Agent identifies the relevant
Project, distinguishes new work from a follow-up, and keeps related requirements
together. Each Task has a Leader that plans the work, uses other configured
Agents when useful, and brings results and decisions back to you.

You do not need to manually create a ticket for every step, carry context between
terminal windows, or remember which Agent was working on which requirement.
Yui keeps the intent, progress and results outside any one conversation, so
continuing work starts from the Task rather than from your memory.

[Quick start](#quick-start) · [Working through conversation](#working-through-conversation) · [Core design](#core-design)

## Quick start

You need Linux x64 with glibc, Git, tmux, and Node.js `^20.17.0`, `^22.9.0` or
`^24.0.0`. For the simplest setup, have Codex CLI or Claude Code CLI installed
and ready to use with your own account. Yui coordinates those Agents; it does
not supply model access.

For Claude, Yui passes through your authentication environment and native
configuration directory; Claude selects the API key or login method using its
own settings. Replacing a Session does not reset your login or initialization.
Native first-run confirmations may still require your input.

### 1. Install

```sh
npm install -g @zq-silk/yui
```

### 2. Set up, yourself or with an Agent

Run the interactive setup:

```sh
yui setup
```

Or ask the coding Agent you already use:

> Yui is installed. Help me run `yui setup` in an interactive terminal,
> choose an available Agent, and check the result with `yui doctor`.
> Ask me about any account or setup choices you need.

Setup establishes the Operator—the Agent you talk to—and a default Task Leader,
then starts the local Controller. You can begin with those two roles and
configure Workers or Reviewers later. If your Agent cannot operate an interactive
terminal, run setup yourself; it only handles the initial configuration.

### 3. Start a conversation

```sh
yui operator enter
```

Tell the Operator what you want to work on:

> My project is at `/absolute/path/to/app`. Help me add CSV export.
> First clarify the scope, then implement and verify it. Don't publish anything.

The Operator can register the Project and organize the request into a Task.
Its Leader handles planning and execution within your instructions. You can
ask questions, refine the requirement, or bring another request to the same
Operator without learning Task IDs or internal commands.

## Working through conversation

### Let the Agent organize the work

You can bring a mixture of new requests, corrections and questions:

> The CSV export also needs to preserve leading zeros in account numbers.
> Separately, investigate why login is slow. Prioritize the export first.

The Operator uses existing Task context to decide what belongs together and
what deserves an independent Task. It can organize work by Project, type,
priority and tags. A follow-up need not become a new Task, and a Task need not
be split into a WorkItem for every implementation step.

The Leader owns delivery: small work can stay with the Leader; independent
requirements can go to configured Workers; a Reviewer can inspect the result
when appropriate. Agents choose the plan and delegation. The Controller
delivers the scheduled work, observes execution and returns results to the
responsible Agent—without requiring you to relay messages between sessions.

### Configure by asking

Stay in the Operator conversation to change how Yui works:

> Show me the available Agents and models. Suggest a setup for planning,
> implementation and review, then apply it after I confirm.

The Operator reads the actual configuration and supported choices before
making changes. You can ask it to change a model, bind another Agent, adjust
review preferences or explain a setting. It should tell you what changes,
whether it affects future launches or a live Session, and which choices need
your confirmation. You do not need to hand-edit configuration files.

### Pick up where you left off

> What is still active? Which tasks need my decision? Continue the CSV task
> from its saved state and summarize what remains.

Tasks retain requirements, decisions and results independently of the native
chat history. Yui delivers durable updates to the Operator; the Agent can
recover context and continue compatible sessions, or choose a new execution
when necessary. A failed process does not erase the Task, and an uncertain
submission is not silently repeated.

For a visual overview, run `yui web` in another terminal. The local Web view
shows the same tasks and pending questions; it is not a separate task system.

## Core design

### Agents make decisions; Yui makes work durable

Yui is a local control plane and context API, not a fixed workflow engine.
The Operator recognizes and routes requests. A Leader owns each Task's outcome
and chooses planning, delegation, review and recovery. The Controller handles
delivery and runtime facts; it does not decide whether an Agent's answer is
good enough.

Tasks, messages, decisions, original execution results and Project Knowledge
are durable context. Agents read and update that context through small,
scoped CLI operations. Session and process state support execution, but do not
replace the record of what the user asked for.

### Separate the task from the conversation

A Task is the outcome; a WorkItem is an independently acceptable requirement;
a Session is a native conversation; an AgentRun is an explicitly requested
execution. Keeping them separate lets you discuss a Task without starting work,
continue a requirement across executions, and inspect the original result
without confusing “the Agent finished speaking” with “the work was accepted.”

A Draft can hold planning before adopting a delivery workspace. For repository
work, changes happen in managed worktrees rather than the stable Project
checkout. The Leader evaluates results and coordinates review and integration
against the actual scope.

### Keep execution replaceable and authority explicit

Codex CLI, Claude Code CLI and ACP connections—including a Claude Agent SDK
bridge—share an execution boundary while retaining their native capabilities
and conversations. Configured intent and what the running Agent actually reports
are distinct facts; Yui does not pretend every integration behaves identically.

When a Task needs an additional capability, its Leader can create and validate a
Task-local plugin and explicitly activate it within existing authority.
Executable plugins need specific execution grants. Results can be saved
independently of the plugin or Session that produced them.

Yui is designed for one trusted local user. It is not an OS sandbox or a remote
multi-user service. Publishing, granting new access and other external effects
still require the corresponding authority.

## Learn more

The [architecture overview](ARCHITECTURE.md) explains the end-to-end design.
The [documentation map](docs/architecture/README.md) links the current contracts
for configuration, execution, delivery, storage and plugins. Use `yui --help`
when you want to operate the CLI directly.

Yui stores its control-plane data under `~/.yui` by default; `YUI_HOME` selects
another instance. See [storage and upgrades](docs/sqlite-control-plane-design.md)
before moving between builds or updating an existing Home.

## Contributing

In a source checkout, start with `npm ci` and `npm test`. Read
`.agents/skills/develop-yui/SKILL.md` and the
[verification policy](docs/testing/verification-levels.md).
Source builds also need a Linux C compiler and static libc development libraries
for the Claude process owner. Published packages include that executable;
npm users do not need to compile it.

To exercise your checkout, run `make install-local`, then use the absolute
`<checkout>/output/dev/bin/yui` launcher. It defaults to an isolated Home under
that checkout; run its `setup` before stateful use. Do not use the global `yui`
or `make link` to validate local changes. Live-model, paid or shared-resource
tests require an explicit request for those resources.

## License

[MIT](LICENSE)
