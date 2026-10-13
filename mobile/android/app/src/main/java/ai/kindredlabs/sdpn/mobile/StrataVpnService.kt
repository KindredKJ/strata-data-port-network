package ai.kindredlabs.sdpn.mobile

import android.content.Intent
import android.net.VpnService
import android.util.Log

/**
 * Android network-settings integration boundary for a future packet-tunnel gateway.
 *
 * SW06-F currently moves verified encrypted application payloads. It DOES NOT
 * forward arbitrary IP packets. Therefore we must NOT call Builder.establish()
 * until a separately reviewed, authenticated IP gateway and safe routing
 * implementation exist, or the device's normal internet connection could break.
 *
 * Merely declaring this service does not grant VPN consent or connect a VPN.
 */
class StrataVpnService : VpnService() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.w("StrataVpnService", "SDPN IP gateway unavailable; declining VPN activation")
        stopSelfResult(startId)
        return START_NOT_STICKY
    }

    override fun onRevoke() {
        stopSelf()
        super.onRevoke()
    }
}
