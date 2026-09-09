# T08 — Draft Leader 与正式执行:实现与验证证据

WorkItem: `work-item-1` (task-22, turn-13 候选;turn-2 的 `9d314e3` 已被拒绝,
turn-4 的 `0e30089` 未被接受、turn-9 的 `5400ac9` 未被接受,其历史均原样保留;
turn-11 的实测运行记录在第 11 节,该 Turn 未产出候选)
分支: `yui/task-22-69eeaf67/work-item-1`
采用的上游 SHA: `013ffdc3154c18974f64c66b05ade018feb63c2b` (PR320;PR319
`c432ad719e17d3b615829db9d2ec0a9115697220` 已验证为其祖先),合并提交 `ae6f28e`
存储版本: `CURRENT_STORAGE_VERSION = 12`(上游占用 10/11,详见第 5 节)

本文件记录**实际执行过的命令与实际输出**。静态断言不作为运行证据;
凡未真实跑过的边界,本文件在"未验证边界"一节显式声明。

**每条结论都标注取证面**:`[CLI]` = 真实 `dist/cli.js` 子进程;
`[internal]` = 从 `dist/` 导入的导出函数。二者不等价,不混用。
Provider 一律是**确定性协议 stub**,不是 Provider、不是模型(见第 7 节)。

---

## 1. 验证环境与资源隔离

所有验证只使用本 WorkItem checkout 的构建产物与一个私有 Home,
**未使用注入的共享 `YUI_HOME`,未重启共享 Controller/Provider,未执行 `make link`,
未进行真实模型/付费/生产/共享资源 E2E,也未申请此类授权。**

turn-2 的隔离启动器验证(第 2–4 节)与 turn-4 的修正验证(第 6 节)是**两批不同的运行**,
各自的资源如下,不合并计入:

| 资源 | turn-2(隔离启动器) | turn-4(修正候选) |
| --- | --- | --- |
| 入口 | `output/dev/bin/yui`(`make install-local` 产出,绝对路径调用) | `dist/cli.js` 子进程 + `dist/` 导出函数 |
| 私有 Home | `/tmp/yui-t08-home-4IDO3t` | 每个脚本各自新建并在退出时删除 |
| 私有 workspace 根 | `/tmp/yui-t08-ws-P5BCun` | 同上,均在私有 Home 之外 |
| 测试 Project | `project-1` (t08app) → `/tmp/t08-proj`,remote `/tmp/t08-remote.git` | 裸 remote + clone,由 `project.mjs` 现场创建 |
| Agent 可执行文件 | **stub 脚本** `/tmp/t08-bin/claude` | **stub 脚本** `tmp-f6/stub-claude.mjs` |

两批都不是真实 Provider。turn-4 的脚本通过 `test/helpers/sanitizedEnv.mjs` 的
`sanitizedTestEnv()` 只透传 `PATH`/`HOME` 并**剥除 22 个继承的 `YUI_*` 描述符**,
再显式覆盖私有 `YUI_HOME`;这是必须的——未剥除时被隔离 CLI 会拒绝调用:
`RUNTIME_ERROR: Managed Task invocation does not match its Session Manifest owner`。

turn-2 的 `yui controller restart` 只作用于其私有 Home 的 Controller
(`PID 163232 -> 243749 -> 253589`);turn-4 **完全没有启动 daemon**
(单周期进程内驱动,见第 6 节)。两批均未触碰共享 Controller。

---

## 2. 验收项证据

### S01 未激活 Task、无常驻 Leader Session → 路由到 Leader 并按需启动 planning

绑定了 Project 但**从未激活**的 Draft(`task-10`),仅发消息:

```
$ yui task message send task-10 "let's plan this before activating"
Sent message message-1 to task-10

$ yui task next-action task-10
Preconditions:
  [ ] Task is active (task task-10)
```

通过**真实 wake 处理器** `processLeaderWakeups` 驱动(stub delivery 在触碰
Provider 前抛错,以证明"是否被调度"而不触发真实 Provider):

```
task-10 turns: turn-1/planning/active
task-10 status: draft | workspace: null
```

事件:

```
event-3 turn.dispatched {"turnId":"turn-1","role":"leader","purpose":"planning","mode":"new",...}
```

即:**Draft 直接获得 planning Turn,既未先激活,也未先建立 delivery 环境
(`workspace: null`、无 cwd)。**

关键门禁值(同一 Task 实测):`planning admitted: true` / `execution admitted: false` /
`workspaceReady: false`。这正是 `leaderWakeupProcessor` 中放行 planning 的原因:
执行就绪门禁对 planning 不适用。

> **取证面升级(turn-11):** 本小节由 `processLeaderWakeups` 驱动,属 `[internal]`。
> 同一路径已在**真实 detached daemon 自己的调度循环**上跑通(第 11.1 节),
> 无需再依赖此处的进程内取证面。

### S02 关闭原 Session,新的兼容会话读取 Context

**规划信息在 Draft 阶段即持久化并可被独立读回**(与原终端、完整工具日志无关):

```
$ yui task decision record task-10 --title "Empty environment plan" --rationale "..."
Recorded decision decision-1 for task-10
$ yui task brief update task-10 --objective "Validate Draft planning persistence" ...
Updated brief for task-10

$ yui task brief show task-10
Objective: Validate Draft planning persistence
Technical approach: Plan first, activate later
Current focus: S02 handover
Leader summary: Draft planning captured; activation deferred
```

**不兼容路径**(激活改变物理 launch):在 `task-10` 上记录一个 live planning
Session 后经真实 CLI 激活:

```
$ yui task activate task-10
Activated task task-10
```

激活后真实事件序列:

```
event-6  task.planning-session-handover {"roleName":"leader","agentId":"claude","adapterId":"claude",
          "nativeSessionId":"native-planning-task10","reason":"activation-changed-physical-launch",
          "continuity":"persistent-context"}
event-8  task.activated {"fromStatus":"draft","status":"active"}
event-9  runtime.session-termination {"outcome":"stop-requested"}
event-10 runtime.session-termination {"outcome":"stop-confirmed"}
event-11 turn.dispatched {"turnId":"turn-2","role":"leader","purpose":"execution","mode":"new",...}
```

- 旧记录显式结束(`history entries: 1`),物理 Host 经 detach 真实关闭
  (`stop-requested`→`stop-confirmed`),未泄漏;
- 新会话以 `mode: "new"` **从持久 Context 接管**,`purpose` 由 planning 变为 execution,
  **逻辑 Leader / Task 身份不变**(仍是 `task-10` 的 `leader`);
- 规划信息在接管后仍可读:`brief still readable: Validate Draft planning persistence`,
  `decisions: Empty environment plan`。

