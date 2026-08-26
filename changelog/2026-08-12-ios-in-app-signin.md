# iOS: sign in and register without leaving the app (App Store Guideline 4)

- `[ios]` Google sign-in now runs in an in-app `ASWebAuthenticationSession`
  sheet instead of bouncing through Safari (App Review rejected the Safari
  roundtrip under Guideline 4 - Design).
- `[ios]` The auth screen gains a Register tab (email-first, same flow as the
  web) replacing the "Create your account on the web" Safari link.
- `[web]` Open-in-app CTAs are platform-aware on iPhone/iPad: "Open the Flow
  app" instead of "Open the desktop app", no "Download for Mac" fallback.

## Feature

- **Sign in and create your account right in the iPhone app.** Registration
  and Google sign-in no longer switch you out to Safari — everything happens
  inside Flow. (iOS)
