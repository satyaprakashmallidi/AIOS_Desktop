import json
import os
import tempfile
import unittest
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

import workspace  # noqa: E402
from host import HostError, dispatch  # noqa: E402


class HostTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        os.environ["AIOS_WORKSPACE_ROOT"] = self.tempdir.name
        Path(self.tempdir.name, "context").mkdir(parents=True, exist_ok=True)
        Path(self.tempdir.name, "module-installs", "context-os-v1").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_settings_round_trip(self):
        dispatch("set_setting", {"key": "claude_path", "value": "/tmp/claude"})
        result = dispatch("get_setting", {"key": "claude_path"})
        self.assertEqual(result["value"], "/tmp/claude")

    def test_unknown_command_is_blocked(self):
        with self.assertRaises(HostError):
            dispatch("run_bash", {"command": "echo unsafe"})

    def test_complete_onboarding_writes_context(self):
        dispatch("complete_onboarding", {"answers": {"role": "Founder", "offer": "AIOS implementation"}})
        personal = Path(self.tempdir.name, "context", "personal-info.md").read_text()
        business = Path(self.tempdir.name, "context", "business-info.md").read_text()
        self.assertIn("Founder", personal)
        self.assertIn("AIOS implementation", business)

    def test_safe_path_blocks_escape(self):
        with self.assertRaises(ValueError):
            workspace.read_file("../secret.txt")


if __name__ == "__main__":
    unittest.main()
