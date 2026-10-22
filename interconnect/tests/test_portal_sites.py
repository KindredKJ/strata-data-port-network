"""End-to-end signed Portal site rendering in native INTERCONNECT."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "interconnect"))
from port_address import resolve_port_uri, locally_published_site

class PortalWebsiteTests(unittest.TestCase):
    def test_signed_native_port_opens_actual_operator_published_site(self):
        with tempfile.TemporaryDirectory(prefix="sdpn-browser-site-") as directory:
            root = Path(directory)
            storage = root / "portal" / "sites"
            storage.mkdir(parents=True)
            env = {**os.environ, "SDPN_OPERATOR_DIR": directory,
                   "PORTAL_DATA_DIR": str(root / "portal")}
            issued = json.loads(subprocess.check_output(
                ["node", str(ROOT / "scripts" / "port-domain.mjs"), "init", "--dir", directory],
                env=env, text=True))
            (storage / "private-launch.json").write_text(json.dumps({
                "slug": "private-launch", "title": "Real Native Portal",
                "description": "Own signed Port Zero website",
                "body": "An actual saved site, not a generated mock",
                "createdAt": "2026-10-21T00:00:00.000Z"
            }))
            published = json.loads(subprocess.check_output(
                ["node", str(ROOT / "apps" / "portal" / "publish.mjs"),
                 "publish", "private-launch"], env=env, text=True))
            resolution = resolve_port_uri(published["uri"], issued["manifestPath"])
            self.assertTrue(resolution["nameSignatureVerified"])
            with patch.dict(os.environ, env):
                html = locally_published_site(published["uri"])
                self.assertIsInstance(html, str)
                self.assertIn("Real Native Portal", html)
                self.assertIn("An actual saved site", html)
                self.assertNotIn("<script>", html)
                self.assertIsNone(locally_published_site(published["uri"].replace("private-launch.", "missing.")))

if __name__ == "__main__":
    unittest.main()
