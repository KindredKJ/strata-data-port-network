import tempfile, unittest
from pathlib import Path
from kindred_superstructure.http_transport import HttpMTLSDispatcher, MTLSConfigurationError

class HttpTransportTests(unittest.TestCase):
    def test_requires_https_and_mtls_material(self):
        with tempfile.TemporaryDirectory() as directory:
            missing=Path(directory)/"missing.pem"
            with self.assertRaises(MTLSConfigurationError): HttpMTLSDispatcher({"communications":"http://port.invalid"},missing,missing,missing)
            with self.assertRaisesRegex(MTLSConfigurationError,"file reference unavailable"): HttpMTLSDispatcher({"communications":"https://port.invalid"},missing,missing,missing)
