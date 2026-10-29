package ai.unoblox.works.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.button.MaterialButton
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Reads the desktop's Connect Phone QR code. Frames are decoded on the phone and never stored. */
class ScanActivity : AppCompatActivity() {
  private lateinit var analysis: ExecutorService
  private lateinit var status: TextView
  private var finished = false
  private var lastRejected = ""

  private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) startCamera() else showBlocked(R.string.camera_denied, settings = true)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_scan)
    analysis = Executors.newSingleThreadExecutor()
    status = findViewById(R.id.scanStatus)
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.chrome)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    findViewById<MaterialButton>(R.id.closeButton).setOnClickListener { finish() }
    findViewById<MaterialButton>(R.id.settingsButton).setOnClickListener {
      startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      startCamera()
    } else {
      permission.launch(Manifest.permission.CAMERA)
    }
  }

  override fun onResume() {
    super.onResume()
    // Coming back from Settings with the permission now granted.
    if (findViewById<View>(R.id.settingsButton).visibility == View.VISIBLE &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    ) {
      findViewById<View>(R.id.settingsButton).visibility = View.GONE
      startCamera()
    }
  }

  override fun onDestroy() {
    analysis.shutdown()
    super.onDestroy()
  }

  private fun startCamera() {
    status.setText(R.string.scan_help)
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
      val provider = try {
        future.get()
      } catch (_: Exception) {
        showBlocked(R.string.camera_unavailable, settings = false)
        return@addListener
      }
      val preview = Preview.Builder().build().also {
        it.surfaceProvider = findViewById<PreviewView>(R.id.preview).surfaceProvider
      }
      val reader = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true))
      }
      val imageAnalysis = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
      imageAnalysis.setAnalyzer(analysis) { image -> decode(reader, image) }
      try {
        provider.unbindAll()
        provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis)
      } catch (_: Exception) {
        showBlocked(R.string.camera_unavailable, settings = false)
      }
    }, ContextCompat.getMainExecutor(this))
  }

  private fun decode(reader: MultiFormatReader, image: ImageProxy) {
    try {
      if (finished) return
      // The Y plane alone is a greyscale picture, which is all a QR code needs.
      val plane = image.planes[0]
      val buffer = plane.buffer
      val bytes = ByteArray(buffer.remaining())
      buffer.get(bytes)
      val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
      val text = try {
        reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
      } catch (_: NotFoundException) {
        null
      } catch (_: ReaderException) {
        null
      } finally {
        reader.reset()
      }
      if (text != null) runOnUiThread { handle(text) }
    } finally {
      image.close()
    }
  }

  private fun handle(text: String) {
    if (finished) return
    val link = Links.parsePairing(text)
    if (link == null) {
      // Keep scanning: the camera may be on some other code by mistake.
      if (text != lastRejected) {
        lastRejected = text
        status.setText(R.string.invalid_link)
      }
      return
    }
    finished = true
    setResult(RESULT_OK, Intent().putExtra(EXTRA_LINK, link.url))
    finish()
  }

  private fun showBlocked(message: Int, settings: Boolean) {
    status.setText(message)
    findViewById<View>(R.id.settingsButton).visibility = if (settings) View.VISIBLE else View.GONE
  }

  companion object {
    const val EXTRA_LINK = "link"
  }
}
