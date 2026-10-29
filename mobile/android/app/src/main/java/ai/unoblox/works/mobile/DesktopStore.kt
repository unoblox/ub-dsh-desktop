package ai.unoblox.works.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** A computer this phone has paired with. The pairing itself is the bridge's cookie in the WebView. */
data class SavedDesktop(val origin: String, val name: String, val lastUsedAt: Long)

/**
 * Remembers paired computers in app-private preferences. Only addresses and
 * names are kept here; the session cookie stays in the WebView's cookie store
 * and nothing is sent anywhere.
 */
class DesktopStore(context: Context) {
  private val preferences = context.getSharedPreferences("desktops", Context.MODE_PRIVATE)

  fun all(): List<SavedDesktop> = decode(preferences.getString(KEY, null))

  fun mostRecent(): SavedDesktop? = all().firstOrNull()

  fun touch(origin: String, now: Long = System.currentTimeMillis()) {
    save(upsert(all(), origin, now))
  }

  fun rename(origin: String, name: String) {
    save(all().map { if (it.origin == origin) it.copy(name = name.trim().ifEmpty { defaultName(origin) }) else it })
  }

  fun forget(origin: String) {
    save(all().filterNot { it.origin == origin })
  }

  private fun save(desktops: List<SavedDesktop>) {
    preferences.edit().putString(KEY, encode(desktops)).apply()
  }

  companion object {
    private const val KEY = "list"
    private const val LIMIT = 20

    fun defaultName(origin: String): String = origin.substringAfter("://").substringBefore(':')

    /** Moves [origin] to the front, adding it when new. Keeps the most recent [LIMIT]. */
    fun upsert(desktops: List<SavedDesktop>, origin: String, now: Long): List<SavedDesktop> {
      val existing = desktops.firstOrNull { it.origin == origin }
      val updated = (existing ?: SavedDesktop(origin, defaultName(origin), now)).copy(lastUsedAt = now)
      return (listOf(updated) + desktops.filterNot { it.origin == origin }).take(LIMIT)
    }

    fun encode(desktops: List<SavedDesktop>): String = JSONArray().apply {
      desktops.forEach {
        put(JSONObject().put("origin", it.origin).put("name", it.name).put("lastUsedAt", it.lastUsedAt))
      }
    }.toString()

    /** Unreadable or no-longer-allowed entries are dropped rather than failing the whole list. */
    fun decode(text: String?): List<SavedDesktop> {
      if (text.isNullOrEmpty()) return emptyList()
      val array = try {
        JSONArray(text)
      } catch (_: JSONException) {
        return emptyList()
      }
      return (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val origin = Links.desktopOriginOf(item.optString("origin"))
        if (origin == null || origin != item.optString("origin")) return@mapNotNull null
        SavedDesktop(origin, item.optString("name").ifEmpty { defaultName(origin) }, item.optLong("lastUsedAt"))
      }.sortedByDescending { it.lastUsedAt }
    }
  }
}
