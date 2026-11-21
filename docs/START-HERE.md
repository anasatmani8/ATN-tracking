# Start here: from this repository to the App Store and Google Play

This guide is for someone who has never published an app. Follow the steps **in order**. Each step says what you need, where to click, and how you know it worked. Tick the boxes as you go.

You do **not** need a Mac. The apps are built in the cloud by Expo (EAS).

---

## What it costs and how long it takes

| Item | Cost (check the site, prices change) | Waiting time |
| --- | --- | --- |
| GitHub (you already have it) | Free | — |
| Expo account (builds the apps in the cloud) | Free plan is enough to start (limited builds per month) | — |
| Apple Developer Program | About US$99 per year | Approval: 1 day to 2 weeks |
| Google Play developer account | About US$25 once | Identity check: a few days |
| Google Play testing period for new personal accounts | Free | At least 14 days with testers (see Step 13) |
| A support email address | Free (e.g. Gmail) | — |
| Privacy policy web page | Free with GitHub Pages | — |
| Cloud sync server (Supabase) | **Skip for the first release** | — |

**Recommendation:** publish the first version **without online accounts** (no cloud sync). The app already works fully offline. It is simpler, cheaper, and needs far less paperwork: no account deletion system, no server, and "Data not collected" on the stores. You can add sync in a later update (Step 16).

---

## The order at a glance

1. Merge the pull request
2. Make `main` the default branch
3. Start the Apple and Google sign-ups (they take days, so start early)
4. Choose the app name and the app IDs
5. Create the support email
6. Put your values in `app.settings.json`
7. Publish the privacy, support and data-deletion pages
8. Prepare your computer
9. Create the Expo account and link the project
10. Build the Android test app and install it on your phone
11. Build the iPhone test app and install it with TestFlight
12. Test on both phones and send me the results
13. Google Play: store listing, internal test, closed test, production
14. App Store: listing and review
15. After launch: updates
16. Later: cloud sync and accounts

---

## Step 1 — Merge the pull request

The app code is in a pull request (a proposal to add the code to your main branch).

1. Open <https://github.com/anasatmani8/ATN-tracking/pulls>.
2. Click the pull request named **"Kinset: offline-first fitness app (iOS, Android)"**.
3. Scroll to the bottom. Click the green **Merge pull request** button, then **Confirm merge**.
4. You may click **Delete branch** afterwards. It is safe; the code is now in `main`.

- [ ] Done when the pull request shows a purple **Merged** label.

## Step 2 — Make `main` the default branch

1. In your repository, click **Settings** (top bar, gear icon).
2. In **General**, find **Default branch**. Click the two-arrows button next to the branch name.
3. Choose **main**, click **Update**, then confirm.

- [ ] Done when the repository front page shows `main` in the branch selector.

> Your repository is **public**: anyone can read the code. Nothing secret is in it. If you want it private, use Settings → General → Danger Zone → Change visibility. Note that GitHub Pages (Step 7) on a private repository needs a paid GitHub plan.

## Step 3 — Start the Apple and Google sign-ups now

These take days, so start them first and continue with the other steps while you wait.

### 3a. Apple Developer Program

1. Make sure your Apple Account (Apple ID) has **two-factor authentication** on (iPhone: Settings → your name → Sign-In & Security).
2. Go to <https://developer.apple.com/programs/enroll/> and click **Start your enrollment**.
3. Choose **Individual** (publishes under your own name) or **Organization** (publishes under a company name; needs a free D-U-N-S number for your company, which can take extra days).
4. Pay the yearly fee.

- [ ] Done when you receive the "Welcome to the Apple Developer Program" email.

### 3b. Google Play Console

1. Go to <https://play.google.com/console/signup> with the Google account you want to own the app.
2. Choose **Yourself** (personal) or **An organization**.
3. Pay the one-time fee and complete **identity verification** (ID document; organizations also need a D-U-N-S number).

- [ ] Done when you can open <https://play.google.com/console> and see "Create app".

## Step 4 — Choose the app name and the app IDs

"Kinset" is only a placeholder. Pick your real name now, because the IDs below **cannot be changed after publishing**.

1. **App name** (what people see), at most 30 characters. Search the App Store and Google Play to check nobody uses it already. Searching your country's trademark office (or <https://branddb.wipo.int>) is a good idea too.
2. **App ID**, one value used for both stores, written backwards like a web address:
   - Format: `com.yourname.appname`, e.g. `com.anasatmani.kinset`
   - Use only lowercase letters, numbers and dots. No spaces, no dashes, no accents. Each part must start with a letter.
   - It is permanent once the app is published.

