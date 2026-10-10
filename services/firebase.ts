import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getAuth } from "firebase/auth"; 
import { syncDebug } from '../utils/syncDebug';

const firebaseConfig = {
  apiKey: "AIzaSyCVe3kA9kTNvGt82laTPvIFgDrWA29VYNA",
  authDomain: "nexus-note-18dd3.firebaseapp.com",
  projectId: "nexus-note-18dd3",
  storageBucket: "nexus-note-18dd3.firebasestorage.app",
  messagingSenderId: "756592567968",
  appId: "1:756592567968:web:0458251c1ce993a0ba8bc5"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// Mengaktifkan sistem hybrid (Offline Persistence)
enableIndexedDbPersistence(db)
  .catch((err) => {
    // [DEBUG] Catat alasan cache offline gagal aktif
    let alasan = err.message;
    if (err.code == 'failed-precondition') {
        alasan = 'Banyak tab aplikasi terbuka — hanya satu tab yang boleh memakai cache Firestore.';
    } else if (err.code == 'unimplemented') {
        alasan = 'Browser ini tidak mendukung cache lokal Firebase.';
    }
    syncDebug.warn('sistem', 'CACHE_OFFLINE_GAGAL',
      `Cache offline Firestore tidak aktif: ${alasan}`,
      { code: err.code, akibat: 'Tulisan saat offline tidak akan tertahan di cache perangkat.' });
  });
export const auth = getAuth(app); 
// GoogleAuthProvider dihapus

// [DEBUG] Inisialisasi tercatat agar terlihat apakah modul firebase dimuat di depan
syncDebug.info('sistem', 'FIREBASE_DIMUAT', 'Firebase Firestore & Auth siap digunakan',
  { projectId: firebaseConfig.projectId });
