<p align="center"><img src="public/icon.svg" width="140" alt="ReadX"></p>

# ReadX

Read books together. ReadX is like a mix of a reading app and a group chat. Your group shares a shelf of PDFs and EPUBs. Everyone can highlight passages, add notes, comments and links, and discuss them in threads and in the group chat. People can read at different times, and each reader chooses whose annotations are shown on their own pages.

The same code runs as a **website** — live at **<https://bidhanar.github.io/readx/>** — and as an **Android app**.

## Features

- **Groups.** Create a group and invite people with a link or an 8-letter code. Each group has a shared shelf, a group chat and a member list. The owner can rename the group, reset the invite code and remove members.
- **PDF and EPUB reader.** It has a realistic **page-curl** animation, with slide and (for PDFs) scroll modes too. Wide screens show a two-page spread. It also has a table of contents, full-text search with the matches outlined on the page, light, sepia and dark themes, and zoom for PDFs in scroll mode. Swipe, tap the page edges, use the arrow keys or drag a page corner to turn pages.
- **Navigation.** Drag the progress bar to jump anywhere; it previews where you'll land ("Page 120 of 300 · Chapter 7"). EPUBs get whole-book page numbers at your current screen and font size.
- **EPUB typography.** Text size, font (the book's own, serif or sans), line spacing and margins.
- **Every kind of EPUB.** Right-to-left books (Arabic, Hebrew, Persian) put the first page on the right and turn the other way. Fixed-layout books (comics, picture books) keep their designed pages, scaled to fit.
- **Annotations.** Select text to highlight it in one of 5 colours or to add a **note**, a **link** or a **discussion** (a thread with replies). Everything syncs live to everyone in the group.
- **Layers.** Show or hide each member's annotations, and each annotation type, separately for each book. This setting is private to you.
- **Reading together at different times.** Your position is saved per book. The progress bar shows where everyone else is, and tapping someone's avatar jumps to their page.
- **Share to chat.** Post a passage to the group chat. It appears as a card that opens the book at that spot.
- **Works offline, syncs later.** Read, highlight, write notes, reply and chat with no connection; everything syncs when you're back online. See [Offline](#offline).

## How it's built

```
React + TypeScript (Vite) ──┬── GitHub Pages          → website (bidhanar.github.io/readx)
                            └── Capacitor (Android)   → app
Firebase (free Spark plan):  Auth (Google sign-in) · Firestore (groups, notes, chat, progress)
Supabase (free plan):        Storage for the book files only (Firebase Storage now needs a card)
Reader:                      pdf.js · epub.js (parsing + CFI) · StPageFlip (page curl)
```

- **PDF** pages are rendered by pdf.js and fed to the page-curl engine. A text layer handles selection, and highlights are stored as page-relative rectangles.
- **EPUB** chapters are laid out in CSS columns exactly one page wide, inside sandboxed iframes, so every page can curl like a PDF page. Highlights are anchored with EPUB CFIs, so they stay attached to the same text when the font size or screen size changes.
- There's no server code. Access control is done entirely by [`firestore.rules`](firestore.rules) and [`supabase/storage-policies.sql`](supabase/storage-policies.sql).

```
src/
  auth/        Google sign-in (popup on web, native account picker on Android)
  data/        Firestore hooks & writes: groups, books, annotations, messages, progress, prefs, files
  pages/       Login, Home (groups), Group (shelf · chat · members), Join, Reader
  reader/      Pager (curl/slide/scroll), pdf/, epub/, annotations/ (selection menu, threads), panels
  upload/      PDF/EPUB metadata + cover extraction, upload
tests/         Firestore security-rules tests (emulator)
android/       Capacitor Android project
```

---

## Setup

You need **Node 22+**. To build the Android app you also need the **Android SDK** (Android Studio installs it).

```bash
npm install
cp .env.example .env.local     # then fill it in (steps below)
```

### 1. Firebase (free Spark plan, no card)

1. Go to <https://console.firebase.google.com>, choose **Add project**, and leave it on the Spark plan.
2. Go to **Build → Authentication → Get started → Sign-in method** and enable **Google**.
3. Go to **Build → Firestore Database → Create database** and pick a region. Production mode is fine, because the rules below replace the defaults.
4. Go to **Project settings → General → Your apps** and add a **Web app**. Copy `apiKey`, `authDomain`, `projectId` and `appId` into `.env.local`.
5. Deploy the security rules and indexes:
   ```bash
   npx firebase login
   npx firebase use --add           # pick your project
   npx firebase deploy --only firestore
   ```

### 2. Supabase (free plan, no card): book files

1. Go to <https://supabase.com>, create a **New project**, and wait for it to finish starting.
2. Go to **Authentication → Sign In / Providers → Third-party Auth → Add provider → Firebase** and enter your Firebase **project ID**.
3. Open the **SQL Editor** and paste [`supabase/storage-policies.sql`](supabase/storage-policies.sql). Replace `YOUR_FIREBASE_PROJECT_ID` (it appears twice), then **Run**. This creates a private `books` bucket (50 MB per file, PDF/EPUB only) that only signed-in users of *your* app can access.
4. Go to **Project settings → API** and copy the **Project URL** and the **anon public** key into `.env.local`.

> **Security note:** Supabase can't see Firestore group membership. Book files therefore live at random, unguessable paths, and only group members can learn a book's path. A signed-in user of your app who somehow got hold of a path could still download that one file. That's fine for a small private app; a paid setup would put the check in a Cloud Function.

### 3. Run it

```bash
npm run dev            # http://localhost:5173 (uses your real Firebase + Supabase)
```

**Try it without any keys:** `npm run dev:emu` starts the Firebase emulators and the app against them. Book files are then stored in your browser instead of Supabase. Sign in through the emulator's fake Google account screen.

### 4. Publish the website (GitHub Pages)

The site is served from the `readx/` folder of the [bidhanar.github.io](https://github.com/bidhanar/bidhanar.github.io) repo, which must be checked out next to this one (`../bidhanar.github.io`).

```bash
npm run deploy:gh      # builds into ../bidhanar.github.io/readx/
cd ../bidhanar.github.io && git add readx && git commit -m "Update ReadX" && git push
```

**One-time:** in the Firebase console go to **Authentication → Settings → Authorized domains → Add domain** and add `bidhanar.github.io`. Without it, Google sign-in is refused on the live site.

Notes:
- Routes use `#` (for example `…/readx/#/join/CODE`), because GitHub Pages can't send every path to the app. Invite links always use this format, wherever they're created.
- The site repo has a `.nojekyll` file, so GitHub serves the build as-is, and `.well-known/assetlinks.json` for Android app links (see below).
- After changing security rules, deploy them with `npm run deploy` (Firestore rules only).

**Prefer Firebase Hosting instead?** Build with `VITE_HASH_ROUTER=false npm run build` for clean URLs, run `npx firebase deploy --only hosting`, and set `VITE_PUBLIC_SITE_URL` to `https://<project-id>.web.app`.

---

## Android app

The Android project is in `android/`. It's a normal Capacitor project, so you can also open it in Android Studio (`npm run android`).

1. **Add the Android app to Firebase.** Go to **Project settings → Your apps → Add app → Android** and use the package name `com.readx.app`.
2. **Add your SHA-1.** Google sign-in needs it. Print it with:
   ```bash
   cd android && ./gradlew signingReport     # copy the SHA1 (and SHA-256) of the "debug" variant
   ```
   Paste the SHA-1 into the Android app's settings in Firebase.
3. **Add Firebase's config file.** Download `google-services.json` and put it at `android/app/google-services.json`. It's git-ignored.
4. **Build:**
   ```bash
   npm run apk
   # → android/app/build/outputs/apk/debug/ReadX.apk
   adb install -r android/app/build/outputs/apk/debug/ReadX.apk
   ```

**Java version:** the build works on JDK 21–25. The Gradle wrapper is pinned to 9.1, the first Gradle release that runs on Java 25. If Gradle can't download itself and you get a `Connect timed out` error, run `export JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true` first.

### App links (invite links open the app)

Links to the website (for example `https://bidhanar.github.io/readx/#/join/CODE`) open the app when it's installed. This is already set up for the debug key:

1. `android/gradle.properties` has `readxHost=bidhanar.github.io` and `readxPathPrefix=/readx/`.
2. `bidhanar.github.io/.well-known/assetlinks.json` (in the site repo) lists the app and your signing key's **SHA-256**. When you create a release key, or use Play App Signing, add that key's SHA-256 to the same list:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": { "namespace": "android_app", "package_name": "com.readx.app",
                 "sha256_cert_fingerprints": ["AA:BB:…:FF"] }
   }]
   ```
3. Push the site repo, then rebuild the APK.

### Icon

The app icon comes from [`public/icon.svg`](public/icon.svg). It's used for the browser tab, the login and home screens, the Android launcher (both legacy and adaptive icons) and the Android splash screen. If you change the SVG, ask for the PNGs in `android/app/src/main/res/mipmap-*` and `drawable*/splash.png` to be regenerated, or use Android Studio's **Image Asset** tool.

---

## Offline

ReadX is offline-first, on the website and in the Android app.

| Works offline | Needs internet |
|---|---|
| Opening the app (website: after one online visit) | Signing in the first time |
| Reading any book that's on the device | Adding a book (upload) |
| Highlights, notes, links, discussions, replies | Joining a group with a code |
| Group chat (shows *Waiting to send* until delivered) | Downloading a book you haven't opened |
| Creating groups, renaming, deleting your notes | |
| Reading position and reader settings | |

**How syncing works**
- Firestore keeps a copy of your groups, chat, notes and progress on the device, along with any changes you made offline. Changes appear instantly and are sent when the connection returns, even if you closed the app in between.
- A small pill at the bottom says when you're offline or syncing. If the server ever rejects a change (for example, you were removed from the group while offline), the pill says which change didn't sync.
- **Books on the device:** books you open or upload are kept automatically. On the shelf, use **Save offline** on a book, or **Save all offline**, to download them ahead of a trip. Downloaded books show a green *Offline* badge.
- **Website:** a service worker (`public/sw.js`) saves the whole app (about 3.5 MB) on your first visit, so the site opens offline later. Each deploy has its own cache, and old ones are cleaned up automatically. The Android app has the files built in.

## Tests

```bash
npm test               # unit tests (selection geometry)
npm run test:rules     # Firestore security rules (20 tests) against the emulator; needs Java
npm run typecheck
```

## Free-tier limits worth knowing

| Service | Free allowance | Notes |
|---|---|---|
| Firestore | 1 GiB stored, 50k reads and 20k writes per day | Plenty for a few active groups |
| Firebase Hosting | 10 GB stored, 360 MB transferred per day | |
| Supabase Storage | 1 GB total, 50 MB per file | Roughly 100–300 books |
| Supabase project | **Pauses after 7 days with no activity** | Unpause it from the dashboard with one click |

## Origin

This repository started in 2021 as a native Android app (Java + Parse) for reading one bundled PDF with shared page notes. That version is still in the git history on `master`.
