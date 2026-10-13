package ai.kindredlabs.sdpn.mobile

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Entry in Android's Quick Settings network/connectivity workflow.
 * Remains INACTIVE until a genuine system tunnel and routing gateway exist.
 */
class StrataNetworkTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        // No authenticated packet-forwarding gateway exists in SW07/SW08.
        // A successful application-level proof MUST NOT promote the network icon.
        val level = CloudSignal.level(
            SdpnNetworkHealthSource.currentGatewayHealth(),
            System.currentTimeMillis()
        )
        qsTile?.let {
            it.label = "Strata CloudSignal"
            it.icon = Icon.createWithResource(this, CloudSignal.iconResource(level))
            it.state = if (level > 0) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            it.contentDescription = "Strata network: " + CloudSignal.label(level) +
                ", " + level + " of four clouds. Tap to open SDPN."
            it.updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        if (Build.VERSION.SDK_INT >= 34) {
            val pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            startActivityAndCollapse(pendingIntent)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
