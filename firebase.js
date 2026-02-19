import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Replace with your Firebase project config in production.
const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'deepmatch-15625.firebaseapp.com',
  projectId: 'deepmatch-15625',
  storageBucket: 'deepmatch-15625.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
  databaseURL: 'https://deepmatch-15625-default-rtdb.firebaseio.com/'
};

const hasValidConfig = firebaseConfig.apiKey !== 'REPLACE_ME' && firebaseConfig.appId !== 'REPLACE_ME' && firebaseConfig.projectId !== 'REPLACE_ME';

let app;
let db;
let auth;

if (hasValidConfig) {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
}

export {
  hasValidConfig,
  db,
  auth,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  signInAnonymously,
  onAuthStateChanged
};
