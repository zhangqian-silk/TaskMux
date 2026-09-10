# Record external delivery

Use this after creating, updating, closing, reopening or merging a PR/MR
within existing user authorization. This procedure does not grant permission
to push, publish, merge, query an external provider or archive.

Immediately record the confirmed operation with `yui task publication upsert`.
Supply only facts already known from the operation; do not defer recording to
another Role or depend on provider-specific discovery.

Track PR/MR identity, state, commits, URL, merge time and evidence, not CI or
deployment status. After merge, use `yui task publication verify` only when
current authorization covers that external provider read. Otherwise retain
reported evidence and state the verification gap.

Use `yui task remote-delivery <task>` to explain external delivery. Publication
is not Candidate acceptance, Review, Integration or Task completion.

Completion does not authorize archive. The Operator obtains authorization for
the exact Task, checks archive eligibility, then uses `--integrated` for verified
merged delivery or `--abandon` for deliberate non-delivery. General archive
approval never implies `--force` authority. Preserve the Task record.
