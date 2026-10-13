package ai.kindredlabs.sdpn.mobile

import android.app.Activity
import android.content.Intent
import android.provider.Settings
import android.os.Bundle
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Native Android SDPN pairing/proof screen. Does not activate an OS VPN.
 * Never stores the ephemeral secret or reports successful traffic routing.
 */
class MainActivity : Activity() {
    private val client = Sw06fClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Strata Data Port Network"
        val padding = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }
        val titleText = TextView(this).apply {
            text = "Strata Data Port Network"
            textSize = 23f
            gravity = Gravity.CENTER_HORIZONTAL
        }
        layout.addView(titleText)
        val cloudLevel = CloudSignal.nativeLevel(
            SdpnNetworkHealthSource.currentNativeHealth(),
            System.currentTimeMillis()
        )
        val cloudIcon = ImageView(this).apply {
            setImageResource(CloudSignal.iconResource(cloudLevel))
            contentDescription = "CloudSignal: " + CloudSignal.label(cloudLevel) +
                ", " + cloudLevel + " of four clouds"
            setBackgroundColor(0xFF173454.toInt())
            setPadding(padding, padding / 2, padding, padding / 2)
        }
        layout.addView(cloudIcon, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, (78 * resources.displayMetrics.density).toInt()
        ))
        layout.addView(TextView(this).apply {
            text = "Strata CloudSignal · " + cloudLevel + "/4 · " +
                CloudSignal.label(cloudLevel) + "\nClouds light only for verified bidirectional native materialization."
            textSize = 15f
        })
        val info = TextView(this).apply {
            text = "Native Strata Data Port Network\nPort identities • Zero Point reconstruction • no IP or routing.\n" +
                "Native phone carrier qualification is pending. No live global connection is claimed.\n" +
                "Founded by Kindred Jermaine Cox / Kindred Labs."
            textSize = 15f
        }
        layout.addView(info)
        val legacy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        val showLegacy = Button(this).apply { text = "Show legacy IP compatibility test" }
        showLegacy.setOnClickListener {
            legacy.visibility = if (legacy.visibility == View.GONE) View.VISIBLE else View.GONE
        }
        layout.addView(showLegacy)
        layout.addView(legacy)
        val wifi = Button(this).apply { text = "Find Strata in Wi-Fi settings" }
        wifi.setOnClickListener {
            startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
        }
        legacy.addView(wifi)

        val systemVpn = Button(this).apply {
            text = "Network Settings → SDPN VPN (gateway pending)"
        }
        systemVpn.setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_VPN_SETTINGS))
            } catch (error: Exception) {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            }
        }
        legacy.addView(systemVpn)

        val receiver = EditText(this).apply {
            hint = "Computer private IP, e.g. 192.168.1.20"
            inputType = InputType.TYPE_CLASS_PHONE
            isSingleLine = true
        }
        legacy.addView(receiver)
        val secret = EditText(this).apply {
            hint = "One-time pairing secret"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            transformationMethod = PasswordTransformationMethod.getInstance()
            isSingleLine = true
        }
        legacy.addView(secret)
        val status = TextView(this).apply {
            text = "Disconnected • no network profile installed"
            textSize = 15f
        }
        val action = Button(this).apply { text = "Verify encrypted phone → PC transfer" }
        legacy.addView(action)
        legacy.addView(status)
        action.setOnClickListener {
            val host = receiver.text.toString().trim()
            val pairingSecret = secret.text.toString()
            if (!Sw06fClient.privateIpv4(host) || pairingSecret.length < 32) {
                status.text = "Enter an RFC1918 private IP and a 32+ character one-time secret."
                return@setOnClickListener
            }
            action.isEnabled = false
            status.text = "Testing authenticated 1 MiB transfer…"
            secret.text.clear() // Avoid retaining text in the widget after start.
            Thread {
                try {
                    val measurement = client.sendProof(host, 47900, pairingSecret, 1)
                    runOnUiThread {
                        status.text = "Verified 1 MiB SW06-F transfer\n" +
                            "Round trip: %.1f ms\n".format(measurement.elapsedMs) +
                            "Application goodput: %.2f Mbps\n".format(measurement.goodputMbps) +
                            "Receipt SHA-256: " + measurement.receiptSha256 + "\n" +
                            "Proof complete. Device-wide routing: NOT ENABLED."
                        action.isEnabled = true
                    }
                } catch (error: Exception) {
                    runOnUiThread {
                        status.text = "No verified SDPN session: " +
                            (error.message ?: "Transport unavailable") + "\n" +
                            "Your regular network connection was not changed."
                        action.isEnabled = true
                    }
                }
            }.start()
        }
        val scroll = ScrollView(this)
        scroll.addView(layout, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
    }
}
