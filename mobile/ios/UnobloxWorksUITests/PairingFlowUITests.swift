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
    // The composer only exists on the page for a paired phone.
    XCTAssertTrue(app.webViews.textViews.firstMatch.waitForExistence(timeout: 45), "the paired page did not load")

    // A cold start goes back to that computer, still paired.
    app.terminate()
    let again = XCUIApplication()
    again.launch()
    XCTAssertTrue(again.webViews.textViews.firstMatch.waitForExistence(timeout: 45), "the computer did not reopen paired")
  }

  func testShowsPairingStepsWithoutAComputer() {
    let app = XCUIApplication()
    app.launchArguments = ["-noAutoOpen", "YES"]
    app.launch()
    XCTAssertTrue(app.buttons["scan"].waitForExistence(timeout: 10))
  }
}
