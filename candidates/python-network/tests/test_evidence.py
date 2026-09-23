import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "evidence" / "verification" / "world_tools.py"


class EvidenceToolTests(unittest.TestCase):
    def run_tool(self, *args):
        return subprocess.run(["python3", str(TOOL), *args], cwd=ROOT, text=True, capture_output=True)

    def test_update_lock_pins_exact_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "lock.json"
            result = self.run_tool("update-lock", "--output", str(output))
            self.assertEqual(result.returncode, 0, result.stderr)
            record = json.loads(output.read_text())["repositories"][0]
            self.assertRegex(record["commit"], r"^[0-9a-f]{40}$")
            self.assertNotEqual(record["branch"], "")

    def test_bundle_verification_detects_tampering(self):
        result = self.run_tool("validate", "--no-tests")
        self.assertEqual(result.returncode, 0, result.stderr)
        run = Path(result.stdout.strip().splitlines()[-1])
        verified = self.run_tool("verify", str(run))
        self.assertEqual(verified.returncode, 0, verified.stderr)
        summary = run / "summary.md"
        summary.write_text(summary.read_text() + "tampered\n")
        rejected = self.run_tool("verify", str(run))
        self.assertNotEqual(rejected.returncode, 0)

    def test_schema_is_versioned_json_schema_2020_12(self):
        schema = json.loads((ROOT / "evidence/schemas/evidence-manifest.schema.json").read_text())
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(schema["properties"]["schema_version"]["const"], "1.0.0")


if __name__ == "__main__":
    unittest.main()
