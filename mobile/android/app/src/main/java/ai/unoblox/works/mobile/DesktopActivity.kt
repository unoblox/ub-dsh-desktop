package ai.unoblox.works.mobile

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.button.MaterialButton

/**
 * Shows the phone page that the desktop app serves for one paired computer.
 *
 * The page is the desktop's own (src/main/mobile/lan-mobile-pages.ts), so
 * phone and computer never disagree about the API between them. The page gets
 * no native bridge: nothing on it can reach the phone beyond what any web page
 * can, and links that leave the computer open in the browser.
 */
class DesktopActivity : AppCompatActivity() {
  private lateinit var webView: WebView
  private lateinit var store: DesktopStore
  private lateinit var origin: String
  private lateinit var errorView: View
  private lateinit var progress: ProgressBar
  private var mainFrameFailed = false

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val start = intent.getStringExtra(EXTRA_URL)
    val requested = intent.getStringExtra(EXTRA_ORIGIN)
    val validOrigin = requested?.let(Links::desktopOriginOf)
    if (start == null || validOrigin == null || validOrigin != requested || !Links.isSameOrigin(start, validOrigin)) {
      finish()
      return
    }
    origin = validOrigin
    store = DesktopStore(this)
    setContentView(R.layout.activity_desktop)
    webView = findViewById(R.id.webView)
    errorView = findViewById(R.id.errorView)
    progress = findViewById(R.id.progress)

    // The page lays itself out for the visible area only; the keyboard and
    // system bars are padding, so the composer stays above the keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }

    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setSupportMultipleWindows(false)
      userAgentString = "$userAgentString $USER_AGENT_TOKEN/${BuildConfig.VERSION_NAME}"
    }
    CookieManager.getInstance().setAcceptCookie(true)
    webView.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) {
        progress.visibility = if (newProgress < 100) View.VISIBLE else View.GONE
        progress.progress = newProgress
      }
    }
    webView.webViewClient = Client()

    findViewById<MaterialButton>(R.id.retryButton).setOnClickListener { reload() }
    findViewById<MaterialButton>(R.id.scanAgainButton).setOnClickListener {
      startActivity(
        Intent(this, MainActivity::class.java)
          .putExtra(MainActivity.EXTRA_SCAN, true)
          .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      )
      finish()
    }
    findViewById<MaterialButton>(R.id.listButton).setOnClickListener { finish() }

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (errorView.visibility != View.VISIBLE && webView.canGoBack()) webView.goBack() else finish()
      }
    })

    if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
      webView.loadUrl(start)
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    if (::webView.isInitialized) webView.saveState(outState)
  }

  override fun onResume() {
    super.onResume()
    if (::webView.isInitialized) webView.onResume()
  }

  override fun onPause() {
    if (::webView.isInitialized) webView.onPause()
    CookieManager.getInstance().flush()
    super.onPause()
  }

  override fun onDestroy() {
    if (::webView.isInitialized) {
      (webView.parent as? FrameLayout)?.removeView(webView)
      webView.destroy()
    }
    super.onDestroy()
  }

  private fun reload() {
    errorView.visibility = View.GONE
    webView.visibility = View.VISIBLE
    val current = webView.url
    if (current != null && Links.isSameOrigin(current, origin) && !current.contains("/pair?")) {
      webView.reload()
    } else {
      webView.loadUrl("$origin/")
    }
  }

  private fun showError(expiredCode: Boolean) {
    val name = store.all().firstOrNull { it.origin == origin }?.name ?: DesktopStore.defaultName(origin)
    findViewById<TextView>(R.id.errorTitle).text =
      if (expiredCode) getString(R.string.code_expired_title) else getString(R.string.unreachable_title, name)
    findViewById<TextView>(R.id.errorBody).text = getString(
      when {
        expiredCode -> R.string.code_expired_body
        Links.modeOf(origin) == ConnectionMode.TUNNEL -> R.string.unreachable_tunnel
        else -> R.string.unreachable_lan
      }
    )
    errorView.visibility = View.VISIBLE
    webView.visibility = View.INVISIBLE
  }

  private inner class Client : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val url = request.url.toString()
      if (Links.isSameOrigin(url, origin)) return false
      // The desktop moves a phone from its Wi-Fi address to its internet link
      // with a redirect when the link is on; that is still the same computer.
      val redirectedOrigin = Links.desktopOriginOf(url)
      if (request.isForMainFrame && request.isRedirect && redirectedOrigin != null) {
        origin = redirectedOrigin
        return false
      }
      val scheme = request.url.scheme?.lowercase()
      if (scheme == "http" || scheme == "https") {
        try {
          startActivity(Intent(Intent.ACTION_VIEW, request.url).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
          // No browser installed: there is nowhere to send the link, and it
          // must not open in here.
        }
      }
      return true
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
      mainFrameFailed = false
    }

    override fun onPageFinished(view: WebView, url: String) {
      if (!mainFrameFailed && Links.isSameOrigin(url, origin)) store.touch(origin)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      if (!request.isForMainFrame) return
      mainFrameFailed = true
      showError(expiredCode = false)
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
      if (!request.isForMainFrame) return
      // The bridge answers 401 on /pair once a code has been used or has
      // expired; other errors are its own pages and stay visible.
      if (response.statusCode == 401 && request.url.path == "/pair") {
        mainFrameFailed = true
        showError(expiredCode = true)
      }
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      // The renderer was killed (usually for memory). Start this screen again
      // rather than letting the whole app crash with it.
      finish()
      startActivity(intent(this@DesktopActivity, origin, "$origin/"))
      return true
    }
  }

  companion object {
    const val EXTRA_ORIGIN = "origin"
    const val EXTRA_URL = "url"
    /** Lets the desktop page tell the app from a phone browser; it carries no identity. */
    const val USER_AGENT_TOKEN = "unobloxWorksApp"

    fun intent(context: Context, origin: String, url: String): Intent =
      Intent(context, DesktopActivity::class.java).putExtra(EXTRA_ORIGIN, origin).putExtra(EXTRA_URL, url)

    /** Drops the bridge's cookie for [origin], so a forgotten computer must be paired again. */
    fun clearCookies(origin: String) {
      val manager = CookieManager.getInstance()
      val cookies = manager.getCookie(origin) ?: return
      for (cookie in cookies.split(';')) {
        val name = cookie.substringBefore('=').trim()
        // Internet-link cookies are Secure, and only a Secure write replaces them.
        val secure = if (origin.startsWith("https://")) "; Secure" else ""
        if (name.isNotEmpty()) manager.setCookie(origin, "$name=; Max-Age=0; Path=/$secure")
      }
      manager.flush()
    }
  }
}
