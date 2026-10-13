package ai.kindredlabs.sdpn.mobile

import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Native SW06-F sender interoperating with src/two-machine-proof.mjs.
 * Only RFC1918 private LAN transport is permitted in this proof application.
 */
class Sw06fClient {
    companion object {
        const val SCHEMA = "kindred.sdpn.two-host-proof.v2"
        private const val MAX_RESPONSE = 65536
        private const val TIMEOUT_MS = 30000
        private const val TRANSPORT = "HTTP_TCP_AES_256_GCM_BUFFERED"
        private val HEX = Regex("^[0-9a-fA-F]{64}$")

        fun privateIpv4(host: String): Boolean {
            val parts = host.split(".")
            if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 ||
                        it.any { ch -> ch !in '0'..'9' } ||
                        (it.length > 1 && it.startsWith("0")) }) return false
            val n = parts.map { it.toIntOrNull() ?: return false }
            if (n.any { it > 255 }) return false
            return n[0] == 10 || (n[0] == 172 && n[1] in 16..31) ||
                (n[0] == 192 && n[1] == 168)
        }

        fun hexToBytes(value: String): ByteArray {
            require(value.length % 2 == 0 && value.matches(Regex("^[0-9a-fA-F]*$")))
            return ByteArray(value.length / 2) {
                value.substring(it * 2, it * 2 + 2).toInt(16).toByte()
            }
        }
        private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
        private fun sha256(data: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(data))
        private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key, "HmacSHA256"))
            return mac.doFinal(data)
        }
        fun hkdf(secret: String, challengeHex: String, sessionId: String): ByteArray {
            val salt = hexToBytes(challengeHex)
            require(salt.size == 32)
            val prk = hmac(salt, secret.toByteArray(StandardCharsets.UTF_8))
            val info = ("kindred-sdpn-sw06f|" + sessionId).toByteArray(StandardCharsets.UTF_8)
            return hmac(prk, info + byteArrayOf(1))
        }
        private fun base64url(data: ByteArray) = Base64.encodeToString(data,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

        fun receiptTranscript(r: JSONObject): String = listOf(
            r.getString("schemaVersion"), r.getString("sessionId"), r.getString("stateId"),
            r.getString("stateHash"), r.getLong("generation").toString(),
            r.getString("payloadSha256"), r.getString("receivedSha256"),
            r.getLong("payloadBytes").toString(), r.getLong("ciphertextBytes").toString(),
            r.getString("sourceHostFingerprint"), r.getString("destinationHostFingerprint"),
            r.getBoolean("distinctHostFingerprints").toString(),
            r.getBoolean("loopbackObserved").toString(),
            r.getBoolean("authenticationVerified").toString(),
            r.getBoolean("integrityVerified").toString(),
            r.getBoolean("encryptedOnWire").toString(), r.getString("cipher"),
            r.getString("transportClass"), r.getBoolean("twoHostNetworkProofSatisfied").toString(),
            r.getBoolean("physicalMachineAttestationProven").toString(),
            r.getBoolean("productionReadyClaim").toString(), r.getString("observedAt")
        ).joinToString("|")

        private fun request(host: String, port: Int, path: String, contentType: String,
                            body: ByteArray, headers: Map<String, String> = emptyMap()): JSONObject {
            require(privateIpv4(host)) { "Private LAN IPv4 address required." }
            require(port in 1..65535)
            val connection = URL("http://" + host + ":" + port + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.instanceFollowRedirects = false
                connection.useCaches = false
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", contentType)
                connection.setFixedLengthStreamingMode(body.size)
                for ((key, value) in headers) connection.setRequestProperty(key, value)
                connection.outputStream.use { it.write(body) }
                val status = connection.responseCode
                if (status !in 200..299) throw SecurityException("Proof rejected with HTTP " + status)
                val output = ByteArrayOutputStream()
                connection.inputStream.use { input ->
                    val chunk = ByteArray(4096)
                    while (true) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        require(output.size() + n <= MAX_RESPONSE) { "Response exceeds limit" }
                        output.write(chunk, 0, n)
                    }
                }
                return JSONObject(output.toString(StandardCharsets.UTF_8.name()))
            } finally { connection.disconnect() }
        }
    }

    // This is a fresh software fingerprint per app session, not hardware attestation.
    private val fingerprint = sha256(("kindred-android-proof|" +
        UUID.randomUUID().toString()).toByteArray(StandardCharsets.UTF_8))

    data class Measurement(
        val payloadMiB: Int, val elapsedMs: Double, val goodputMbps: Double,
        val receiptSha256: String, val twoHostSoftwareProof: Boolean
    )

    fun sendProof(host: String, port: Int, secret: String, payloadMiB: Int): Measurement {
        require(privateIpv4(host)) { "Only private LAN IPv4 receivers are allowed." }
        require(secret.length >= 32) { "Pairing secret requires 32+ characters." }
        require(payloadMiB in listOf(1, 4, 16)) { "Payload size must be 1, 4 or 16 MiB." }
        val payload = ByteArray(payloadMiB * 1024 * 1024) { 0x5a.toByte() }
        val digest = sha256(payload)
        val stateId = "kindred-android-proof:" + UUID.randomUUID().toString()
        val generation = 0L
        val start = System.nanoTime()
        val hello = JSONObject().put("schemaVersion", SCHEMA)
            .put("sourceHostFingerprint", fingerprint).put("stateId", stateId)
            .put("stateHash", digest).put("generation", generation)
            .put("payloadSha256", digest).put("payloadBytes", payload.size)
        val challenge = request(host, port, "/proof/challenge", "application/json",
            hello.toString().toByteArray(StandardCharsets.UTF_8))
        val sessionId = challenge.getString("sessionId")
        val challengeHex = challenge.getString("challenge")
        val destination = challenge.getString("destinationHostFingerprint")
        check(challenge.getString("schemaVersion") == SCHEMA &&
            challenge.getString("cipher") == "AES-256-GCM" &&
            sessionId.matches(Regex("^[0-9a-fA-F-]{36}$")) &&
            challengeHex.matches(HEX) && destination.matches(HEX)) {
            "Invalid challenge or incompatible receiver."
        }
        val transcript = listOf(SCHEMA, sessionId, challengeHex, fingerprint, destination,
            stateId, digest, generation.toString(), digest, payload.size.toString()).joinToString("|")
        val auth = hex(hmac(secret.toByteArray(StandardCharsets.UTF_8),
            transcript.toByteArray(StandardCharsets.UTF_8)))
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(hkdf(secret, challengeHex, sessionId), "AES"),
            GCMParameterSpec(128, nonce))
        cipher.updateAAD(transcript.toByteArray(StandardCharsets.UTF_8))
        val sealed = cipher.doFinal(payload)
        val ciphertext = sealed.copyOfRange(0, sealed.size - 16)
        val tag = sealed.copyOfRange(sealed.size - 16, sealed.size)
        val receipt = request(host, port, "/proof/transfer", "application/octet-stream", ciphertext,
            mapOf("x-kindred-session" to sessionId, "x-kindred-proof-auth" to auth,
                "x-kindred-proof-iv" to base64url(nonce), "x-kindred-proof-tag" to base64url(tag)))
        val macHex = receipt.getString("receiptMac")
        check(macHex.matches(HEX)) { "Invalid proof receipt MAC." }
        val expected = hmac(secret.toByteArray(StandardCharsets.UTF_8),
            receiptTranscript(receipt).toByteArray(StandardCharsets.UTF_8))
        check(MessageDigest.isEqual(expected, hexToBytes(macHex))) { "Receipt authentication failed." }
        check(receipt.getString("schemaVersion") == SCHEMA &&
            receipt.getString("sessionId") == sessionId &&
            receipt.getString("stateId") == stateId &&
            receipt.getString("stateHash") == digest &&
            receipt.getLong("generation") == generation &&
            receipt.getString("payloadSha256") == digest &&
            receipt.getString("receivedSha256") == digest &&
            receipt.getLong("payloadBytes") == payload.size.toLong() &&
            receipt.getLong("ciphertextBytes") == ciphertext.size.toLong() &&
            receipt.getString("sourceHostFingerprint") == fingerprint &&
            receipt.getString("destinationHostFingerprint") == destination &&
            receipt.getBoolean("distinctHostFingerprints") &&
            !receipt.getBoolean("loopbackObserved") &&
            receipt.getBoolean("twoHostNetworkProofSatisfied") &&
            receipt.getBoolean("authenticationVerified") &&
            receipt.getBoolean("integrityVerified") &&
            receipt.getBoolean("encryptedOnWire") &&
            receipt.getString("cipher") == "AES-256-GCM" &&
            receipt.getString("transportClass") == TRANSPORT &&
            !receipt.getBoolean("physicalMachineAttestationProven") &&
            !receipt.getBoolean("productionReadyClaim")) {
            "Receipt verification or proof boundary failed."
        }
        val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
        return Measurement(payloadMiB, elapsedMs, payload.size * 8.0 / (elapsedMs / 1000) / 1e6,
            sha256(receipt.toString().toByteArray(StandardCharsets.UTF_8)), true)
    }
}
