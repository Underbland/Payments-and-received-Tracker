// Turns on Facebook sign-in for the Android app.
// Usage:  node scripts/enable-facebook.mjs <FACEBOOK_APP_ID> <FACEBOOK_CLIENT_TOKEN>
// (App ID: Facebook developer dashboard -> Settings -> Basic. Client token: Settings -> Advanced.)
import fs from 'node:fs';

const [appId, token] = process.argv.slice(2);
if (!appId || !token || !/^\d+$/.test(appId)) {
  console.error('Usage: node scripts/enable-facebook.mjs <FACEBOOK_APP_ID (digits)> <FACEBOOK_CLIENT_TOKEN>');
  process.exit(1);
}

const edit = (file, fn) => { const before = fs.readFileSync(file, 'utf8'); const after = fn(before); if (after !== before) fs.writeFileSync(file, after); return after !== before; };

// 1) include the Facebook library in the build
edit('android/variables.gradle', (s) => s.replace('rgcfaIncludeFacebook = false', 'rgcfaIncludeFacebook = true'));

// 2) Facebook ids
edit('android/app/src/main/res/values/strings.xml', (s) => {
  if (s.includes('facebook_app_id')) return s;
  return s.replace('</resources>',
    `    <string name="facebook_app_id">${appId}</string>\n    <string name="fb_login_protocol_scheme">fb${appId}</string>\n    <string name="facebook_client_token">${token}</string>\n</resources>`);
});

// 3) manifest entries (inside <application>)
edit('android/app/src/main/AndroidManifest.xml', (s) => {
  if (s.includes('com.facebook.sdk.ApplicationId')) return s;
  const block = `
        <meta-data android:name="com.facebook.sdk.ApplicationId" android:value="@string/facebook_app_id"/>
        <meta-data android:name="com.facebook.sdk.ClientToken" android:value="@string/facebook_client_token"/>
        <activity android:name="com.facebook.FacebookActivity" android:configChanges="keyboard|keyboardHidden|screenLayout|screenSize|orientation" android:label="@string/app_name"/>
        <activity android:name="com.facebook.CustomTabActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="@string/fb_login_protocol_scheme" />
            </intent-filter>
        </activity>
`;
  return s.replace('    </application>', block + '    </application>');
});

// 4) show the Facebook button
edit('src/config.js', (s) => s.replace("export const providers = ['google'];", "export const providers = ['google', 'facebook'];"));

console.log('Facebook sign-in switched on. Next: build the app again (push to GitHub, or npm run android).');
