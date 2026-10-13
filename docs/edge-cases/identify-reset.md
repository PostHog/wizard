# Users not identified or reset

25 cases. Part of the [edge case catalogue](../edge-cases.md).

## Login tracked but user never identified

**Problem.** Asked to 'track login', a generic agent adds a user\_logged\_in capture and stops. Nothing errors, and events still show up, so the missing identify is invisible until someone looks for per-user data.

**Impact.** Silent: every event stays anonymous, so per-user funnels, retention and replay attribution do not work.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (identify on login AND on page refresh)
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md)
- `context-mill: example-apps/android/.../viewmodel/AuthViewModel.kt`

**Sources.** [PostHog/wizard-workbench#4476](https://github.com/PostHog/wizard-workbench/pull/4476), [PostHog/wizard-workbench#4471](https://github.com/PostHog/wizard-workbench/pull/4471), [PostHog/wizard-workbench#4440](https://github.com/PostHog/wizard-workbench/pull/4440), [PostHog/context-mill#5](https://github.com/PostHog/context-mill/issues/5), [PostHog/wizard-workbench#3338](https://github.com/PostHog/wizard-workbench/pull/3338), [PostHog/wizard-workbench#3368](https://github.com/PostHog/wizard-workbench/pull/3368), [PostHog/wizard-workbench#4383](https://github.com/PostHog/wizard-workbench/pull/4383), [PostHog/wizard-workbench#4454](https://github.com/PostHog/wizard-workbench/pull/4454), [PostHog/wizard-workbench#2964](https://github.com/PostHog/wizard-workbench/pull/2964)

**Frameworks.** `react`, `vue`, `nuxt`, `nextjs`, `tanstack-router`, `javascript_web`, `android`

**Wrong:**

```javascript
async function login(username) {
  await auth.login(username)
  posthog.capture('user_logged_in')   // no identify
}
```

**Fixed:**

```javascript
await auth.login(username)
// person properties go in identify(), not in capture()
posthog.identify(username, { name: username })
posthog.capture('user_logged_in')
```

## Logout never resets the PostHog identity

**Problem.** The agent treats logout as app auth state only, clearing its own storage and maybe capturing user\_logged\_out, without knowing PostHog keeps its own distinct id. The bleed only shows when a second person uses the same device.

**Impact.** Silent: the next user on the same browser or device inherits the previous person, and their identify() can merge both accounts into one person.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) #ios, #flutter (reset on logout and before identify when switching accounts)
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md)
- [`context-mill: context/skills/audit/references/3-identification.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/3-identification.md) (identify-reset-on-logout, Task D)
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md)
- [`context-mill: example-apps/vue-3/src/components/Header.vue`](https://github.com/PostHog/context-mill/blob/main/example-apps/vue-3/src/components/Header.vue)
- `wizard: src/lib/programs/audit/seed.ts` (identify-reset-on-logout)

**Sources.** [PostHog/wizard-workbench#4471](https://github.com/PostHog/wizard-workbench/pull/4471), [PostHog/wizard-workbench#4476](https://github.com/PostHog/wizard-workbench/pull/4476), [PostHog/wizard-workbench#4409](https://github.com/PostHog/wizard-workbench/pull/4409), [PostHog/wizard-workbench#4366](https://github.com/PostHog/wizard-workbench/pull/4366), [PostHog/wizard-workbench#4306](https://github.com/PostHog/wizard-workbench/pull/4306), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112), [PostHog/wizard-workbench#754](https://github.com/PostHog/wizard-workbench/pull/754), [context-mill@bb3f77d](https://github.com/PostHog/context-mill/commit/bb3f77d1), [context-mill@f6bf6e1](https://github.com/PostHog/context-mill/commit/f6bf6e1f), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#92](https://github.com/PostHog/context-mill/pull/92), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73), [PostHog/context-mill#66](https://github.com/PostHog/context-mill/pull/66), [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `vue`, `angular`, `tanstack-router`, `tanstack-start`, `react-router`, `astro`, `expo`, `react-native`, `ios`, `swift`, `android`, `flutter`

**Wrong:**

```javascript
async function signOut() {
  await fetch('/api/logout', { method: 'POST' })  // server capture only
  setUser(null)
  localStorage.removeItem('currentUser')   // PostHog id untouched
  router.push('/login')
}
```

**Fixed:**

```javascript
async function signOut() {
  posthog.capture('user_logged_out')
  await fetch('/api/logout', { method: 'POST' })
  // IMPORTANT: Reset the PostHog instance to clear the user session
  posthog.reset()   // also before identify() when switching accounts directly
  router.push('/login')
}
// iOS: PostHogSDK.shared.reset()  Flutter: await Posthog().reset()
```

## Reset runs for anonymous visitors on page load

**Problem.** Told to 'reset when logged out', the agent keys reset() on 'no session' or 'no user' state, which is also true on every first visit. The over-correction looks right in review and fails silently.

**Impact.** Silent: every visit mints a new anonymous id, detaching pre-signup pageviews from the account that follows and inflating unique visitors.

**Rule location.** [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('the transition out of an identified session, never an initially anonymous page load')

**Sources.** [context-mill@bb3f77d](https://github.com/PostHog/context-mill/commit/bb3f77d1), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [PostHog/context-mill#314](https://github.com/PostHog/context-mill/pull/314)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `vue`, `tanstack-start`, `sveltekit`, `supabase`

**Wrong:**

```javascript
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) posthog.reset()   // also true on every anonymous page load
})
// or
useEffect(() => { if (!user) posthog.reset() }, [user])
```

**Fixed:**

```javascript
} else if (status === 'unauthenticated' && identifiedUserId.current) {
  posthog.reset()            // only the identified-to-anonymous transition
  identifiedUserId.current = null
}
```

## Reset called right before identify on login

**Problem.** Resetting 'to start clean' before identifying feels defensive, but the SDK only links an anonymous predecessor during identify, and reset has just thrown it away.

**Impact.** Silent: the visitor's pre-login activity is never linked to the user. Identify links a freshly minted, empty anonymous id.

**Rule location.** [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (reset on logout, and before identify() only when switching directly between accounts, implies no reset on first anonymous login)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```javascript
function onLogin(user) {
  posthog.reset()              // discards the original anonymous id
  posthog.identify(user.id)    // links a brand-new anonymous id
}
```

**Fixed:**

```javascript
function onLogin(user)  { posthog.identify(user.id) }  // links the existing anonymous id
function onLogout()     { posthog.reset() }            // only on logout or account switch
```

## Identify fires on every navigation or render

**Problem.** Following 'identify on login AND on refresh', the agent puts identify in a component body or an effect that mounts on every page, or strips an existing dedupe guard as 'redundant'. Nothing breaks, it just floods events.

**Impact.** A redundant identify with a full $set payload on every navigation or render, and identify can run before the user id is known.

**Rule location.**

- [`context-mill: context/agents/integration-v2/identify.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/identify.md) (client: identify once)
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('identify once rather than per page or per event')
- [`context-mill: example-apps/vue-3/src/views/Home.vue`](https://github.com/PostHog/context-mill/blob/main/example-apps/vue-3/src/views/Home.vue)

**Sources.** [PostHog/wizard#1121](https://github.com/PostHog/wizard/issues/1121), [PostHog/context-mill#5](https://github.com/PostHog/context-mill/issues/5), [context-mill@d45736f](https://github.com/PostHog/context-mill/commit/d45736ff), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `nextjs`, `react`, `react-router`, `vue`, `tanstack-start`, `javascript_web`

**Wrong:**

```tsx
export function PostHogIdentify({ userId, email }) {
  useEffect(() => {
    posthog.identify(userId, email ? { email } : undefined)   // guard removed
  }, [userId, email])
}
// or: useEffect(() => { if (user) posthog.identify(user.id) })  // no deps
```

**Fixed:**

```tsx
if (identifiedUserId.current !== session.user.id) {
  if (identifiedUserId.current) posthog.reset()
  posthog.identify(session.user.id, { email, name })
  identifiedUserId.current = session.user.id
}
```

## Returning logged-in users never identified

**Problem.** Docs and most example apps show identify() inside the login handler, so the agent wires it there. Sessions restored from a cookie, stored credentials or app restart skip that handler, and nothing signals the gap.

**Impact.** Silent: returning sessions (new tab, cleared PostHog storage, new device with a live server session) stay on anonymous distinct ids, splitting one user across anonymous and identified persons.

**Rule location.**

- [`context-mill: context/commandments.yaml#javascript_web`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) ('on login AND on page refresh if the user is already logged in')
- [`context-mill: context/skills/integration/references/4-conclude.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/4-conclude.md) and integration-v2/report/description.md (returning-visitor checklist item)
- [`context-mill: example-apps/javascript-web/src/main.js`](https://github.com/PostHog/context-mill/blob/main/example-apps/javascript-web/src/main.js)
- [`context-mill: example-apps/react-native/src/contexts/AuthContext.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-native/src/contexts/AuthContext.tsx)

**Sources.** [PostHog/wizard#447](https://github.com/PostHog/wizard/issues/447), [PostHog/wizard#595](https://github.com/PostHog/wizard/pull/595), [PostHog/context-mill#174](https://github.com/PostHog/context-mill/pull/174), [PostHog/context-mill#181](https://github.com/PostHog/context-mill/pull/181), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#83](https://github.com/PostHog/context-mill/pull/83), [PostHog/context-mill#87](https://github.com/PostHog/context-mill/pull/87), [context-mill@f6bf6e1](https://github.com/PostHog/context-mill/commit/f6bf6e1f), [PostHog/wizard-workbench#807](https://github.com/PostHog/wizard-workbench/pull/807), [PostHog/wizard-workbench#2520](https://github.com/PostHog/wizard-workbench/pull/2520), [PostHog/wizard-workbench#4430](https://github.com/PostHog/wizard-workbench/pull/4430), [PostHog/wizard-workbench#4468](https://github.com/PostHog/wizard-workbench/pull/4468), [PostHog/wizard-workbench#3112](https://github.com/PostHog/wizard-workbench/pull/3112)

**Frameworks.** `javascript_web`, `react`, `react-vite`, `nextjs`, `angular`, `react-router`, `tanstack-router`, `sveltekit`, `vue`, `react-native`

**Wrong:**

```javascript
async function onSubmit(values) {
  const user = await login(values)
  posthog.identify(user.id, { email: user.email })   // only path
}
// cookie-restored sessions auto-redirect past this handler
```

**Fixed:**

```tsx
// on login success AND on any load where a session already exists
useEffect(() => {
  if (user && posthog.get_distinct_id() !== user.id) {
    posthog.identify(user.id, { email: user.email })
  }
}, [user])
```

## Identify called late, after captures and flags

**Problem.** The agent drops identify wherever user data is handy (a settings or profile page mount) because the docs only say 'call identify', not when relative to other captures and flag evaluations. Nothing fails when early calls go out anonymous.

**Impact.** Silent: startup captures and flag evaluations run anonymously, so flags targeted by person properties return the wrong value and events are split from the person.

**Rule location.**

- `wizard: src/lib/programs/audit/seed.ts` (identify-not-late)
- [`context-mill: context/skills/audit/references/3-identification.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit/references/3-identification.md) (Task B)
- [`context-mill: context/skills/audit-identify/references/2-identify-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/2-identify-fix.md) (Task B)
- [`context-mill: context/skills/posthog-best-practices/references/feature-flags.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/references/feature-flags.md) ('Resolve identity before evaluation')

**Sources.** [PostHog/wizard#425](https://github.com/PostHog/wizard/pull/425), [PostHog/context-mill#108](https://github.com/PostHog/context-mill/pull/108), [PostHog/context-mill#118](https://github.com/PostHog/context-mill/pull/118), [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `vue`

**Wrong:**

```javascript
posthog.init(token, { api_host: '/ingest' })
const beta = posthog.isFeatureEnabled('beta')   // anonymous
posthog.capture('app_opened')
// identify() only when the settings page mounts
```

**Fixed:**

```javascript
posthog.init(token, { api_host: '/ingest' })
// on login / on load for a signed-in user, before captures and flags
posthog.identify(user.id, { email: user.email })
posthog.onFeatureFlags(() => {
  const beta = posthog.isFeatureEnabled('beta')
})
posthog.capture('app_opened')
```

## Logout event captured after reset

**Problem.** Order looks cosmetic, so agents reset first as 'clean up then log' (or capture login before identify). Reset swaps the distinct id immediately, so the event lands on the wrong person with no error. Even the javascript-web example app resets first.

**Impact.** Silent: user\_logged\_out belongs to a fresh anonymous id, and a login event captured before identify belongs to the pre-login visitor.

**Rule location.**

- context-mill example apps only (no commandment states the order, commandments.yaml#javascript\_web and #flutter only say 'reset on logout'): example-apps/flutter/lib/auth/auth\_state.dart + test/auth/auth\_state\_test.dart
- [`context-mill: example-apps/next-app-router/src/contexts/AuthContext.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/next-app-router/src/contexts/AuthContext.tsx)
- [`context-mill: example-apps/react-vite/src/components/Header.jsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-vite/src/components/Header.jsx)
- [`context-mill: example-apps/expo/src/contexts/AuthContext.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/expo/src/contexts/AuthContext.tsx)
- [`context-mill: example-apps/swift/BurritoConsiderationClient/UserState.swift`](https://github.com/PostHog/context-mill/blob/main/example-apps/swift/BurritoConsiderationClient/UserState.swift)
- [`context-mill: example-apps/nuxt-4/app/components/AppHeader.vue`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/app/components/AppHeader.vue)
- [`context-mill: example-apps/react-react-router-7-framework/app/components/Header.tsx`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/app/components/Header.tsx)

**Sources.** [PostHog/context-mill#276](https://github.com/PostHog/context-mill/pull/276), [PostHog/context-mill#266](https://github.com/PostHog/context-mill/pull/266), [PostHog/context-mill#212](https://github.com/PostHog/context-mill/pull/212), [PostHog/context-mill#73](https://github.com/PostHog/context-mill/pull/73)

**Frameworks.** `javascript_web`, `react`, `nextjs`, `nuxt`, `expo`, `react-native`, `flutter`, `swift`

**Wrong:**

```javascript
function handleLogout() {
  posthog.reset()                    // wipes the distinct id first
  posthog.capture('user_logged_out') // lands on the new anonymous id
  localStorage.removeItem('currentUser')
}
// Flutter: await Posthog().reset(); await Posthog().capture(eventName: 'user_logged_out');
```

**Fixed:**

```dart
// login: identify, then capture
await Posthog().identify(userId: id, userProperties: props);
await Posthog().capture(eventName: 'user_logged_in');
// logout: capture first, so the event is still attributed to the user
await Posthog().capture(eventName: 'user_logged_out');
await Posthog().reset();
```

## next-auth session has no user id

**Problem.** The agent writes posthog.identify(session.user.id) from habit, but next-auth's default session callback returns only name, email and image, so the id is undefined.

**Impact.** Silent: the SDK rejects the undefined id and nobody is ever identified.

**Rule location.** [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) (prove the id reaches the identifying line, names 'a session callback that returns only name and email'). No next-auth-specific rule in commandments.yaml or posthog-best-practices

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245)

**Frameworks.** `nextjs`, `next-auth`

**Wrong:**

```javascript
// pages/_app.jsx
posthog.identify(session.user.id)   // session.user = { name, email, image }
// callbacks.session returns session unchanged
```

**Fixed:**

```javascript
callbacks: {
  session({ session, token }) {
    if (session.user && typeof token.sub === 'string') session.user.id = token.sub
    return session
  },
}
```

## Django login event captured as nobody

**Problem.** The agent trusts PosthogContextMiddleware and writes a bare capture after login(), not knowing the middleware read request.user before the view ran. The obvious over-correction, wrapping every capture in its own context, adds churn.

**Impact.** Silent: login and signup events (the key funnel steps) are personless while later requests look fine.

**Rule location.**

- [`context-mill: context/commandments.yaml#django`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (lines ~145-146, user\_logged\_in signal rule)
- [`context-mill: example-apps/django/core/signals.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/signals.py) + core/apps.py ready()
- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) '### Django' (older wording: open a fresh context and identify it, does not mention the signal)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@17ab50d](https://github.com/PostHog/context-mill/commit/17ab50d4), [context-mill@1e43ce1](https://github.com/PostHog/context-mill/commit/1e43ce1f), [context-mill@e6532e0](https://github.com/PostHog/context-mill/commit/e6532e0d), [context-mill@2d1da78](https://github.com/PostHog/context-mill/commit/2d1da788), [PostHog/wizard-workbench#4452](https://github.com/PostHog/wizard-workbench/pull/4452), [PostHog/posthog.com#18611](https://github.com/PostHog/posthog.com/pull/18611)

**Frameworks.** `django`

**Wrong:**

```python
def login_view(request):
    user = authenticate(request, **creds)
    login(request, user)
    capture('user_logged_in')   # context identified as nobody before login
```

**Fixed:**

```python
@receiver(user_logged_in)
def identify_posthog_user(sender, request, user, **kwargs):
    identify_context(str(user.pk))  # fixes the ambient context for this request
    posthog.set(distinct_id=str(user.pk),
                properties={'email': user.email, 'username': user.username})
# apps.py ready(): from . import signals  # noqa: F401
# the view's plain capture('user_logged_in') is now attributed
```

## FastAPI login event uses pre-login context

**Problem.** The request context was built from the cookie before the user logged in, and the agent captures under it without realising the handler is what creates the session.

**Impact.** Silent: user\_logged\_in and user\_signed\_up are attributed to nobody.

**Rule location.**

- [`context-mill: example-apps/fastapi/app/routers/main.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/routers/main.py) (login, signup)
- same principle as context/commandments.yaml#django (login request context is identified as nobody)

**Sources.** [PostHog/wizard-workbench#4449](https://github.com/PostHog/wizard-workbench/pull/4449), [PostHog/context-mill#63](https://github.com/PostHog/context-mill/pull/63), [PostHog/context-mill#216](https://github.com/PostHog/context-mill/pull/216)

**Frameworks.** `fastapi`

**Wrong:**

```python
if user:
    user.record_login(db)
    capture("user_logged_in")   # middleware context has no user yet
    response.set_cookie("session_token", create_session_token(user.id))
```

**Fixed:**

```python
if user:
    is_new_user = user.record_login(db)
    with new_context():
        identify_context(str(user.id))
        capture("user_logged_in", properties={
            "$set": {"email": user.email, "is_staff": user.is_staff},
            "is_new_user": is_new_user})
```

## Server logout event captured after session ends

**Problem.** Logging after the action feels natural, and the agent does not notice that the distinct id is read from the session it just cleared. The capture still succeeds, so nothing fails.

**Impact.** Silent: the logout event falls back to an anonymous or missing distinct id, so logouts are not attributed to the user.

**Rule location.**

- [`context-mill: context/commandments.yaml#django`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line ~146, 'capture before calling logout()')
- [`context-mill: example-apps/flask/app/main/routes.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/flask/app/main/routes.py) logout()
- [`context-mill: example-apps/django/core/views.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/django/core/views.py) logout\_view()
- [`context-mill: example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex`](https://github.com/PostHog/context-mill/blob/main/example-apps/elixir/lib/posthog_example_web/controllers/burrito_controller.ex) logout()

**Sources.** [PostHog/context-mill#268](https://github.com/PostHog/context-mill/pull/268), [context-mill@1e43ce1](https://github.com/PostHog/context-mill/commit/1e43ce1f)

**Frameworks.** `django`, `flask`, `elixir`

**Wrong:**

```elixir
def logout(conn, _params) do
  conn = delete_session(conn, :distinct_id)
  PostHog.capture("user_logged_out", %{distinct_id: current_distinct_id(conn)}) # now anonymous
  redirect(conn, to: ~p"/")
end
# Flask: logout_user(); capture('user_logged_out')
```

**Fixed:**

```python
# Flask: capture logout event before session ends
with new_context():
    identify_context(str(current_user.id))
    capture("user_logged_out")

logout_user()
# Django: capture before calling logout()
# Elixir: capture before delete_session(conn, :distinct_id)
```

## Python context opened around every capture

**Problem.** SDK examples show new\_context() and identify\_context() next to a single capture, so agents copy that block to every call site instead of binding identity once per request.

**Impact.** Boilerplate at every call site. Any route that misses it, or any capture outside the wrapper, is personless or mis-attributed.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (### Python: 'Wrapping an individual capture in its own context buys nothing')
- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('A context around a single capture buys nothing')
- [`context-mill: context/commandments.yaml#django`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (line ~145, 'do not wrap it in a context of its own')
- [`context-mill: example-apps/fastapi/app/middleware.py`](https://github.com/PostHog/context-mill/blob/main/example-apps/fastapi/app/middleware.py)

**Sources.** [PostHog/context-mill#63](https://github.com/PostHog/context-mill/pull/63), [PostHog/context-mill#335](https://github.com/PostHog/context-mill/pull/335), [context-mill@d45736f](https://github.com/PostHog/context-mill/commit/d45736ff), [context-mill@2d1da78](https://github.com/PostHog/context-mill/commit/2d1da788), [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@e6532e0](https://github.com/PostHog/context-mill/commit/e6532e0d), [context-mill@46d5e7a](https://github.com/PostHog/context-mill/commit/46d5e7af6e606f7a0c6257045a7f9133b60f9a35), [context-mill@e6532e0](https://github.com/PostHog/context-mill/commit/e6532e0de98d5026093136d39473a4435a612fa1)

**Frameworks.** `fastapi`, `flask`, `django`, `python`

**Wrong:**

```python
@router.post('/burrito/consider')
async def consider(current_user: RequiredUser):
    with new_context():
        identify_context(current_user.email)
        capture('burrito_considered')
```

**Fixed:**

```python
class PostHogMiddleware:   # pure ASGI, one context per request
    async def __call__(self, scope, receive, send):
        user = self._get_user_from_scope(scope)
        with new_context():
            if user:
                identify_context(str(user.id))
            await self.app(scope, receive, send)
# routes just call capture(...)
```

## Node errors captured without the user

**Problem.** The agent passes distinctId on each capture, which works for events, but the error handler's captureException has no user in scope, and nothing warns about it.

**Impact.** Silent: exceptions, and any capture that omits the id, carry no user.

**Rule location.**

- [`context-mill: context/skills/posthog-best-practices/description.md#Node.js`](https://github.com/PostHog/context-mill/blob/main/context/skills/posthog-best-practices/description.md) (also mentions setupExpressRequestContext for Express)
- [`context-mill: context/agents/integration-v2/identify.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/identify.md)
- [`context-mill: example-apps/react-react-router-7-framework/app/lib/posthog-middleware.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/react-react-router-7-framework/app/lib/posthog-middleware.ts)

**Sources.** [PostHog/context-mill#245](https://github.com/PostHog/context-mill/pull/245), [context-mill@d45736f](https://github.com/PostHog/context-mill/commit/d45736ff)

**Frameworks.** `javascript-node`, `express`, `react-router`

**Wrong:**

```javascript
app.post('/orders', (req, res) => {
  posthog.capture({ distinctId: req.user.id, event: 'order_created' })
})
app.use((err, req, res, next) => {
  posthog.captureException(err)   // no distinctId, no context
  next(err)
})
```

**Fixed:**

```typescript
// middleware: bind identity to the whole request
await posthog.withContext(
  { sessionId: sessionId ?? undefined, distinctId: distinctId ?? undefined },
  next   // captures and exceptions inside inherit it
)
```

## Users identified on the server, or twice

**Problem.** In SSR apps the agent cannot tell which files run client-side, so it calls identify wherever it first finds the user, often a server login route or both sides. Server identify never sees the browser's anonymous id, and nothing errors.

**Impact.** Silent: pre-login browser activity stays on a separate anonymous person, server events are not tied to the client's person or session, and duplicate identify calls split profiles.

**Rule location.**

- [`context-mill: example-apps/nuxt-4/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/README.md) (lines 134, 157), nuxt-3-6/README.md, react-react-router-6/-7-data/-7-framework READMEs ('Important: do not identify users on the server-side')
- [`context-mill: example-apps/nuxt-4/server/api/auth/login.post.ts`](https://github.com/PostHog/context-mill/blob/main/example-apps/nuxt-4/server/api/auth/login.post.ts)
- [`context-mill: context/skills/integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description.md) ('Identifying users', X-POSTHOG-\* headers)
- [`context-mill: context/skills/integration/references/2-edit.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/references/2-edit.md)

**Sources.** [PostHog/context-mill#5](https://github.com/PostHog/context-mill/issues/5), [context-mill@e497ab3](https://github.com/PostHog/context-mill/commit/e497ab39), [context-mill@c8e4cd6](https://github.com/PostHog/context-mill/commit/c8e4cd63)

**Frameworks.** `nuxt`, `react-router`, `nextjs`, `astro`, `tanstack-router`

**Wrong:**

```typescript
// server/api/auth/login.post.ts
posthog.identify({ distinctId: username, properties: { username } })
posthog.capture({ distinctId: username, event: 'server_login' })
// plus layout.tsx calling posthog.identify on every render
```

**Fixed:**

```typescript
// client identifies once on login: posthog.identify(username)
const sessionId = getHeader(event, 'x-posthog-session-id')
const distinctId = getHeader(event, 'x-posthog-distinct-id')
posthog.capture({ distinctId, event: 'server_login',
  properties: { $session_id: sessionId } })
```

## Rails browser and server identities never joined

**Problem.** The agent identifies with posthog-rails in the sessions controller and treats the job as done, leaving the posthog-js snippet in the layout without a matching identify. The README claims they link when ids match, but the example layout itself omits the client call.

**Impact.** Silent: browser pageviews and replays stay on an anonymous person while backend events land on the user, so the two halves never join.

**Rule location.**

- [`context-mill: example-apps/ruby-on-rails/README.md`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/README.md) (Frontend + Backend integration, item 3 'Shared distinct\_id', line ~214, the line ~217 note about no tracing-header middleware is stale)
- [`context-mill: example-apps/ruby-on-rails/app/views/layouts/application.html.erb`](https://github.com/PostHog/context-mill/blob/main/example-apps/ruby-on-rails/app/views/layouts/application.html.erb) (no identify)
- [`context-mill: context/skills/integration/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration/description.md) ('Identifying users', X-POSTHOG-\* headers)

**Sources.** [PostHog/wizard-workbench#533](https://github.com/PostHog/wizard-workbench/pull/533), [context-mill@e6fe850](https://github.com/PostHog/context-mill/commit/e6fe8501)

**Frameworks.** `ruby-on-rails`

**Wrong:**

```ruby
# SessionsController#create (server)
PostHog.identify(distinct_id: user.posthog_distinct_id, properties: user.posthog_properties)
# layout: posthog.init(token, { person_profiles: 'identified_only' })  -- no posthog.identify
```

**Fixed:**

```erb
<%# layout, after posthog.init, when signed in %>
<% if current_user %>
  <script>posthog.identify('<%= j current_user.posthog_distinct_id.to_s %>')</script>
<% end %>
<%# posthog-rails >= 3.9.0 also reads X-POSTHOG-DISTINCT-ID / X-POSTHOG-SESSION-ID %>
```

## MCP identify reads headers with old SDK shape

**Problem.** Training data shows the v1 MCP SDK shape extra.requestInfo.headers. On v2 the request moved to extra.http.req, and the stale read returns undefined without throwing.

**Impact.** Silent: identify() returns null and every MCP event goes out anonymous with no error anywhere.

**Rule location.** [`context-mill: context/skills/mcp-analytics/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/mcp-analytics/description.md) (STEP 4 Path B, always read request headers through getRequestHeaders)

**Sources.** [PostHog/context-mill#344](https://github.com/PostHog/context-mill/pull/344)

**Frameworks.** `mcp-typescript-sdk`, `mcp-handler`

**Wrong:**

```typescript
instrument(server, posthog, {
  identify: (request, extra) => ({
    distinctId: extra.requestInfo?.headers?.['x-user-id'],   // v1-shaped read
  }),
})
```

**Fixed:**

```typescript
import { instrument, getRequestHeaders } from '@posthog/mcp'
instrument(server, posthog, {
  identify: async (request, extra) => {
    const token = getRequestHeaders(extra)?.['authorization']
    return token ? { distinctId: await resolveUserId(token) } : null
  },
})
```

## Two identify calls with different ids

**Problem.** With an auth provider UID and an internal user id both at hand, the agent identifies with each, not knowing the first call marks the device identified and blocks the second merge.

**Impact.** The anonymous-to-internal-id merge is blocked and the user splits across two profiles. Cited as 30k+ blocked merges/day at multi-SDK SaaS customers.

**Rule location.** [`context-mill: context/skills/audit-identify/references/2-identify-fix.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/2-identify-fix.md) (Task E, identify-sequential-calls)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `all`

**Wrong:**

```javascript
posthog.identify(authProviderUid)
posthog.identify(internalUserId)
```

**Fixed:**

```javascript
// one identify with the stable internal id
posthog.identify(internalUserId, { email: user.email })
```

## Server alias of the browser anonymous id

**Problem.** Server-side alias looks like a legitimate way to merge an anonymous visitor into a user, and the old audit rule even allowed it. It actually marks the UUID identified so the client identify merge is silently blocked.

**Impact.** Silent: the later client identify() with that UUID as $anon\_distinct\_id is blocked. About 80-100k blocked merges/day cited.

**Rule location.** [`context-mill: context/skills/audit-identify/references/3-identify-lifecycle.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/3-identify-lifecycle.md) (identify-alias-usage)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-node`, `all server SDKs`

**Wrong:**

```javascript
// server route
posthog.alias({
  distinctId: user.id,
  alias: req.cookies.ph_anon_id,
})
```

**Fixed:**

```javascript
// no server alias; let the client do the anon-to-user merge
posthog.identify(user.id, { email: user.email })
```

## Server $set capture with no identify

**Problem.** Putting $set on a server capture makes the person show properties and look identified, so the agent assumes identification is done.

**Impact.** Silent: no $identify event fires and no anonymous-to-identified merge happens, leaving earlier anonymous activity orphaned.

**Rule location.** [`context-mill: context/skills/audit-identify/references/5-server-sdk.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/5-server-sdk.md) (Task C, server-set-without-identify)

**Sources.** [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `javascript-node`, `python`, `ruby`, `go`, `php`

**Wrong:**

```javascript
posthog.capture({
  distinctId: user.id,
  event: 'plan_changed',
  properties: { $set: { plan: 'pro' } },
})
```

**Fixed:**

```javascript
posthog.identify({ distinctId: user.id, properties: { plan: 'pro' } })
// or confirm the client already identified this same distinct id
```

## Imports an auth library the app lacks

**Problem.** Training data pairs identify() with Clerk or Auth.js hooks, so the agent reaches for one to get a user id even when the project has no such dependency.

**Impact.** The build breaks on the missing import, or identify runs with an invented user id and splits persons.

**Rule location.** [`context-mill: context/commandments.yaml`](https://github.com/PostHog/context-mill/blob/main/context/commandments.yaml) (javascript and javascript\_web sections). The original 'DO NOT assume any authentication library (Clerk, Auth.js, etc.)' text was in wizard src/nextjs/event-setup.ts (added PR 94, deleted PR 214) and is no longer present

**Sources.** [PostHog/wizard#94](https://github.com/PostHog/wizard/pull/94), [PostHog/wizard#214](https://github.com/PostHog/wizard/pull/214)

**Frameworks.** `nextjs`, `all web`

**Wrong:**

```typescript
import { useUser } from '@clerk/nextjs'   // not a dependency
const { user } = useUser()
posthog.identify(user?.id, { email: user?.email })
```

**Fixed:**

```text
- When identity comes from framework-bridged state (Inertia or SSR shared props, a serialized session), confirm the backend actually shares that field — add the share server-side if missing — before identifying from it
- Call posthog.identify(userId, { email, name, role }) on login AND on page refresh if the user is already logged in
```

## Later tasks re-add identify already written

**Problem.** A fresh task agent sees only its direct dependency's handoff, so it does not know an earlier task already added init, identify or reset, and adds them again.

**Impact.** Duplicate PostHog.identify calls or setup in the same flow, or wasted turns rediscovering earlier work.

**Rule location.** `wizard: src/lib/agent/agent-prompt-loader.ts` (ancestorIds, renderHandoffContext, TASK\_BASICS 'Read a file before you edit it, so your own changes do not duplicate what is already there')

**Sources.** [PostHog/wizard#677](https://github.com/PostHog/wizard/pull/677)

**Frameworks.** `android`, `all`

**Wrong:**

```kotlin
// MainViewModel.login(): identify task
PostHog.identify(distinctId = username)
// capture task (saw only its direct dependency) adds it again
PostHog.identify(distinctId = username,
    userProperties = mapOf("username" to username))
```

**Fixed:**

```text
## Context from previous steps
### identify
- did: Added PostHog.identify() and PostHog.reset() in MainViewModel.kt.
- for you: Identify fires in MainViewModel.login() with
  distinctId = username. Reset fires in MainViewModel.logout().
- files: app/src/main/java/.../MainViewModel.kt
### capture   (also sees install + init via ancestorIds)
```

## Fake identify in an app with no users

**Problem.** Integration guides always include an identify step, so the agent wires one with a placeholder or random id even when the app has no login.

**Impact.** Events pool onto a fake person or create a new person per page load, instead of honest personless events.

**Rule location.**

- [`context-mill: context/skills/integration-v2/identify/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/integration-v2/identify/description.md) ('no concept of a user, there is nothing to identify')
- [`context-mill: context/agents/integration-v2/capture.md`](https://github.com/PostHog/context-mill/blob/main/context/agents/integration-v2/capture.md) (personless / DISTINCT\_ID paragraphs, lines ~25-41)

**Sources.** [context-mill@0bf2d8a](https://github.com/PostHog/context-mill/commit/0bf2d8a1), [context-mill@8592324](https://github.com/PostHog/context-mill/commit/85923242), [PostHog/wizard#853](https://github.com/PostHog/wizard/pull/853)

**Frameworks.** `all`

**Wrong:**

```ts
posthog.identify('user')                  // no auth in this app
posthog.identify(crypto.randomUUID())    // new person every page load
```

**Fixed:**

```text
identify: "If the app has no concept of a user, there is nothing to identify
  — report that and stop."
capture: no accounts or login -> "personless events are the right answer.
  Capture plainly, with no id and no placeholder, and say so in your handoff."
DISTINCT_ID placeholder only when identity exists but no stable id reaches the call site.
```

## Person properties set on every capture

**Problem.** $set on capture is documented and works, so the agent attaches it everywhere, including first-touch values that should be written only once.

**Impact.** Person-property versions bloat, and first-touch values such as initial referrer get overwritten. Nothing reports it.

**Rule location.**

- [`context-mill: context/skills/audit-identify/references/3-identify-lifecycle.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/3-identify-lifecycle.md) (Task A)
- audit-events/2-events-fix.md (Task D)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130)

**Frameworks.** `javascript_web`, `react`, `nextjs`

**Wrong:**

```javascript
posthog.capture('page_viewed', {
  $set: { initial_referrer: document.referrer, plan: user.plan }
})
```

**Fixed:**

```javascript
posthog.identify(user.id,
  { plan: user.plan },                                  // $set: changing values
  { initial_referrer: document.referrer, signup_date }  // $set_once: first touch
)
```

## Redundant alias() added next to identify()

**Problem.** Older docs and other analytics tools need alias to link anonymous and known users, so the agent adds it to be safe.

**Impact.** Extra $create\_alias events and self-alias calls that do nothing, with a false sense that identity is handled. Worse, a server-side alias of a browser anonymous UUID marks it identified and silently blocks the later client identify() merge.

**Rule location.** [`context-mill: context/skills/audit-identify/references/3-identify-lifecycle.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/audit-identify/references/3-identify-lifecycle.md) (Task B identify-alias-usage)

**Sources.** [PostHog/context-mill#130](https://github.com/PostHog/context-mill/pull/130), [PostHog/context-mill#193](https://github.com/PostHog/context-mill/pull/193)

**Frameworks.** `all`

**Wrong:**

```javascript
posthog.alias(user.id)
posthog.identify(user.id)
```

**Fixed:**

```javascript
posthog.identify(user.id)
// anonymous -> identified merge is automatic on first identify()
// alias() only for narrow cases, e.g. server-only projects with no client SDK
```
