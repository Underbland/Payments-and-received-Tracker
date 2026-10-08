// 1) Create a Firebase project (https://console.firebase.google.com).
// 2) Project settings -> Your apps -> add a Web app -> copy its settings here.
// These values are not secret. Your data is protected by firestore.rules and by sign-in.
// While the values below still say PASTE, the app works without sign-in and keeps data on the device only.
export const firebaseConfig = {
  apiKey: 'AIzaSyBfGqXaav89GFTujKRXFi1M-t6HLJJ04As',
  authDomain: 'bill-tracker-projects.firebaseapp.com',
  projectId: 'bill-tracker-projects',
  storageBucket: 'bill-tracker-projects.firebasestorage.app',
  messagingSenderId: '273579098723',
  appId: '1:273579098723:web:74c135374caa7cc4516e56'
};

// Sign-in buttons to show. Add 'facebook' after you set Facebook up (see README, step 6).
export const providers = ['google'];

export const cloudEnabled = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE');
