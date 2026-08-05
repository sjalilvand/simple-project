let lastRemoteUrl = "";
let lastRepoInfo = "";

async function apiGet(path) {
  const response = await fetch(path);
  return await response.json();
}

async function apiPost(path, data = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return await response.json();
}

function el(id) {
  return document.getElementById(id);
}

function asText(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function renderCommandResult(title, data) {
  const ok = data.ok ? "SUCCESS ✅" : "FAILED ❌";

  let output = "";
  output += `${title}\n`;
  output += `${ok}\n`;
  output += "----------------------------------------\n";

  if (data.result) {
    output += `Command: ${data.result.command || ""}\n`;
    output += `Return Code: ${data.result.returncode}\n`;
    output += `Time: ${data.result.timestamp || ""}\n`;
    output += "\n--- STDOUT ---\n";
    output += data.result.stdout || "";
    output += "\n--- STDERR ---\n";
    output += data.result.stderr || "";
  } else {
    output += asText(data);
  }

  el("commandOutput").textContent = output;
}

function clearCommandOutput() {
  el("commandOutput").textContent = "هنوز فرمانی اجرا نشده است.";
}

async function refreshAll() {
  await loadStatus();
  await loadLog();
  await loadBranches();
  await loadRemotes();
}

async function loadStatus() {
  try {
    const data = await apiGet("/api/status");

    el("currentBranch").textContent = data.current_branch || "---";

    const status = data.status?.stdout || "";
    const diffStat = data.diff_stat?.stdout || "";
    const stagedDiffStat = data.staged_diff_stat?.stdout || "";

    let text = "";
    text += "Repository:\n";
    text += data.repo_dir + "\n\n";

    text += "Git Status:\n";
    text += status || "No changes.\n";

    text += "\nUnstaged Diff Stat:\n";
    text += diffStat || "No unstaged diff.\n";

    text += "\nStaged Diff Stat:\n";
    text += stagedDiffStat || "No staged diff.\n";

    el("statusOutput").textContent = text;

    lastRepoInfo = text;

  } catch (err) {
    el("statusOutput").textContent = String(err);
  }
}

async function loadLog() {
  try {
    const data = await apiGet("/api/log");
    const tbody = el("logTable");

    tbody.innerHTML = "";

    if (!data.commits || data.commits.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">Commit وجود ندارد.</td></tr>`;
      return;
    }

    data.commits.forEach(commit => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td class="hash" title="${commit.full_hash}">${commit.short_hash}</td>
        <td>${escapeHtml(commit.message)}</td>
        <td>${escapeHtml(commit.author)}</td>
        <td>${escapeHtml(commit.date)}</td>
      `;

      tbody.appendChild(tr);
    });

  } catch (err) {
    el("logTable").innerHTML = `<tr><td colspan="4">${escapeHtml(String(err))}</td></tr>`;
  }
}

async function loadBranches() {
  try {
    const data = await apiGet("/api/branches");

    let text = "";
    text += `Current Branch: ${data.current_branch || "---"}\n\n`;
    text += data.branches?.stdout || "";
    text += data.branches?.stderr || "";

    el("branchesOutput").textContent = text;

  } catch (err) {
    el("branchesOutput").textContent = String(err);
  }
}

async function loadRemotes() {
  try {
    const data = await apiGet("/api/remotes");

    const text = data.remotes?.stdout || "No remote configured.";
    el("remoteOutput").textContent = text;

    lastRemoteUrl = extractFirstRemoteUrl(text);

  } catch (err) {
    el("remoteOutput").textContent = String(err);
  }
}

async function loadDiff() {
  try {
    const data = await apiGet("/api/diff");

    el("diffOutput").textContent =
      data.diff?.stdout ||
      data.diff?.stderr ||
      "No unstaged diff.";

    el("stagedDiffOutput").textContent =
      data.staged_diff?.stdout ||
      data.staged_diff?.stderr ||
      "No staged diff.";

  } catch (err) {
    el("diffOutput").textContent = String(err);
  }
}

async function addAll() {
  if (!confirm("آیا مطمئنی می‌خواهی همه تغییرات stage شوند؟\nمعادل: git add .")) {
    return;
  }

  const data = await apiPost("/api/add-all");
  renderCommandResult("git add .", data);

  await refreshAll();
  await loadDiff();
}

async function commitChanges() {
  const message = el("commitMessage").value.trim();

  if (!message) {
    alert("پیام commit را وارد کن.");
    return;
  }

  if (!confirm(`آیا commit انجام شود؟\n\nپیام:\n${message}`)) {
    return;
  }

  const data = await apiPost("/api/commit", { message });
  renderCommandResult("git commit", data);

  await refreshAll();
  await loadDiff();
}

async function push() {
  if (!confirm("آیا می‌خواهی تغییرات را به GitHub push کنی؟")) {
    return;
  }

  const data = await apiPost("/api/push");
  renderCommandResult("git push", data);

  await refreshAll();
}

async function pull() {
  if (!confirm("آیا می‌خواهی آخرین تغییرات را از remote دریافت کنی؟\nمعادل: git pull")) {
    return;
  }

  const data = await apiPost("/api/pull");
  renderCommandResult("git pull", data);

  await refreshAll();
  await loadDiff();
}

async function createBranch() {
  const name = el("newBranchName").value.trim();

  if (!name) {
    alert("نام branch جدید را وارد کن.");
    return;
  }

  if (!confirm(`ساخت branch جدید و رفتن روی آن؟\n\n${name}`)) {
    return;
  }

  const data = await apiPost("/api/create-branch", { name });
  renderCommandResult("git switch -c", data);

  await refreshAll();
}

async function switchBranch() {
  const name = el("switchBranchName").value.trim();

  if (!name) {
    alert("نام branch را وارد کن.");
    return;
  }

  if (!confirm(`آیا می‌خواهی به این branch بروی؟\n\n${name}`)) {
    return;
  }

  const data = await apiPost("/api/switch-branch", { name });
  renderCommandResult("git switch", data);

  await refreshAll();
  await loadDiff();
}

async function restoreFile() {
  const file = el("restoreFilePath").value.trim();

  if (!file) {
    alert("مسیر فایل را وارد کن. مثلا app.py");
    return;
  }

  const message =
    `هشدار!\n\n` +
    `این کار تغییرات ذخیره‌نشده فایل زیر را به آخرین commit برمی‌گرداند:\n\n` +
    `${file}\n\n` +
    `معادل:\n` +
    `git restore -- ${file}\n\n` +
    `آیا مطمئنی؟`;

  if (!confirm(message)) {
    return;
  }

  const data = await apiPost("/api/restore-file", { file });
  renderCommandResult("git restore file", data);

  await refreshAll();
  await loadDiff();
}

async function revertCommit() {
  const hash = el("revertHash").value.trim();

  if (!hash) {
    alert("commit hash را وارد کن. مثلا e027f90");
    return;
  }

  const message =
    `هشدار!\n\n` +
    `این کار commit زیر را revert می‌کند و یک commit جدید معکوس می‌سازد:\n\n` +
    `${hash}\n\n` +
    `معادل:\n` +
    `git revert --no-edit ${hash}\n\n` +
    `آیا مطمئنی؟`;

  if (!confirm(message)) {
    return;
  }

  const data = await apiPost("/api/revert", { hash });
  renderCommandResult("git revert", data);

  await refreshAll();
  await loadDiff();
}

function extractFirstRemoteUrl(text) {
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

async function copyRemoteUrl() {
  if (!lastRemoteUrl) {
    await loadRemotes();
  }

  if (!lastRemoteUrl) {
    alert("Remote URL پیدا نشد.");
    return;
  }

  await navigator.clipboard.writeText(lastRemoteUrl);
  alert("لینک remote کپی شد:\n" + lastRemoteUrl);
}

async function copyRepoInfo() {
  await loadStatus();

  const text =
    "Git Dashboard Repo Info\n" +
    "-----------------------\n" +
    lastRepoInfo;

  await navigator.clipboard.writeText(text);
  alert("اطلاعات پروژه کپی شد.");
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