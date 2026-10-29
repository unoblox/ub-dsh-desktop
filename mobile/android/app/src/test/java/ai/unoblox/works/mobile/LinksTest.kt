package ai.unoblox.works.mobile

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinksTest {
  private val fixtures = JSONObject(File(System.getProperty("pairingFixtures")!!).readText())

  @Test
  fun acceptsEveryLinkTheDesktopProduces() {
    val accept = fixtures.getJSONArray("accept")
    for (index in 0 until accept.length()) {
      val case = accept.getJSONObject(index)
      val link = Links.parsePairing(case.getString("link"))
      requireNotNull(link) { "rejected ${case.getString("link")}" }
      assertEquals(case.getString("origin"), link.origin)
      assertEquals(case.getString("token"), link.token)
      assertEquals(ConnectionMode.valueOf(case.getString("mode").uppercase()), link.mode)
      assertEquals("${link.origin}/pair?token=${link.token}", link.url)
    }
  }

  @Test
  fun rejectsEverythingElse() {
    val reject = fixtures.getJSONArray("reject")
    for (index in 0 until reject.length()) {
      val case = reject.getJSONObject(index)
      assertNull("accepted ${case.getString("link")} (${case.getString("why")})", Links.parsePairing(case.getString("link")))
    }
  }

  @Test
  fun tunnelHostsMatchTheSharedList() {
    val suffixes = fixtures.getJSONArray("tunnelHostSuffixes")
    for (index in 0 until suffixes.length()) {
      assertTrue(Links.isTunnelHost("abc" + suffixes.getString(index)))
      assertFalse(Links.isTunnelHost(suffixes.getString(index).removePrefix(".")))
    }
    val excluded = fixtures.getJSONArray("excludedTunnelHosts")
    for (index in 0 until excluded.length()) assertFalse(Links.isTunnelHost(excluded.getString(index)))
  }

  @Test
  fun keepsNavigationOnThePairedComputer() {
    val origin = "http://192.168.1.20:43127"
    assertTrue(Links.isSameOrigin("http://192.168.1.20:43127/", origin))
    assertTrue(Links.isSameOrigin("http://192.168.1.20:43127/reconnect?x=1", origin))
    assertFalse(Links.isSameOrigin("http://192.168.1.20:43128/", origin))
    assertFalse(Links.isSameOrigin("https://192.168.1.20:43127/", origin))
    assertFalse(Links.isSameOrigin("http://192.168.1.21:43127/", origin))
    assertFalse(Links.isSameOrigin("https://unoblox.ai/", origin))
    assertFalse(Links.isSameOrigin("javascript:alert(1)", origin))
  }

  @Test
  fun privateAddressesMatchTheBridge() {
    for (address in listOf("10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1")) {
      assertTrue(address, Links.isPrivateIpv4(address))
    }
    for (address in listOf("127.0.0.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "8.8.8.8", "100.64.0.1", "10.0.0.256", "10.0.0")) {
      assertFalse(address, Links.isPrivateIpv4(address))
    }
  }
}
