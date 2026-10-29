import XCTest
@testable import UnobloxWorks

final class LinksTests: XCTestCase {
  private struct Fixtures: Decodable {
    struct Accept: Decodable { let link, origin, token, mode: String }
    struct Reject: Decodable { let link, why: String }
    let tunnelHostSuffixes: [String]
    let excludedTunnelHosts: [String]
    let accept: [Accept]
    let reject: [Reject]
  }

  private func fixtures() throws -> Fixtures {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "pairing-links", withExtension: "json"))
    return try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
  }

  func testAcceptsEveryLinkTheDesktopProduces() throws {
    for item in try fixtures().accept {
      let link = try XCTUnwrap(Links.parsePairing(item.link), "rejected \(item.link)")
      XCTAssertEqual(link.origin, item.origin)
      XCTAssertEqual(link.token, item.token)
      XCTAssertEqual(link.mode.rawValue, item.mode)
      XCTAssertEqual(link.url.absoluteString, "\(item.origin)/pair?token=\(item.token)")
    }
  }

  func testRejectsEverythingElse() throws {
    for item in try fixtures().reject {
      XCTAssertNil(Links.parsePairing(item.link), "accepted \(item.link) (\(item.why))")
    }
  }

  func testTunnelHostsMatchTheSharedList() throws {
    let data = try fixtures()
    for suffix in data.tunnelHostSuffixes {
      XCTAssertTrue(Links.isTunnelHost("abc" + suffix))
      XCTAssertFalse(Links.isTunnelHost(String(suffix.dropFirst())))
    }
    for host in data.excludedTunnelHosts { XCTAssertFalse(Links.isTunnelHost(host)) }
  }

  func testKeepsNavigationOnThePairedComputer() {
    let origin = "http://192.168.1.20:43127"
    XCTAssertTrue(Links.isSameOrigin(URL(string: "http://192.168.1.20:43127/")!, origin))
    XCTAssertTrue(Links.isSameOrigin(URL(string: "http://192.168.1.20:43127/reconnect?x=1")!, origin))
    XCTAssertFalse(Links.isSameOrigin(URL(string: "http://192.168.1.20:43128/")!, origin))
    XCTAssertFalse(Links.isSameOrigin(URL(string: "https://192.168.1.20:43127/")!, origin))
    XCTAssertFalse(Links.isSameOrigin(URL(string: "https://unoblox.ai/")!, origin))
    XCTAssertFalse(Links.isSameOrigin(URL(string: "javascript:alert(1)")!, origin))
  }

  func testPrivateAddressesMatchTheBridge() {
    for address in ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1"] {
      XCTAssertTrue(Links.isPrivateIPv4(address), address)
    }
    for address in ["127.0.0.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "8.8.8.8", "100.64.0.1", "10.0.0.256", "10.0.0", "1.2.3.4.5"] {
      XCTAssertFalse(Links.isPrivateIPv4(address), address)
    }
  }
}
