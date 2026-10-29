import SwiftUI
import WebKit

/// What the screen shows besides the page.
enum DesktopProblem: Equatable {
  case unreachable
  case expiredCode
}

/// Shows the phone page that the desktop app serves for one paired computer.
///
/// The page is the desktop's own (src/main/mobile/lan-mobile-pages.ts), so
/// phone and computer never disagree about the API between them. The page gets
/// no native bridge: nothing on it can reach the phone beyond what any web page
/// can, and links that leave the computer open in Safari.
struct DesktopScreen: View {
  let origin: String
  let start: URL
  let onScan: () -> Void

  @EnvironmentObject private var store: DesktopStore
  @StateObject private var model = DesktopModel()

  var body: some View {
    ZStack(alignment: .top) {
      DesktopWebView(model: model)
        .opacity(model.problem == nil ? 1 : 0)
      if model.loading {
        ProgressView(value: model.progress)
          .progressViewStyle(.linear)
          .tint(Color("Gold"))
      }
      if let problem = model.problem {
        problemView(problem)
      }
    }
    .background(Color("Paper"))
    .navigationTitle(store.name(of: model.origin ?? origin))
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          model.reload()
        } label: {
          Image(systemName: "arrow.clockwise")
        }
        .accessibilityLabel(Text("retry"))
      }
    }
    .onAppear {
      model.start(origin: origin, url: start) { loadedOrigin in store.touch(loadedOrigin) }
    }
  }

  private func problemView(_ problem: DesktopProblem) -> some View {
    let current = model.origin ?? origin
    let title = problem == .expiredCode
      ? String(localized: "code.expired.title")
      : String(format: String(localized: "unreachable.title %@"), store.name(of: current))
    let body: LocalizedStringKey = problem == .expiredCode
      ? "code.expired.body"
      : Links.mode(of: current) == .tunnel ? "unreachable.tunnel" : "unreachable.lan"
    return VStack(spacing: 0) {
      Image(systemName: "desktopcomputer")
        .font(.system(size: 44))
        .foregroundStyle(Color("Muted"))
      Text(title)
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
        .padding(.top, 16)
      Text(body)
        .foregroundStyle(Color("Muted"))
        .multilineTextAlignment(.center)
        .padding(.top, 8)
      Button {
        model.reload()
      } label: {
        Text("retry").font(.headline).frame(minWidth: 200, minHeight: 50)
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.capsule)
      .padding(.top, 24)
      Button("scan.again", action: onScan)
        .frame(minHeight: 44)
        .foregroundStyle(Color("Ink"))
        .padding(.top, 4)
    }
    .frame(maxWidth: 420)
    .padding(32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color("Paper"))
  }

  /// Drops the bridge's cookies for `origin`, so a forgotten computer must be paired again.
  static func clearCookies(for origin: String) {
    guard let host = URL(string: origin)?.host else { return }
    let cookies = WKWebsiteDataStore.default().httpCookieStore
    cookies.getAllCookies { all in
      for cookie in all where cookie.domain == host { cookies.delete(cookie) }
    }
  }
}

/// Owns the web view so it survives SwiftUI redraws, and follows its navigation.
@MainActor
final class DesktopModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
  /// Lets the desktop page tell the app from a phone browser; it carries no identity.
  static let userAgentToken = "unobloxWorksApp"

  @Published var problem: DesktopProblem?
  @Published var loading = false
  @Published var progress = 0.0
  @Published private(set) var origin: String?

  let webView: WKWebView
  private var onLoaded: ((String) -> Void)?
  private var started = false
  private var observations: [NSKeyValueObservation] = []

  override init() {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    configuration.applicationNameForUserAgent = "\(Self.userAgentToken)/\(version)"
    configuration.allowsInlineMediaPlayback = true
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isOpaque = false
    webView.backgroundColor = UIColor(named: "Paper")
    webView.scrollView.contentInsetAdjustmentBehavior = .automatic
    webView.allowsBackForwardNavigationGestures = false
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    // Progress can stop changing before loading ends, so both are observed:
    // otherwise the bar stays on screen at 100%.
    observations = [
      webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
        Task { @MainActor in self?.progress = view.estimatedProgress }
      },
      webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
        Task { @MainActor in self?.loading = view.isLoading }
      }
    ]
  }

  func start(origin: String, url: URL, onLoaded: @escaping (String) -> Void) {
    guard !started, Links.desktopOrigin(of: origin) == origin, Links.isSameOrigin(url, origin) else { return }
    started = true
    self.origin = origin
    self.onLoaded = onLoaded
    webView.load(URLRequest(url: url))
  }

  func reload() {
    guard let origin else { return }
    problem = nil
    if let current = webView.url, Links.isSameOrigin(current, origin), current.path != "/pair" {
      webView.reload()
    } else {
      webView.load(URLRequest(url: URL(string: "\(origin)/")!))
    }
  }

  // MARK: WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url, let origin else { return decisionHandler(.cancel) }
    if Links.isSameOrigin(url, origin) { return decisionHandler(.allow) }
    // The desktop moves a phone from its Wi-Fi address to its internet link
    // with a redirect when the link is on; that is still the same computer.
    if action.targetFrame?.isMainFrame == true, action.navigationType == .other,
       let moved = Links.desktopOrigin(of: url) {
      self.origin = moved
      return decisionHandler(.allow)
    }
    if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
      UIApplication.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    // The bridge answers 401 on /pair once a code has been used or has
    // expired; other errors are its own pages and stay visible.
    if response.isForMainFrame, let http = response.response as? HTTPURLResponse,
       http.statusCode == 401, http.url?.path == "/pair" {
      problem = .expiredCode
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    problem = nil
    if let url = webView.url, let origin, Links.isSameOrigin(url, origin) { onLoaded?(origin) }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    // iOS reclaimed the page's process (usually for memory); load it again.
    reload()
  }

  private func fail(_ error: Error) {
    let code = (error as NSError).code
    // Cancelled loads are our own (a refused link, or a newer load); a policy
    // change is the expired-code response cancelled above.
    if code == NSURLErrorCancelled || code == 102 /* WebKitErrorFrameLoadInterruptedByPolicyChange */ { return }
    if problem == nil { problem = .unreachable }
  }

  // MARK: WKUIDelegate

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    // target=_blank links: the desktop's own pages load in place, the rest go to Safari.
    if let url = action.request.url, let origin {
      if Links.isSameOrigin(url, origin) {
        webView.load(action.request)
      } else if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
        UIApplication.shared.open(url)
      }
    }
    return nil
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    present(message, cancellable: false) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    present(message, cancellable: true, completion: completionHandler)
  }

  private func present(_ message: String, cancellable: Bool, completion: @escaping (Bool) -> Void) {
    guard let presenter = webView.window?.rootViewController?.topmost else { return completion(false) }
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    if cancellable {
      alert.addAction(UIAlertAction(title: String(localized: "cancel"), style: .cancel) { _ in completion(false) })
    }
    alert.addAction(UIAlertAction(title: String(localized: "ok"), style: .default) { _ in completion(true) })
    presenter.present(alert, animated: true)
  }
}

private extension UIViewController {
  var topmost: UIViewController { presentedViewController?.topmost ?? self }
}

struct DesktopWebView: UIViewRepresentable {
  let model: DesktopModel

  func makeUIView(context: Context) -> WKWebView { model.webView }

  func updateUIView(_ view: WKWebView, context: Context) {}
}
