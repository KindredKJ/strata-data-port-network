import hashlib, hmac, json, pathlib, sys, tempfile, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from policy import navigation_allowed
from evidence import read_receipt, inspect_receipt, FIELDS, BOOLS

def fixture():
    payload=b"local verified state"
    digest=hashlib.sha256(payload).hexdigest()
    r=dict(zip(FIELDS, [
        "kindred.sdpn.two-host-proof.v2", "12345678-1234-1234-1234-123456789abc", "state/local",
        digest, 0, digest, digest, len(payload), len(payload), "a"*64, "b"*64,
        True, False, True, True, True, "AES-256-GCM", "HTTP_TCP_AES_256_GCM_BUFFERED",
        True, False, False, "2026-10-11T01:00:00.000Z"
    ]))
    secret="TEST_ONLY_PAIRING_SECRET_NOT_A_FOUNDER_CREDENTIAL"
    text="|".join(str(r[f]).lower() if f in BOOLS else str(r[f]) for f in FIELDS)
    r["receiptMac"]=hmac.new(secret.encode(),text.encode(),hashlib.sha256).hexdigest()
    return r,secret,payload

class LocalPolicy(unittest.TestCase):
    def test_local_navigation_and_remote_off(self):
        self.assertTrue(navigation_allowed("interconnect://home"))
        self.assertTrue(navigation_allowed("about:blank"))
        self.assertFalse(navigation_allowed("https://example.com"))
    def test_session_network_optin(self):
        self.assertTrue(navigation_allowed("https://example.com",True))
        for uri in ("http://example.com","file:///etc/passwd","javascript:alert(1)",
                    "https://user:pass@example.com","https://localhost","https://127.0.0.1",
                    "https://10.0.0.1","https://[::1]","https://example.com:bad","https://example.com:8443"):
            self.assertFalse(navigation_allowed(uri,True),uri)
    def test_metadata_never_promotes_claims(self):
        r,_,_=fixture(); result=inspect_receipt(r)
        self.assertFalse(result["mac_verified"]); self.assertFalse(result["production_authorized"])
        self.assertFalse(result["physical_machine_proven"])
    def test_mac_and_payload_exact(self):
        r,secret,payload=fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/"payload"; path.write_bytes(payload)
            result=inspect_receipt(r,secret,path)
            self.assertTrue(result["mac_verified"]); self.assertTrue(result["payload_verified"])
    def test_mac_tamper_rejected(self):
        r,secret,_=fixture(); r["stateId"]="altered"
        with self.assertRaises(ValueError): inspect_receipt(r,secret)
    def test_false_and_mistyped_claims_rejected(self):
        for field,value in (("integrityVerified",False),("integrityVerified","true"),
                            ("physicalMachineAttestationProven",True),("productionReadyClaim",True),
                            ("generation",True),("twoHostNetworkProofSatisfied",False)):
            r,_,_=fixture(); r[field]=value
            with self.assertRaises(ValueError): inspect_receipt(r)
    def test_payload_mismatch_rejected(self):
        r,secret,_=fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/"payload";path.write_bytes(b"wrong")
            with self.assertRaises(ValueError): inspect_receipt(r,secret,path)
    def test_duplicate_and_oversized_json_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/"receipt"
            for data in (b'{"a":1,"a":2}',b"x"*(1024*1024+1),b'{"x":NaN}'):
                path.write_bytes(data)
                with self.assertRaises(ValueError): read_receipt(path)
    def test_unrecognized_fields_rejected(self):
        r,_,_=fixture();r["privateKey"]="never accepted"
        with self.assertRaises(ValueError): inspect_receipt(r)

if __name__=="__main__": unittest.main()
