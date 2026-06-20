# shared-bookmarks

# Shared Bookmarks

A Chrome extension that turns a normal bookmarks folder into a collaborative space. Pick a room code, share it with a group, and any page someone saves into their **📚 Shared Bookmarks** folder shows up for everyone else — automatically.

## How it works

- Join a room with a name and a shared room code.
- A **📚 Shared Bookmarks** folder appears in your real Chrome bookmarks.
- Save any page into it (or use the popup's "Add this page" button) and it syncs to everyone in the room within seconds.
- Bookmarks others add land in that same folder on your machine. Remove one and it's removed for everyone.
- Only bookmarks inside the shared folder are synced — everything else in your browser stays private.

A small Firestore database in the cloud acts as the shared room; each browser keeps its own bookmarks folder in sync with it.

## Tech

- **Manifest V3** Chrome extension (popup + background service worker)
- **`chrome.bookmarks`** API for reading/writing real browser bookmarks
- **`chrome.alarms`** for background sync while the popup is closed
- **Cloud Firestore** as the shared backend, accessed over its REST API (no SDK bundled)
- Vanilla HTML / CSS / JavaScript — no build step

## Project structure

```
shared-bookmarks/
├── manifest.json     # extension config + permissions
├── popup.html        # the popup UI
├── popup.js          # room join, viewer, add button
└── background.js     # two-way sync between the room and the bookmarks folder
```

## Setup

1. Create a free Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add a **Cloud Firestore** database (start in test mode).
3. In Project settings → General, copy your **Project ID** and **Web API Key**.
4. Paste both into the `CONFIG` block at the top of `popup.js`.
5. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder.
6. Open the popup, enter a name and room code, and start bookmarking.

## Notes & limitations

- Firestore **test-mode rules are open** and expire after ~30 days. Lock down the security rules (and add authentication) before any real public use.
- The Firebase web API key is safe to ship in client code — it identifies the project but isn't a secret. Access is controlled by Firestore rules, not the key.
- If two people save the exact same URL at the same moment, a brief duplicate can appear before the next sync settles.

## Possible next steps

- Google sign-in so rooms are private to invited members
- Real-time updates (websocket listeners) instead of polling
- Per-person choice of which bookmarks folder mirrors the room
