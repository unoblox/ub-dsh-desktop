import Foundation

/// A computer this phone has paired with. The pairing itself is the bridge's cookie in the web view.
struct SavedDesktop: Codable, Equatable, Identifiable {
  var origin: String
  var name: String
  var lastUsedAt: Date

  var id: String { origin }
}

/// Remembers paired computers on this phone only. Only addresses and names are
/// kept here; the session cookie stays in the web view's cookie store and
/// nothing is sent anywhere.
final class DesktopStore: ObservableObject {
  static let limit = 20
  private static let key = "desktops"

  @Published private(set) var desktops: [SavedDesktop]
  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    desktops = Self.decode(defaults.data(forKey: Self.key))
  }

  var mostRecent: SavedDesktop? { desktops.first }

  func touch(_ origin: String, now: Date = Date()) {
    save(Self.upsert(desktops, origin: origin, now: now))
  }

  func rename(_ origin: String, to name: String) {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    save(desktops.map { $0.origin == origin ? SavedDesktop(origin: origin, name: trimmed.isEmpty ? Self.defaultName(origin) : trimmed, lastUsedAt: $0.lastUsedAt) : $0 })
  }

  func forget(_ origin: String) {
    save(desktops.filter { $0.origin != origin })
  }

  func name(of origin: String) -> String {
    desktops.first { $0.origin == origin }?.name ?? Self.defaultName(origin)
  }

  private func save(_ list: [SavedDesktop]) {
    desktops = list
    defaults.set(Self.encode(list), forKey: Self.key)
  }

  static func defaultName(_ origin: String) -> String {
    let host = origin.components(separatedBy: "://").last ?? origin
    return host.components(separatedBy: ":").first ?? host
  }

  /// Moves `origin` to the front, adding it when new. Keeps the most recent `limit`.
  static func upsert(_ list: [SavedDesktop], origin: String, now: Date) -> [SavedDesktop] {
    var updated = list.first { $0.origin == origin } ?? SavedDesktop(origin: origin, name: defaultName(origin), lastUsedAt: now)
    updated.lastUsedAt = now
    return Array(([updated] + list.filter { $0.origin != origin }).prefix(limit))
  }

  static func encode(_ list: [SavedDesktop]) -> Data {
    (try? JSONEncoder().encode(list)) ?? Data("[]".utf8)
  }

  /// Entries the app may no longer open are dropped rather than failing the whole list.
  static func decode(_ data: Data?) -> [SavedDesktop] {
    guard let data, let list = try? JSONDecoder().decode([SavedDesktop].self, from: data) else { return [] }
    return list
      .filter { Links.desktopOrigin(of: $0.origin) == $0.origin }
      .sorted { $0.lastUsedAt > $1.lastUsedAt }
  }
}
