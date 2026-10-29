package ai.unoblox.works.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class DesktopStoreTest {
  private val lan = "http://192.168.1.20:43127"
  private val tunnel = "https://quiet-river-1234.trycloudflare.com"

  @Test
  fun mostRecentFirstAndNoDuplicates() {
    var list = DesktopStore.upsert(emptyList(), lan, 1)
    list = DesktopStore.upsert(list, tunnel, 2)
    list = DesktopStore.upsert(list, lan, 3)
    assertEquals(listOf(lan, tunnel), list.map { it.origin })
    assertEquals(3L, list.first().lastUsedAt)
    assertEquals("192.168.1.20", list.first().name)
  }

  @Test
  fun keepsTheNameWhenTouched() {
    val renamed = DesktopStore.upsert(emptyList(), lan, 1).map { it.copy(name = "Studio Mac") }
    assertEquals("Studio Mac", DesktopStore.upsert(renamed, lan, 5).single().name)
  }

  @Test
  fun keepsAtMostTwenty() {
    var list = emptyList<SavedDesktop>()
    for (index in 1..25) list = DesktopStore.upsert(list, "http://10.0.0.$index:43127", index.toLong())
    assertEquals(20, list.size)
    assertEquals("http://10.0.0.25:43127", list.first().origin)
  }

  @Test
  fun roundTripsAndDropsEntriesItMayNotOpen() {
    val list = DesktopStore.upsert(DesktopStore.upsert(emptyList(), lan, 1), tunnel, 2)
    assertEquals(list, DesktopStore.decode(DesktopStore.encode(list)))
    val tampered = """[{"origin":"https://example.com","name":"x","lastUsedAt":9},{"origin":"$lan","name":"","lastUsedAt":1},7]"""
    assertEquals(listOf(SavedDesktop(lan, "192.168.1.20", 1)), DesktopStore.decode(tampered))
    assertEquals(emptyList<SavedDesktop>(), DesktopStore.decode("not json"))
    assertEquals(emptyList<SavedDesktop>(), DesktopStore.decode(null))
  }
}
