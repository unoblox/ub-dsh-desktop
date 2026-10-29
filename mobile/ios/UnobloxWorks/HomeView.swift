import SwiftUI

/// The list of paired computers, and the way to pair a new one.
struct HomeView: View {
  @EnvironmentObject private var store: DesktopStore
  @State private var path: [Route] = []
  @State private var scanning = false
  @State private var pasting = false
  @State private var pastedLink = ""
  @State private var pasteError = false
  @State private var renaming: SavedDesktop?
  @State private var newName = ""
  @State private var forgetting: SavedDesktop?
  @State private var openedLastUsed = false

  var body: some View {
    NavigationStack(path: $path) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Image("Mark")
            .resizable()
            .frame(width: 56, height: 56)
            .accessibilityHidden(true)
          Text(verbatim: "unoblox works")
            .font(.system(size: 30, weight: .bold))
            .padding(.top, 20)
          Text("home.subtitle")
            .font(.body)
            .foregroundStyle(Color("Muted"))
            .padding(.top, 6)
          if store.desktops.isEmpty {
            emptyState.padding(.top, 32)
          } else {
            Text("home.computers")
              .font(.footnote.weight(.bold))
              .textCase(.uppercase)
              .foregroundStyle(Color("Muted"))
              .padding(.top, 32)
            VStack(spacing: 10) {
              ForEach(store.desktops) { desktop in row(desktop) }
            }
            .padding(.top, 10)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.top, 24)
      }
      .safeAreaInset(edge: .bottom) { actions }
      .background(Color("Paper"))
      .toolbar(.hidden, for: .navigationBar)
      .navigationDestination(for: Route.self) { route in
        switch route {
        case let .desktop(origin, start):
          DesktopScreen(origin: origin, start: start, onScan: { path = []; scanning = true })
        }
      }
    }
    .sheet(isPresented: $scanning) {
      ScannerScreen { link in
        scanning = false
        open(link.origin, link.url)
      } onPaste: {
        scanning = false
        pasting = true
      }
    }
    .alert("paste.title", isPresented: $pasting) {
      TextField(String(localized: "paste.hint"), text: $pastedLink)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .keyboardType(.URL)
      Button("cancel", role: .cancel) { pastedLink = "" }
      Button("open") {
        if let link = Links.parsePairing(pastedLink) {
          pastedLink = ""
          open(link.origin, link.url)
        } else {
          pasteError = true
        }
      }
    } message: {
      Text("paste.help")
    }
    .alert("link.invalid", isPresented: $pasteError) {
      Button("ok", role: .cancel) {}
    }
    .alert("rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
      TextField("", text: $newName)
      Button("cancel", role: .cancel) {}
      Button("save") { if let desktop = renaming { store.rename(desktop.origin, to: newName) } }
    }
    .confirmationDialog(
      forgetting.map { String(format: String(localized: "forget.title %@"), $0.name) } ?? "",
      isPresented: Binding(get: { forgetting != nil }, set: { if !$0 { forgetting = nil } }),
      titleVisibility: .visible
    ) {
      Button("forget", role: .destructive) {
        if let desktop = forgetting {
          store.forget(desktop.origin)
          DesktopScreen.clearCookies(for: desktop.origin)
        }
      }
    } message: {
      Text("forget.body")
    }
    .onAppear(perform: openLastUsedOnce)
  }

  private var emptyState: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("home.empty.title").font(.title3.weight(.bold))
      Text("home.empty.step1").padding(.top, 14)
      Text("home.empty.step2").padding(.top, 10)
      Text("home.empty.note")
        .font(.subheadline)
        .foregroundStyle(Color("Muted"))
        .padding(.top, 16)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
    .background(RoundedRectangle(cornerRadius: 16).fill(Color("Card")))
    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color("Line")))
  }

  private func row(_ desktop: SavedDesktop) -> some View {
    HStack(spacing: 14) {
      Button {
        open(desktop.origin, URL(string: "\(desktop.origin)/")!)
      } label: {
        HStack(spacing: 14) {
          Image(systemName: "desktopcomputer")
            .font(.title2)
            .frame(width: 28)
          VStack(alignment: .leading, spacing: 2) {
            Text(desktop.name).font(.headline).lineLimit(1)
            Text(detail(desktop)).font(.subheadline).foregroundStyle(Color("Muted")).lineLimit(2)
          }
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Menu {
        Button("rename") {
          newName = desktop.name
          renaming = desktop
        }
        Button("forget", role: .destructive) { forgetting = desktop }
      } label: {
        Image(systemName: "ellipsis")
          .frame(width: 44, height: 44)
          .foregroundStyle(Color("Muted"))
      }
      .accessibilityLabel(Text(String(format: String(localized: "more.options %@"), desktop.name)))
    }
    .padding(.leading, 18)
    .padding(.trailing, 4)
    .padding(.vertical, 12)
    .frame(minHeight: 72)
    .background(RoundedRectangle(cornerRadius: 16).fill(Color("Card")))
    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color("Line")))
  }

  private var actions: some View {
    VStack(spacing: 4) {
      Button {
        scanning = true
      } label: {
        Label("scan", systemImage: "qrcode.viewfinder")
          .font(.headline)
          .frame(maxWidth: .infinity, minHeight: 52)
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.capsule)
      .accessibilityIdentifier("scan")
      Button("paste.link") { pasting = true }
        .frame(minHeight: 44)
        .foregroundStyle(Color("Ink"))
    }
    .padding(.horizontal, 24)
    .padding(.top, 8)
    .padding(.bottom, 8)
    .background(Color("Paper"))
  }

  private func detail(_ desktop: SavedDesktop) -> String {
    let mode = Links.mode(of: desktop.origin) == .tunnel ? String(localized: "mode.tunnel") : String(localized: "mode.lan")
    let when = RelativeDateTimeFormatter().localizedString(for: desktop.lastUsedAt, relativeTo: Date())
    return "\(mode) · \(String(format: String(localized: "last.used %@"), when))"
  }

  private func open(_ origin: String, _ start: URL) {
    path = [.desktop(origin: origin, start: start)]
  }

  /// A cold start goes straight back to the computer used last; Back returns to this list.
  private func openLastUsedOnce() {
    guard !openedLastUsed else { return }
    openedLastUsed = true
    #if DEBUG
    // UI tests start the app with `-pairingLink <link>` in place of a scan.
    // Release builds ignore it, so only the camera or a paste can pair.
    if let raw = UserDefaults.standard.string(forKey: "pairingLink"), let link = Links.parsePairing(raw) {
      open(link.origin, link.url)
      return
    }
    if UserDefaults.standard.bool(forKey: "noAutoOpen") { return }
    #endif
    if let last = store.mostRecent { open(last.origin, URL(string: "\(last.origin)/")!) }
  }
}