**兼容路径**:空环境计划不改变任何物理事实,live planning Session 直接延续
(不产生 handover 事件、不 detach);实测 `MAY CONTINUE: true` / `RESUME MODE: resume`。
`roleSessionKind` 将 planning 与 execution 映射到同一 `"leader"` kind,
`sessionManifestCompatibilityDigest` 实测相等(`digest equal: true`)。

### S27 空环境计划合法,不为满足框架模型创建 worktree

```
$ yui task activation request task-3 --request-id req-e2 --environment empty
Requested activation task-activation:task-3/req-e2
Environment: empty
Disposition: pending

$ yui task activate task-3
Activated task task-3

$ yui task activation show task-3
Task: task-3 (active)
Environment: empty
Disposition: adopted
Effect: confirmed
```

持久事实:

```
status: active | cwd: undefined | workspaceIdentity: undefined
taskWorkspace record: null
managedWorkspaces: 0
events: task.created, task.activation-requested, task.activation-adopted, task.activated
```

私有 workspace 根下**不存在任何属于空计划 Task 的目录**:

```
$ ls /tmp/yui-t08-ws-P5BCun/tasks/
task-10

$ find /tmp/yui-t08-ws-P5BCun -maxdepth 3 -name "*task-3*"
(无输出)
```

`tasks/task-10` 属于后续 S02 中那个**确实绑定 Project** 的 Task;
空计划的 `task-3`/`task-4`/`task-6`/`task-7` 都没有留下任何目录:
**没有为了框架模型创建 worktree**。

**该 Task 的 Leader 随后真实启动成功**(空环境不是"只能激活、不能干活"):

```
sessions: { "claude": { "status": "active", "native": "b09e9ac2-...", "root": "/tmp/yui-t08-ws-P5BCun", "entries": 0 } }
task status: active | cwd: undefined | workspace record: null
```

**范围限定(turn-11 补充,避免与第 11.6 节被读成矛盾):** 上面这些空计划 Task
(`task-3`/`task-4`/`task-6`/`task-7`)**都不绑定 Project**,所以确实没有任何目录。
若一个 Task **绑定了 Project**,即使激活计划为 `empty`、**不采用任何资源**,
激活仍会物化其**受管 Git 工作区**,`workspace.root` 因此改变(见第 11.6 节实测)。
两者并不冲突:S27 主张的是"**不为满足框架模型而创建 worktree**",
而受管工作区来自 **Project 绑定**这一显式事实,不是为了凑框架模型。

### S40 Draft 对话中调用 Activation:立即返回引用、结束后按当前意图采用、已取消不继续

请求来自 Leader 自己**正在运行的 planning Turn** 时:

```
planning turn: turn-1 active planning
startMode: after-planning-turn | afterPlanningTurn: turn-1 | ref returned immediately: task-activation:task-1/req-defer
admission WHILE turn active: "deferred"
admission AFTER turn ends: ready
after cancel -> disposition: cancelled | admission: settled | task status: draft
```

- **立即返回引用、绝不自等待**(`deferred` + 立即拿到 operationRef);
- 该 Turn 结束后才 `ready`,按当时有效事实采用;
- 取消后为 `settled`,**不被继续执行**,Task 保持 `draft`。

真实 CLI 上的请求语义(`task-11`,实跑输出):

```
$ yui task activation request task-11 --request-id req-x1 --environment empty
Requested activation task-activation:task-11/req-x1
Disposition: pending

$ yui task activation request task-11 --request-id req-x1 --environment empty
Existing activation task-activation:task-11/req-x1          # 重放 → 同一引用,幂等

$ yui task activation request task-11 --request-id req-x1 --environment scratch
USAGE_ERROR: Activation requestId req-x1 was already used for different inputs.

$ yui task activation cancel task-11 --request-id req-x1 --reason "user cancelled while waiting"
Cancelled activation task-activation:task-11/req-x1

$ yui task activate task-11
RUNTIME_ERROR: Task activation is not adoptable: task-11/settled.   # 已取消不被继续执行

$ yui task activation request task-11 --request-id req-x2 --environment empty
Disposition: pending
$ yui task activate task-11
Activated task task-11
Status: active
```

→ **取消作用于请求,不是整个 Task**:同一 Task 可用新 requestId 重新请求并采用。

> **取证面升级(turn-11):** 上面 `deferred → ready → adopted` 的判定取自进程内
> 采用边界。同一序列现已在**真实 daemon** 上成立:planning 活着时 `pending`
> 且**未采用**,terminal 后由 **daemon 自己**采用并派发 execution;
> 取消与撤权两条阻止路径也都在 daemon 上跑通(第 11.2/11.3/11.7 节)。

---

## 3. 其余必须覆盖的用例

### 采用失败 → Draft 仍可继续,只释放可确证未采用的资源

```
$ yui task activation request task-4 --request-id req-f1 --environment local:no-such-resource:write
Disposition: pending
$ yui task activate task-4
RUNTIME_ERROR: Local resource not found: no-such-resource.

$ yui task activation show task-4
Task: task-4 (draft)
Disposition: failed
Effect: none
Outcome: Local resource not found: no-such-resource.
```

Task 保持 `draft` 且**可继续**(随后用空计划成功激活):

```
$ yui task activation request task-4 --request-id req-f2 --environment empty
$ yui task activate task-4
Activated task task-4
Status: active
```

### 权限变化(真实 grant 被吊销)在实际采用之前处理

```
[A] revoked-grant error: Resource grant unavailable: res-1/write.
[A] task status: draft | request: failed | effect: none
[A] preparations: none
```

吊销发生在采用之前 → 失败关闭,`effect: none`,未产生任何 preparation。

### 采用后启动失败:保持 active + 环境事实,无假回滚

`task-3` 上真实发生过启动失败(修复前),事实完整保留:

```
message: "Task launch requires its authoritative ManagedWorkspace."
status: active | request: adopted effect: confirmed
```

即失败**没有**把 Task 退回 draft、没有撤销已采用的环境事实。
库级同样确认:`status still active: true | environment facts kept: true | adopted kept: true`。

### 规划结果不自动成为 Candidate

```
[C] work items: 0 | candidates: 0 | changeSets: 0
```

规划产物(brief / decision / planning Turn)不产生 Candidate 或 ChangeSet。

---

## 4. 验证中发现并修复的真实缺陷

以下**全部由实跑发现**,不是代码阅读推测:

1. **live planning Session 使激活永久失败** — 抛
   `Task Role session must be stopped before workspace migration`,Task 永远卡在 draft。
   修复:`handOverPlanningSession` 显式交接(S02)。
