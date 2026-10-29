package ai.unoblox.works.mobile

import java.net.URI
import java.net.URISyntaxException

/** How the phone reaches the computer: the same Wi-Fi, or an internet tunnel. */
enum class ConnectionMode { LAN, TUNNEL }

/** A Connect Phone QR code from the desktop app: where the computer is, and a one-time token. */
data class PairingLink(val origin: String, val token: String, val mode: ConnectionMode) {
  val url: String get() = "$origin/pair?token=$token"
}

/**
 * The only addresses this app opens. The desktop bridge accepts phones on
 * private networks (`isPrivateAddress` in src/main/mobile/lan-mobile-bridge.ts)
 * and its internet tunnels use the hosts in `isInternetTunnelHost`; the same
 * rules are recorded in mobile/shared/pairing-links.json, which both apps and
 * the desktop tests check against. Anything else is refused so the app cannot
 * be pointed at an arbitrary site by a QR code.
 */
object Links {
  private val TOKEN = Regex("^[A-Za-z0-9_-]{16,128}$")
  private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
  private val TUNNEL_SUFFIXES = listOf(".trycloudflare.com", ".pinggy.link", ".pinggy-free.link", ".pinggy.online")
  private val EXCLUDED_TUNNEL_HOSTS = setOf("api.trycloudflare.com")

  fun parsePairing(raw: String): PairingLink? {
    val uri = parse(raw.trim()) ?: return null
    val origin = desktopOrigin(uri) ?: return null
    if (uri.rawPath != "/pair") return null
    val token = singleParam(uri.rawQuery, "token") ?: return null
    if (!TOKEN.matches(token)) return null
    return PairingLink(origin.first, token, origin.second)
  }

  /** The normalized origin of [url] when it belongs to a computer this app may open, else null. */
  fun desktopOriginOf(url: String): String? = parse(url)?.let { desktopOrigin(it)?.first }

  fun modeOf(origin: String): ConnectionMode? = parse(origin)?.let { desktopOrigin(it)?.second }

  /** True when [url] is on [origin], so the page may load it in place. */
  fun isSameOrigin(url: String, origin: String): Boolean = desktopOriginOf(url) == origin

  private fun parse(text: String): URI? = try {
    URI(text)
  } catch (_: URISyntaxException) {
    null
  }

  private fun desktopOrigin(uri: URI): Pair<String, ConnectionMode>? {
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (uri.rawUserInfo != null) return null
    val host = uri.host?.lowercase()?.trimEnd('.') ?: return null
    val mode = when {
      scheme == "http" && isPrivateIpv4(host) -> ConnectionMode.LAN
      scheme == "https" && isTunnelHost(host) -> ConnectionMode.TUNNEL
      else -> return null
    }
    val defaultPort = if (scheme == "http") 80 else 443
    val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
    return "$scheme://$host$port" to mode
  }

  private fun singleParam(query: String?, name: String): String? {
    if (query == null) return null
    val values = query.split('&').filter { it.startsWith("$name=") }.map { it.substring(name.length + 1) }
    return values.singleOrNull()
  }

  fun isPrivateIpv4(host: String): Boolean {
    val match = IPV4.matchEntire(host) ?: return false
    val parts = match.groupValues.drop(1).map { it.toInt() }
    if (parts.any { it > 255 }) return false
    val (a, b) = parts
    return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
  }

  fun isTunnelHost(host: String): Boolean =
    host !in EXCLUDED_TUNNEL_HOSTS && TUNNEL_SUFFIXES.any { host.endsWith(it) && host.length > it.length }
}
