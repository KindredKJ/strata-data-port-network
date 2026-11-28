#!/usr/bin/env python3
"""Build a standards-compliant pure-Python wheel using only Python stdlib."""
from __future__ import annotations
import base64
import hashlib
import csv
import io
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = "0.1.0"
DIST = f"kindred_sdpn-{VERSION}.dist-info"
WHEEL = ROOT / "dist" / f"kindred_sdpn-{VERSION}-py3-none-any.whl"
FILES = {
    "kindred_sdpn/__init__.py": (ROOT / "kindred_sdpn/__init__.py").read_bytes(),
    f"{DIST}/METADATA": (
        "Metadata-Version: 2.3\nName: kindred-sdpn\nVersion: 0.1.0\n"
        "Summary: First-party offline SDPN terminal SDK and SW06-F verifier\n"
        "Requires-Python: >=3.12\n\n"
    ).encode(),
    f"{DIST}/WHEEL": (
        "Wheel-Version: 1.0\nGenerator: kindred-sdpn stdlib builder\n"
        "Root-Is-Purelib: true\nTag: py3-none-any\n"
    ).encode(),
}


def build() -> Path:
    WHEEL.parent.mkdir(exist_ok=True)
    entries = []
    with zipfile.ZipFile(WHEEL, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(FILES.items()):
            z.writestr(name, data)
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            entries.append((name, f"sha256={digest}", str(len(data))))
        record = f"{DIST}/RECORD"
        entries.append((record, "", ""))
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerows(entries)
        z.writestr(record, output.getvalue().encode())
    return WHEEL


if __name__ == "__main__":
    print(build())