2. **绑定 Project 的 Draft 永远得不到 planning 唤醒** — 被
   `workspace-not-ready` 跳过。修复:执行就绪门禁不适用于 planning(S01)。
3. **`PLANNING_EVENT_TYPES` 列了四个没有任何代码发出的 `turn.planning-*` 类型** —
   真实事件是携带 `purpose` 的 `turn.dispatched`,导致**任何规划过的 Draft 都不可激活**
   (`Draft Task task-1 has execution facts (event event-4/turn.dispatched)`)。
   修复:按事件所指 Turn 的 purpose 判定。
4. **CLI `task activate` 的 activation proof 要求必须存在 workspace** —
   空计划 Task 报 `USAGE_ERROR: Task workspace activation proof does not match task-2.`
   (库级路径绕过了该入口,所以先前未暴露)。修复:proof 按
   `taskOwnsManagedWorkspace` 分流,workspace-free 时**反过来要求不存在 workspace**。
5. **workspace-free Task 的 Leader 永远无法启动** — 隔离栅栏把"合法地没有 workspace"
   与"authoritative workspace 缺失"都当成 `undefined` 而失败关闭。
   修复:新增显式 `workspaceFree` 事实。实测三分支:

```
[1] workspace-free launch: PASSED (isolation skipped)
[2] missing workspace, not declared free: fails closed: Task launch requires its authoritative ManagedWorkspace.
[3] declared free yet carrying a workspace: rejected: A workspace-free Task launch cannot carry a ManagedWorkspace.
```

即修复没有把栅栏改成漏洞:缺失仍然失败关闭,自相矛盾的声明被拒绝。

### turn-4 修正中新发现并修复的两个真实缺陷

6. **采用的环境从未成为 Role 真实的 `executionEnvironment`(F3/F6)** —
   `resources.adopt` 之后没有 `bindEnvironment`,`preparationId` 只是个没有任何启动会读的记录。
   把绑定挪进激活事务后,实跑立刻暴露出更深的一层:绑定被**运行时生命周期栅栏正确拒绝**——
   ```
   Role environment binding is blocked while a runtime lifecycle transition is pending or processing.
   ```
   因为同一事务里的 `handOverPlanningSession` 已经把 `runtime-host-detach-required`
   排入 `role-runtime` 邮箱。**根因是顺序,不是栅栏**:期望配置必须先改成"已采用的环境",
   之后才产生"结束旧物理 Host"的义务,否则 runtime cleanup 会对一个 Task 已经替换掉的
   启动配置动手——这恰恰是栅栏在两者倒置时所拒绝的。
   修复:`SqliteTaskStore.transaction` 可重入,故 `#bindAdoptedActivationEnvironment`
   在**调用者的激活事务内、且在 handover 之前**执行,走的仍是 task-21 既有的公共
   `bindEnvironment`(原子 Role 更新 + `role.updated` 事件 + 邮箱通知),未新建路径。
   实测结果:Role 真实携带 `ownership=preparation isolation=trusted-local access=write`
   的存在目录。

   **我曾对此误诊过一次,如实记录**:最初判断为 Controller 阶段顺序缺陷,
   并改动了 `selectedRuntimeLifecycleTargets` 以纳入 Draft。两条事实否证了它——
   (a) task scope 的 `runtimeLifecycleSignalKey` 发出的是 `role:<taskId>/<roleName>`,
   该分支**根本没有状态过滤**,full-scope 分支读 ready 邮箱也没有;
   (b) 该义务是在采用**过程中**由我自己的 `handOverPlanningSession` 产生的,
   任何更早的阶段都不可能排空它。该改动已 `git checkout --` 完整回退,
   最终 `controller.ts` 只保留下述第 7 项的修正(diff 仅 2 个 hunk)。

7. **`recordAdoptedTaskActivation` 允许记录 `preparationId` 而不指明其所属请求(F4)** —
   `/tmp/f45/f4.mjs` 直接调用该原语时打印 `*** DEFECT CONFIRMED ***`。
   逐一核对后确认:**所有真实调用方都同时传 `expected`,故边界本身是安全的**,
   但原语允许这种不安全调用。修复:缺 `expected` 而给了 `preparationId` 时硬失败——
   preparation 之所以存在,必然源于某个具体请求,只报 preparation 不说属于哪个请求
   永远不是合法调用。无 preparation 的情形仍可省略 `expected`(没有环境可误挂)。

8. **重启后已释放的请求会等待无关流量(F6)** — 释放信号入队后 Controller 重启,
   dirty key 全部丢失,而 `adoptReleasedTaskActivations` 原先只从 dirty keys 取候选。
   修复:full reconcile 改为从**持久 pending 投影**取候选
   (`listPendingActivationRequestTaskIds`,由部分索引支撑)。
   实测方式不是断言而是**真的重启**:`store.close()` 后 `new SqliteTaskStore(home)`
   重新打开,再跑 `{kind:"full"}` —— 无任何 dirty key 也完成采用。

---

## 5. 持久化与并行合并

先检查了持久载荷是否必须变更:activation request、其 settled 历史与 planning purpose
都是**新增可选字段**,因此**只在既有迁移之后追加一条**,未修改任何既有迁移。
`introducedIn` 为 `"0.15.8"`——最后的发布 tag `v0.15.7` 的
`CURRENT_STORAGE_VERSION = 3`,其后各迁移同属未发布的 `0.15.8`,
本迁移属于同一未发布版本,不另起版本号。

**turn-9 采用上游后本节已更新。** turn-4 时本迁移编号为 10;采用 PR319/PR320 后,
上游 master 已占用 **10(`plugin-validation-evidence`)与 11(`plugin-enable-intent`)**,
因此本迁移在合并时**顺延为 12**,`CURRENT_STORAGE_VERSION = 12`:

```
version: 12, name: "draft-planning-and-deferred-activation", introducedIn: "0.15.8"
sql: CREATE INDEX IF NOT EXISTS idx_turns_planning_active   ON turns(...)        WHERE ...
     CREATE INDEX IF NOT EXISTS idx_tasks_activation_pending ON task_records(...) WHERE ...
```

两个**部分索引**把 Draft planning 选取与 pending 激活恢复限定在合格的少数行,
执行期不因此扫描 Task 历史;建索引不新增行、不重写任何 payload。
缺省语义为"从未显式请求过激活",历史 Turn 保持原有 execution/review purpose,
不推断、不重写。

已实测迁移不可变性(而非静态声称):对 `sqliteSchema.ts` 的 `git diff` 只有
**两个 hunk**——本迁移条目本身与 `REQUIRED_SCHEMA_INDEXES` 列表;
diff 中**没有任何一行**触及既有迁移,12 个具名 `*_SQL` 基线常量逐一
按 SHA-256 与 base `fa70078` 比对**全部一致**。上游的 10/11 条目**原样保留**,
本次采用只把自己的条目排到其后。

