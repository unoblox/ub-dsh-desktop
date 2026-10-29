import XCTest

/// Pairs with the desktop's real phone bridge (mobile/e2e/bridge-server.ts),
/// which CI starts on the simulator's host and passes in as PAIRING_LINK.
/// The link uses a private address over plain HTTP, so this also proves App
/// Transport Security lets the web view reach a computer on the local network.
final class PairingFlowUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  func testPairsThenReopensWithoutScanningAgain() throws {
    let link = try XCTUnwrap(ProcessInfo.processInfo.environment["PAIRING_LINK"], "run through the CI workflow")

    let app = XCUIApplication()
    app.launchArguments = ["-pairingLink", link]
    app.launch()
    expectPairedPage(app, "the paired page did not load")

    // A cold start goes back to that computer, still paired.
    app.terminate()
    let again = XCUIApplication()
    again.launch()
    expectPairedPage(again, "the computer did not reopen paired")
  }

  /// The composer only exists on the page for a paired phone. On failure the
  /// message carries what was on screen, so a CI log shows why.
  private func expectPairedPage(_ app: XCUIApplication, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
    if app.webViews.textViews.firstMatch.waitForExistence(timeout: 45) { return }
    XCTFail("\(message). On screen:\n\(app.debugDescription)", file: file, line: line)
  }

  func testShowsPairingStepsWithoutAComputer() {
    let app = XCUIApplication()
    app.launchArguments = ["-noAutoOpen", "YES"]
    app.launch()
    XCTAssertTrue(app.buttons["scan"].waitForExistence(timeout: 10))
  }
}
