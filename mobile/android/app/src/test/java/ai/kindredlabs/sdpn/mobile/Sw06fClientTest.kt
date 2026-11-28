package ai.kindredlabs.sdpn.mobile

import org.junit.Assert.*
import org.junit.Test

class Sw06fClientTest {
    @Test fun onlyPrivateIpv4IsAccepted() {
        for (ip in listOf("10.0.0.3", "172.16.0.2", "172.31.255.250", "192.168.1.4")) {
            assertTrue(ip, Sw06fClient.privateIpv4(ip))
        }
        for (ip in listOf("127.0.0.1", "8.8.8.8", "172.32.0.1", "192.168.001.4",
            "0.0.0.0", "2001:db8::1", "my-router", "10.1.1.256", "")) {
            assertFalse(ip, Sw06fClient.privateIpv4(ip))
        }
    }

    @Test fun hkdfMatchesNodeReferenceVector() {
        val key = Sw06fClient.hkdf(
            "sw07-test-secret-abcdefghijklmnopqrstuvwxyz123",
            "ab".repeat(32),
            "00000000-0000-4000-8000-000000000001"
        )
        val expected = Sw06fClient.hexToBytes(
            "3e642c2062cdeebf1b2919232e56e6a8e38329ba0a81e1617adfda97c5513c1e"
        )
        assertArrayEquals(expected, key)
    }

    @Test fun rejectsInvalidDigestEncoding() {
        assertThrows(IllegalArgumentException::class.java) {
            Sw06fClient.hexToBytes("not-hex")
        }
    }
}