部分索引确实被查询计划器使用(不是假定):

```
$ node tmp-f6/index-check.mjs
selected: ["task-1"]
expected: ["task-1"] — cancelled/adopted/never-requested/non-draft all excluded
plan: SCAN records USING INDEX idx_tasks_activation_pending | SEARCH catalog ...
INDEX CHECK: PASS (correct rows; partial index used, so no Task-history scan)
```

**并行编号协调(已实际发生并已处理):`CURRENT_STORAGE_VERSION` 是全局单点。**
turn-4 占用的 10 已被上游 PR320 占用;turn-9 采用上游时按"上游已发布条目不动、
本分支条目顺延"处理为 12,并同步了 `core-smoke.test.js` 的迁移头断言
(该断言现由 `production storage admission is owned by the SQLite migration head`
覆盖,实跑通过)。若后续仍有其他分支同期追加迁移,仍需再次协调序号。

---

## 6. 实际检查

以下为 turn-4 修正候选上**本次实跑**的输出(不是 turn-2 的旧结果):

```
$ npm run lint            # tsc -p tsconfig.json --noEmit
(无输出,exit 0)

$ npm run build           # tsc -p tsconfig.json
(无输出,exit 0)

$ node --test test/core/*.test.js
ℹ tests 82
ℹ pass 82
ℹ fail 0

$ node tmp-f6/deferral.mjs        # 无 Project 的延迟链
deferral path: 12/12 pass

$ node tmp-f6/project.mjs         # 有 Project + 重启恢复 + 新规划唤醒顺序
project path: 16/16 pass

$ node tmp-f6/index-check.mjs
INDEX CHECK: PASS (correct rows; partial index used, so no Task-history scan)

$ node tmp-f6/stub-protocol.mjs
STUB PROTOCOL CHECK: PASS
  - the fixture accepted at transport level (acceptance=transport, one pipe write)
  - the fixture reached a protocol-level terminal (type=result, matching session_id)
  - this is a protocol stub, NOT a Provider: the text is echoed, not generated

$ node /tmp/f45/f4windows.mjs     # F4 注入取消/替换/授权变更/准备失败窗口
==== 13 passed, 0 failed ====

$ node /tmp/f45/verify.mjs        # F4/F5 请求身份与历史
==== 22 passed, 0 failed ====
```

**取证面必须区分,不得混同。** `deferral.mjs` 与 `project.mjs` 中,
Task 创建、`message send`、`activation request` 是**真实 `dist/cli.js` 子进程**(标 `[CLI]`);
调度 pass、terminalization、采用边界是**从 `dist/` 导入的导出函数**(标 `[internal]`)。
**没有 CLI 的 run-once 动词**,因此本节这些用例的单个调度周期只能进程内驱动;
**本节不是"daemon 正常性"证明**——daemon 正常性另见第 9 节,那里由真实 daemon
自己的调度循环驱动,不用 `runControllerSchedulerPass`。

`tmp-f6/*.mjs` 与 `/tmp/f45/*.mjs` 是**临时诊断脚本,已在交付前删除**
(故上述命令无法在本候选上原样复跑;它们的输出是删除前的真实运行记录)。
删除后在**即将提交的这棵树上**重跑了 `lint` / `build` / `test:core`,
三者退出码均为 `0`、`82/82` 通过(采用上游后总数由 81 变为 82)。
永久回归矩阵**未扩容**:`test/core/core-smoke.test.js` 仅更新迁移头断言
(`CURRENT_STORAGE_VERSION` → 12、迁移列表加本条目),未新增测试。

**这些临时脚本自身的一个缺陷已被发现并修正,如实记录**:早期版本把调度时钟写成
硬编码常量(`new Date("2026-09-08T10:00:00.000Z")`),而 CLI 子进程按**真实时钟**入队。
`processLeaderWakeups` 在 `LEADER_WAKE_AGGREGATION_MS`(60s)内会以 `aggregating` 跳过唤醒,
因此一旦真实时间越过该常量,`waitedMs` 归零,**dispatch 分支被静默跳过而检查仍"通过"**
(表现为 `no active Leader Turn was created`)。已改为 `Date.now() + 300_000`(> 聚合窗口)。
这是**取证脚手架的缺陷,不是产品缺陷**——产品的聚合窗口行为是设计如此;
但它说明**固定时钟的证据会随时间失效**,故在此明确记录。

---

## 7. 未验证的真实协议边界(明确声明)

- **未接触任何真实 Provider 协议。** 所有 Agent 启动都指向 stub 可执行文件;
  `runtime.observation` 来自 stub。真实 Claude/Codex 的会话恢复、原生 session id 语义、
  控制通道行为**均未验证**。
- **stub 不是 Provider,不可混同。** `tmp-f6/stub-claude.mjs` 是**确定性协议 stub**:
  它在 transport 层真实接受了一次写入,并发出了 `type=result`、`session_id` 匹配的
  协议级 terminal(由 `tmp-f6/stub-protocol.mjs` 单独证明,见第 6 节)。
  但它的文本是**回显而非生成**,没有模型参与。
  因此可主张的仅是"**该 fixture 在协议层确实接受并终止了**",
  **不可**据此主张任何真实 Provider 的行为。
- **未做真实模型/付费/生产/共享资源 E2E**,亦未申请该授权。
- **daemon 正常性已在 turn-9 单独证明,不再是空白**(见第 9 节):
  `tmp-p3/daemon.mjs` 用真实 `yui web` 拉起**独立 detached daemon 进程**,
  由**它自己的调度循环**排空 wake 队列并派发 planning Turn,
  真实 Chrome 经 CDP 驱动真实 Web 入口。该 harness **从不调用**
  `runControllerSchedulerPass`。仍然成立的是:**没有 CLI 的 run-once 动词**,
  以及第 2/3 节中标 `[internal]` 的那些用例仍是进程内取证面。
- 兼容路径的 `RESUME MODE: resume` 与 digest 相等在**库级**验证;
  不兼容路径(handover)在**真实 CLI** 与本次 `[internal]` 采用边界两侧均验证。
  **turn-11 补充:两条路径现各有一次真实 daemon E2E**(同一 `conversationId` 复用 /
  换 Session 并留下持久 handover 事件,见第 11.5 节);其余组合仍只在库级覆盖。
- Claude 侧**未**主张与 Codex 配置化 read-only/never 等价的 OS 级只读保证;
  `isolation: "trusted-local"` 只表示"本地受信目录",**不是** OS 级强制只读。