- [ ] Written down: app name `__________` and app ID `__________`.

## Step 5 — Create a support email address

The stores show this email publicly, so do not use your personal address.

1. Create a free address, for example on Gmail: `yourappname.support@gmail.com`.
2. Check it regularly. Reviewers and users will write to it.

- [ ] Written down: support email `__________`.

## Step 6 — Put your values in `app.settings.json`

You can do this in the browser, no computer setup needed.

1. In your repository on github.com, open the file **`app.settings.json`**.
2. Click the **pencil icon** (Edit this file).
3. Change the values (keep the quotes):

```json
{
  "appName": "YourAppName",
  "slug": "yourappname",
  "scheme": "yourappname",
  "iosBundleId": "com.yourname.yourappname",
  "androidPackage": "com.yourname.yourappname",
  "supportEmail": "yourappname.support@gmail.com",
  "privacyUrl": "https://anasatmani8.github.io/ATN-tracking/privacy.html",
  "termsUrl": "",
  "accountDeletionUrl": "https://anasatmani8.github.io/ATN-tracking/delete-data.html",
  "easProjectId": "",
  "easOwner": ""
}
```

   - `slug` and `scheme`: your app name in lowercase, no spaces (e.g. `kinset`).
   - Leave `easProjectId` and `easOwner` empty for now (filled in at Step 9).
4. Click **Commit changes…**, keep "Commit directly to the main branch", and click **Commit changes**.

- [ ] Done when the file on github.com shows your values.

## Step 7 — Publish the privacy, support and data-deletion pages

Both stores require a privacy policy link. The pages are already written in the `docs` folder; you only fill in your details and switch on GitHub Pages.

1. On github.com, open each of these files, click the pencil, and replace every `[FILL IN: …]` with your details (name, country, email, date):
   - `docs/privacy.html`
   - `docs/support.html`
   - `docs/delete-data.html`
   - `docs/index.html`

   Tip: inside the editor press Ctrl+F (Cmd+F on Mac) and search `FILL IN`. Also replace "Kinset" with your app name. In `privacy.html`, delete the sentence in square brackets about Open Food Facts (online barcode lookup is off).
2. Commit each file.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose branch **main** and folder **/docs**, and click **Save**.
5. Wait 1 to 5 minutes, then open <https://anasatmani8.github.io/ATN-tracking/privacy.html>.

- [ ] Done when the privacy page opens in your browser with your details.

> The privacy text is a draft based on how the app actually works. It is not legal advice. If you can, have someone familiar with the law in your country read it.

## Step 8 — Prepare your computer (Windows or Mac)

You need three free programs, installed once.

1. **Node.js**: go to <https://nodejs.org>, download the **LTS** version, and install it with the default options.
2. **Git**: go to <https://git-scm.com/downloads> and install it with the default options.
3. **A terminal**: on Windows use **PowerShell** (Start menu → type "PowerShell"); on Mac use **Terminal** (Spotlight → "Terminal").

Then type these commands in the terminal, one line at a time, pressing Enter after each:

```bash
node --version
git --version
cd Desktop
git clone https://github.com/anasatmani8/ATN-tracking.git
cd ATN-tracking
npm ci
```

- `node --version` should print a number starting with `v22` or higher.
- `npm ci` downloads the app's libraries and takes a few minutes.

- [ ] Done when `npm ci` finishes without red "ERR!" lines.

