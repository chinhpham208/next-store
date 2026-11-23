"""Chuyển trạng thái và tạo ticket YouTrack (project NS) cho quy trình trong docs/process.md.

Dùng YouTrack CLI (`yt`). Mọi lệnh in mã ticket bị ảnh hưởng.

  python3 scripts/youtrack/ticket.py start NS-23 --branch NS-23-db-schema
  python3 scripts/youtrack/ticket.py to-verify NS-23 --pr <url> --evidence "CI xanh; preview <url>"
  python3 scripts/youtrack/ticket.py state NS-7 "In Progress" --comment "..."
  python3 scripts/youtrack/ticket.py tasks M2            # tạo Task từ "### Task N: ..." trong docs/plans/M2.md
  python3 scripts/youtrack/ticket.py bug --story US-02 --summary "..." --description "..." [--priority Major]
  python3 scripts/youtrack/ticket.py bug --story M3-TECH --summary "..." --description "..."   # ticket kỹ thuật

Board Development xếp thẻ theo User Story: Task và Bug phải là **subtask** của một story, không chỉ "relates to",
nếu không sẽ rơi vào "Uncategorized Cards". Phân cấp: Epic (M<n>) → User Story (US-xx, hoặc story kỹ thuật
M<n>-TECH "M<n> — Kỹ thuật & hạ tầng") → Task / Bug.
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


# Exact lines `yt issues create` (youtrack-cli 0.27.0) prints on success; see test_ticket.py for a full sample.
SUCCESS_LINE = re.compile(rf"(?:Success: Issue ({PROJECT}-\d+) created successfully|Issue ID: ({PROJECT}-\d+))")


def parse_created_issue(output: str, summary: str, description: str) -> str:
    """Mã issue vừa tạo, chỉ đọc từ dòng thông báo thành công của `yt`.

    `yt` in lại summary (bug có dạng `[NS-1] …`) nên mã đầu tiên trong output không phải mã mới. Chỉ tin một dòng
    khớp trọn mẫu thông báo và không đến từ summary / description (cả khi chúng chứa xuống dòng). Không xoá chuỗi
    summary khỏi output: summary ngắn như `s` sẽ xoá luôn chữ trong `Success`, còn rich lại ngắt dòng summary dài
    nên xoá cũng không chắc hết. Không thấy, hoặc các dòng thông báo không cùng một mã → dừng, không đoán.
    """
    ids = set()
    for line in output.splitlines():
        line = line.strip()
        match = SUCCESS_LINE.fullmatch(line)
        if not match or line in summary or line in description:
            continue
        ids.add(match.group(1) or match.group(2))
    if len(ids) != 1:
        sys.exit(f"Không đọc được mã issue vừa tạo (thấy {sorted(ids) or 'không có'}) từ:\n{output}")
    return ids.pop()


def create_issue(summary: str, issue_type: str, description: str, priority: str | None = None) -> str:
    args = ["issues", "create", PROJECT, summary, "--type", issue_type, "--description", description]
    if priority:
        args += ["--priority", priority]
    return parse_created_issue(yt(*args), summary, description)


STORY_IN_TITLE = re.compile(r"\b(US-\d{2})\b")


def task_parent(milestone: str, title: str, issue_map: dict[str, str]) -> str:
    """Story cha của một Task: US đầu tiên nhắc trong tiêu đề, không có thì story kỹ thuật M<n>-TECH."""
    match = STORY_IN_TITLE.search(title)
    key = match.group(1) if match else f"{milestone}-TECH"
    if key not in issue_map:
        sys.exit(f"Chưa có '{key}' trong {MAP_FILE.name}: tạo story đó (User Story, subtask của {milestone}) trước")
    return issue_map[key]


def cmd_tasks(milestone: str) -> None:
    plan = ROOT / "docs" / "plans" / f"{milestone}.md"
    if not plan.exists():
        sys.exit(f"Không thấy {plan}")
    issue_map = load_map()
    issue_map.get(milestone) or sys.exit(f"Chưa có epic {milestone} trong {MAP_FILE.name}")
    tasks = re.findall(r"^### Task (\d+): (.+)$", plan.read_text(), flags=re.MULTILINE)
    if not tasks:
        sys.exit(f"Không tìm thấy '### Task N: ...' trong {plan}")
    for number, title in tasks:
        key = f"{milestone}-T{number}"
        if key in issue_map:
            print(f"{key:7} = {issue_map[key]} (đã có)")
            continue
        description = f"Plan: `docs/plans/{milestone}.md` — Task {number}."
        parent = task_parent(milestone, title, issue_map)
        issue = create_issue(title.strip(), "Task", description)
        yt("issues", "links", "create", issue, parent, "subtask of")
        issue_map[key] = issue
        save_map(issue_map)
        print(f"{key:7} → {issue}  {title.strip()}")


def cmd_bug(story: str, summary: str, description: str, priority: str) -> None:
    story_issue = resolve(story)
    issue = create_issue(f"[{story}] {summary}", "Bug", description, priority)
    yt("issues", "links", "create", issue, story_issue, "subtask of")
    print(f"Bug {issue} (subtask của {story} = {story_issue})")


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
