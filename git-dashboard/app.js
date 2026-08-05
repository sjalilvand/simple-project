let lastRemoteUrl = "";
let diffVisible = false;

function el(id) {
  return document.getElementById(id);
}

async function apiGet(path) {
  const res = await fetch(path);
  return await res.json();
}

async function apiPost(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return await res.json();
}

async function refreshAll() {
  await loadStatus();
  await loadLog();
  await loadRemote();
}

async function loadStatus() {
  try {
    const data = await apiGet("/api/status");

    el("currentBranch").textContent = data.current_branch || "---";
    el("repoPath").textContent = data.repo_dir || "";

    const rawStatus = data.status?.stdout || "";
    const changes = parseGitStatus(rawStatus);

    renderSummary(changes);
    renderChanges(changes);

  } catch (err) {
    el("changeList").innerHTML = `
      <div class="empty error-text">
        خطا در دریافت وضعیت: ${escapeHtml(String(err))}
      </div>
    `;
  }
}

function parseGitStatus(raw) {
  const result = [];

  const lines = raw
    .split("\n")
    .map(x => x.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("##")) {
      continue;
    }

    if (line.length < 3) {
      continue;
    }

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const file = line.substring(3).trim();

    let type = "modified";
    let label = "تغییر کرده";

    if (line.startsWith("??")) {
      type = "new";
      label = "فایل جدید";
    } else if (indexStatus === "A" || worktreeStatus === "A") {
      type = "new";
      label = "فایل جدید";
    } else if (indexStatus === "D" || worktreeStatus === "D") {
      type = "deleted";
      label = "حذف شده";
    } else if (indexStatus === "M" || worktreeStatus === "M") {
      type = "modified";
      label = "تغییر کرده";
    }

    const staged = indexStatus !== " " && indexStatus !== "?";

    result.push({
      raw: line,
      file,
      type,
      label,
      staged,
      indexStatus,
      worktreeStatus
    });
  }

  return result;
}

function renderSummary(changes) {
  const newCount = changes.filter(x => x.type === "new").length;
  const modifiedCount = changes.filter(x => x.type === "modified").length;
  const deletedCount = changes.filter(x => x.type === "deleted").length;
  const stagedCount = changes.filter(x => x.staged).length;

  el("newCount").textContent = newCount;
  el("modifiedCount").textContent = modifiedCount;
  el("deletedCount").textContent = deletedCount;
  el("stagedCount").textContent = stagedCount;

  if (changes.length === 0) {
    el("cleanMessage").classList.remove("hidden");
  } else {
    el("cleanMessage").classList.add("hidden");
  }
}

function renderChanges(changes) {
  const box = el("changeList");

  if (changes.length === 0) {
    box.innerHTML = `
      <div class="empty">
        هیچ تغییری وجود ندارد. پروژه فعلاً تمیز است.
      </div>
    `;
    return;
  }

  box.innerHTML = "";

  changes.forEach(change => {
    const card = document.createElement("div");
    card.className = "change-card";

    const stagedText = change.staged
      ? "آماده commit شده"
      : "هنوز آماده commit نیست";

    const stagedClass = change.staged ? "badge staged" : "stage-state";

    card.innerHTML = `
      <div>
        <span class="badge ${change.type}">
          ${escapeHtml(change.label)}
        </span>
      </div>

      <div class="file-name">
        ${escapeHtml(change.file)}
      </div>

      <div class="${stagedClass}">
        ${escapeHtml(stagedText)}
      </div>
    `;

    box.appendChild(card);
  });
}

async function loadLog() {
  try {
    const data = await apiGet("/api/log");
    const commits = data.commits || [];
    const box = el("timeline");

    if (commits.length === 0) {
      box.innerHTML = `<div class="empty">هنوز commit ثبت نشده است.</div>`;
      return;
    }

    box.innerHTML = "";

    commits.slice(0, 8).forEach(commit => {
      const div = document.createElement("div");
      div.className = "commit-card";

      div.innerHTML = `
        <div class="commit-hash">${escapeHtml(commit.short_hash)}</div>
        <div>
          <div class="commit-message">${escapeHtml(commit.message)}</div>
          <div class="commit-meta">
            ${escapeHtml(commit.author)} - ${escapeHtml(commit.date)}
          </div>
        </div>
      `;

      box.appendChild(div);
    });

  } catch (err) {
    el("timeline").innerHTML = `
      <div class="empty error-text">
        خطا در دریافت تاریخچه: ${escapeHtml(String(err))}
      </div>
    `;
  }
}

