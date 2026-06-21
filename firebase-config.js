// ============================================================
// FIREBASE CONFIG
// ============================================================
// Ye aapke "laptopgallery-42411" Firebase project ka asli config hai.
// Isko change karne ki zaroorat nahi hai.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcNZjb3x6Afv0aFpzw2_QFoWhkqn-ZAbE",
  authDomain: "laptopgallery-42411.firebaseapp.com",
  projectId: "laptopgallery-42411",
  storageBucket: "laptopgallery-42411.firebasestorage.app",
  messagingSenderId: "772232753536",
  appId: "1:772232753536:web:3e3641804066457b89165"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
