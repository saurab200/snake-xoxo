package com.tether.admin

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
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

    /** Resolved once per process; the set cannot change while we are running. */
    @Volatile
    private var protectedCache: Set<String>? = null

    /**
     * Packages that must NEVER be hidden, however the blocklist is configured.
     *
     * Hiding these does not make someone focus, it bricks their phone: no home
     * screen to return to, no dialer for an emergency, no Settings to undo it,
     * and with Device Owner set the app cannot even be force-stopped. On the
     * emulator a blocklist that had every app ticked took the device down to a
     * single launchable app, which is exactly how this would play out on
     * hardware.
     *
     * Resolved from the system rather than hardcoded, because the launcher,
     * dialer and keyboard differ per device and per user choice.
     */
    fun protectedPackages(context: Context): Set<String> {
        protectedCache?.let { return it }

        val pm = context.packageManager
        val out = mutableSetOf(context.packageName)

        fun add(pkg: String?) {
            // "android" is the intent resolver, not a real app.
            if (!pkg.isNullOrBlank() && pkg != "android") out.add(pkg)
        }

        try {
            // EVERY home-capable app, not just the current default -- switching
            // launcher must not strand the user on a hidden one.
            pm.queryIntentActivities(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                0,
            ).forEach { add(it.activityInfo?.packageName) }

            add(pm.resolveActivity(Intent(Intent.ACTION_DIAL), 0)?.activityInfo?.packageName)
            add(
                (context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)
                    ?.defaultDialerPackage,
            )
            add(
                pm.resolveActivity(Intent(Settings.ACTION_SETTINGS), 0)
                    ?.activityInfo?.packageName,
            )
            add(Telephony.Sms.getDefaultSmsPackage(context))
            add(
                Settings.Secure.getString(
                    context.contentResolver,
                    Settings.Secure.DEFAULT_INPUT_METHOD,
                )?.substringBefore('/'),
            )
        } catch (e: Exception) {
            Log.e(TAG, "could not resolve every protected package", e)
        }

        protectedCache = out
        return out
    }

    private fun admin(context: Context) =
        ComponentName(context.packageName, TetherDeviceAdmin::class.java.name)

    private fun dpm(context: Context) =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    /**
     * Device Owner AND a live admin component.
     *
     * isDeviceOwnerApp() alone is not enough: the owner record survives an
     * uninstall/reinstall, but the app comes back with a new uid and the admin
     * component no longer belongs to it. dpm then reports us as owner while
     * every setApplicationHidden() throws
     *
     *   SecurityException: Admin ... does not exist or is not owned by uid N
     *
     * which is silent, because each call is caught per package. Checking
     * isAdminActive() too makes a stale provisioning show up in the UI as
     * "vanish mode off" instead of as blocking that quietly does nothing.
     */
    fun isDeviceOwner(context: Context): Boolean = try {
        val dpm = dpm(context)
        dpm.isDeviceOwnerApp(context.packageName) && dpm.isAdminActive(admin(context))
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
        val protectedPkgs = protectedPackages(context)

        packages.forEach { pkg ->
            if (pkg in protectedPkgs) {
                // Refused, not failed: blocking the launcher or dialer would
                // leave no way back. See protectedPackages().
                Log.w(TAG, "refusing to hide protected package $pkg")
                return@forEach
            }
            try {
                // Record BEFORE hiding: a crash between the two must leave a
                // package we can still restore, not one stranded as hidden.
                hidden.add(pkg)
                Prefs.setStringSet(context, KEY_HIDDEN, hidden)
                dpm(context).setApplicationHidden(admin(context), pkg, true)
            } catch (e: Exception) {
                // ...but a call that FAILED must not leave a record claiming it
                // worked, or hiddenCount reports "20 hidden" while nothing is.
                hidden.remove(pkg)
                Prefs.setStringSet(context, KEY_HIDDEN, hidden)
                Log.e(TAG, "could not hide $pkg", e)
            }
        }
    }

    /** Unhide everything we ever hid. Safe to call when nothing is hidden. */
    fun restoreAll(context: Context) {
        if (!isDeviceOwner(context)) return
        val hidden = Prefs.getStringSet(context, KEY_HIDDEN)
        if (hidden.isEmpty()) return

        // GOTCHA: setApplicationHidden() reports refusal by RETURNING FALSE, not
        // by throwing -- so a catch-only version of this loop cannot tell a
        // restore that worked from one that silently did nothing. Clearing the
        // record regardless then strands those packages: they stay hidden at the
        // OS level while hiddenCount() reads 0, which removes the "Restore all
        // apps now" affordance and leaves the user no way back.
        //
        // So: keep every package we did NOT get back, and only drop the ones the
        // system confirmed. A stuck package stays in the record, stays counted,
        // and stays offered for retry.
        val stuck = mutableSetOf<String>()

        hidden.forEach { pkg ->
            // A package that is no longer installed cannot be hidden OR restored,
            // and keeping it would mean retrying it forever and reporting a
            // phantom "1 app still hidden" the user can never clear. Uninstalled
            // since we hid it, or carried over from another device -- either way
            // it is not ours to worry about any more, so drop it.
            if (!isInstalled(context, pkg)) {
                Log.w(TAG, "dropping $pkg from the hidden record -- not installed")
                return@forEach
            }

            val stillHidden = try {
                dpm(context).setApplicationHidden(admin(context), pkg, false)
                // Trust the SYSTEM, not the return value. setApplicationHidden()
                // reports "did I change anything", so it is false both when the
                // call was refused and when the package was already visible --
                // treating that as failure would strand packages that are
                // perfectly fine. Asking what the state actually is now
                // distinguishes the two.
                dpm(context).isApplicationHidden(admin(context), pkg)
            } catch (e: Exception) {
                Log.e(TAG, "could not restore $pkg", e)
                true
            }
            if (stillHidden) {
                Log.e(TAG, "restore refused for $pkg -- still hidden")
                stuck.add(pkg)
            }
        }

        Prefs.setStringSet(context, KEY_HIDDEN, stuck)
        if (stuck.isNotEmpty()) {
            Log.e(TAG, "${stuck.size} of ${hidden.size} package(s) could not be restored")
        }

        // "Not hidden" is what we applied, whether or not every package obeyed.
        // Recording it as still-hidden would make the next sync() tick try the
        // whole set again, once per tick, forever. Anything that refused stays
        // in the record above, so the Blocked screen keeps offering a manual
        // retry -- which is the right place for it, not a hot loop.
        lastAppliedHidden = false
    }

    /**
     * Whether the package is present for this user at all.
     *
     * GOTCHA: MATCH_UNINSTALLED_PACKAGES is not optional here. A hidden app is
     * reported as NOT installed by a default lookup -- which is every package
     * this function is ever asked about, since we only ask about ones we hid.
     * Without the flag this returns false for all of them and the restore loop
     * "helpfully" drops the entire record instead of unhiding anything.
     */
    private fun isInstalled(context: Context, pkg: String): Boolean = try {
        context.packageManager.getApplicationInfo(
            pkg,
            PackageManager.MATCH_UNINSTALLED_PACKAGES,
        )
        true
    } catch (e: Exception) {
        false
    }

    fun hiddenCount(context: Context): Int =
        Prefs.getStringSet(context, KEY_HIDDEN).size
}
