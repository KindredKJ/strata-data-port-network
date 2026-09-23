import tempfile,unittest
from pathlib import Path
from kindred_superstructure.partner_sdk import *
from kindred_superstructure.persistence import SQLiteState
from kindred_superstructure.security import DevelopmentHMACSigner
from kindred_superstructure.tenancy import TenantDirectory

class PartnerSDKTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.state=SQLiteState(Path(self.tmp.name)/"p.db");self.tenants=TenantDirectory(self.state);self.tenants.onboard("org","partner","Org");self.tenants.provision("tenant","org","dev","brand");self.tenants.grant("ent","tenant","watt.analyze");self.sent=[];self.client=PortZeroClient(self.tenants,self.sent.append,DevelopmentHMACSigner(b"test-only"),CredentialReference("service","env://KINDRED_PARTNER_IDENTITY"));self.context=PartnerContext("org","tenant","partner","dev","project","ent","agent","watt:analyze","org",("site_config",),"meter")
    def tearDown(self):self.state.close();self.tmp.cleanup()
    def test_envelope_uses_tenant_entitlement_and_secret_reference(self):
        envelope=self.client.create_envelope(self.context,capability="watt.analyze",destination_stratum="watt",destination_port="watt",payload={"site_config":"ref"},payload_type="WattCapabilityRequest",route_targets=("watt",));self.assertEqual(envelope.tenant_id,"tenant");self.assertEqual(envelope.encryption_metadata["key_reference"],"env://KINDRED_PARTNER_IDENTITY");self.client.submit(envelope);self.assertEqual(self.sent,[envelope])
        with self.assertRaises(PermissionError):self.client.create_envelope(self.context,capability="communications.send",destination_stratum="communications",destination_port="communications",payload={},payload_type="request",route_targets=("communications",))
    def test_inline_credentials_are_rejected(self):
        with self.assertRaises(ValueError):CredentialReference("service","token=do-not-store")