- Scratch 未作为结果自动交付。
- **跨分支迁移序号已在 turn-9 采用上游时协调完成**(10/11 归上游、本分支顺延 12,
  见第 5 节);后续若再有并行迁移,仍需再次协调。
- 授权/资源撤销在**注入窗口**中验证(`/tmp/f45/f4windows.mjs`);
  真实多进程并发下的竞态时序未验证。
  **turn-11 补充:"撤权阻止延后采用"已在真实 daemon 上成立**(第 11.7 节:
  planning 活动期间吊销 grant → daemon 采用 fail closed、`disposition=failed`);
  但**采用后启动失败**(第 3 节)仍只有注入窗口证据,**未**做成 daemon E2E。

---

## 8. T06 可消费的入口/返回契约

- **入口(请求)**:`yui task activation request <task> --request-id <id> --environment <empty|scratch|local:<res>:<read|write>>`
  - `--request-id` 为**稳定幂等键**:重放返回同一 `operationRef`;同 id 配不同输入被拒。
  - 调用者若是 Leader 自己正在运行的 planning Turn,请求自动记为
    `startMode: after-planning-turn` + `afterPlanningTurn: <turnId>`,**立即返回引用**。
- **返回**:`operationRef = task-activation:<taskId>/<requestId>`;
  `disposition ∈ {pending, adopted, cancelled, failed}`;`effect ∈ {none, possible, confirmed}` 单调升级。
- **采用**:`yui task activate <task>`。准入会**重新检查** Task 状态、executionGate、
  请求目标一致性与实际相关的授权/资源;`deferred` 期间拒绝采用。
- **取消**:`yui task activation cancel <task> --request-id <id>` → `settled`,不再被执行;
  取消作用于**请求**,同 Task 可提交新请求。
- **查询**:`yui task activation show <task>`。
- 空计划合法:`active` 且 `cwd`/`workspaceIdentity`/workspace 记录均不存在;
  下游若需要目录,必须显式请求 `scratch`/`local`,不可假设 worktree 存在。

---

## 9. turn-9:真实 daemon + 真实浏览器的公共路径证据

取证脚本 `tmp-p3/daemon.mjs`(**交付前删除**,输出为删除前真实运行记录)。
它替换的**只有 Provider 边界**;其余全部是产品自己的东西:

| 环节 | 是否真实 |
| --- | --- |
| daemon 进程 | **真实**:`yui web` 经 `ensureFileTaskController` 拉起 detached 进程,pid 与 harness/web 进程均不同 |
| 调度循环 | **daemon 自己的**;harness **从不调用** `runControllerSchedulerPass` |
| 持久化 worker | **生产配置** `workerEnabled: true`(即 `core-smoke` 固定为 `false` 的那条路径) |
| HTTP listener | **真实** `yui web` 监听 |
| 浏览器 | **真实 Chrome 149.0.7827.55**,经 CDP;token 由服务端注入 HTML 自动获得 |
| 时钟 | **真实**;真实等满 `LEADER_WAKE_AGGREGATION_MS`(60s),实测 65s 后才出现派发 |
| Provider | **协议 stub**(外部可执行文件 + 绝对路径 launcher),不是模型 |

最终结果 **35 passed, 0 failed of 35**。关键实测事实:

```
PASS [BROWSER] 真实 Chrome 加载 daemon 的 dashboard 并渲染 Task surface
PASS [BROWSER] Draft 聊天输入存在且 Send 是 ENABLED(不是禁用外壳)
PASS [BROWSER] 真实鼠标点击后,实时 DOM 收据为
               "Queued for Leader; not proof of execution · message-1"
               —— 不是 "planning unavailable"
PASS [DAEMON]  daemon 自己的调度循环消费 wake-1 并派发 turn-1 (purpose=planning)
PASS [PROVIDER] 外部 Endpoint 收到真实受管 Turn:
               task=task-1 turn=turn-1 role=leader purpose=planning
               snapshot=context-snapshot-1@<64 hex>,绝对 manifest 路径,
               且使用 Yui 预分配的 --session-id
PASS [PROVIDER] 持久 Provider terminal:
               {providerNamespace:"anthropic/claude-code", accountScope:"claude",
                conversationId:"d9740f22-…", attemptId:"turn:task-1/turn-1",
                status:"completed"},turn.status=completed
PASS [PLANNING] planning Turn 的 writeProjectIds=[](空环境合法)
PASS [DURABLE]  浏览器键入的文本经公共 `task context` 读回,确为持久 Task 记录
PASS [BROWSER]  页面显示真实 Turn id / Provider 终态 / Provider 会话 id
PASS [BROWSER]  Leader Session 入口按**真实 Session**开合,不按 Draft 状态
```

**capability 探针不算派发,已分开计数**:12 次调用中只有 1 次携带受管身份
(`YUI_TASK_ID`/`YUI_ROLE`),其余是 `--version` 探针。早期版本曾把探针误当作
"Provider 真的执行了",此错误由本人发现并修正,如实记录。

**产品的 `YUI_TURN_ID` 并不注入 Provider 进程**(实际注入集见脚本头注释);
Turn 身份走 directive 文本 + `--session-id`。早期断言曾要求该变量,
属对产品的误解,已删除并记录。

### turn-9 中发现并修复的三个真实产品缺陷

1. `src/controller/runtimeHookTurnFence.ts` —— Draft 的 planning Turn 上报运行时被拒
   (`Runtime observation Hook Task does not accept this lifecycle boundary`),
   导致 `startup-failed`。修复复用**既有唯一不变量** `turnPurposeAdmitsTaskState`,
   不新增判定;Draft 仍不能产生 execution 观测。
2. `src/controller/fileSchedulerStoreAdapter.ts` —— 同因导致
   `Cannot register a native session for a Task that is not active`。同样交由
   该不变量裁决,Draft 仍不能在激活前开 execution Session。
3. `src/web/assets/client/app.ts` —— **渲染键不覆盖异步到达的观测**。
   `runtime` 由**独立**请求(1s 超时)填充,而 `updateRuntimePanel` 只就地
   打补丁两个节点,渲染键只由 core 快照算出;因此任何依赖观测的界面
   在观测到达后**永远保持旧值**。修复:渲染键加入**稳定**的观测签名
   (只含 role/session 身份,不含每次轮询都变的时间戳,避免持续重绘),
   并让观测到达后走 `renderCurrentDetail()`(仍受"未发送草稿/焦点"保护)。

### 第 2 部分的界面语义(不是删提示、不是删 disabled)

