# Couple Compatibility Test (Netlify + Firebase)

A mobile-first, WhatsApp-shareable **research-informed** compatibility web app for couples.

## Features

- Unique Invite ID generation for pairing two people in one session.
- Real-time pairing + updates using Firestore `onSnapshot`.
- Anonymous Firebase Auth (no names/emails/phone numbers stored).
- 15 psychologically grounded Likert-scale questions (1–7).
- Category breakdown:
  - Personality alignment
  - Attachment/Security alignment
  - Conflict & repair style alignment
  - Values & life priorities alignment
  - Boundaries & trust alignment
- Transparent scoring algorithm with mild complementarity tolerance on selected questions.
- Local draft persistence + Firestore sync while answering.
- Delete session data button.

## File structure

- `index.html`
- `styles.css`
- `firebase.js`
- `app.js`
- `README.md`

## 1) Create Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a project.
2. In **Build → Authentication → Sign-in method**, enable **Anonymous**.
3. In **Build → Firestore Database**, create a database in production mode.
4. In **Project settings → General → Your apps**, create a Web app and copy config values.

## 2) Configure the app

Open `firebase.js` and replace the remaining `REPLACE_ME` values (`apiKey`, `messagingSenderId`, `appId`) in `firebaseConfig`.

This repo is prefilled with your project identifiers:
- `projectId`: `deepmatch-15625`
- `authDomain`: `deepmatch-15625.firebaseapp.com`
- `databaseURL`: `https://deepmatch-15625-default-rtdb.firebaseio.com/`

> Note: the app uses **Firestore** for syncing, while `databaseURL` points to Realtime Database and is optional here.

## 3) Firestore Security Rules (recommended)

Use anonymous auth and these rules so only participants in a session can read/write that session:

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      function isParticipant() {
        return request.auth != null
          && (
            resource.data.participants.A.authUid == request.auth.uid
            || resource.data.participants.B.authUid == request.auth.uid
          );
      }

      allow create: if request.auth != null
        && request.resource.data.participants.A.authUid == request.auth.uid;

      allow read, update, delete: if isParticipant();
    }
  }
}
```

This implementation stores both a local anonymous browser `userId` and Firebase Anonymous `auth.uid`, and rules above should rely on `auth.uid` for access control.

If you choose no-auth mode, your data is vulnerable to unauthorized access unless rules are more permissive. Anonymous auth is strongly recommended.

## 4) Local run (for development)

Because Firebase Auth/Firestore are origin-sensitive, avoid opening with raw `file://` URL for full functionality.

Use a static server:

```bash
npx serve .
```

Then open the shown localhost URL.

## 5) Deploy to Netlify

### Option A: Drag-and-drop
1. Zip the project folder.
2. In Netlify dashboard, choose **Add new site → Deploy manually**.
3. Drag the folder/zip.

### Option B: GitHub
1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Build command: *(leave empty)*
4. Publish directory: `.`

No build step is needed.

## Scoring model summary

- For each question: `similarity = 1 - abs(a-b)/6`, converted to %.
- Category score = average of 3 question scores.
- Overall score = weighted average of category scores (`CATEGORY_WEIGHTS` in `app.js`, default equal weights).
- Nuance: questions 2, 3, and 15 use a mild tolerance band where differences up to 2 points still score relatively high before dropping faster.

## Privacy notes

- Stored data: session ID, anonymous local `userId`, timestamps, numeric answers.
- Not stored: name, email, phone number.
- Use the in-app **Delete session data** button to remove the Firestore document.

## Optional Firestore indexes

No composite indexes are required for this implementation.
