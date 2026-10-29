package ai.unoblox.works.mobile

import android.content.Intent
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Pairs with the desktop's real phone bridge (mobile/e2e/bridge-server.ts),
 * which CI starts on the emulator's host and passes in as `pairingLink`.
 */
@RunWith(AndroidJUnit4::class)
class PairingFlowTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

  @Test
  fun pairsThenReopensWithoutScanningAgain() {
    val raw = InstrumentationRegistry.getArguments().getString("pairingLink")
    assumeTrue("no pairingLink argument; run through the CI workflow", raw != null)
    val link = requireNotNull(Links.parsePairing(raw!!)) { "the bridge produced a link the app refuses: $raw" }

    ActivityScenario.launch<DesktopActivity>(DesktopActivity.intent(context, link.origin, link.url)).use { scenario ->
      assertEquals("unoblox works", waitForScript(scenario, "document.getElementById('composer') ? document.title : ''"))
    }
    assertNotNull("the bridge's session cookie was not kept", CookieManager.getInstance().getCookie(link.origin))
    assertEquals(link.origin, DesktopStore(context).mostRecent()?.origin)

    // A cold start from the launcher goes back to that computer, still paired:
    // the composer only exists on the page for a paired phone.
    val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClass(context, MainActivity::class.java)
    ActivityScenario.launch<MainActivity>(launch).use {
      val desktop = waitForActivity<DesktopActivity>()
      assertEquals("unoblox works", waitForScript(desktop, "document.getElementById('composer') ? document.title : ''"))
    }
  }

  @Test
  fun refusesAComputerAddressItMayNotOpen() {
    val intent = DesktopActivity.intent(context, "https://example.com", "https://example.com/")
    ActivityScenario.launch<DesktopActivity>(intent).use { scenario ->
      assertEquals(Lifecycle.State.DESTROYED, scenario.state)
    }
  }

  private fun waitForScript(scenario: ActivityScenario<DesktopActivity>, script: String): String {
    var activity: DesktopActivity? = null
    scenario.onActivity { activity = it }
    return waitForScript(requireNotNull(activity), script)
  }

  /** Polls [script] in the page until it returns a non-empty string, for up to 30 s. */
  private fun waitForScript(activity: DesktopActivity, script: String): String {
    val deadline = System.currentTimeMillis() + 30_000
    while (System.currentTimeMillis() < deadline) {
      val latch = CountDownLatch(1)
      var value = ""
      activity.runOnUiThread {
        activity.findViewById<WebView>(R.id.webView).evaluateJavascript(script) { result ->
          value = result?.trim('"') ?: ""
          latch.countDown()
        }
      }
      latch.await(5, TimeUnit.SECONDS)
      if (value.isNotEmpty() && value != "null") return value
      Thread.sleep(500)
    }
    throw AssertionError("the page did not show the paired view within 30 s")
  }

  private inline fun <reified T : android.app.Activity> waitForActivity(): T {
    val deadline = System.currentTimeMillis() + 15_000
    while (System.currentTimeMillis() < deadline) {
      var found: T? = null
      InstrumentationRegistry.getInstrumentation().runOnMainSync {
        found = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
          .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)
          .filterIsInstance<T>().firstOrNull()
      }
      found?.let { return it }
      Thread.sleep(250)
    }
    throw AssertionError("${T::class.java.simpleName} did not open")
  }
}
