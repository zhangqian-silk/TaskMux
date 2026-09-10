# Runtime recovery

Read this when a native Turn fails, delivery acceptance is unknown, the
Controller is unavailable, or an authorized supervisor chooses Session
replacement. Workers and Reviewers report exact evidence; they do not acquire
supervisor authority by reading this procedure.

## Inspect the failed execution

Read the referenced `runtime.agent-error`, exact AgentRun, Role Session and
affected WorkItem, ReviewRound or Integration. Use `task next-action` and
`execution audit` as decision support, not as an automatic plan.
Active or quiet observations are not a Task-wide lock or proof of failure.

A failed AgentRun is immutable; retry creates a new attempt. Reuse a recoverable
Session when useful and load the new attempt's current context, not an old
Assignment from memory. A new Host process need not mean a new native Session.
Preserve frozen Review candidates and selected synthesis sources on retry.
An infrastructure failure is not a defect in the business result.

## Replace a Session deliberately

An authorized Leader or Operator may request:

```sh
yui task role session new <task> <role> --reason "<reason>"
```

The old Run may still be active, the Session may already be released, or fresh
context may simply be preferable. Save necessary requirements, decisions,
progress and results first. Yui persists replacement intent, stops the exact
execution and retires its engineering attempts while retaining Task history and
workspaces. Do not manipulate Run status, delete context or change models to
make replacement legal.

When replacing yourself, end the native turn. The successor reads durable Task
context and fixed notification references, then chooses which still-valid
assignment to continue. Released Leaders retain scoped diagnostic reads but
cannot regain write authority.

## Handle uncertainty and failed cleanup

Never replay a notification whose acceptance is unknown. After evidence
establishes shared-native quiescence, an authorized supervisor can use:

```sh
yui task wake resolve <task> <wake> --reason "<quiescence evidence>"
```

This releases only the claim, preserves the original unknown record, and lets
independent later inputs proceed. It neither asserts acceptance nor implements
the Message. Uncertain native activity still blocks conflicting execution;
unrelated authorized local work can continue.

If the Controller is unresponsive, an authorized Operator can use
`controller status` and explicit `controller restart` without a successful
preliminary RPC. Preserve the resource and restart authorization boundary.
If exact native stop or inspection fails, read the persisted diagnostic and
resolve that resource boundary; do not kill arbitrary processes, clear unknown
execution records, or modify managed refs, tmux Sessions or state files.

After repeated failure of the same bounded recovery, report the observed
cause, impact and smallest remaining options. Do not broaden cleanup or add
a private retry loop. A failed recovery does not erase the pending requirement.
