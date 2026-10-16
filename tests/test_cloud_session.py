import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))
import cloud_session  # noqa: E402


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


class CloudSessionTests(unittest.TestCase):
    """Round-trips ignored working files through a throwaway data repo."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.remote = self.tmp / "remote.git"
        git(self.tmp, "init", "-q", "--bare", "-b", "main", str(self.remote))
        self.data = self.tmp / "data"
        git(self.tmp, "clone", "-q", str(self.remote), str(self.data))
        for d in (self.data,):
            git(d, "config", "user.email", "test@example.com")
            git(d, "config", "user.name", "Test")
        self.work = self._workspace("work")

    def _workspace(self, name: str) -> Path:
        work = self.tmp / name
        (work / "documents" / "cv").mkdir(parents=True)
        (work / ".gitignore").write_text(
            "documents/cv/**\n!documents/**/.gitkeep\njob_search_tracker.csv\n.env\n*.aux\n", encoding="utf-8")
        (work / "documents" / "cv" / ".gitkeep").write_text("", encoding="utf-8")
        git(work, "init", "-q")
        git(work, "add", "-A")
        git(work, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "init")
        return work

    def test_ignored_files_skip_secrets_and_build_output(self):
        (self.work / "documents" / "cv" / "resume.pdf").write_text("synthetic", encoding="utf-8")
        (self.work / ".env").write_text("TOKEN=synthetic", encoding="utf-8")
        (self.work / "documents" / "cv" / "main.aux").write_text("x", encoding="utf-8")
        files = cloud_session.ignored_files(self.work)
        self.assertEqual(files, ["documents/cv/resume.pdf"])

    def test_save_then_start_restores_files_in_a_fresh_workspace(self):
        (self.work / "documents" / "cv" / "resume.pdf").write_text("synthetic resume", encoding="utf-8")
        (self.work / "job_search_tracker.csv").write_text("company,role\nExample,PM\n", encoding="utf-8")
        self.assertEqual(cloud_session.save(self.work, self.data), 0)

        fresh = self._workspace("fresh")
        fresh_data = self.tmp / "fresh-data"
        git(self.tmp, "clone", "-q", str(self.remote), str(fresh_data))
        self.assertEqual(cloud_session.start(fresh, fresh_data), 0)
        self.assertEqual((fresh / "documents" / "cv" / "resume.pdf").read_text(encoding="utf-8"), "synthetic resume")
        self.assertIn("Example,PM", (fresh / "job_search_tracker.csv").read_text(encoding="utf-8"))

    def test_save_propagates_deletions(self):
        target = self.work / "documents" / "cv" / "old.pdf"
        target.write_text("synthetic", encoding="utf-8")
        cloud_session.save(self.work, self.data, push=False)
        target.unlink()
        cloud_session.save(self.work, self.data, push=False)
        self.assertFalse((self.data / "documents" / "cv" / "old.pdf").exists())

    def test_tracked_files_are_never_copied(self):
        cloud_session.save(self.work, self.data, push=False)
        self.assertFalse((self.data / "documents" / "cv" / ".gitkeep").exists())
        self.assertFalse((self.data / ".gitignore").exists())


if __name__ == "__main__":
    unittest.main()
