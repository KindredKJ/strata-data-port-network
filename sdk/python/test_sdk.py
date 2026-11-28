import json
import hashlib
import hmac
import unittest
from kindred_sdpn import verify_receipt, SDPNVerificationError, ask_local, _receipt_transcript

SECRET = "test-session-secret-at-least-thirty-two-characters"


class SDKTests(unittest.TestCase):
    def receipt(self):
        h = hashlib.sha256(b"payload").hexdigest()
        f = hashlib.sha256(b"host").hexdigest()
        r = dict(schemaVersion="kindred.sdpn.two-host-proof.v2",sessionId="session",stateId="state",
                 stateHash=h,generation=1,payloadSha256=h,receivedSha256=h,payloadBytes=7,ciphertextBytes=7,
                 sourceHostFingerprint=f,destinationHostFingerprint=f,distinctHostFingerprints=False,
                 loopbackObserved=True,authenticationVerified=True,integrityVerified=True,encryptedOnWire=True,
                 cipher="AES-256-GCM",transportClass="HTTP_TCP_AES_256_GCM_BUFFERED",twoHostNetworkProofSatisfied=False,
                 physicalMachineAttestationProven=False,productionReadyClaim=False,observedAt="2026-11-27T00:00:00.000Z")
        r["receiptMac"] = hmac.new(SECRET.encode(),_receipt_transcript(r).encode(),hashlib.sha256).hexdigest()
        return r

    def test_verified_and_tamper(self):
        r = self.receipt()
        self.assertEqual(verify_receipt(r,SECRET)["stateId"],"state")
        r["generation"] += 1
        with self.assertRaises(SDPNVerificationError):
            verify_receipt(r,SECRET)

    def test_reject_untrusted_endpoint(self):
        for ep in ("https://public.example/v1/cognition","http://8.8.8.8/", "http://localhost:18281/v1/cognition", "http://127.0.0.1:18281/other"):
            with self.assertRaises(ValueError):
                ask_local("hello",ep)

    def test_reject_false_physical_claim(self):
        r = self.receipt()
        r["physicalMachineAttestationProven"] = True
        with self.assertRaises(SDPNVerificationError):
            verify_receipt(r,SECRET)


if __name__ == "__main__":
    unittest.main()
