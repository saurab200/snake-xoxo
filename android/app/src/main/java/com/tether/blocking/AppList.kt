package com.tether.blocking

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/** Reads the installed-app list for the blocklist settings screen. */
object AppList {

    /** Sensible defaults to pre-tick in the UI. */
    val SUGGESTED_BLOCKLIST = listOf(
        "com.instagram.android",
        "com.zhiliaoapp.musically",   // TikTok
        "com.twitter.android",
        "com.snapchat.android",
        "com.facebook.katana",
        "com.google.android.youtube",
        "com.reddit.frontpage",
        "com.netflix.mediaclient",
    )

    data class Entry(val packageName: String, val label: String)

    /**
     * Launchable apps only. Android 11+ requires the QUERY_ALL_PACKAGES permission
     * or a <queries> manifest block to see other apps at all -- see AndroidManifest.
     */
    fun installed(context: Context): List<Entry> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .mapNotNull { resolved ->
                val pkg = resolved.activityInfo?.packageName ?: return@mapNotNull null
                if (pkg == context.packageName) return@mapNotNull null
                Entry(pkg, resolved.loadLabel(pm).toString())
            }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase() }
    }

    fun labelFor(context: Context, pkg: String): String = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }
}
