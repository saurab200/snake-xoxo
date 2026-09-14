package com.tether.admin

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.util.Log
import com.tether.core.FocusSessionStore
import com.tether.core.Prefs

/**
 * Makes blocked apps vanish from the launcher during a session or lockout.
 *
 * SAFETY: this hides apps the user owns. If Tether crashed while apps were
 * hidden they would stay hidden with no obvious way back, so every package we
 * hide is written to Prefs first and restored from there on the next process
 * start. Hiding is never "fire and forget".
 */
object AppHider {

    private const val TAG = "AppHider"
    private const val KEY_HIDDEN = "hidden.packages"

    /** Avoids re-issuing identical binder calls on every tick. */
    @Volatile
    private var lastAppliedHidden: Boolean? = null

    private fun admin(context: Context) =
        ComponentName(context.packageName, TetherDeviceAdmin::class.java.name)

    private fun dpm(context: Context) =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isDeviceOwner(context: Context): Boolean = try {
        dpm(context).isDeviceOwnerApp(context.packageName)
    } catch (e: Exception) {
        false
    }

    /**
     * Apply the state the session/lockout implies. Cheap to call repeatedly --
     * it no-ops unless the desired state actually changed.
     */
    fun sync(context: Context, force: Boolean = false) {
        if (!isDeviceOwner(context)) return

        val shouldHide = FocusSessionStore.isActive || FocusSessionStore.isLockedOut()
        if (!force && lastAppliedHidden == shouldHide) return
        lastAppliedHidden = shouldHide

        if (shouldHide) {
            hide(context, FocusSessionStore.blocklist)
        } else {
            restoreAll(context)
        }
    }

    private fun hide(context: Context, packages: Set<String>) {
        if (packages.isEmpty()) return
        val hidden = Prefs.getStringSet(context, KEY_HIDDEN).toMutableSet()

        packages.forEach { pkg ->
            if (pkg == context.packageName) return@forEach // never hide ourselves
            try {
                // Record BEFORE hiding: a crash between the two must leave a
                // package we can still restore, not one stranded as hidden.
                hidden.add(pkg)
                Prefs.setStringSet(context, KEY_HIDDEN, hidden)
                dpm(context).setApplicationHidden(admin(context), pkg, true)
            } catch (e: Exception) {
                Log.e(TAG, "could not hide $pkg", e)
            }
        }
    }

    /** Unhide everything we ever hid. Safe to call when nothing is hidden. */
    fun restoreAll(context: Context) {
        if (!isDeviceOwner(context)) return
        val hidden = Prefs.getStringSet(context, KEY_HIDDEN)
        if (hidden.isEmpty()) return

        hidden.forEach { pkg ->
            try {
                dpm(context).setApplicationHidden(admin(context), pkg, false)
            } catch (e: Exception) {
                Log.e(TAG, "could not restore $pkg", e)
            }
        }
        Prefs.setStringSet(context, KEY_HIDDEN, emptySet())
        lastAppliedHidden = false
    }

    fun hiddenCount(context: Context): Int =
        Prefs.getStringSet(context, KEY_HIDDEN).size
}