`taskSurface.ts` 现在从**Context 快照**(权威持久读、且驱动重渲染)取 planning 事实,
而不是从可选观测取:显示真实 planning Turn id 与状态、Provider 终态与会话 id、
环境(空环境显示"empty (legal for planning)")与 Turn 观测时间;
受限快照隐藏 Turn 时显示 `withheld`,**不谎报** "not-dispatched"。
Session 入口的 disabled 改为**按是否真的存在在线 Session**,
不再"因为是 Draft 就禁用";Draft 的收据文案按提交事实区分 queued/saved。


---

## 10. 第 4 部分:native better-sqlite3 崩溃(**已复现,根因=本地 gyp 构建**)

> **本节在 turn-11 被整体重写。** 上一版结论是"未能复现,如实声明",并写下
> "依赖版本与 native 二进制均可排除,也与 Leader 的一致"。
> **这两句都被撤回:它们是错的。** 当时我只在自己树上跑了同一个(预编译)
> 二进制,却把"我这里没崩"推广成"二进制相同、可以排除",这是从缺失证据
> 做的推断,不是观察。Leader 随后取证:失败 Integration 的
> `better_sqlite3.node` 与我树上的**不是**同一个文件。按该线索,
> 我在隔离目录里**逐字节复现了 Leader 的失败二进制,并复现了崩溃**。

### 结论

崩溃与 Yui 代码、与 `YUI_STORE_WORKER`、与 Node 二进制**都无关**;
它取决于 `better-sqlite3` 的 **native 产物来源**:

| 来源 | `better_sqlite3.node` sha256 | 工具链(`readelf -p .comment`) | daemon 启动 |
| --- | --- | --- | --- |
| `npm ci`(上游预编译) | `45cb92a1…e84f2` | `GCC: (Debian 10.2.1-6) 10.2.1 20210110` | **0/5** 崩溃 |
| `npm ci --build-from-source`(本机编译) | **`2e5e2fc1…ffdc34`** | `GCC: (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0` | **4/5** 崩溃 |

第二行的 sha256 与 Leader 报告其失败 Integration 的值**完全相同**
(`2e5e2fc17e752c952da4c5f89b990e30909e31144e7fa22923cac756f4ffdc34`),
`.comment` 也同为 Ubuntu 13.3.0;该目录同时存在 `Release/obj.target`、
`obj.target/deps/sqlite3.a`、`test_extension.node` —— 与 Leader 的观察逐项吻合。
故失败侧是**本机 node-gyp 编译产物**,成功侧是**上游 Debian 预编译产物**。

### 复现所用的精确命令

`tmp-p4b/install.sh`(临时脚手架,交付前删除)在**同一** `package.json` +
`package-lock.json`、同一 node、同一宿主工具链下做两份隔离安装:

```
node v24.20.0 · npm 11.19.0 · gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0

$ cd <iso>/prebuilt   && npm ci                       # 预编译路径
    real 0m2.372s        added 49 packages
$ cd <iso>/fromsource && npm ci --build-from-source    # 本机编译路径
    real 1m4.352s        added 49 packages
    npm warn: ... allowScripts ...   (better-sqlite3 与 node-pty 各一条)
```

两份都落在隔离目录内;**未改共享 Node、全局依赖或任何服务,也没有复制来源不明的
二进制去蒙混门禁**。`npm ci` 的 49 packages / 约 1 分钟 / 两条 `allowScripts`
警告与 Leader 的安装日志一致 —— 该日志描述的是**编译**那一侧。

### 崩溃形态(以及它此前为何"看不见")

用同一 Home、把 `controllerMain.js` 放到**前台**运行,本机编译版稳定给出:

```
exit code 134
node: ../src/node_api.cc:1128: napi_status napi_remove_env_cleanup_hook(...):
  Assertion `(env) != nullptr' failed.        ← RemoveEnvironmentCleanupHook
frames #3–#4: better_sqlite3.node  Statement::~Statement()
```

`src/controller/clientRuntime.ts:266-272` 以 `detached: true, stdio: "ignore"`
派生 daemon,所以 native abort **不进任何日志、CLI 也只看到 daemon 没起来**;
上一版之所以"未能复现",部分原因就是我一直在观察一个把 abort 丢弃的通道。
本节的 exit 134 是把同一进程拉到前台后**直接捕获**的。

### 已实测排除项(逐条给出观察,不是推断)

1. **Node 二进制相同,debug build 假设作废。** Leader 的
   `/data00/home/zhangqian.0326/.nvm/versions/node/v24.20.0/bin/node`
   sha256 `89af8424…aabbae7`,与我使用的**逐字节相同**;
   `process.version=v24.20.0`、`process.features.debug=false`、
   `v8_enable_debugging_features` 与 `v8_enable_debug` 均 `undefined`。
   上一版第 4 点"断言属于 debug/assert 构建"**不成立**:
   release 构建的 `node_api.cc` 同样带这条断言,**不能从断言形态反推 debug build**。
2. **`YUI_STORE_WORKER=0` 不是修复。** 在本机编译版上仍 **2/3 崩溃**。
   把 `workerEnabled=0` 当作修复会掩盖真实根因,本轮明确不采用。
   (turn-9 那四组 worker 假设实验的结论保持有效:worker 生命周期不是本崩溃的原因。)
3. **与 TMPDIR、与并行/串行无关**:两种 TMPDIR、两种模式在预编译版上均通过。

### 恢复到可通过状态(可重复)

```
$ cd node_modules/better-sqlite3 && npx prebuild-install    # 取回上游预编译产物
$ sha256sum build/Release/better_sqlite3.node
  45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2
