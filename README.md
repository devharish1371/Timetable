# Weekly Timetable

A personal weekly timetable app with real-time Firebase sync, PIN lock, and responsive mobile/desktop layout.

## 🔗 Live App
**https://devharish1371.github.io/Timetable/**

## Features
- 🔐 **PIN Lock** (4-digit PIN with AES-256 encryption — data is encrypted before reaching Firebase)
- 🔄 **Real-time sync** across all devices via Firebase Firestore
- 📱 **Mobile-friendly** — swipe between days, floating add button
- 🖥️ **Desktop** — drag to create blocks, resize, move
- 🏷️ **Categories** with custom colors
- 📊 **Weekly stats** sidebar
- 🔍 **Search** to highlight blocks
- 📋 **Copy week summary** to clipboard
- ↩️ **Undo** deleted blocks

## Deploy Updates
```bash
npm run deploy
```

## Firebase Setup
- Firestore rules must allow read/write (data is encrypted client-side, PIN required to decrypt)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
