# Wave Identity — login for the PWA / TWA

Netlify Identity is already enabled on your site (the 401 at `/.netlify/identity`
proves it's live). These files wire an actual login UI into Wave. Because the
app is same-origin on Netlify (and the Android APK *is* the live site), there is
**no CORS, no API base, no extra config**.

## 1. Install the widget

```bash
npm install netlify-identity-widget
```

## 2. Copy the files

| File in this kit | Destination | Action |
|---|---|---|
| `src/components/identity.tsx` | `src/components/identity.tsx` | **new** — provider + `useIdentity()` hook |
| `src/components/identity-button.tsx` | `src/components/identity-button.tsx` | **new** — account chip |
| `src/app/layout.tsx` | `src/app/layout.tsx` | **replace** — wraps app in `<IdentityProvider>` |

## 3. Drop the chip into the TopBar

In `src/components/Shell.tsx`, inside `TopBar`, add the chip as the last element
of the top-right container (after the mobile search conditional, before the
container's closing `</div>`):

```tsx
      <div className={cn("ml-auto flex shrink-0 items-center gap-1.5", !onSearchScreen && "md:ml-0")}>
        {!onSearchScreen && (
          <button /* …existing mobile search entry… */
          </button>
        )}
        <IdentityButton />   {/* ← add this line */}
      </div>
```

And at the top of `Shell.tsx`:

```tsx
import { IdentityButton } from "@/components/identity-button";
```

## 4. How accounts work with your current settings

Your dashboard shows **Registration: Invite only** — so:

- **Invite a friend**: Netlify dashboard → Identity → **Users** → **Invite users**
  → they get an email → accept → set a password → they can sign in
  (email or the Google button) via the chip.
- **Want self-serve signup?** Identity → Registration → Configure → **Open**.
  The widget then offers full signup + Google sign-in.
- **Google button**: appears in the widget automatically once the Google
  provider is fully configured (Identity → Services → Google → your OAuth
  client ID/secret + authorized redirect). If it's missing in the widget, that
  setup is incomplete — email login works regardless.

## 5. What Identity does (and doesn't) do in Wave right now

- The chip manages sessions; nothing is gated yet — the app plays exactly as
  before whether signed in or not. Identity is the foundation for the next
  feature: **per-user synced playlists / listening history** — key every record
  by `user.id` from `useIdentity()`.
- Sessions persist via localStorage, so users stay signed in across visits —
  including inside the Android TWA (it shares the browser's storage).

## Notes & gotchas

- **`next dev` on localhost** has no Identity service; the provider
  automatically borrows `https://wave-musical.netlify.app/.netlify/identity`
  (constant `SITE_IDENTITY_URL` in `identity.tsx` — update if the domain changes).
- **Inside the installed APK (TWA)**: email/password login always works. The
  Google popup opens as a Chrome Custom Tab — test it once; if a device
  mishandles the popup, sign in on the browser once and the session carries
  into the app.
- **Invite links** open on the website URL — new users complete invites in the
  browser, then sign in inside the app whenever.
- The widget is same-origin → your `/api/*` CORS middleware from the old
  Capacitor kit is NOT needed here (and shouldn't be deployed at all).
