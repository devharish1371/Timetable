// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDmytz4_wUJz_Mn4342B4k7JH6ceb3XIdA",
  authDomain: "timetable-db85b.firebaseapp.com",
  projectId: "timetable-db85b",
  storageBucket: "timetable-db85b.firebasestorage.app",
  messagingSenderId: "43670290542",
  appId: "1:43670290542:web:5f3fcf211a2c66fde8667f",
  measurementId: "G-QMP0FT8X0N",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Analytics — fire and forget, non-critical
try { getAnalytics(app); } catch (_) {}
