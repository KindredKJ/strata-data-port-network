"""Kindred Labs SDPN native terminal Python SDK.

Zero third-party dependencies. Local-only cognition and authenticated SW06-F
receipt verification. No hosted inference provider or network service required.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

__version__ = "0.1.0"
SCHEMA = "kindred.sdpn.two-host-proof.v2"


class SDPNVerificationError(ValueError):
    """Raised for invalid or untrusted SW06-F proof records."""


def _receipt_transcript(r: dict) -> str:
    fields = (
        "schemaVersion", "sessionId", "stateId", "stateHash", "generation",
        "payloadSha256", "receivedSha256", "payloadBytes", "ciphertextBytes",
        "sourceHostFingerprint", "destinationHostFingerprint", "distinctHostFingerprints",
        "loopbackObserved", "authenticationVerified", "integrityVerified",
        "encryptedOnWire", "cipher", "transportClass", "twoHostNetworkProofSatisfied",
        "physicalMachineAttestationProven", "productionReadyClaim", "observedAt",
    )
    return "|".join(str(r[key]).lower() if isinstance(r[key], bool) else str(r[key]) for key in fields)


def verify_receipt(receipt: dict | str | Path, secret: str) -> dict:
    """Verify SW06-F v2 receipt HMAC/integrity claims; returns parsed receipt.

    The pairing secret must be the original session's ephemeral secret, and is
    never returned or logged. This does NOT attest physical host separation.
    """
    if not isinstance(secret, str) or len(secret) < 32:
        raise SDPNVerificationError("session secret must be at least 32 characters")
    if isinstance(receipt, Path):
        r = json.loads(receipt.read_text(encoding="utf-8"))
    elif isinstance(receipt, str):
        r = json.loads(receipt)
    else:
        r = dict(receipt)
    if r.get("schemaVersion") != SCHEMA or r.get("cipher") != "AES-256-GCM":
        raise SDPNVerificationError("incorrect proof schema/cipher")
    if r.get("transportClass") != "HTTP_TCP_AES_256_GCM_BUFFERED":
        raise SDPNVerificationError("unknown transport class")
    for name in ("authenticationVerified", "integrityVerified", "encryptedOnWire"):
        if r.get(name) is not True:
            raise SDPNVerificationError(f"missing verification: {name}")
    if r.get("physicalMachineAttestationProven") is not False or r.get("productionReadyClaim") is not False:
        raise SDPNVerificationError("unsupported production/hardware claim")
    for name in ("stateHash", "payloadSha256", "receivedSha256", "sourceHostFingerprint", "destinationHostFingerprint"):
        value = r.get(name)
        if not isinstance(value, str) or len(value) != 64:
            raise SDPNVerificationError(f"invalid digest: {name}")
        try:
            bytes.fromhex(value)
        except ValueError as exc:
            raise SDPNVerificationError(f"invalid hex digest: {name}") from exc
    if r["stateHash"] != r["payloadSha256"] or r["payloadSha256"] != r["receivedSha256"]:
        raise SDPNVerificationError("payload digest mismatch")
    if type(r.get("payloadBytes")) is not int or r["payloadBytes"] <= 0 or r.get("ciphertextBytes") != r["payloadBytes"]:
        raise SDPNVerificationError("payload length mismatch")
    distinct = r["sourceHostFingerprint"] != r["destinationHostFingerprint"]
    if r.get("distinctHostFingerprints") is not distinct:
        raise SDPNVerificationError("incorrect fingerprint equality claim")
    two_host = distinct and r.get("loopbackObserved") is False
    if r.get("twoHostNetworkProofSatisfied") is not two_host:
        raise SDPNVerificationError("incorrect software two-host claim")
    expected = hmac.new(secret.encode(), _receipt_transcript(r).encode(), hashlib.sha256).hexdigest()
    actual = r.get("receiptMac", "")
    if not isinstance(actual, str) or not hmac.compare_digest(actual.lower(), expected):
        raise SDPNVerificationError("receipt MAC mismatch")
    return r


def native_status(binary: str = "sdpn-terminal") -> dict:
    """Ask the local terminal binary for its declared feature scope."""
    out = subprocess.run([binary, "sdpn", "status"], capture_output=True, check=True, text=True, timeout=10)
    return json.loads(out.stdout)


def ask_local(prompt: str, endpoint: str = "http://127.0.0.1:18281/v1/cognition") -> str:
    """Use an explicitly configured first-party local Auxiliary implementation.

    No external/provider URLs or DNS names are accepted, including localhost.
    """
    u = urlparse(endpoint)
    try:
        loopback = ipaddress.ip_address(u.hostname or "").is_loopback
    except ValueError:
        loopback = False
    if u.scheme != "http" or not loopback or u.username or u.password or u.path != "/v1/cognition" or u.query or u.fragment:
        raise ValueError("SDPN local cognition requires literal loopback HTTP")
    data = json.dumps({"input": prompt, "source": "kindred-sdpn-python", "mode": "local"}).encode()
    req = Request(endpoint, data=data, headers={"Content-Type": "application/json"}, method="POST")
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=15) as resp:
        result = json.loads(resp.read(1024 * 1024))
    if not isinstance(result.get("output"), str) or not result["output"]:
        raise ValueError("local cognition response missing output")
    return result["output"]
