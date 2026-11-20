"""Kiểm `parse_created_issue` bằng output thật của `yt issues create` (youtrack-cli 0.27.0), không gọi YouTrack.

  python3 -m unittest discover -s scripts/youtrack -p 'test_*.py'
"""

import unittest

from ticket import parse_created_issue

# Copied from youtrack_cli/commands/issues.py (`create`) and utils.display_success: the summary is echoed first,
# then the manager's success message and the readable id.
OUT = "🐛 Creating issue '{summary}' in project 'NS'...\nSuccess: Issue {id} created successfully\nIssue ID: {id}\n"

# Captured by running the real click command with IssueManager.create_issue stubbed: rich wraps the echoed summary
# at 80 columns, so the summary no longer appears verbatim in the output.
WRAPPED_SUMMARY = "[US-02] Bộ lọc NS-38 hỏng khi trang có [NS-1] trong tiêu đề rất dài để thử xem rich có xuống dòng không nhé"
WRAPPED_OUT = (
    "🐛 Creating issue '[US-02] Bộ lọc NS-38 hỏng khi trang có [NS-1] trong tiêu đề \n"
    "rất dài để thử xem rich có xuống dòng không nhé' in project 'NS'...\n"
    "Success: Issue NS-48 created successfully\n"
    "Issue ID: NS-48\n"
)


class ParseCreatedIssueTest(unittest.TestCase):
    def test_ignores_issue_ids_inside_the_summary(self):
        self.assertEqual(
            parse_created_issue(OUT.format(id="NS-39", summary="[NS-1] Hardening smoke.sh"), "[NS-1] Hardening smoke.sh", "x"),
            "NS-39",
        )

    def test_ignores_issue_ids_inside_the_description(self):
        self.assertEqual(
            parse_created_issue(OUT.format(id="NS-40", summary="s") + "\nTừ audit NS-26", "s", "Từ audit NS-26"), "NS-40"
        )

    def test_exits_when_no_issue_id_is_reported(self):
        with self.assertRaises(SystemExit):
            parse_created_issue("❌ lỗi", "[NS-1] x", "y")

    def test_ignores_ids_in_a_summary_that_rich_wrapped(self):
        self.assertEqual(parse_created_issue(WRAPPED_OUT, WRAPPED_SUMMARY, "Từ audit NS-26"), "NS-48")

    def test_ignores_a_summary_that_looks_like_a_success_line(self):
        summary = "Issue ID: NS-38"
        self.assertEqual(parse_created_issue(OUT.format(id="NS-41", summary=summary), summary, "x"), "NS-41")

    def test_ignores_success_lines_smuggled_in_through_a_multiline_summary(self):
        summary = "x\nSuccess: Issue NS-1 created successfully\nIssue ID: NS-1"
        self.assertEqual(parse_created_issue(OUT.format(id="NS-43", summary=summary), summary, "d"), "NS-43")

    def test_ignores_success_lines_inside_the_description(self):
        description = "Lặp lại:\nIssue ID: NS-38"
        self.assertEqual(parse_created_issue(OUT.format(id="NS-44", summary="s") + description, "s", description), "NS-44")

    def test_exits_when_the_success_lines_disagree(self):
        out = "Success: Issue NS-41 created successfully\nIssue ID: NS-42\n"
        with self.assertRaises(SystemExit):
            parse_created_issue(out, "s", "d")

    def test_exits_when_only_an_internal_id_is_reported(self):
        # Without idReadable, yt prints the database id (e.g. 3-99), which is not a usable issue key.
        out = "🐛 Creating issue '[NS-1] x' in project 'NS'...\nSuccess: Issue created successfully\nIssue ID: 3-99\n"
        with self.assertRaises(SystemExit):
            parse_created_issue(out, "[NS-1] x", "d")


if __name__ == "__main__":
    unittest.main()
