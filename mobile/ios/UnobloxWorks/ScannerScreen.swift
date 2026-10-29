import AVFoundation
import SwiftUI

/// Reads the desktop's Connect Phone QR code. Frames are decoded on the phone and never stored.
struct ScannerScreen: View {
  let onLink: (PairingLink) -> Void
  let onPaste: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var status: LocalizedStringKey = "scan.help"
  @State private var blocked = false

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      if !blocked {
        CameraView { text in
          if let link = Links.parsePairing(text) {
            onLink(link)
            return true
          }
          status = "link.invalid"
          return false
        } onUnavailable: { denied in
          blocked = true
          status = denied ? "camera.denied" : "camera.unavailable"
        }
        .ignoresSafeArea()
        RoundedRectangle(cornerRadius: 24)
          .stroke(Color("Gold"), lineWidth: 3)
          .frame(width: 260, height: 260)
      }
      VStack(spacing: 0) {
        HStack {
          Button("close") { dismiss() }
            .foregroundStyle(.white)
            .frame(minHeight: 44)
          Spacer()
        }
        .padding(.horizontal, 16)
        Text("scan.title")
          .font(.title2.weight(.bold))
          .foregroundStyle(.white)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 24)
          .padding(.top, 8)
        Spacer()
        Text(status)
          .foregroundStyle(.white)
          .multilineTextAlignment(.center)
          .padding(14)
          .frame(maxWidth: .infinity)
          .background(RoundedRectangle(cornerRadius: 14).fill(.black.opacity(0.7)))
          .padding(.horizontal, 24)
        HStack(spacing: 12) {
          if blocked {
            Button("open.settings") {
              if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(.black)
          }
          Button("paste.link", action: onPaste)
            .foregroundStyle(.white)
            .frame(minHeight: 44)
        }
        .padding(.vertical, 16)
      }
    }
  }
}

/// AVFoundation's QR reader, which needs no third-party code.
private struct CameraView: UIViewControllerRepresentable {
  /// Returns true when the code was accepted, which stops scanning.
  let onCode: (String) -> Bool
  let onUnavailable: (_ denied: Bool) -> Void

  func makeUIViewController(context: Context) -> CameraController {
    CameraController(onCode: onCode, onUnavailable: onUnavailable)
  }

  func updateUIViewController(_ controller: CameraController, context: Context) {}
}

private final class CameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  private let onCode: (String) -> Bool
  private let onUnavailable: (Bool) -> Void
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "camera")
  private var preview: AVCaptureVideoPreviewLayer?
  private var lastRejected = ""
  private var done = false

  init(onCode: @escaping (String) -> Bool, onUnavailable: @escaping (Bool) -> Void) {
    self.onCode = onCode
    self.onUnavailable = onUnavailable
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { nil }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      configure()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async { granted ? self.configure() : self.onUnavailable(true) }
      }
    default:
      onUnavailable(true)
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    queue.async { [session] in session.stopRunning() }
  }

  private func configure() {
    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else { return onUnavailable(false) }
    session.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else { return onUnavailable(false) }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: .main)
    output.metadataObjectTypes = [.qr]
    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    layer.frame = view.bounds
    view.layer.addSublayer(layer)
    preview = layer
    queue.async { [session] in session.startRunning() }
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard !done, let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
    if onCode(code) {
      done = true
      UINotificationFeedbackGenerator().notificationOccurred(.success)
      queue.async { [session] in session.stopRunning() }
    } else if code != lastRejected {
      // Keep scanning: the camera may be on some other code by mistake.
      lastRejected = code
      UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
  }
}
