"""Chuyển trạng thái và tạo ticket YouTrack (project NS) cho quy trình trong docs/process.md.

Dùng YouTrack CLI (`yt`). Mọi lệnh in mã ticket bị ảnh hưởng.

  python3 scripts/youtrack/ticket.py start NS-23 --branch NS-23-db-schema
  python3 scripts/youtrack/ticket.py to-verify NS-23 --pr <url> --evidence "CI xanh; preview <url>"
  python3 scripts/youtrack/ticket.py state NS-7 "In Progress" --comment "..."
  python3 scripts/youtrack/ticket.py tasks M2            # tạo Task từ "### Task N: ..." trong docs/plans/M2.md
  python3 scripts/youtrack/ticket.py bug --story US-02 --summary "..." --description "..." [--priority Major]
  python3 scripts/youtrack/ticket.py id US-02             # tra mã YouTrack từ mã nội bộ
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

PROJECT = "NS"
ROOT = Path(__file__).resolve().parents[2]
MAP_FILE = Path(__file__).with_name("issue-map.json")
STATES = ("Open", "In Progress", "To Verify", "Done")


def yt(*args: str) -> str:
    result = subprocess.run(["yt", *args], capture_output=True, text=True)
    output = result.stdout + result.stderr
    if result.returncode != 0 or "❌" in output:
        sys.exit(f"yt {' '.join(args[:3])} thất bại:\n{output}")
    return output


def load_map() -> dict[str, str]:
    return json.loads(MAP_FILE.read_text()) if MAP_FILE.exists() else {}


def save_map(issue_map: dict[str, str]) -> None:
    MAP_FILE.write_text(json.dumps(issue_map, indent=2, ensure_ascii=False) + "\n")


def resolve(key: str) -> str:
    if re.fullmatch(rf"{PROJECT}-\d+", key):
        return key
    issue_map = load_map()
    if key not in issue_map:
        sys.exit(f"Không có '{key}' trong {MAP_FILE.name}")
    return issue_map[key]


def set_state(issue: str, state: str, comment: str | None) -> None:
    if state not in STATES:
        sys.exit(f"Trạng thái không hợp lệ: {state}. Hợp lệ: {', '.join(STATES)}")
    yt("issues", "update", issue, "--state", state)
    if comment:
        yt("issues", "comments", "add", issue, comment)
    print(f"{issue} → {state}")


def create_issue(summary: str, issue_type: str, description: str, priority: str | None = None) -> str:
    args = ["issues", "create", PROJECT, summary, "--type", issue_type, "--description", description]
    if priority:
        args += ["--priority", priority]
    output = yt(*args)
    match = re.search(rf"\b({PROJECT}-\d+)\b", output)
    if not match:
        sys.exit(f"Không đọc được mã issue từ:\n{output}")
    return match.group(1)


def cmd_tasks(milestone: str) -> None:
    plan = ROOT / "docs" / "plans" / f"{milestone}.md"
    if not plan.exists():
        sys.exit(f"Không thấy {plan}")
    issue_map = load_map()
    epic = issue_map.get(milestone) or sys.exit(f"Chưa có epic {milestone} trong {MAP_FILE.name}")
    tasks = re.findall(r"^### Task (\d+): (.+)$", plan.read_text(), flags=re.MULTILINE)
    if not tasks:
        sys.exit(f"Không tìm thấy '### Task N: ...' trong {plan}")
    for number, title in tasks:
        key = f"{milestone}-T{number}"
        if key in issue_map:
            print(f"{key:7} = {issue_map[key]} (đã có)")
            continue
        description = f"Plan: `docs/plans/{milestone}.md` — Task {number}."
        issue = create_issue(title.strip(), "Task", description)
        yt("issues", "links", "create", issue, epic, "subtask of")
        issue_map[key] = issue
        save_map(issue_map)
        print(f"{key:7} → {issue}  {title.strip()}")


def cmd_bug(story: str, summary: str, description: str, priority: str) -> None:
    story_issue = resolve(story)
    issue = create_issue(f"[{story}] {summary}", "Bug", description, priority)
    yt("issues", "links", "create", issue, story_issue, "relates to")
    print(f"Bug {issue} (liên quan {story} = {story_issue})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("start"); p.add_argument("issue"); p.add_argument("--branch", required=True)
    p = sub.add_parser("to-verify"); p.add_argument("issue"); p.add_argument("--pr", required=True); p.add_argument("--evidence", required=True)
    p = sub.add_parser("state"); p.add_argument("issue"); p.add_argument("state"); p.add_argument("--comment")
    p = sub.add_parser("tasks"); p.add_argument("milestone")
    p = sub.add_parser("bug"); p.add_argument("--story", required=True); p.add_argument("--summary", required=True)
    p.add_argument("--description", required=True); p.add_argument("--priority", default="Normal")
    p = sub.add_parser("id"); p.add_argument("key")

    args = parser.parse_args()
    if args.cmd == "start":
        set_state(resolve(args.issue), "In Progress", f"Bắt đầu trên nhánh `{args.branch}`.")
    elif args.cmd == "to-verify":
        set_state(resolve(args.issue), "To Verify", f"Đã merge: {args.pr}\n\n{args.evidence}")
    elif args.cmd == "state":
        set_state(resolve(args.issue), args.state, args.comment)
    elif args.cmd == "tasks":
        cmd_tasks(args.milestone)
    elif args.cmd == "bug":
        cmd_bug(args.story, args.summary, args.description, args.priority)
    elif args.cmd == "id":
        print(resolve(args.key))


if __name__ == "__main__":
    main()
