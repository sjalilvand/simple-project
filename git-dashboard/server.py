from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import subprocess
import json
import re
from datetime import datetime, timezone

BASE_DIR = Path(__file__).parent.resolve()
REPO_DIR = BASE_DIR.parent.resolve()
HOST = "127.0.0.1"
PORT = 8765


def now_utc():
    return datetime.now(timezone.utc).isoformat()


def safe_branch_name(name: str) -> bool:
    """
    اجازه نام branch ساده و امن:
    feature/login
    bugfix/app-error
    test_branch
    """
    if not name:
        return False
    if name.startswith("-"):
        return False
    if ".." in name:
        return False
    if " " in name:
        return False
    return bool(re.match(r"^[A-Za-z0-9._/\-]+$", name))


def safe_commit_hash(value: str) -> bool:
    """
    commit hash کوتاه یا کامل
    مثل:
    e027f90
    8c51afd123...
    """
    if not value:
        return False
    return bool(re.match(r"^[a-fA-F0-9]{7,40}$", value))


def safe_relative_file_path(value: str) -> bool:
    """
    جلوگیری از مسیرهای خطرناک مثل:
    ../../something
    C:\...
    /etc/passwd
    """
    if not value:
        return False

    p = Path(value)

    if p.is_absolute():
        return False

    parts = p.parts

    if ".." in parts:
        return False

    if value.startswith("/") or value.startswith("\\"):
        return False

    return True


def run_git(args, timeout=90):
    """
    اجرای امن Git:
    - shell=True استفاده نمی‌کنیم
    - فقط commandهای whitelist شده از endpointها اجرا می‌شوند
    """
    command = ["git"] + args

    try:
        result = subprocess.run(
            command,
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout
        )

        return {
            "ok": result.returncode == 0,
            "returncode": result.returncode,
            "command": "git " + " ".join(args),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "timestamp": now_utc()
        }

    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "returncode": -1,
            "command": "git " + " ".join(args),
            "stdout": "",
            "stderr": "Command timed out.",
            "timestamp": now_utc()
        }

    except Exception as exc:
        return {
            "ok": False,
            "returncode": -1,
            "command": "git " + " ".join(args),
            "stdout": "",
            "stderr": str(exc),
            "timestamp": now_utc()
        }


def parse_log(raw):
    commits = []

    if not raw.strip():
        return commits

    for line in raw.splitlines():
        parts = line.split("\x1f")

        if len(parts) >= 5:
            commits.append({
                "short_hash": parts[0],
                "full_hash": parts[1],
                "author": parts[2],
                "date": parts[3],
                "message": parts[4],
            })

    return commits


def json_response(handler, data, status=200):
    payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")

    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", 0))

    if length <= 0:
        return {}

    raw = handler.rfile.read(length).decode("utf-8")

    try:
        return json.loads(raw)
    except Exception:
        return {}


class GitDashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, format, *args):
        # لاگ‌های پیش‌فرض HTTP را کمتر شلوغ می‌کنیم
        print("[HTTP]", format % args)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
            return

        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.handle_api_post()
            return

        json_response(self, {"ok": False, "error": "Not found"}, 404)

    def handle_api_get(self):
        path = self.path.split("?")[0]

        if path == "/api/health":
            json_response(self, {
                "ok": True,
                "message": "Git Dashboard is running.",
                "repo_dir": str(REPO_DIR),
                "timestamp": now_utc()
            })
            return

        if path == "/api/status":
            status_result = run_git(["status", "--short", "--branch"])
            branch_result = run_git(["branch", "--show-current"])
            diff_stat_result = run_git(["diff", "--stat"])
            staged_diff_stat_result = run_git(["diff", "--staged", "--stat"])

            json_response(self, {
                "ok": status_result["ok"],
                "repo_dir": str(REPO_DIR),
                "status": status_result,
                "current_branch": branch_result["stdout"].strip(),
                "diff_stat": diff_stat_result,
                "staged_diff_stat": staged_diff_stat_result,
            })
            return

        if path == "/api/log":
            raw_result = run_git([
                "log",
                "--pretty=format:%h%x1f%H%x1f%an%x1f%ad%x1f%s",
                "--date=iso",
                "-n",
                "30"
            ])

            json_response(self, {
                "ok": raw_result["ok"],
                "raw": raw_result,
                "commits": parse_log(raw_result["stdout"])
            })
            return

        if path == "/api/branches":
            branches_result = run_git(["branch", "--all", "--verbose", "--no-abbrev"])
            current_result = run_git(["branch", "--show-current"])

            json_response(self, {
                "ok": branches_result["ok"],
                "current_branch": current_result["stdout"].strip(),
                "branches": branches_result
            })
            return

        if path == "/api/remotes":
            remote_result = run_git(["remote", "-v"])

            json_response(self, {
                "ok": remote_result["ok"],
                "remotes": remote_result
            })
            return

        if path == "/api/diff":
            diff_result = run_git(["diff"])
            staged_diff_result = run_git(["diff", "--staged"])

            json_response(self, {
                "ok": diff_result["ok"] and staged_diff_result["ok"],
                "diff": diff_result,
                "staged_diff": staged_diff_result
            })
            return

        json_response(self, {"ok": False, "error": "Unknown GET endpoint"}, 404)

    def handle_api_post(self):
        path = self.path.split("?")[0]
        body = read_json_body(self)

        if path == "/api/add-all":
            result = run_git(["add", "."])

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/commit":
            message = str(body.get("message", "")).strip()

            if not message:
                json_response(self, {
                    "ok": False,
                    "error": "Commit message is required."
                }, 400)
                return

            result = run_git(["commit", "-m", message])

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/push":
            result = run_git(["push"], timeout=180)

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/pull":
            # برای شروع، pull ساده.
            # در پروژه‌های تیمی حرفه‌ای می‌توان pull --rebase یا pull --ff-only استفاده کرد.
            result = run_git(["pull"], timeout=180)

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/create-branch":
            name = str(body.get("name", "")).strip()

            if not safe_branch_name(name):
                json_response(self, {
                    "ok": False,
                    "error": "Invalid branch name."
                }, 400)
                return

            result = run_git(["switch", "-c", name])

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/switch-branch":
            name = str(body.get("name", "")).strip()

            if not safe_branch_name(name):
                json_response(self, {
                    "ok": False,
                    "error": "Invalid branch name."
                }, 400)
                return

            result = run_git(["switch", name])

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/restore-file":
            file_path = str(body.get("file", "")).strip()

            if not safe_relative_file_path(file_path):
                json_response(self, {
                    "ok": False,
                    "error": "Invalid file path."
                }, 400)
                return

            result = run_git(["restore", "--", file_path])

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        if path == "/api/revert":
            commit_hash = str(body.get("hash", "")).strip()

            if not safe_commit_hash(commit_hash):
                json_response(self, {
                    "ok": False,
                    "error": "Invalid commit hash."
                }, 400)
                return

            # revert امن‌تر از reset است چون یک commit جدید معکوس می‌سازد.
            result = run_git(["revert", "--no-edit", commit_hash])

            json_response(self, {
                "ok": result["ok"],
                "result": result
            })
            return

        json_response(self, {"ok": False, "error": "Unknown POST endpoint"}, 404)


def main():
    print("=" * 70)
    print("Git Dashboard")
    print("=" * 70)
    print(f"Repository directory: {REPO_DIR}")
    print(f"Dashboard URL: http://{HOST}:{PORT}")
    print("")
    print("Security note:")
    print("This server is bound to 127.0.0.1 only. Do not expose it to the internet.")
    print("=" * 70)

    server = ThreadingHTTPServer((HOST, PORT), GitDashboardHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()