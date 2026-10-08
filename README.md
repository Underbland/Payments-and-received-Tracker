# Bill tracker

Bills to pay (ranked by urgency), paid bills, and a history of money paid or received through BCEL One, APB Meporm and LDB.
English and Lao. One code base gives you a website, an installable web app (iPhone, Windows, macOS, Android) and an Android APK.

Only bills and payment history are stored: amount, date, bank, a short note and the transaction code (used to avoid adding the same payment twice).
No balances, account numbers or messages are saved.

## What is tested and what is not

Tested while building this: the web app builds, the bank-text parser passes `npm test`, the Android project is generated and configured.
**Not tested** (needs your accounts or devices): the APK build itself, Google and Facebook sign-in, cloud saving, and the iPhone install.
Expect to fix small things the first time. The steps below follow the plugin's own setup guides.

## 1. Try it on your computer (no accounts needed)

```
npm install
npm run dev
```

Without Firebase the app works and keeps data on the device only, with the "not saved" warning shown.

## 2. Create the Firebase project (free plan is enough)

1. Go to https://console.firebase.google.com and create a project.
2. Build > Authentication > Get started > Sign-in method: turn on **Google**.
3. Build > Firestore Database > Create database. Then open the Rules tab, paste the contents of `firestore.rules`, and publish.
4. Project settings > Your apps > add a **Web** app. Copy its settings into `src/config.js` (replace the PASTE values).

Now the website version has sign-in and cloud saving.

## 3. Android app: sign-in files

1. Project settings > Your apps > add an **Android** app.
   Package name: `com.billtracker.app` (see "Changing the app ID" below).
   SHA-1: `85:F5:D9:42:71:37:7C:7A:84:AC:5B:CD:5B:6A:E7:6B:A9:B2:3B:24`
   (this is the key stored in `android/app/bill-tracker-debug.keystore`; it does not change between builds).
2. Download `google-services.json` and put it in `android/app/`.

## 4. Build the APK without Android Studio

1. Create a **private** repository on GitHub and push this folder to it (the signing key is inside the project, so keep it private).
2. Open the Actions tab > "Build Android APK" > Run workflow. It also runs on every push to `main`.
3. When it finishes, download the `bill-tracker-apk` artifact, unzip it, and send `app-debug.apk` to your phone.
   Allow "install unknown apps" for the app you open it with.

With Android Studio instead: `npm run android`, then press Run.

## 5. Facebook sign-in (optional, do after Google works)

1. Create an app at https://developers.facebook.com, add **Facebook Login**, and note the App ID and Client Token.
2. Firebase > Authentication > Sign-in method > Facebook: paste the App ID and App Secret.
   Copy the OAuth redirect URI Firebase shows into the Facebook app's Valid OAuth Redirect URIs.
3. For the Android app, also add the package name `com.billtracker.app` and your key hash on the Facebook app's Android settings.
4. Run: `node scripts/enable-facebook.mjs <APP_ID> <CLIENT_TOKEN>` and build again.

## 6. Website

```
npm run build
npx firebase-tools login
npx firebase-tools init hosting     # choose the existing project, folder: dist, single-page app: No, do not overwrite files
npx firebase-tools deploy --only hosting,firestore:rules
```

Then in Firebase > Authentication > Settings > Authorized domains, make sure your website address is listed.

## 7. Install on other devices

- **iPhone**: open the website in Safari > Share > Add to Home Screen. Sign in from the Safari tab first if the home-screen version cannot open the sign-in window.
- **Windows / macOS**: open the website in Chrome or Edge and choose Install (icon in the address bar).
- **A real iPhone app** needs a Mac, Xcode and an Apple developer account: `npm i @capacitor/ios`, `npx cap add ios`, then follow the plugin's iOS steps. Not set up here.

## Notes

- Bank screenshots and messages: in History > Add money entry you can pick one or more **screenshots**, or paste a bank message or a whole statement. The app reads the text on the device (nothing is uploaded or stored), fills in what it recognizes, and you review every entry before it is saved. Entries already in your history, or repeated in two overlapping screenshots, are not added twice.
  The reader is a built-in text reader (OCR) with English data. It reads digits, dates, + and - signs and bank codes well, but not Lao words, and it can misread a blurry or cropped screenshot, so always check the amounts. It was tested on one APB Meporm screenshot. Wording from BCEL One and LDB may need adjusting in `src/parse.js` (add examples to `tests/parse.test.mjs` and run `npm test`).
  The reader files (about 11 MB) are copied into `public/ocr` automatically by `npm run dev` and `npm run build`.
- Reading bank notifications automatically is possible on Android only and is not included.
- Changing the app ID: edit `appId` in `capacitor.config.json`, `namespace` and `applicationId` in `android/app/build.gradle`, `package_name` and `custom_url_scheme` in `android/app/src/main/res/values/strings.xml`, and move `android/app/src/main/java/com/billtracker/app/` to match. Do this before registering the app in Firebase, and use the same ID there.
- Releasing on Google Play needs your own release key; the included key is for personal installs.
- Wording in Lao is in `src/i18n.js`; have a Lao speaker check it.
