import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getAuth } from "firebase/auth"; 

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
    if (err.code == 'failed-precondition') {
      console.warn('Gagal mengaktifkan cache: Banyak tab aplikasi terbuka.');
    } else if (err.code == 'unimplemented') {
      console.warn('Browser ini tidak mendukung cache lokal Firebase.');
    }
  });
export const auth = getAuth(app); 
// GoogleAuthProvider dihapus
