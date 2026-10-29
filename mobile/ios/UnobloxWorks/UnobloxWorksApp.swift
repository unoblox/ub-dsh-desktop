import SwiftUI

@main
struct UnobloxWorksApp: App {
  @StateObject private var store = DesktopStore()

  var body: some Scene {
    WindowGroup {
      HomeView()
        .environmentObject(store)
        .tint(Color("Ink"))
    }
  }
}

/// Where the app is: the list of computers, or one computer's page.
enum Route: Hashable {
  case desktop(origin: String, start: URL)
}
