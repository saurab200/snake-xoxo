# Tether — Hackathon Task Split (3 people)

A focus app: a draggable "snake" at the top of the screen sets a focus timer, which blocks social media apps and surfaces productivity tool widgets (starting with Canvas) in the corner of the screen.

**Platform:** Android (Kotlin + Jetpack Compose). iOS is not realistic for a hackathon timeline — Screen Time / FamilyControls needs Apple approval.

**Shared contract (agree on this first, then split up):**
- `FocusSession` — a simple object/singleton: `isActive: Boolean`, `durationMinutes: Int`, `startTime: Long`
- Trigger signal — a package name (`String`) representing whichever app just came to the foreground

Stub these early so nobody is blocked waiting on someone else's real implementation:
- Person B can stub `FocusSession.isActive = true` before Person A's real timer works
- Person C can wire a "simulate opening Canvas" button before Person B's real `AccessibilityService` works

Integrate the three pieces in the last 2–3 hours of the hackathon, not continuously.

---

## Person A — Interaction & Timer
*The demo hook — build and polish this first.*

**Builds:**
1. **Snake overlay** — `WindowManager` + custom `View`, pinned near the top of the screen (`TYPE_APPLICATION_OVERLAY`). Draggable handle with an elastic trailing shape. Drag distance maps to timer duration:
   ```kotlin
   val minutesPerPixel = 0.15f
   val dragDistance = abs(currentY - anchorY)
   val timerMinutes = (dragDistance * minutesPerPixel).roundToInt().coerceIn(5, 120)
   ```
2. **Timer engine** — a `ForegroundService` running a `CountDownTimer`, with a persistent notification (required by Android for long-running services). Owns and updates the shared `FocusSession` object.

**Produces for others:** `FocusSession.isActive` (+ duration/blocklist config) — read by Person B.

---

## Person B — Blocking Engine

**Builds:**
1. **Accessibility service** — listens for `TYPE_WINDOW_STATE_CHANGED` events to detect which app just came to the foreground. Checks the foreground package against the blocklist *while* `FocusSession.isActive` is true.
   ```kotlin
   override fun onAccessibilityEvent(event: AccessibilityEvent) {
       val pkg = event.packageName?.toString() ?: return
       if (FocusSession.isActive && pkg in blocklist) {
           showBlockOverlay(pkg)
       }
   }
   ```
2. **Block overlay** — full-screen overlay shown when a blocked app is opened during a session (e.g. "Instagram is blocked — 32 min left"), or redirect home via `Intent.ACTION_MAIN` / `CATEGORY_HOME`.
3. **Blocklist settings screen** — list installed apps (`PackageManager.getInstalledApplications`), default-select known social apps (Instagram, TikTok, X, Snapchat, Facebook, YouTube).

**Consumes:** `FocusSession.isActive` from Person A.
**Produces for others:** foreground package name, filtered to allowed/integration apps only — read by Person C.

---

## Person C — Integrations

**Builds:**
1. **Plugin interface + registry** — so adding a new integration later is trivial:
   ```kotlin
   interface ProductivityIntegration {
       val id: String
       val displayName: String
       suspend fun fetchWidgetData(): WidgetPayload
       fun renderWidget(payload: WidgetPayload): View
   }

   class CanvasIntegration : ProductivityIntegration {
       override val id = "canvas"
       override suspend fun fetchWidgetData(): WidgetPayload {
           val todos = canvasApi.getTodos()
           return WidgetPayload.TodoList(todos.map { it.title to it.dueAt })
       }
       override fun renderWidget(payload: WidgetPayload) = TodoChipView(payload)
   }
   ```
2. **Canvas API client** — fetch todos via a personal access token (skip full OAuth for the hackathon):
   ```
   GET https://<canvas-instance>/api/v1/users/self/todo
   Authorization: Bearer <user_access_token>
   ```
3. **Corner widget overlay** — small floating card (same overlay technique as the snake, smaller `TYPE_APPLICATION_OVERLAY` view) that renders whatever `renderWidget()` returns.

**Consumes:** foreground package name from Person B.

---

## Permissions needed (request as settings-intent screens, not runtime dialogs)
- `SYSTEM_ALERT_WINDOW` — draw over other apps
- `PACKAGE_USAGE_STATS` — usage access
- Accessibility Service enablement
- `POST_NOTIFICATIONS` (Android 13+)
- Canvas personal access token (pasted by user — skip OAuth)

## MVP scope for the demo
1. Snake drag → timer starts (the wow moment)
2. Block 2–3 hardcoded social apps during the timer
3. One integration (Canvas) with corner popup showing todos

**Cut if short on time:** iOS version, full OAuth, any backend server — keep everything on-device.

## Suggested build order
1. Hr 0–2: Foreground service + timer + notification
2. Hr 2–5: Snake overlay + drag → duration mapping
3. Hr 5–8: Accessibility service + blocklist + block overlay
4. Hr 8–11: Canvas integration + corner widget
5. Hr 11–13: Settings screens (block/allow lists)
6. Remaining: polish, demo script, **record a backup demo video** — accessibility permissions are flaky live on stage