$ <daemon 启动 × 3>                                          → 0/3 崩溃
$ node --test test/core/*.test.js
  ℹ tests 82  ℹ pass 82  ℹ fail 0                            exit 0
```

### 供 Leader 在全新 Integration 上重复的完整配方

```
node v24.20.0(同一 nvm 路径即可,无需改动)
npm ci                          # 不加 --build-from-source:走上游预编译
npm run lint                    # tsc --noEmit                → exit 0
npm run build                   # tsc                         → exit 0
node --test test/core/*.test.js #                             → 82/82 exit 0
sha256sum node_modules/better-sqlite3/build/Release/better_sqlite3.node
  # 期望 45cb92a1…e84f2;若得到 2e5e2fc1…ffdc34,说明本机编译被触发,
  # 此时 build/Release/obj.target 会存在 —— 用上面的 prebuild-install 恢复
```

**边界(如实限定):** 本节证明的是**预编译产物稳定、本机编译产物在此宿主上崩溃**,
以及两者与 Leader 两侧观察逐字节对应。我**没有**修复 better-sqlite3 自身的
析构/cleanup-hook 缺陷 —— 那是第三方 native 模块的问题,不在 T08 范围内,
本轮也不为此重写第三方模块。因此第 4 部分的产品结论是:
**Yui 侧无需改代码**,门禁只需保证 native 产物来自上游预编译。

---

## 11. turn-11:Draft→延后采用→执行 的真实 daemon 链路证据

> 本节的实测运行发生在 turn-11;turn-13 以**同一 directive** 再次派发同一 WorkItem,
> 本节内容未改,仅在 turn-13 完成交付前的最终验证与提交(见第 12 节)。

本节补齐此前被我报成 "optional" 的核心链路。它们在 message-2 与 turn-7 指令中
**是必须项**,上一轮未跑通就不该被降级 —— 这里给出实际跑通的结果。

**方法与边界:** 全部经由**真实生产 daemon**(`controller restart`,独立 pid,
`detached`)与**真实公共 CLI**;唯一被替换的是 **Provider 边界**(一个绝对路径的
外部协议 stub 可执行文件)。**没有**直接调用 `runControllerSchedulerPass` 或任何
调度函数;下列每一次状态迁移都是 daemon 自己的循环产生的。
`task turn list` 只渲染表格、没有结构化载荷,故用一个**只读**观测脚本读同一批
持久记录(只读、不写、不替代 daemon)。不要求真实模型,也没有使用真实 Provider。
四个场景各自在独立隔离 Home 中运行,并在最终确认轮中复跑:

```
adopt    ===== adopt: 36/36 passed =====
empty    ===== empty: 32/32 passed =====
cancel   ===== cancel: 18/18 passed =====
revoke   ===== revoke: 19/19 passed =====
```

### 11.1 Draft 消息真的被 accepted 并到达 terminal

Project-bound Draft 收到 `task message send` 后,**daemon 自己**在真实 60s
Leader 唤醒窗口后派发 planning Turn(实测 61s,与
`LEADER_WAKE_AGGREGATION_MS = 60_000` 相符);外部 Endpoint 确实收到该受管 Turn,
身份为 `{YUI_SESSION_SCOPE:"task", YUI_TASK_ID:"task-1", YUI_ROLE:"leader"}`;
Turn 随后进入 terminal。**这是实际 accepted/terminal,不是模拟。**

### 11.2 planning Turn 内的 CLI request 立即拿到原操作引用

在**自身受管 planning Turn 内部**调用激活请求,立即返回
`operationRef task-activation:task-1/req-activate-1`,
`startMode:"after-planning-turn"`、`after=turn-1` —— 即**原操作引用**,不是新建操作。
`activationCaller`(`taskActivationCommands.ts:201`)从"调用者是否处于该 Task 自己的
存活 planning Turn"推导 `startMode`,**从不接受调用方自报**。
同一 `requestId` 重复请求返回 `created=false` 与同一引用(幂等)。

### 11.3 持续活动期间不得采用;terminal 后由 daemon 自行采用并派发 execution

planning 仍活着时读取:`status=draft`、`disposition=pending` —— **未采用**。
planning 到达 terminal 后,**daemon 自己**完成采用:`status=active`、
`disposition=adopted`,并派发 execution Turn。

### 11.4 真实 executionEnvironment 的目录/权限,经核验

```json
{ "environmentRef": "task-1/preparation-<uuid>", "access": "write",
  "isolation": "trusted-local",
  "directory": { "path": "<granted dir>", "device": "64784",
                 "inode": "1706136", "ownership": "user" } }
```

`device`/`inode` 与活文件系统实测值一致(`resolveExecutionEnvironment`
本就会在不一致时拒绝),preparation 的 `resourceRefs=["native-dir"]`,
execution Turn **带着该已采用环境**真正到达 Endpoint。

### 11.5 新旧 Session 身份:两个结果都在真实链路上成立

* **不兼容(必须换 Session):** planning Session `2adf5e41…` → execution Session
  `8f4caa02…`,并有持久事件
  `{"reason":"activation-changed-physical-launch","roleName":"leader",
  "nativeSessionId":"2adf5e41…","continuity":"persistent-context"}` 作为依据。
* **兼容(必须复用 Session):** 事实不变时再派发**第二个 execution Turn**,
  `turn-2` 与 `turn-3` 的 `conversationId` **同为** `8f4caa02…`,
  且全程**只有一次** handover 记录(就是激活那次)。

`roleSessionMayContinue`(`effectiveLaunch.ts:222`)深比较的
`sessionContinuitySnapshot` 正是这两个结果的判据。内部风险窗口的既有证据继续复用,
不要求把所有组合都做成 E2E。

### 11.6 空环境计划:一处**修正我自己的假设**

我原以为"空计划 → 物理启动不变 → Session 可续"。**实测否证了这个假设。**
空计划确实**不采用任何物理资源、连 preparation 都不创建**
(`adoptTaskActivationResources`:`if (plan.kind === "empty") return { request }`),
但激活一个 Project-bound Task 会**物化其受管 Git 工作区**
(`workspace` → `workspace/tasks/task-1/main`,并多出一个 Project worktree),
`workspace.root` 因此改变,Session 仍然无法续用。
**真正的原因是受管工作区物化,不是"被采用的目录"。** 此处照实记录,不掩盖。
(第二个 execution Turn 在事实不变后同样复用 Session。)

### 11.7 取消 / 撤权:两条阻止延后采用的路径

* **取消**(`cancel: 18/18`):在 planning **仍活着**时取消 pending 请求 →
  `disposition=cancelled`,Task 保持 `draft`,**无** execution Turn、**无**环境、
  **无**已采用 preparation;重放被拒:
  `Activation request req-activate-1 was already cancelled for task-1 (operator withdrew the request). Use a new reques…`
* **撤权**(`revoke: 19/19`):在 planning 活着时由 Operator 吊销 grant
  (`revokeGrant(grant, "global:operator", now)`)→ daemon 在 terminal 后的采用
  **fail closed**:`disposition=failed`、
  `outcome="Resource grant unavailable: native-dir/write."`,
  Task 仍是**可继续的 Draft**,没有任何绑定或采用,也没有 execution Turn。

  首次尝试没能证明这一点:stub 在请求后约 0.1s 就 terminal,daemon 的采用
  **合法地**赢得竞态。加入 `STUB_HOLD_MS` 让 planning 真正保持活动后,
  才是在"持续活动期间"施加取消/撤权。此处如实记录该修正。

### 11.8 独立 Controller 重启后当前事实恢复

`cancel`/`revoke` 之外,`adopt` 场景做了一次**独立 Controller 重启**(新 pid):
`status`/`disposition`/`preparationId`/`executionEnvironment` **逐项保持**,
planning **没有**被重放。(重启的是本场景隔离 Home 里的私有 daemon,
**没有**重启共享 Controller/Provider。)

### 11.9 浏览器只验证受影响的交互

真实 Chrome(CDP)对真实 Web 服务器 `http://127.0.0.1:4173`,在真实渲染列表里
点开 Task 行,**11/11 通过**;turn-9 的 35/35 矩阵保持有效、本轮不重跑:

```json
{ "planning": "active",
  "text": "Planning Turn is active; messages reach the Task Leader.\n\nPlanning Turn: turn-1 (active)\n\nProvider terminal: not reported\n\nProvider conversation: not reported\n\nLive Leader Session: f358a21a-a7eb-4d2e-b84c-4b7ea4f28e77\n\nEnvironment: empty (legal for planning)\n\nTurn observed at: ...",
  "sessionButton": { "label": "View Leader Session (read-only)", "disabled": false } }
```

`data-planning="active"` 等于持久 Turn 状态(**没有**谎报 "not-dispatched"),
渲染出的 Session id 与持久状态一致,Session 入口因**真的存在** Leader Session 而可用。
一处自查修正:最初的选择器 `/session|conversation/i` 命中的是全局
"Operator session" 按钮,那条断言并没有在测它声称的东西;改为按真实文案
`View Leader Session (read-only)` 定位 Task 界面自己的按钮后重跑,才是有效证据。

### 11.10 本轮的验收覆盖层级(精确,不夸大)

| 项 | 覆盖层级 | 依据 |
| --- | --- | --- |
| **S01** 路由到 Leader 并按需启动 planning | **真实 daemon E2E + 真实浏览器** | 11.1、11.9;daemon 自己派发,外部 Endpoint 实收 |
| **S02** 关闭原 Session、兼容会话读取 Context | **真实 daemon E2E,两个结果都有** | 11.5:不兼容换 Session(带持久 handover 事件)、兼容复用同一 `conversationId` |
| **S27** 空环境计划合法、不为框架模型建 worktree | **真实 daemon E2E,并修正了我的假设** | 11.6:空计划不创建 preparation;`workspace.root` 变化来自受管工作区物化 |
| **S40** Draft 内激活:立即返回引用、结束后按当前意图采用、已取消不继续 | **真实 daemon E2E,四场景** | 11.2、11.3、11.7:立即拿到原操作引用;活动期间不采用;取消/撤权均阻止延后采用 |

**仍未做到 E2E、故不声称完成的部分(如实列出):**

1. **没有真实 Provider/模型。** Provider 边界是外部协议 stub;
   "真实模型会如何回话"不在本节证据内(本轮也不要求)。
2. **采用后启动失败**(第 3 节)仍是内部风险窗口层级的证据,**未**做成 daemon E2E。
3. **兼容/不兼容的其余组合**只在内部层级覆盖;本节只把**各一个**结果做成了 E2E。
4. **`crashForTest()` 重启后在飞请求不 settle 的挂起**(§10 早前发现)
   仍是**未修复的独立问题**,本轮明确不扩范围。
5. 第 7 节列出的未验证协议边界**未**变化。

---

## 12. 交付前的最终验证(turn-13,清理后的实际树)

临时脚手架(`tmp-a/` 四场景 harness 与只读观测器、`tmp-p4b/` 两份隔离安装)
**已在提交前删除**;交付 diff 只含本证据文档。删除后在实际交付树上跑:

```
$ node --version && npm --version
v24.20.0
11.19.0

$ sha256sum node_modules/better-sqlite3/build/Release/better_sqlite3.node
  45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2   ← 上游预编译
  build/Release/obj.target: 不存在                                    ← 未本地编译
  readelf -p .comment: GCC: (Debian 10.2.1-6) 10.2.1 20210110

$ npm run lint     # tsc -p tsconfig.json --noEmit    → exit 0
$ npm run build    # tsc -p tsconfig.json             → exit 0
$ TMPDIR=/tmp node --test test/core/*.test.js
  ℹ tests 82  ℹ pass 82  ℹ fail 0                     → exit 0
```

即第 10 节给出的配方在本树上成立:**native 产物来自上游预编译时,完整 core 通过**。

**本轮未做、也不声称做过的事:** 没有 push / PR / 远端 merge / release / archive;
没有自我 accept 或自我 complete(候选交由 Leader 独立 Review);
没有 amend / rebase 既有 `9d314e3` / `0e30089` / `ae6f28e` / `5400ac9`;
没有重启共享 Controller/Provider;没有真实 Provider/模型/付费/生产 E2E;
没有触碰 T10/T11/ACP/SDK;没有新增重试 worker / lease / 第二账本;
没有改动中央已发布迁移(本分支仍为顺延的 12)。

## 13. F5 最终修正与 Leader 集成验证

`turn-19` 交付 `fe55958cbba42819209907904afc4b60bea1b610`：
取消/采用请求的历史判定改为读取既有持久 activation 事件，16 项数组仅用于
展示。超过展示上限后，旧取消请求仍被拒绝，不再重获 pending 槽位。
本节取代前文关于限长数组能够独立保证历史请求不可重播的表述。

Leader 已完整读取该 Turn 原报告及六文件差异。`integration-6 / job-2`
在独立工作区对该精确提交完成依赖安装、原生产物 SHA 校验、build、lint、
core：85/85 通过，测试阶段约 4.32 秒；随后由受支持 Integration 的
compare-and-swap 将 Task main 前移至该提交。原始 Task 基线不变。
此前 `integration-5` 的预编译下载超时保留为失败记录，不算代码测试失败。

依赖取自本地已缓存的同版本上游预编译归档，仅向隔离 node_modules 解包；
解包后强制核验 `better_sqlite3.node` 的 SHA-256 为
`45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2`。
没有改写全局安装、共享 Home 或共享服务；此结果不证明本机 GCC 构建缺陷已修复。

85 项中新增的三项 F5 检查验证了真实 SQLite 关闭重开、超过旧展示上限后
拒绝重播、保留槽位、相同 pending 请求幂等及不同输入拒绝。它们调用领域服务，
不等同于新的 CLI/daemon E2E。按 `develop-yui` 的临时变更证据规则，
Leader 在验证通过后移除 `test/core/activation-settled-authority.test.js`，
不将取消/历史回归矩阵永久加入 core。原测试可从上述提交恢复，运行结果保留于
`artifacts/jobs/task-22/job-2/logs/006-check-6.log`。

独立 Task-final Review 将针对清理后冻结的最终 HEAD 进行；上述检查不是该 Review。

清理后的 Task main 复用该 Integration 已验证的同锁文件依赖副本，执行
`make install-local`（含 build）及 `node --test test/core/*.test.js`：
均退出 0，core 82/82，测试阶段约 4.48 秒。仅测试与证据文档变化，
生产源码与已通过 lint 的 Integration 候选一致。
