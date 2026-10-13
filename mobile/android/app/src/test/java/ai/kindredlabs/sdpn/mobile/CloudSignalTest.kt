package ai.kindredlabs.sdpn.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class CloudSignalTest {
    private val now = 100_000L
    private fun healthy(
        authenticated: Boolean = true,
        forwarding: Boolean = true,
        peer: Boolean = true,
        seen: Long = now,
        loss: Double = 0.0,
        p95: Double = 30.0,
        jitter: Double = 3.0,
        mbps: Double = 50.0
    ) = CloudSignal.GatewayHealth(
        authenticated, forwarding, peer, seen, loss, p95, jitter, mbps
    )

    @Test fun noGatewayNeverLightsClouds() {
        assertEquals(0, CloudSignal.level(null, now))
        assertEquals(0, CloudSignal.level(healthy(forwarding = false), now))
        assertEquals(0, CloudSignal.level(healthy(authenticated = false), now))
        assertEquals(0, CloudSignal.level(healthy(peer = false), now))
    }

    @Test fun staleOrFutureEvidenceMustBeOffline() {
        assertEquals(0, CloudSignal.level(healthy(seen = now - 15_001L), now))
        assertEquals(0, CloudSignal.level(healthy(seen = now + 1L), now))
        assertEquals(4, CloudSignal.level(healthy(seen = now - 15_000L), now))
    }

    @Test fun worstObservedDimensionLimitsSignalQuality() {
        assertEquals(4, CloudSignal.level(healthy(), now))
        assertEquals(3, CloudSignal.level(healthy(mbps = 12.0), now))
        assertEquals(2, CloudSignal.level(healthy(loss = 3.2), now))
        assertEquals(1, CloudSignal.level(healthy(p95 = 620.0), now))
        assertEquals(1, CloudSignal.level(healthy(jitter = 200.0), now))
    }

    @Test fun invalidMetricsCannotImplyNetworkConnectivity() {
        assertEquals(0, CloudSignal.level(healthy(loss = Double.NaN), now))
        assertEquals(0, CloudSignal.level(healthy(mbps = Double.POSITIVE_INFINITY), now))
        assertEquals(0, CloudSignal.level(healthy(loss = 101.0), now))
        assertEquals(0, CloudSignal.level(healthy(jitter = -2.0), now))
    }

    @Test fun iconAndLabelHaveExactlyFourActiveLevels() {
        assertEquals(R.drawable.sdpn_cloud_0, CloudSignal.iconResource(0))
        assertEquals(R.drawable.sdpn_cloud_25, CloudSignal.iconResource(1))
        assertEquals(R.drawable.sdpn_cloud_50, CloudSignal.iconResource(2))
        assertEquals(R.drawable.sdpn_cloud_75, CloudSignal.iconResource(3))
        assertEquals(R.drawable.sdpn_cloud_100, CloudSignal.iconResource(4))
        assertEquals("Disconnected", CloudSignal.label(0))
        assertEquals("Excellent", CloudSignal.label(4))
    }
}
