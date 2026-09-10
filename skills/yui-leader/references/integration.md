# Integrate an isolated result

Read this before integrating a WorkItem Candidate or handling an Integration
notification. Inspect the original result, diff, checks and exact Candidate.
If insufficient, return bounded feedback to the owning WorkItem/Role while
its scope remains valid.

For acceptable isolated Git changes, capture and integrate the latest Candidate
before acceptance:

```sh
yui task work capture <work-id>
yui task integration start <task> --project <project> \
  --change-set <change-set-id> \
  --check "<Project Policy command>"
yui task work accept <work-id> --summary "<decision and evidence>"
```

These are distinct decisions; confirm Integration succeeded before acceptance.
Preserve each managed workspace's owner and the Task's recorded base. Do not
silently advance that base because a remote branch moved.

## Finish the same attempt

For direct Integration checks running as a DurableJob, Job success is not
the final target update. Read the terminal result, then use:

```sh
yui task integration continue <task>/<integration>
```

This also applies when no manual conflict resolution was needed. Do not start
a duplicate Integration or wait for an empty queue to finalize it.

Resolve failures using the exact conflict or check evidence and the supplied
Integration workspace. Never bypass compare-and-swap, update managed refs by
hand, or create a replacement WorkItem for ordinary Integration correction.
Recheck changed behavior or unresolved failures; do not rerun unchanged
successful validation without a current reason.
