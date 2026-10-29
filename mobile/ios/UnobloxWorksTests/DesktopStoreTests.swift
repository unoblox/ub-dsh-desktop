import XCTest
@testable import UnobloxWorks

final class DesktopStoreTests: XCTestCase {
  private let lan = "http://192.168.1.20:43127"
  private let tunnel = "https://quiet-river-1234.trycloudflare.com"

  func testMostRecentFirstAndNoDuplicates() {
    var list = DesktopStore.upsert([], origin: lan, now: Date(timeIntervalSince1970: 1))
    list = DesktopStore.upsert(list, origin: tunnel, now: Date(timeIntervalSince1970: 2))
    list = DesktopStore.upsert(list, origin: lan, now: Date(timeIntervalSince1970: 3))
    XCTAssertEqual(list.map(\.origin), [lan, tunnel])
    XCTAssertEqual(list.first?.name, "192.168.1.20")
  }

  func testKeepsAtMostTwenty() {
    var list: [SavedDesktop] = []
    for index in 1...25 {
      list = DesktopStore.upsert(list, origin: "http://10.0.0.\(index):43127", now: Date(timeIntervalSince1970: Double(index)))
    }
    XCTAssertEqual(list.count, 20)
    XCTAssertEqual(list.first?.origin, "http://10.0.0.25:43127")
  }

  func testRoundTripsAndDropsEntriesItMayNotOpen() {
    let list = DesktopStore.upsert(DesktopStore.upsert([], origin: lan, now: Date(timeIntervalSince1970: 1)), origin: tunnel, now: Date(timeIntervalSince1970: 2))
    XCTAssertEqual(DesktopStore.decode(DesktopStore.encode(list)), list)
    let tampered = [SavedDesktop(origin: "https://example.com", name: "x", lastUsedAt: Date()), list[1]]
    XCTAssertEqual(DesktopStore.decode(DesktopStore.encode(tampered)), [list[1]])
    XCTAssertEqual(DesktopStore.decode(Data("nope".utf8)), [])
  }

  func testPersistsAcrossInstances() {
    let defaults = UserDefaults(suiteName: "DesktopStoreTests")!
    defaults.removePersistentDomain(forName: "DesktopStoreTests")
    let store = DesktopStore(defaults: defaults)
    store.touch(lan)
    store.rename(lan, to: "Studio Mac")
    XCTAssertEqual(DesktopStore(defaults: defaults).desktops.map(\.name), ["Studio Mac"])
    store.forget(lan)
    XCTAssertEqual(DesktopStore(defaults: defaults).desktops, [])
  }
}
