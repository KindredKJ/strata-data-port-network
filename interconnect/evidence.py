"""Bounded offline SW06-F receipt validation; never elevates physical/production claims."""
import hashlib
import hmac
import json
from datetime import datetime
from pathlib import Path
import re

LIMIT = 1024 * 1024
FIELDS = [
    "schemaVersion", "sessionId", "stateId", "stateHash", "generation",
    "payloadSha256", "receivedSha256", "payloadBytes", "ciphertextBytes",
    "sourceHostFingerprint", "destinationHostFingerprint", "distinctHostFingerprints",
    "loopbackObserved", "authenticationVerified", "integrityVerified", "encryptedOnWire",
    "cipher", "transportClass", "twoHostNetworkProofSatisfied",
    "physicalMachineAttestationProven", "productionReadyClaim", "observedAt",
]
BOOLS = FIELDS[11:16] + FIELDS[18:21]
HASHES = ["stateHash", "payloadSha256", "receivedSha256", "sourceHostFingerprint", "destinationHostFingerprint", "receiptMac"]
def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result
def read_receipt(path):
    with Path(path).open("rb") as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("Receipt exceeds 1 MiB")
    value = json.loads(data, object_pairs_hook=unique_pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite number")))
    if type(value) is not dict:
        raise ValueError("Receipt must be an object")
    return value
def inspect_receipt(receipt, secret=None, payload_path=None):
    if set(receipt) != set(FIELDS + ["receiptMac"]):
        raise ValueError("Unexpected or missing receipt fields")
    if receipt["schemaVersion"] != "kindred.sdpn.two-host-proof.v2":
        raise ValueError("Unsupported schema")
    if any(type(receipt[field]) is not bool for field in BOOLS):
        raise ValueError("Verification flags must be booleans")
    if any(type(receipt[field]) is not str or not re.fullmatch(r"[0-9a-fA-F]{64}", receipt[field]) for field in HASHES):
        raise ValueError("Malformed SHA-256/MAC")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", receipt["sessionId"]):
        raise ValueError("Malformed session identity")
    if type(receipt["stateId"]) is not str or not 1 <= len(receipt["stateId"]) <= 512 or re.search(r"[|\r\n]", receipt["stateId"]):
        raise ValueError("Ambiguous state identity")
    for field in ("generation", "payloadBytes", "ciphertextBytes"):
        if type(receipt[field]) is not int or not 0 <= receipt[field] <= 2**53 - 1:
            raise ValueError("Invalid integer")
    if not 1 <= receipt["payloadBytes"] <= 32 * 1024 * 1024 or receipt["payloadBytes"] != receipt["ciphertextBytes"]:
        raise ValueError("Invalid payload bounds")
    if receipt["stateHash"] != receipt["payloadSha256"] or receipt["payloadSha256"] != receipt["receivedSha256"]:
        raise ValueError("Contradictory reconstruction hashes")
    if any(receipt[field] is not True for field in ("authenticationVerified", "integrityVerified", "encryptedOnWire")):
        raise ValueError("Verification failed")
    if receipt["physicalMachineAttestationProven"] or receipt["productionReadyClaim"]:
        raise ValueError("Unsupported physical/production promotion")
    distinct = receipt["sourceHostFingerprint"] != receipt["destinationHostFingerprint"]
    if receipt["distinctHostFingerprints"] != distinct or receipt["twoHostNetworkProofSatisfied"] != (distinct and not receipt["loopbackObserved"]):
        raise ValueError("Contradictory host classification")
    if receipt["cipher"] != "AES-256-GCM" or receipt["transportClass"] != "HTTP_TCP_AES_256_GCM_BUFFERED":
        raise ValueError("Unsupported transport")
    if type(receipt["observedAt"]) is not str or not receipt["observedAt"].endswith("Z"):
        raise ValueError("Expected UTC timestamp")
    datetime.fromisoformat(receipt["observedAt"].replace("Z", "+00:00"))
    mac_verified = False
    if secret is not None:
        if type(secret) is not str or len(secret) < 32:
            raise ValueError("Invalid local pairing secret")
        text = "|".join(str(receipt[f]).lower() if f in BOOLS else str(receipt[f]) for f in FIELDS)
        expected = hmac.new(secret.encode(), text.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, receipt["receiptMac"].lower()):
            raise ValueError("Receipt MAC rejected")
        mac_verified = True
    payload_verified = False
    if payload_path is not None:
        digest, size = hashlib.sha256(), 0
        with Path(payload_path).open("rb") as stream:
            while chunk := stream.read(65536):
                size += len(chunk)
                if size > receipt["payloadBytes"]:
                    raise ValueError("Payload size mismatch")
                digest.update(chunk)
        if size != receipt["payloadBytes"] or digest.hexdigest() != receipt["payloadSha256"]:
            raise ValueError("Payload hash mismatch")
        payload_verified = True
    return {
        "classification": "OFFLINE_RECEIPT_INSPECTION",
        "metadata_valid": True, "mac_verified": mac_verified, "payload_verified": payload_verified,
        "execution_claim": "UNVERIFIED_HOST_CLASSIFICATION_REQUIRES_EXTERNAL_ATTESTATION",
        "physical_machine_proven": False, "production_authorized": False,
    }