**Optional: see the app on your computer now.** Run `npm run web` and open the address it prints (usually <http://localhost:8081>). Press Ctrl+C in the terminal to stop it.

> Every later command in this guide is typed inside this `ATN-tracking` folder. If you close the terminal, reopen it and type `cd Desktop/ATN-tracking` first. If you edited files on github.com after cloning, run `git pull` to get the latest version.

## Step 9 — Create the Expo account and link the project

1. Create a free account at <https://expo.dev/signup>. Note your **username**.
2. In the terminal:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

   - `login` asks for your Expo email and password.
   - `init` creates the project on Expo and prints a **project ID** (a long code like `a1b2c3d4-…`). It may say it cannot edit the config automatically. That is expected.
3. Open `app.settings.json` (on github.com, or in any text editor on your computer) and fill in:
   - `"easProjectId": "the long code printed by init"`
   - `"easOwner": "your Expo username"`
4. Save it to GitHub. On github.com: edit, then commit. Or in the terminal:

```bash
git add app.settings.json
git commit -m "Link Expo project"
git push
```

- [ ] Done when your project appears at <https://expo.dev> under Projects.

## Step 10 — Build the Android test app and install it on your phone

```bash
npx eas-cli@latest build --profile preview --platform android
```

1. When asked **"Generate a new Android Keystore?"**, answer **Yes**. Expo stores this signing key safely for you.
2. The build runs in the cloud. It takes about 10 to 30 minutes (longer in the free queue). You can close the terminal; progress is also visible on expo.dev.
3. When it finishes, you get a link and a QR code. Open the link **on your Android phone** and download the file.
4. Open the downloaded file. If Android asks, allow **Install unknown apps** for your browser, then install.

- [ ] Done when the app opens on your Android phone and shows the setup screen.

## Step 11 — Build the iPhone test app and install it with TestFlight

You need the Apple Developer membership from Step 3a. The test version reaches your iPhone through Apple's **TestFlight** app.

```bash
npx eas-cli@latest build --profile production --platform ios
```

1. When asked, **log in with your Apple Account**, and let EAS **create and manage the certificates** (answer Yes to its questions).
2. When the build finishes, send it to Apple:

```bash
npx eas-cli@latest submit --platform ios --latest
```

   If asked, let EAS **create the app in App Store Connect** for you.
3. Wait 10 to 30 minutes for Apple to process the build. You get an email when it is ready.
4. Open <https://appstoreconnect.apple.com> → **Apps** → your app → **TestFlight**. Under **Internal Testing**, create a group, add yourself (your Apple Account email) and select the build.
5. On your iPhone, install **TestFlight** from the App Store, open the invitation email, and tap **Install**.

- [ ] Done when the app opens on your iPhone.

## Step 12 — Test on both phones and send me the results

Try each item on **both** phones. Write down what happens if something looks wrong (a screenshot helps).

- [ ] First launch: go through setup, choose "Dumbbells at home" and a plan
- [ ] Turn on **airplane mode**, start today's workout, tap the big check button on the first set
- [ ] Close the app completely (swipe it away), reopen: the set is still ticked and the rest timer is still counting
- [ ] Restart the phone in the middle of a workout and reopen: same result
- [ ] Finish the workout: the summary shows sets, volume, reps
- [ ] Today: tap **+250 mL** twice, then **Undo**: Recovery shows 250 mL
- [ ] Log last night's sleep 23:30 → 07:00 with 30 min awake: it shows 7 h
- [ ] Nutrition → Add → **Scan**: allow the camera, scan a product barcode. Then try again after denying the camera in phone Settings: typing the code must still work
- [ ] Recovery → Reminders → add a reminder a few minutes from now: allow notifications, and check it arrives. Tap it: the app opens on the right screen
- [ ] Phone Settings → largest text size: the screens are still readable
- [ ] Phone Settings → dark mode: the screens are still readable
- [ ] iPhone: VoiceOver on (Settings → Accessibility). Android: TalkBack on. Can you start a workout and complete a set?
- [ ] Profile → Privacy and data → **Export everything**: a file is offered to save or share

**Then send me:** your phone models, what worked, what didn't (with screenshots). I fix the problems and push new commits; you repeat Steps 10 and 11 to get the fixed version.

## Step 13 — Google Play: listing, internal test, closed test, production

### 13a. Build the store version

```bash
npx eas-cli@latest build --profile production --platform android
```

When it finishes, open the build on <https://expo.dev> and click **Download** to get the `.aab` file.

### 13b. Create the app in Play Console

1. <https://play.google.com/console> → **Create app**.
2. App name: yours. Default language: English. Type: **App**. Free. Accept the declarations. Click **Create app**.

### 13c. First upload (must be done by hand the first time)

1. **Test and release → Testing → Internal testing → Create new release**.
2. Accept **Play App Signing** if asked.
3. Upload the `.aab` file, add a release note ("First test version"), then **Next** and **Save and publish** (or **Start rollout**).
4. In the **Testers** tab, create an email list with your own Gmail and open the opt-in link on your phone.

### 13d. Fill in "Set up your app" (Dashboard)

Answers that match this app as built (no accounts, no ads):

| Section | What to choose |
| --- | --- |
| Privacy policy | `https://anasatmani8.github.io/ATN-tracking/privacy.html` |
| App access | All functionality is available without special access |
| Ads | No, my app does not contain ads |
| Content rating | Fill in the questionnaire; this app has no violence, gambling or user-to-user content |
| Target audience | 18 and over |
| Data safety | Does your app collect or share user data? **No** |
| Health apps declaration | Select fitness, nutrition and sleep tracking. It does **not** use Health Connect. Not a medical device |
| Government app / financial features | No |
| App category | Health & Fitness |
| Store listing | Short and full description from `docs/store-listing.md`; app icon `assets/images/store-icon-512.png`; screenshots taken on your phone (at least 2); a feature graphic 1024×500 (ask me and I can generate one) |

### 13e. Closed testing (required for new personal accounts)

Google requires new **personal** developer accounts to run a **closed test** with a minimum number of testers (Play Console shows the current number, recently 12) for at least **14 days in a row** before you can publish to everyone.

1. **Testing → Closed testing → Create track**, upload the same `.aab` (or a newer one), add a tester email list.
2. Invite friends and family with Android phones. They must accept the opt-in link and keep the app installed for the whole period.
3. After the 14 days, Play Console shows **Apply for production**. Answer the questions about your test.

### 13f. Production

**Test and release → Production → Create new release**, choose the build, then **Send for review**. Review usually takes a few days.

- [ ] Done when the app is visible on Google Play.

## Step 14 — App Store: listing and review

1. <https://appstoreconnect.apple.com> → your app → **App Store** tab → the "1.0 Prepare for Submission" version.
2. Fill in:

| Field | What to put |
| --- | --- |
| Screenshots | Take them on your iPhone (the sizes App Store Connect asks for), or ask me to generate them |
| Promotional text, description, keywords | From `docs/store-listing.md` |
| Support URL | `https://anasatmani8.github.io/ATN-tracking/support.html` |
| Privacy Policy URL (App Information) | `https://anasatmani8.github.io/ATN-tracking/privacy.html` |
| Category | Health & Fitness |
| Age rating | Fill in the questionnaire (no objectionable content) |
| App Privacy | **Data Not Collected** |
| Pricing | Free |
| Build | Select the build you tested in TestFlight |
| App Review notes | Copy the "App Review notes" section from `docs/store-listing.md`. Sign-in required: **No** |

3. Click **Add for Review**, then **Submit to App Review**. Apple usually replies within 1 to 3 days. If they reject something, send me their message.

- [ ] Done when the status is **Ready for Distribution**.

## Step 15 — After launch: how updates work

1. Ask me for the change. I commit and push it, then open a pull request you merge (as in Step 1).
2. On your computer:

```bash
git pull
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --platform ios --latest
```

3. For Android, upload the new `.aab` in Play Console (Production → Create new release), or ask me to set up automatic Android submission.

Build numbers go up automatically. Change `version` in `app.config.ts` (for example `1.0.0` → `1.1.0`) when you want users to see a new version number.

## Step 16 — Later: cloud sync and accounts (optional)

Only after the first release is live. It requires a Supabase project, account-deletion pages, and new privacy and data-safety answers. Instructions: `supabase/README.md` and `docs/privacy-and-data-safety.md`. Tell me when you want to do it and I will guide you through it.

**AI coach (optional, after cloud sync works).** The suggestion cards and their Apply/Undo work in every build with no setup. Chat needs: (1) cloud sync set up as above; (2) an API key from Anthropic (console.anthropic.com) or OpenAI (platform.openai.com) with billing and a monthly spending limit; (3) the `supabase secrets set …` and `supabase functions deploy coach` commands in `supabase/README.md` step 5; (4) the AI coach paragraph in `docs/privacy.html` filled in and the store privacy answers updated (`docs/privacy-and-data-safety.md`). The key goes only into Supabase secrets — never into `.env.local`, `app.json` or anything starting with `EXPO_PUBLIC_`.

---

## If something goes wrong

- **A command prints red errors:** copy the whole text and send it to me.
- **"command not found: npx"**: Node.js is not installed or the terminal was open before installing. Close and reopen the terminal.
- **A build fails on expo.dev:** open the build page, click the failed step, copy the log, send it to me.
- **Apple or Google rejects the app:** send me their exact message.

## Progress checklist

- [ ] 1 Pull request merged
- [ ] 2 `main` is the default branch
- [ ] 3 Apple and Google sign-ups started (approved: Apple ☐ Google ☐)
- [ ] 4 Name and app ID chosen
- [ ] 5 Support email created
- [ ] 6 `app.settings.json` filled in
- [ ] 7 Pages online
- [ ] 8 Computer ready
- [ ] 9 Expo project linked
- [ ] 10 Android test app on phone
- [ ] 11 iPhone test app via TestFlight
- [ ] 12 Test results sent
- [ ] 13 Google Play live
- [ ] 14 App Store live
