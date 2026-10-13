package ai.kindredlabs.sdpn.mobile

/**
 * Four-cloud SDPN CloudSignal connection-quality classification.
 *
 * Native SDPN requires verified direct bidirectional materialization without
 * IP or routing. GatewayHealth/level remains a legacy compatibility classifier.
 * A one-off local proof cannot promote a live mobile session.
 *
 * Thresholds are preliminary UX policy, not contractual quality-of-service.
 */
object CloudSignal {
    const val MAX_AGE_MS = 15000L

    data class NativeMaterializationHealth(
        val authenticatedPorts: Boolean,
        val coordinatorGrantVerified: Boolean,
        val activeSessionVerified: Boolean,
        val forwardReconstructionVerified: Boolean,
        val reverseReconstructionVerified: Boolean,
        val durableReceiptsVerified: Boolean,
        val usesIp: Boolean,
        val usesRouting: Boolean,
        val observedAtEpochMs: Long,
        val grantExpiresAtEpochMs: Long,
        val failedMaterializationsPercent: Double,
        val p95MaterializationMs: Double,
        val jitterMs: Double,
        val reconstructionGoodputMbps: Double
    )

    fun nativeLevel(sample: NativeMaterializationHealth?, nowEpochMs: Long): Int {
        if (sample == null || !sample.authenticatedPorts ||
            !sample.coordinatorGrantVerified || !sample.activeSessionVerified ||
            !sample.forwardReconstructionVerified || !sample.reverseReconstructionVerified ||
            !sample.durableReceiptsVerified || sample.usesIp || sample.usesRouting ||
            nowEpochMs < 0 || sample.grantExpiresAtEpochMs <= nowEpochMs) return 0
        if (!fresh(sample.observedAtEpochMs, nowEpochMs)) return 0
        return score(sample.failedMaterializationsPercent, sample.p95MaterializationMs,
            sample.jitterMs, sample.reconstructionGoodputMbps)
    }

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
        if (!fresh(sample.observedAtEpochMs, nowEpochMs)) return 0
        return score(sample.packetLossPercent, sample.p95RoundTripMs,
            sample.jitterMs, sample.applicationGoodputMbps)
    }

    private fun fresh(observed: Long, now: Long): Boolean =
        now >= 0 && observed >= 0 && observed <= now && now - observed <= MAX_AGE_MS

    private fun score(loss: Double, p95: Double, jitter: Double, goodput: Double): Int {
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
 * No native phone carrier or authenticated continuous health source has been
 * qualified. Keep native clouds disconnected until those actual receipts exist.
 * A local PC proof, Wi-Fi RSSI, or a legacy IP gateway must not fill native clouds.
 */
object SdpnNetworkHealthSource {
    fun currentNativeHealth(): CloudSignal.NativeMaterializationHealth? = null
    fun currentGatewayHealth(): CloudSignal.GatewayHealth? = null
}
