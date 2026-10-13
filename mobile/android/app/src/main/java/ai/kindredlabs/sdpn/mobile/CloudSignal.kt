package ai.kindredlabs.sdpn.mobile

/**
 * Four-cloud SDPN CloudSignal connection-quality classification.
 *
 * This is NOT cellular RSSI or Wi-Fi bars. There must be a verified, operating
 * SDPN packet-forwarding gateway before any clouds are illuminated. An
 * authenticated SW06-F application proof is insufficient.
 *
 * Thresholds are preliminary UX policy, not contractual quality-of-service.
 */
object CloudSignal {
    const val MAX_AGE_MS = 15000L

    data class GatewayHealth(
        val authenticated: Boolean,
        val routeForwardingVerified: Boolean,
        val peerReachable: Boolean,
        val observedAtEpochMs: Long,
        val packetLossPercent: Double,
        val p95RoundTripMs: Double,
        val jitterMs: Double,
        val applicationGoodputMbps: Double
    )

    fun level(sample: GatewayHealth?, nowEpochMs: Long): Int {
        if (sample == null || !sample.authenticated ||
            !sample.routeForwardingVerified || !sample.peerReachable) return 0
        if (sample.observedAtEpochMs > nowEpochMs ||
            sample.observedAtEpochMs < 0 ||
            nowEpochMs - sample.observedAtEpochMs > MAX_AGE_MS) return 0
        val loss = sample.packetLossPercent
        val p95 = sample.p95RoundTripMs
        val jitter = sample.jitterMs
        val goodput = sample.applicationGoodputMbps
        if (!loss.isFinite() || !p95.isFinite() || !jitter.isFinite() ||
            !goodput.isFinite() || loss !in 0.0..100.0 ||
            p95 < 0.0 || jitter < 0.0 || goodput < 0.0) return 0

        // Take the weakest measured component rather than overstating quality.
        val packetScore = when {
            loss >= 10.0 -> 1
            loss >= 3.0 -> 2
            loss >= 1.0 -> 3
            else -> 4
        }
        val latencyScore = when {
            p95 >= 600.0 -> 1
            p95 >= 250.0 -> 2
            p95 >= 100.0 -> 3
            else -> 4
        }
        val jitterScore = when {
            jitter >= 150.0 -> 1
            jitter >= 60.0 -> 2
            jitter >= 20.0 -> 3
            else -> 4
        }
        val goodputScore = when {
            goodput < 1.0 -> 1
            goodput < 5.0 -> 2
            goodput < 20.0 -> 3
            else -> 4
        }
        return minOf(packetScore, latencyScore, jitterScore, goodputScore)
    }

    fun iconResource(level: Int): Int = when (level.coerceIn(0, 4)) {
        1 -> R.drawable.sdpn_cloud_25
        2 -> R.drawable.sdpn_cloud_50
        3 -> R.drawable.sdpn_cloud_75
        4 -> R.drawable.sdpn_cloud_100
        else -> R.drawable.sdpn_cloud_0
    }

    fun label(level: Int): String = when (level.coerceIn(0, 4)) {
        1 -> "Weak"
        2 -> "Fair"
        3 -> "Strong"
        4 -> "Excellent"
        else -> "Disconnected"
    }
}

/**
 * The packet gateway and network-health sampler DO NOT EXIST YET.
 * The only legitimate data source is a verified, actively forwarding gateway.
 * Do not read RSSI, run a one-shot proof, or mark a VPN registered as active.
 */
object SdpnNetworkHealthSource {
    fun currentGatewayHealth(): CloudSignal.GatewayHealth? = null
}
