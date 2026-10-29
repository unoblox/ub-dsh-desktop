import Foundation

/// How the phone reaches the computer: the same Wi-Fi, or an internet tunnel.
enum ConnectionMode: String {
  case lan
  case tunnel
}

/// A Connect Phone QR code from the desktop app: where the computer is, and a one-time token.
struct PairingLink: Equatable {
  let origin: String
  let token: String
  let mode: ConnectionMode

  var url: URL { URL(string: "\(origin)/pair?token=\(token)")! }
}

/// The only addresses this app opens. The desktop bridge accepts phones on
/// private networks (`isPrivateAddress` in src/main/mobile/lan-mobile-bridge.ts)
/// and its internet tunnels use the hosts in `isInternetTunnelHost`; the same
/// rules are recorded in mobile/shared/pairing-links.json, which both apps and
/// the desktop tests check against. Anything else is refused so the app cannot
/// be pointed at an arbitrary site by a QR code.
enum Links {
  private static let tunnelSuffixes = [".trycloudflare.com", ".pinggy.link", ".pinggy-free.link", ".pinggy.online"]
  private static let excludedTunnelHosts: Set<String> = ["api.trycloudflare.com"]
  private static let tokenCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")

  static func parsePairing(_ raw: String) -> PairingLink? {
    guard let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
          let (origin, mode) = desktopOrigin(components),
          components.percentEncodedPath == "/pair",
          let query = components.percentEncodedQuery else { return nil }
    let tokens = query.split(separator: "&", omittingEmptySubsequences: false)
      .filter { $0.hasPrefix("token=") }
      .map { String($0.dropFirst("token=".count)) }
    guard tokens.count == 1, let token = tokens.first, isToken(token) else { return nil }
    return PairingLink(origin: origin, token: token, mode: mode)
  }

  /// The normalized origin of `url` when it belongs to a computer this app may open, else nil.
  static func desktopOrigin(of url: URL) -> String? {
    URLComponents(url: url, resolvingAgainstBaseURL: false).flatMap { desktopOrigin($0)?.0 }
  }

  static func desktopOrigin(of text: String) -> String? {
    URLComponents(string: text).flatMap { desktopOrigin($0)?.0 }
  }

  static func mode(of origin: String) -> ConnectionMode? {
    URLComponents(string: origin).flatMap { desktopOrigin($0)?.1 }
  }

  /// True when `url` is on `origin`, so the page may load it in place.
  static func isSameOrigin(_ url: URL, _ origin: String) -> Bool {
    desktopOrigin(of: url) == origin
  }

  static func isPrivateIPv4(_ host: String) -> Bool {
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 4 else { return false }
    var octets: [Int] = []
    for part in parts {
      guard (1...3).contains(part.count), part.allSatisfy({ $0.isASCII && $0.isNumber }),
            let value = Int(part), value <= 255 else { return false }
      octets.append(value)
    }
    return octets[0] == 10 || (octets[0] == 172 && (16...31).contains(octets[1])) || (octets[0] == 192 && octets[1] == 168)
  }

  static func isTunnelHost(_ host: String) -> Bool {
    !excludedTunnelHosts.contains(host) && tunnelSuffixes.contains { host.hasSuffix($0) && host.count > $0.count }
  }

  private static func isToken(_ token: String) -> Bool {
    (16...128).contains(token.count) && token.unicodeScalars.allSatisfy { tokenCharacters.contains($0) }
  }

  private static func desktopOrigin(_ components: URLComponents) -> (String, ConnectionMode)? {
    guard let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
          components.user == nil, components.password == nil,
          var host = components.host?.lowercased(), !host.isEmpty else { return nil }
    if host.hasSuffix(".") { host.removeLast() }
    let mode: ConnectionMode
    if scheme == "http" && isPrivateIPv4(host) {
      mode = .lan
    } else if scheme == "https" && isTunnelHost(host) {
      mode = .tunnel
    } else {
      return nil
    }
    let defaultPort = scheme == "http" ? 80 : 443
    let port = components.port.map { $0 == defaultPort ? "" : ":\($0)" } ?? ""
    return ("\(scheme)://\(host)\(port)", mode)
  }
}