async function loadRemote() {
  try {
    const data = await apiGet("/api/remotes");
    const text = data.remotes?.stdout || "";

    lastRemoteUrl = extractRemoteUrl(text);

    el("remoteText").textContent =
      lastRemoteUrl || "برای این پروژه هنوز remote ثبت نشده است.";

  } catch (err) {
    el("remoteText").textContent = "خطا در دریافت remote";
  }
}

function extractRemoteUrl(text) {
  if (!text) return "";

  const lines = text.split("\n").filter(Boolean);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      return parts[1];
    }
  }

  return "";
}

async function addAll() {
  const ok = confirm(
    "این کار همه تغییرات فعلی را برای commit آماده می‌کند.\n\n" +
    "معادل دستور:\n" +
    "git add .\n\n" +
    "ادامه می‌دهی؟"
  );

  if (!ok) return;

  const data = await apiPost("/api/add-all");
  showCommandResult("آماده‌سازی تغییرات", "git add .", data);

  await refreshAll();
}

async function commitChanges() {
  const message = el("commitMessage").value.trim();

  if (!message) {
    alert("لطفاً پیام commit را بنویس.\nمثلاً: Improve Git dashboard UI");
    return;
  }

  const ok = confirm(
    "این کار یک نسخه جدید در Git ذخیره می‌کند.\n\n" +
    "پیام commit:\n" +
    message + "\n\n" +
    "ادامه می‌دهی؟"
  );

  if (!ok) return;

  const data = await apiPost("/api/commit", { message });
  showCommandResult("ذخیره نسخه جدید", `git commit -m "${message}"`, data);

  el("commitMessage").value = "";

  await refreshAll();
}

async function pushChanges() {
  const ok = confirm(
    "این کار commitهای محلی را به GitHub ارسال می‌کند.\n\n" +
    "معادل دستور:\n" +
    "git push\n\n" +
    "ادامه می‌دهی؟"
  );

  if (!ok) return;

  const data = await apiPost("/api/push");
  showCommandResult("ارسال به GitHub", "git push", data);

  await refreshAll();
}

async function pullChanges() {
  const ok = confirm(
    "این کار آخرین تغییرات را از GitHub دریافت می‌کند.\n\n" +
    "معادل دستور:\n" +
    "git pull\n\n" +
    "اگر فایل‌های تغییرکرده محلی داشته باشی، ممکن است conflict ایجاد شود.\n\n" +
    "ادامه می‌دهی؟"
  );

  if (!ok) return;

  const data = await apiPost("/api/pull");
  showCommandResult("دریافت از GitHub", "git pull", data);

  await refreshAll();
}

async function toggleDiff() {
  diffVisible = !diffVisible;

  const area = el("diffArea");

  if (!diffVisible) {
    area.classList.add("hidden");
    return;
  }

  area.classList.remove("hidden");
  el("diffOutput").textContent = "در حال دریافت diff...";

  try {
    const data = await apiGet("/api/diff");

    const unstaged = data.diff?.stdout || "";
    const staged = data.staged_diff?.stdout || "";

    let text = "";

    text += "UNSTAGED DIFF\n";
    text += "====================\n";
    text += unstaged || "No unstaged diff.";
    text += "\n\n";

    text += "STAGED DIFF\n";
    text += "====================\n";
    text += staged || "No staged diff.";

    el("diffOutput").textContent = text;

  } catch (err) {
    el("diffOutput").textContent = String(err);
  }
}

function showCommandResult(title, command, data) {
  const ok = data.ok === true;

  let text = "";

  text += `${title}\n`;
  text += "====================\n";
  text += `وضعیت: ${ok ? "موفق ✅" : "ناموفق ❌"}\n`;
  text += `دستور: ${command}\n\n`;

  if (data.result) {
    const stdout = data.result.stdout || "";
    const stderr = data.result.stderr || "";

    if (stdout.trim()) {
      text += "پیام Git:\n";
      text += stdout + "\n";
    }

    if (stderr.trim()) {
      text += "هشدار / خطا:\n";
      text += stderr + "\n";
    }

    if (!stdout.trim() && !stderr.trim()) {
      text += "Git خروجی خاصی برنگرداند. این معمولاً یعنی عملیات بدون پیام خاص انجام شده است.\n";
    }
  } else {
    text += JSON.stringify(data, null, 2);
  }

  el("commandOutput").textContent = text;
}

async function copyRemote() {
  if (!lastRemoteUrl) {
    await loadRemote();
  }

  if (!lastRemoteUrl) {
    alert("لینک GitHub پیدا نشد.");
    return;
  }

  await navigator.clipboard.writeText(lastRemoteUrl);
  alert("لینک کپی شد:\n" + lastRemoteUrl);
}

function clearOutput() {
  el("commandOutput").textContent = "هنوز عملیاتی انجام نشده است.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("load", () => {
  refreshAll();
});