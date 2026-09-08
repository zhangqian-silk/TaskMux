# T08 — Draft Leader 与正式执行:实现与验证证据

WorkItem: `work-item-1` (task-22, turn-4 修正候选;turn-2 的 `9d314e3` 已被拒绝)
分支: `yui/task-22-69eeaf67/work-item-1`
存储版本: `CURRENT_STORAGE_VERSION = 10`

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
都是**新增可选字段**,因此**在既有迁移 1–9 之后仅追加迁移 10**,未修改任何既有迁移。
turn-4 将本候选新增的内容**合并为单一当前版本迁移**,`introducedIn` 修正为 `"0.15.8"`
——最后的发布 tag `v0.15.7` 的 `CURRENT_STORAGE_VERSION = 3`,迁移 4–9 同属未发布的
`0.15.8`,本迁移属于同一未发布版本,不另起版本号。

```
version: 10, name: "draft-planning-and-deferred-activation", introducedIn: "0.15.8"
sql: CREATE INDEX IF NOT EXISTS idx_turns_planning_active   ON turns(...)        WHERE ...
     CREATE INDEX IF NOT EXISTS idx_tasks_activation_pending ON task_records(...) WHERE ...
```

两个**部分索引**把 Draft planning 选取与 pending 激活恢复限定在合格的少数行,
执行期不因此扫描 Task 历史;建索引不新增行、不重写任何 payload。
缺省语义为"从未显式请求过激活",历史 Turn 保持原有 execution/review purpose,
不推断、不重写。

已实测迁移不可变性(而非静态声称):对 `sqliteSchema.ts` 的 `git diff` 只有
**两个 hunk**——迁移 10 条目本身与 `REQUIRED_SCHEMA_INDEXES` 列表;
diff 中**没有任何一行**触及 `version: 1..9`,12 个具名 `*_SQL` 基线常量逐一
按 SHA-256 与 base `fa70078` 比对**全部一致**。

部分索引确实被查询计划器使用(不是假定):

```
$ node tmp-f6/index-check.mjs
selected: ["task-1"]
expected: ["task-1"] — cancelled/adopted/never-requested/non-draft all excluded
plan: SCAN records USING INDEX idx_tasks_activation_pending | SEARCH catalog ...
INDEX CHECK: PASS (correct rows; partial index used, so no Task-history scan)
```

**并行合并协调需求:`CURRENT_STORAGE_VERSION` 由 9 改为 10 是全局单点。**
若有其他分支同期也追加迁移,必须协调序号(本分支占用 10),否则会出现两个 version 10;
`core-smoke.test.js` 中迁移头断言需同步。此项需在合并时由人工确认,我未做跨分支协调。

---

## 6. 实际检查

以下为 turn-4 修正候选上**本次实跑**的输出(不是 turn-2 的旧结果):

```
$ npm run lint            # tsc -p tsconfig.json --noEmit
(无输出,exit 0)

$ npm run build           # tsc -p tsconfig.json
(无输出,exit 0)

$ node --test test/core/*.test.js
ℹ tests 81
ℹ pass 81
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
**没有 CLI 的 run-once 动词**,因此单个调度周期只能进程内驱动;
这不是"daemon 正常性"证明,也不等于全链路 CLI 端到端。

`tmp-f6/*.mjs` 与 `/tmp/f45/*.mjs` 是**临时诊断脚本,已在交付前删除**
(故上述命令无法在本候选上原样复跑;它们的输出是删除前的真实运行记录)。
删除后在**即将提交的这棵树上**重跑了 `lint` / `build` / `test:core`,
三者退出码均为 `0`、`81/81` 通过。
永久回归矩阵**未扩容**:`test/core/core-smoke.test.js` 仅更新迁移头断言
(`CURRENT_STORAGE_VERSION` 9→10、迁移列表加 `{version: 10}`),未新增测试;
`git diff 9d314e3 -- test/` 为空,即本次修正未再触碰任何测试文件。

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
- **没有 CLI 的 run-once 动词**,所以单个调度周期由进程内 `runControllerSchedulerPass`
  驱动。私有 Home 的 daemon 未被用来自动排空 wake 队列,
  **本文件不含任何 daemon 正常性证明**。
- 兼容路径的 `RESUME MODE: resume` 与 digest 相等在**库级**验证;
  不兼容路径(handover)在**真实 CLI** 与本次 `[internal]` 采用边界两侧均验证。
- Claude 侧**未**主张与 Codex 配置化 read-only/never 等价的 OS 级只读保证;
  `isolation: "trusted-local"` 只表示"本地受信目录",**不是** OS 级强制只读。
- Scratch 未作为结果自动交付。
- **跨分支迁移序号未协调**(见第 5 节),需人工在合并时确认。
- 授权/资源撤销在**注入窗口**中验证(`/tmp/f45/f4windows.mjs`);
  真实多进程并发下的竞态时序未验证。

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
