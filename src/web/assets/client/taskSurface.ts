export const TASK_SURFACE_SCRIPT = `
import { node, clear } from "/assets/js/dom.js";
import { anchorSection, sectionHead, richText, inputCard, roleCard, turnCard, pill } from "/assets/js/components.js";

// All business facts below retain their Context reference. Expanded values
// are current reads, not mutations of a historical Context snapshot.
export function renderTaskSurface(container, data, t, locale, actions) {
  clear(container);
  const core = data.core;
  const task = data.task;
  container.dataset.taskId = task.id;
  const zh = locale.startsWith("zh");
  const say = (en, cn) => zh ? cn : en;
  const records = (store) => core.records.filter((entry) => entry.ref.store === store);
  const values = (store) => records(store).filter((entry) => !entry.omitted).map((entry) => entry.value);
  const scaffold = node("div", "detail-scaffold task-surface");
  const summary = node("div", "section-body");
  summary.append(node("span", "detail-kicker", task.id), node("h2", "detail-title", task.title), pill(t, "status", task.status));
  const conversation = node("button", "record-open", say("View Leader Session (read-only)", "查看 Leader Session（只读）"));
  conversation.type = "button";
  conversation.disabled = task.status === "draft" || task.status === "archived";
  conversation.addEventListener("click", () => actions.openTerminal({ scope: "task", taskId: task.id, roleName: "leader" }));
  summary.append(conversation);
  const chat = node("form", "record-card");
  const chatLabel = node("label", "", say("Message to Task Leader", "发送给 Task Leader"));
  const message = node("textarea", "");
  message.required = true;
  message.maxLength = 8000;
  chatLabel.append(message);
  chat.addEventListener("input", () => { chat.dataset.unsent = message.value ? "true" : "false"; });
  const send = node("button", "record-open", say("Send", "发送"));
  send.type = "submit";
  send.disabled = !["active", "draft"].includes(task.status);
  const sent = node("p", "muted", say("Not submitted", "未提交"));
  sent.setAttribute("role", "status");
  chat.append(chatLabel, send, sent);
  chat.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    chat.dataset.unsent = "true";
    const requestId = crypto.randomUUID();
    sent.textContent = say("Waiting for receipt · ", "等待回执 · ") + requestId;
    try {
      const receipt = await actions.sendMessage(task.id, message.value, requestId);
      sent.textContent = (receipt.disposition === "queued"
        ? say("Queued for Leader; not proof of execution · ", "已为 Leader 排队，不代表已执行 · ")
        : say("Saved as Draft context; planning Session unavailable · ", "已保存为 Draft 上下文；planning Session 不可用 · "))
        + receipt.record.id;
      message.value = "";
      chat.dataset.unsent = "false";
      send.disabled = false;
    } catch {
      sent.textContent = say("Unknown submission outcome. Reload and inspect saved messages before sending again · ",
        "提交结果未知。请重新加载并检查已保存消息，不要盲目重发 · ") + requestId;
    }
  });
  summary.append(chat);
  if (task.status === "draft") summary.append(node("p", "muted", say(
    "Draft planning Session is not available yet. No runtime has been started.",
    "Draft planning Session 尚不可用；此入口没有启动运行时。")));
  if (task.description) summary.append(richText(say("Current requirements", "当前要求"), task.description, t));
  if (task.completionSummary) summary.append(richText(t("detail.conclusion"), task.completionSummary, t));
  const edit = node("details", "record-card");
  edit.append(node("summary", "", say("Edit Task title", "修改任务标题")));
  const form = node("form", "record-block");
  const label = node("label", "", say("Title", "标题"));
  const title = node("input", "");
  title.value = task.title;
  title.required = true;
  title.maxLength = 500;
  label.append(title);
  form.addEventListener("input", () => { form.dataset.unsent = "true"; });
  const save = node("button", "record-open", say("Save", "保存"));
  save.type = "submit";
  const feedback = node("p", "muted", say("Not submitted", "未提交"));
  feedback.setAttribute("role", "status");
  form.append(label, save, feedback);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    form.dataset.unsent = "true";
    const requestId = crypto.randomUUID();
    feedback.textContent = say("Waiting for save receipt · ", "正在等待保存回执 · ") + requestId;
    try {
      const receipt = await actions.updateTask(task.id, { title: title.value }, requestId);
      feedback.textContent = say("Saved · revision ", "已保存 · revision ") + receipt.revision;
      title.value = receipt.record.title;
      form.dataset.unsent = "false";
      save.disabled = false;
    } catch {
      // Local mutation IDs correlate requests; they are not a deduplication
      // ledger. A lost response must never automatically replay a write.
      feedback.textContent = say("Unknown save outcome. Reload this page to read current facts before submitting again. Request: ",
        "保存结果未知。请重新加载页面读取当前事实，再决定是否提交。请求：") + requestId;
    }
  });
  edit.append(form);
  summary.append(edit);
  scaffold.append(anchorSection("detail-top", sectionHead(t("tabs.summary")), summary));

  function recordCard(entry) {
    const card = node("article", "record-card");
    card.append(node("strong", "", entry.ref.store + " · " + entry.ref.refId));
    const ref = node("small", "muted", say("Revision: ", "版本：") + entry.ref.revision);
    card.append(ref);
    if (!entry.omitted) {
      const value = entry.value;
      const text = value.content || value.summary || value.body || value.objective || value.title || value.leaderSummary;
      if (text) card.append(richText(null, text, t));
      if (value.status) card.append(node("p", "muted", value.status));
      if (value.roleName) card.append(node("p", "muted", value.roleName));
      if (entry.ref.store === "work-item") {
        card.append(node("p", "muted", say("Owner: ", "负责人：") + (value.assignee || "Leader")));
        if (value.acceptance) card.append(richText(say("Acceptance criteria", "验收标准"), value.acceptance.join("\\n"), t));
      }
      if (entry.ref.store === "job") {
        const status = value.status;
        const label = status === "queued" ? say("Queued", "已排队")
          : status === "running" ? say("Waiting for a terminal receipt", "等待明确终态")
          : status === "unknown-needs-attention" ? say("Unknown effect — inspect the original operation; do not resend", "效果未知——检查原操作，不要重发")
          : say("Terminal record", "已记录终态");
        card.append(node("p", "", label + " · " + task.id + "/" + value.id));
      }
    } else card.append(node("p", "muted", entry.summary || say("Value omitted from compact read", "紧凑读取已省略正文")));
    const expand = node("button", "record-open", say("Read full record / source", "读取完整记录／来源"));
    expand.type = "button";
    expand.addEventListener("click", async () => {
      expand.disabled = true;
      try {
        const result = await actions.inspect(task.id, entry.ref);
        const content = node("pre", "surface-json", JSON.stringify(result.value, null, 2));
        card.append(content);
        expand.remove();
      } catch {
        expand.disabled = false;
        expand.textContent = say("Record changed or unavailable; refresh context", "记录已变化或不可用；请刷新 Context");
      }
    });
    card.append(expand);
    return card;
  }
  function section(id, name, entries) {
    const body = node("div", "section-body");
    entries.forEach((entry) => body.append(recordCard(entry)));
    if (!entries.length) body.append(node("p", "muted", core.omitted.records
      ? say("Not included in this compact read", "此紧凑读取未包含该记录")
      : say("No records", "暂无记录")));
    scaffold.append(anchorSection(id, sectionHead(name, { count: entries.length }), body));
    return body;
  }
  const focus = section("detail-focus", say("Goal and current focus", "目标与当前关注"), records("task-brief"));
  const brief = values("task-brief")[0];
  if (brief) {
    focus.prepend(richText(t("detail.focus"), brief.currentFocus, t));
    if (brief.boundaries.length) focus.append(richText(say("Boundaries", "边界"), brief.boundaries.join("\\n"), t));
  }
  const questions = node("div", "section-body");
  records("input-request").filter((entry) => entry.omitted || entry.value.status === "open").forEach((entry) => {
    questions.append(entry.omitted ? recordCard(entry) : inputCard(entry.value, { single: true }, t, locale, actions));
  });
  scaffold.append(anchorSection("detail-attention", sectionHead(t("detail.attention")), questions));
  section("detail-work", say("Responsibilities and acceptance", "工作责任与验收"), records("work-item"));
  section("detail-results", say("Saved results and provenance", "已保存结果与来源"), records("artifact").concat(records("candidate")));
  section("detail-messages", t("detail.messages"), records("task-message"));
  section("detail-history", say("Decisions and milestones", "决策与里程碑"), records("task-decision").concat(records("task-milestone")));
  section("detail-reviews", t("detail.reviews"), records("review-round"));
  const roles = node("div", "section-body");
  records("role").forEach((entry) => {
    if (entry.omitted) { roles.append(recordCard(entry)); return; }
    const role = entry.value;
    const active = values("turn").find((turn) => turn.roleName === role.name && turn.status === "active");
    const incomplete = core.omitted.records > 0 || records("turn").some((entry) => entry.omitted);
    roles.append(roleCard({
      ...role, status: active ? "running" : incomplete ? "unknown" : "idle",
      effectiveLaunch: active ? active.effective : null,
      launchDrift: active && active.effective.sourceDesiredRevision !== role.launchRevision
    }, task, t, locale, actions));
    if (!active) roles.append(node("p", "muted", say(
      "No active Turn in this read; Session activity is a separate observation.",
      "此读取中没有活跃 Turn；Session 活动属于独立观察。")));
  });
  scaffold.append(anchorSection("detail-roles", sectionHead(t("detail.roles")), roles));
  const execution = node("details", "record-card");
  execution.append(node("summary", "", say("Execution and observations", "展开执行与观察")));
  records("turn").forEach((entry) => execution.append(entry.omitted ? recordCard(entry) : turnCard(entry.value, t, locale)));
  (core.observations || []).forEach((observation) => execution.append(node("p", "muted",
    observation.source + " · " + observation.status + " · " + observation.coverage + " · " + observation.observedAt)));
  const runtimeStatus = node("p", "muted", data.runtimeStatus + " · " + data.runtimeObservedAt);
  runtimeStatus.dataset.runtimeStatus = "";
  execution.append(runtimeStatus);
  const raw = node("pre", "surface-json", data.runtime ? JSON.stringify({
      roles: data.runtime.roles, runtimeHealth: data.runtime.runtimeHealth
    }, null, 2) : "");
  raw.dataset.runtimeValue = "";
  execution.append(raw);
  scaffold.append(anchorSection("detail-exec", sectionHead(t("detail.execution")), execution));
  section("detail-operations", say("Original operation facts (no automatic retry)", "原始操作事实（不自动重试）"), records("job"));
  const refs = node("details", "record-card");
  refs.append(node("summary", "", say("Context cursor and omitted references", "Context 游标与省略引用")));
  refs.append(node("pre", "surface-json", JSON.stringify({
    coreCursor: core.coreCursor, throughCursor: core.throughCursor, count: core.count, omitted: core.omitted
  }, null, 2)));
  refs.append(node("p", "muted", say("Reads do not acknowledge messages. Omitted records can be located with the CLI domain query and inspected by reference.",
    "读取不确认消息。被省略的记录可经 CLI 领域查询定位后按引用读取。")));
  scaffold.append(refs);
  container.append(scaffold);
}
`;
