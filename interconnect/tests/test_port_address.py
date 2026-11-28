"""Executed local INTERCONNECT port:// navigation and signature integration tests."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "interconnect"))
from port_address import resolve_port_uri, offline_port_page

class PortAddressTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node runtime required for signed Port Zero integration")
    def test_signed_port_identity_is_visible_but_never_network_authorized(self):
        with tempfile.TemporaryDirectory(prefix="sdpn-interconnect-") as directory:
            raw = subprocess.check_output(["node", str(ROOT / "scripts/port-domain.mjs"),
                                           "init", "--dir", directory], text=True)
            record = json.loads(raw)
            url = next(item["uri"] for item in record["addresses"] if item["name"] == "portal")
            result = resolve_port_uri(url, record["manifestPath"])
            self.assertEqual(result["targetPort"], record["ownerPort"])
            self.assertTrue(result["nameSignatureVerified"])
            self.assertFalse(result["networkConnected"])
            self.assertFalse(result["authorizationGranted"])
            self.assertIn("PORT · SDPN", offline_port_page(result))
            with self.assertRaises(ValueError):
                resolve_port_uri("port://localhost/private", record["manifestPath"])
            with self.assertRaises(ValueError):
                resolve_port_uri(url + "?token=secret", record["manifestPath"])

    def test_port_metadata_escapes_html(self):
        page = offline_port_page({
            "address": '<script>alert("x")</script>',
            "ownerPort": "<img src=x>", "targetPort": "strata:port:<unsafe>"
        })
        self.assertNotIn("<script>alert", page)
        self.assertNotIn("<img src", page)
        self.assertIn("&lt;script&gt;", page)

if __name__ == "__main__":
    unittest.main()
