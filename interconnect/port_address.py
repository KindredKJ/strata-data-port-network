"""Offline verified SDPN port:// address presentation for INTERCONNECT.
A signed name does not activate transport, data access, or private Port Zero authority.
"""
from __future__ import annotations
import html
import json
from pathlib import Path
import subprocess
import sys

RESOLVER = Path(__file__).resolve().parents[1] / "scripts" / "port-resolve.mjs"

def resolve_port_uri(uri: str, manifest_path: str) -> dict:
    if not isinstance(uri, str) or len(uri) > 1024 or not uri.startswith("port://"):
        raise ValueError("Noncanonical SDPN port URI")
    if not isinstance(manifest_path, str) or not manifest_path:
        raise ValueError("Signed local port namespace manifest required")
    try:
        result = subprocess.run(["node", str(RESOLVER), uri, "--manifest", manifest_path],
                                capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("Native port resolver unavailable") from error
    if result.returncode != 0 or len(result.stdout) > 16384:
        raise ValueError("Port name signature, namespace, or expiry denied")
    try:
        data = json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid native port resolution") from error
    if (data.get("schema") != "kindred.sdpn.port-resolution.v1" or
            data.get("nameSignatureVerified") is not True or
            any(data.get(field) is not False for field in
                ("networkConnected", "authorizationGranted", "physicalZeroCopyVerified", "dnsRegistration"))):
        raise ValueError("Unsigned or overstated port resolution rejected")
    return data

def offline_port_page(record: dict) -> str:
    address = html.escape(record["address"], quote=True)
    owner = html.escape(record["ownerPort"], quote=True)
    target = html.escape(record["targetPort"], quote=True)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'">
    <title>INTERCONNECT · PORT mode</title>
    <style>body{{background:#09151f;color:#ecfaff;font:18px system-ui,sans-serif;padding:6vw;overflow-wrap:anywhere}}
    h1{{font-size:44px;color:#72f2c6}}code{{color:#bef5df}}p{{max-width:80ch;line-height:1.7}}</style></head>
    <body><h1>PORT · SDPN</h1><p><strong>Signed namespace verified</strong></p>
    <p>Address: <code>{address}</code></p><p>Signing Port Zero: <code>{owner}</code></p>
    <p>Resolved target port: <code>{target}</code></p>
    <p><strong>Connection not active.</strong> No peer session, data access, global reachability,
    physical zero-copy, DNS registration or production authorization is implied.
    Owner policy, peer consent, and an independently approved adapter are still required.</p>
    </body></html>"""
