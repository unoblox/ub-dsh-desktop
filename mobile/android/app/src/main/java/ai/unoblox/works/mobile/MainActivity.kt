package ai.unoblox.works.mobile

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** The list of paired computers, and the way to pair a new one. */
class MainActivity : AppCompatActivity() {
  private lateinit var store: DesktopStore

  private val scan = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val link = result.data?.getStringExtra(ScanActivity.EXTRA_LINK) ?: return@registerForActivityResult
    Links.parsePairing(link)?.let(::pair)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    store = DesktopStore(this)
    val root = findViewById<View>(R.id.root)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    findViewById<MaterialButton>(R.id.scanButton).setOnClickListener {
      scan.launch(Intent(this, ScanActivity::class.java))
    }
    findViewById<MaterialButton>(R.id.pasteButton).setOnClickListener { askForLink() }

    if (intent?.getBooleanExtra(EXTRA_SCAN, false) == true) {
      scan.launch(Intent(this, ScanActivity::class.java))
      return
    }
    // A launch from the home screen goes straight back to the computer used
    // last; Back from there returns to this list.
    if (savedInstanceState == null && intent?.action == Intent.ACTION_MAIN) {
      store.mostRecent()?.let { open(it.origin) }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (intent.getBooleanExtra(EXTRA_SCAN, false)) scan.launch(Intent(this, ScanActivity::class.java))
  }

  override fun onResume() {
    super.onResume()
    render()
  }

  private fun render() {
    val desktops = store.all()
    findViewById<View>(R.id.emptyState).visibility = if (desktops.isEmpty()) View.VISIBLE else View.GONE
    findViewById<View>(R.id.computersLabel).visibility = if (desktops.isEmpty()) View.GONE else View.VISIBLE
    val list = findViewById<LinearLayout>(R.id.desktopList)
    list.removeAllViews()
    val inflater = LayoutInflater.from(this)
    for (desktop in desktops) {
      val row = inflater.inflate(R.layout.item_desktop, list, false)
      row.findViewById<TextView>(R.id.name).text = desktop.name
      val mode = if (Links.modeOf(desktop.origin) == ConnectionMode.TUNNEL) R.string.mode_tunnel else R.string.mode_lan
      val when_ = DateUtils.getRelativeTimeSpanString(desktop.lastUsedAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
      row.findViewById<TextView>(R.id.detail).text =
        getString(R.string.desktop_detail, getString(mode), getString(R.string.last_used, when_))
      row.setOnClickListener { open(desktop.origin) }
      val more = row.findViewById<ImageButton>(R.id.more)
      more.contentDescription = getString(R.string.more_options, desktop.name)
      more.setOnClickListener { showMenu(it, desktop) }
      list.addView(row)
    }
  }

  private fun showMenu(anchor: View, desktop: SavedDesktop) {
    PopupMenu(this, anchor).apply {
      menu.add(0, 1, 0, R.string.rename)
      menu.add(0, 2, 1, R.string.forget)
      setOnMenuItemClickListener { item ->
        when (item.itemId) {
          1 -> rename(desktop)
          2 -> forget(desktop)
        }
        true
      }
    }.show()
  }

  private fun rename(desktop: SavedDesktop) {
    val input = EditText(this).apply {
      setText(desktop.name)
      setSingleLine()
      selectAll()
    }
    MaterialAlertDialogBuilder(this)
      .setTitle(R.string.rename)
      .setView(padded(input))
      .setNegativeButton(R.string.cancel, null)
      .setPositiveButton(R.string.save) { _, _ ->
        store.rename(desktop.origin, input.text.toString())
        render()
      }
      .show()
  }

  private fun forget(desktop: SavedDesktop) {
    MaterialAlertDialogBuilder(this)
      .setTitle(getString(R.string.forget_title, desktop.name))
      .setMessage(R.string.forget_body)
      .setNegativeButton(R.string.cancel, null)
      .setPositiveButton(R.string.forget) { _, _ ->
        store.forget(desktop.origin)
        DesktopActivity.clearCookies(desktop.origin)
        render()
      }
      .show()
  }

  private fun askForLink() {
    val input = EditText(this).apply {
      hint = getString(R.string.paste_hint)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
      setSingleLine()
    }
    val help = TextView(this).apply {
      text = getString(R.string.paste_help)
      setPadding(0, dp(8), 0, 0)
    }
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      addView(input)
      addView(help)
    }
    val dialog = MaterialAlertDialogBuilder(this)
      .setTitle(R.string.paste_title)
      .setView(padded(content))
      .setNegativeButton(R.string.cancel, null)
      .setPositiveButton(R.string.open, null)
      .show()
    // Validate before closing, so a mistyped link can be corrected in place.
    dialog.getButton(android.content.DialogInterface.BUTTON_POSITIVE).setOnClickListener {
      val link = Links.parsePairing(input.text.toString())
      if (link == null) {
        input.error = getString(R.string.invalid_link)
      } else {
        dialog.dismiss()
        pair(link)
      }
    }
  }

  private fun pair(link: PairingLink) {
    startActivity(DesktopActivity.intent(this, link.origin, link.url))
  }

  private fun open(origin: String) {
    startActivity(DesktopActivity.intent(this, origin, "$origin/"))
  }

  private fun padded(view: View): View = FrameLayout(this).apply {
    setPadding(dp(24), dp(8), dp(24), 0)
    addView(view)
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    /** Set by a computer screen's Scan again: return to this list and open the scanner. */
    const val EXTRA_SCAN = "scan"
  }
}
