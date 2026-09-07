import { X, Folder as FolderIcon } from 'lucide-react'; 
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Note, Folder, ViewMode, EditorHandle } from './types';
import { Editor } from './components/Editor';
import { GraphView } from './components/GraphView';
import { TopBar } from './components/TopBar';
import { HomeView } from './components/HomeView';
import { PreviewSheet } from './components/PreviewSheet';
import { SettingsView } from './components/SettingsView';
import { TractView } from './components/TractView';
import { MindmapEditor } from './components/MindmapEditor';
import { db, auth } from './services/firebase'; 
import { clearHistory as clearHistoryFromIndexedDB } from './utils/historyStore'; 
import { 
  collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, updateDoc, where 
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signOut, 
  User,
  signInWithEmailAndPassword,

  sendPasswordResetEmail,
  updateEmail
} from 'firebase/auth';

// --- HELPER: LOCAL STORAGE (Tetap sama) --
const getLocalNotes = (): Note[] => {
  try { return JSON.parse(localStorage.getItem('nexus_backup_notes') || '[]'); } catch { return []; }
};
const saveToLocalStorage = (note: Note) => {
  const local = getLocalNotes();
  const filtered = local.filter(n => n.id !== note.id);
  const next = [...filtered, note];
  try {
    localStorage.setItem('nexus_backup_notes', JSON.stringify(next));
  } catch (e) {
    // QuotaExceededError: coba sisakan 20 catatan terbaru, lalu simpan ulang
    try {
      localStorage.setItem('nexus_backup_notes', JSON.stringify(next.slice(-20)));
    } catch (e2) {
      console.warn('⚠️ Penyimpanan lokal penuh; catatan tidak disimpan offline.', e2);
    }
  }
};
const removeFromLocalStorage = (noteId: string) => {
  const local = getLocalNotes();
  const filtered = local.filter(n => n.id !== noteId);
  localStorage.setItem('nexus_backup_notes', JSON.stringify(filtered));
};
const clearLocalStorage = () => localStorage.removeItem('nexus_backup_notes');

const getLocalFolders = (): Folder[] => {
  try { return JSON.parse(localStorage.getItem('nexus_backup_folders') || '[]'); } catch { return []; }
};
const saveFolderToLocalStorage = (folder: Folder) => {
  const local = getLocalFolders();
  const filtered = local.filter(f => f.id !== folder.id);
  localStorage.setItem('nexus_backup_folders', JSON.stringify([...filtered, folder]));
};
const removeFolderFromLocalStorage = (folderId: string) => {
  const local = getLocalFolders();
  localStorage.setItem('nexus_backup_folders', JSON.stringify(local.filter(f => f.id !== folderId)));
};
const clearLocalFolders = () => localStorage.removeItem('nexus_backup_folders');

export default function App() {
  // [PERCEPAT 1] Inisialisasi User langsung dari LocalStorage!
  // Kita tidak mulai dari null, tapi kita cek apakah ada jejak login sebelumnya.
  const [user, setUser] = useState<User | null>(() => {
    const savedUid = localStorage.getItem('nexus_user_uid');
    if (savedUid) {
       // Kita buat objek user "palsu" sementara agar UI langsung render Home
       // Firebase akan menimpa ini nanti dengan objek User asli yang lebih lengkap
       return { uid: savedUid, email: null, displayName: 'Loading...' } as User;
    }
    return null;
  });

  // State Auth Loading kita hapus/tidak dipakai untuk blocking UI lagi
  // agar langsung tembus ke renderContent()

  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  // --- LOGIKA SAMPAH (AUTO DELETE 24 JAM) ---
  const notesRef = useRef(notes);
  const foldersRef = useRef(folders);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  useEffect(() => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000; 

    const cleanupTrash = async () => {
      const now = Date.now();
      const currentNotes = notesRef.current;
      const currentFolders = foldersRef.current;
      if (!currentNotes.length && !currentFolders.length) return;

      const expiredNotes = currentNotes.filter(n => n.deletedAt && (now - n.deletedAt > ONE_DAY_MS));
      expiredNotes.forEach(async (n) => {
        await deleteDoc(doc(db, "notes", n.id));
        removeFromLocalStorage(n.id);
      });

      const expiredFolders = currentFolders.filter(f => f.deletedAt && (now - f.deletedAt > ONE_DAY_MS));
      expiredFolders.forEach(async (f) => {
        await deleteDoc(doc(db, "folders", f.id));
      });
    };

    cleanupTrash();
    const timer = setInterval(cleanupTrash, 60000); 
    return () => clearInterval(timer);
  }, []); // Hanya mount sekali, tidak re-create interval saat notes berubah

  // Fungsi Soft Delete 
  const handleSoftDelete = async (noteIds: string[], folderIds: string[]) => {
    const protectedFolderNames = ["Keterhubungan"];
    const foldersToDelete = folders.filter(f => folderIds.includes(f.id));
    const isProtected = foldersToDelete.some(f => protectedFolderNames.includes(f.name));

    if (isProtected) {
        alert("Folder 'Keterhubungan' adalah folder sistem dan tidak dapat dihapus.");
        folderIds = folderIds.filter(id => {
            const folder = folders.find(f => f.id === id);
            return folder && !protectedFolderNames.includes(folder.name);
        });
        if (noteIds.length === 0 && folderIds.length === 0) return;
    }

    const time = Date.now();
    const isOffline = user?.uid === 'offline-local';

    if (isOffline) {
      noteIds.forEach(id => {
        const note = notes.find(n => n.id === id);
        if (note) {
          const updated = { ...note, deletedAt: time, updatedAt: time };
          saveToLocalStorage(updated);
          setNotes(prev => prev.map(n => n.id === id ? updated : n));
        }
      });
      folderIds.forEach(id => {
        const folder = folders.find(f => f.id === id);
        if (folder) {
          const updated = { ...folder, deletedAt: time } as Folder;
          saveFolderToLocalStorage(updated);
          setFolders(prev => prev.map(f => f.id === id ? updated : f));
        }
      });
    } else {
      const batchPromises = [
        ...noteIds.map(id => updateDoc(doc(db, "notes", id), { deletedAt: time, updatedAt: time })),
        ...folderIds.map(id => updateDoc(doc(db, "folders", id), { deletedAt: time }))
      ];
      await Promise.all(batchPromises);
    }
    alert("Item dipindahkan ke Sampah. Akan dihapus permanen dalam 24 jam.");
  };
  
  const handleRestore = async (noteIds: string[], folderIds: string[]) => {
    const isOffline = user?.uid === 'offline-local';

    if (isOffline) {
      noteIds.forEach(id => {
        const note = notes.find(n => n.id === id);
        if (note) {
          const updated = { ...note, deletedAt: undefined, updatedAt: Date.now() };
          saveToLocalStorage(updated);
          setNotes(prev => prev.map(n => n.id === id ? updated : n));
        }
      });
      folderIds.forEach(id => {
        const folder = folders.find(f => f.id === id);
        if (folder) {
          const updated = { ...folder, deletedAt: undefined } as Folder;
          saveFolderToLocalStorage(updated);
          setFolders(prev => prev.map(f => f.id === id ? updated : f));
        }
      });
    } else {
      const batchPromises = [
        ...noteIds.map(id => updateDoc(doc(db, "notes", id), { deletedAt: null })),
        ...folderIds.map(id => updateDoc(doc(db, "folders", id), { deletedAt: null }))
      ];
      await Promise.all(batchPromises);
    }
  };

  const handleHardDelete = async (noteIds: string[], folderIds: string[]) => {
    if(!confirm("Hapus permanen? Data tidak bisa dikembalikan.")) return;
    const isOffline = user?.uid === 'offline-local';

    if (isOffline) {
      noteIds.forEach(id => { removeFromLocalStorage(id); });
      folderIds.forEach(id => { removeFolderFromLocalStorage(id); });
      setNotes(prev => prev.filter(n => !noteIds.includes(n.id)));
      setFolders(prev => prev.filter(f => !folderIds.includes(f.id)));
    } else {
      noteIds.forEach(id => { deleteDoc(doc(db, "notes", id)); removeFromLocalStorage(id); });
      folderIds.forEach(id => { deleteDoc(doc(db, "folders", id)); });
    }
  };
   
  // Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoadingAuth, setIsLoadingAuth] = useState(false); 
   
  const [isResetting, setIsResetting] = useState(false); 
  const [resetMessage, setResetMessage] = useState('');

  const [showEditorMoveDialog, setShowEditorMoveDialog] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setAuthError('Mohon masukkan email Anda terlebih dahulu.');
      return;
    }
    setIsLoadingAuth(true);
    setAuthError('');
    setResetMessage('');
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage('Link reset password telah dikirim ke email! Cek inbox/spam.');
      setTimeout(() => {
        setIsResetting(false);
        setResetMessage('');
      }, 5000);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoadingAuth(false);
    }
  };

 const [dbError, setDbError] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('HOME');
  const [currentNoteId, setCurrentNoteId] = useState<string>(''); 
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>(undefined);
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);

  // State baru untuk menyembunyikan TopBar saat mode Browser Layar Penuh aktif
  const [isImmersive, setIsImmersive] = useState(false);

  const [isAutoSync, setIsAutoSync] = useState(() => {
    try {
        const saved = localStorage.getItem('nexus_auto_sync');
        return saved !== null ? JSON.parse(saved) : true; 
    } catch { return true; }
  });
   
  const [syncInterval, setSyncInterval] = useState(() => {
     try {
        const saved = localStorage.getItem('nexus_sync_interval');
        return saved ? Number(saved) : 1500;
     } catch { return 1500; }
  });

  useEffect(() => {
    localStorage.setItem('nexus_auto_sync', JSON.stringify(isAutoSync));
  }, [isAutoSync]);

  useEffect(() => {
    localStorage.setItem('nexus_sync_interval', syncInterval.toString());
  }, [syncInterval]);

  const [isReady, setIsReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error' | 'unsaved'>('idle');

  const editorRef = useRef<EditorHandle>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('nexus_theme');
      return saved !== null ? JSON.parse(saved) : false; 
    } catch { return false; }
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('nexus_theme', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  useEffect(() => {
    // Membaca URL saat aplikasi pertama kali dibuka (Direct Link)
    const path = window.location.pathname.toLowerCase();
    let initialMode: ViewMode = 'HOME';
    let initialNoteId = '';
    let currentPath = path;

    if (path === '/tractapp') {
        initialMode = 'TRACT';
    } else if (path === '/settings') {
        initialMode = 'SETTINGS';
    } else if (path === '/graph') {
        initialMode = 'GRAPH';
    } else if (path.startsWith('/editor/')) {
        initialMode = 'EDITOR';
        initialNoteId = path.replace('/editor/', '');
    } else {
        // Jika path kosong (/) atau tidak dikenali, paksa ke /home
        initialMode = 'HOME';
        currentPath = '/home'; 
    }

    setViewMode(initialMode);
    setCurrentNoteId(initialNoteId);
    window.history.replaceState({ mode: initialMode, noteId: initialNoteId }, '', currentPath);

    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        setViewMode(event.state.mode);
        setCurrentNoteId(event.state.noteId || '');
      } else {
        setViewMode('HOME');
        setCurrentNoteId('');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = useCallback((mode: ViewMode, noteId: string = '') => {
    if (viewMode === mode && currentNoteId === noteId) return;
    // --- TAMBAHAN BARU: Update lastOpenedAt saat membuka editor ---
    if (mode === 'EDITOR' && noteId && user) {
        const now = Date.now();
        
        // 1. Update State Lokal agar UI langsung berubah
        setNotes(prev => prev.map(n => 
            n.id === noteId ? { ...n, lastOpenedAt: now } : n
        ));

        const isOffline = user?.uid === 'offline-local';
        if (isOffline) {
          // Mode offline: simpan ke localStorage saja
          const note = notes.find(n => n.id === noteId);
          if (note) saveToLocalStorage({ ...note, lastOpenedAt: now });
        } else {
          // Mode online: update ke Firebase
          updateDoc(doc(db, "notes", noteId), { lastOpenedAt: now })
              .catch(err => console.error("Failed to update last opened:", err));
        }
    }
    // --------------
    setViewMode(mode);
    setCurrentNoteId(noteId);
    
    // Mengubah URL Address Bar sesuai menu yang dibuka
    let newPath = '/home'; // Default menjadi /home
    if (mode === 'TRACT') newPath = '/tractapp';
    else if (mode === 'SETTINGS') newPath = '/settings';
    else if (mode === 'GRAPH') newPath = '/graph';
    else if (mode === 'EDITOR') newPath = `/editor/${noteId}`;

    window.history.pushState({ mode, noteId }, '', newPath);
  }, [viewMode, currentNoteId, user]);

  /// Efek Otomatis untuk Mengubah Judul Tab Browser
  const activeTitleNote = useMemo(
    () => notes.find(n => n.id === currentNoteId),
    [notes, currentNoteId]
  );
  useEffect(() => {
    switch (viewMode) {
      case 'TRACT':
        document.title = 'TractApp - Lacak Aktivitas';
        break;
      case 'HOME':
        document.title = 'Beranda - Nexus Notes';
        break;
      case 'SETTINGS':
        document.title = 'Pengaturan - Nexus Notes';
        break;
      case 'GRAPH':
        document.title = 'Grafik Visual - Nexus Notes';
        break;
      case 'EDITOR':
        // Cari data catatan yang saat ini sedang aktif/dibuka
        const activeNote = activeTitleNote;
        // Jika catatan punya judul, gunakan judul tersebut murni. Jika kosong, gunakan teks default.
        document.title = activeNote && activeNote.title ? activeNote.title : 'Catatan Tanpa Judul';
        break;
      default:
        document.title = 'Nexus Notes';
        break;
    }
  }, [viewMode, currentNoteId, activeTitleNote]);
  
  // --- AUTH LISTENER & PERCEPATAN ---
  useEffect(() => {
    // Mode offline: skip Firebase auth listener
    if (user?.uid === 'offline-local') return;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
          // [PERCEPAT 2] Jika login valid, simpan UID ke local storage
          localStorage.setItem('nexus_user_uid', currentUser.uid);
          setUser(currentUser); // Update user dengan data asli dari Firebase
      } else {
          // Jika logout atau sesi habis
          localStorage.removeItem('nexus_user_uid');
          setUser(null);
          setNotes([]); setFolders([]); setIsReady(false); setAuthError(''); setDbError('');
      }
    });
    return () => unsubscribe();
  }, []);

  // --- MODE OFFLINE: Load data dari localStorage ---
  useEffect(() => {
    if (user?.uid !== 'offline-local') return;
    setNotes(getLocalNotes());
    setFolders(getLocalFolders());
    setIsReady(true);
  }, [user]);

  // --- FIREBASE LISTENERS ---
  useEffect(() => {
    if (!user) return;
    // Mode offline: skip Firestore listeners
    if (user.uid === 'offline-local') return;
    setDbError('');

    // Karena user.uid mungkin dari local storage (fake user), query tetap akan jalan
    // dan Firebase akan menangani caching data-nya.
    const qNotes = query(
      collection(db, "notes"), 
      where("userId", "==", user.uid), 
      orderBy("updatedAt", "desc")
    );

    const unsubNotes = onSnapshot(qNotes, (snap) => {
      const serverNotes = snap.docs.map(d => d.data() as Note);
      const localNotes = getLocalNotes();
       
      const mergedNotes = serverNotes.map(sNote => {
        const lNote = localNotes.find(l => l.id === sNote.id);
        return (lNote && lNote.updatedAt > sNote.updatedAt) ? lNote : sNote;
      });

      localNotes.forEach(lNote => {
        if (!mergedNotes.find(m => m.id === lNote.id)) mergedNotes.push(lNote);
      });

      mergedNotes.sort((a, b) => b.updatedAt - a.updatedAt);
      // --- LOGIKA RESET CHECKBOX BERJANGKA ---
      const now = new Date();
      let hasUpdates = false;
      
      // Clone array agar bisa dimodifikasi
      const updatedNotes = mergedNotes.map(note => {
          // Hanya proses jika konten memiliki checkbox recurring
          if (note.content?.includes('class="todo-item recurring"')) {
              let noteChanged = false;

              // Gunakan regex untuk hindari DOMParser round-trip yang bisa mengubah HTML
              const inputRegex = /<input[^>]*>/gi;
              let newContent = note.content.replace(inputRegex, (match) => {
                  const daysMatch = match.match(/data-days="(\d+)"/);
                  const timeMatch = match.match(/data-checked-time="(\d+)"/);
                  const hasChecked = /\bchecked\b/.test(match);
                  
                  if (daysMatch && timeMatch && hasChecked) {
                      const daysInterval = parseInt(daysMatch[1]);
                      const checkedTime = parseInt(timeMatch[1]);
                      
                      if (daysInterval > 0 && checkedTime > 0) {
                          const lastCheckedDate = new Date(checkedTime);
                          const targetResetDate = new Date(lastCheckedDate);
                          targetResetDate.setDate(targetResetDate.getDate() + daysInterval);
                          targetResetDate.setHours(0, 0, 0, 0);
                          
                          if (now >= targetResetDate) {
                              noteChanged = true;
                              // Hapus checked + data-checked-time
                              return match
                                  .replace(/\s*checked\b\s*/g, ' ')
                                  .replace(/\s*data-checked-time="[^"]*"\s*/g, ' ')
                                  .replace(/\s+/g, ' ')
                                  .replace(/\s>/, '>');
                          }
                      }
                  }
                  return match;
              });

              // Pass 2: Hapus class 'completed' dari div yang sudah tidak punya data-checked-time
              if (noteChanged) {
                  newContent = newContent.replace(
                      /(<div[^>]*class="[^"]*\btodo-item\b[^"]*\brecurring\b[^"]*\bcompleted\b[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/gi,
                      (fullMatch, openTag, inner, closeTag) => {
                          // Jika inner tidak mengandung data-checked-time, hapus completed
                          if (!inner.includes('data-checked-time')) {
                              return openTag.replace(/\bcompleted\b\s*/g, '') + inner + closeTag;
                          }
                          return fullMatch;
                      }
                  );
                  
                  hasUpdates = true;
                  
                  updateDoc(doc(db, "notes", note.id), { 
                      content: newContent,
                      updatedAt: Date.now()
                  });
                  
                  return { ...note, content: newContent };
              }
          }
          return note;
      });

      // Update state lokal jika ada yang di-reset agar UI langsung berubah
      if (hasUpdates) {
          setNotes(updatedNotes);
      } else {
          setNotes(mergedNotes);
      }
      
      setIsReady(true);
      // ...

      if (localNotes.length > 0) setSyncStatus('unsaved');
    }, (err) => {
      // Abaikan error permission sementara jika user object masih "fake"
      // karena update user asli akan segera menyusul
      if (err.code !== 'permission-denied') {
          console.error("Notes Sync Error:", err);
          setDbError(`Gagal memuat Catatan: ${err.message}`);
      }
    });

    const qFolders = query(
      collection(db, "folders"), 
      where("userId", "==", user.uid), 
      orderBy("createdAt", "desc")
    );
    
    const unsubFolders = onSnapshot(qFolders, (snap) => {
      setFolders(snap.docs.map(d => d.data() as Folder));
    }, (err) => {
      if (err.code !== 'permission-denied') {
        console.error("Folder Sync Error:", err);
        setDbError(prev => prev ? prev : `Gagal memuat Folder: ${err.message}`);
      }
    });

    return () => { unsubNotes(); unsubFolders(); };
  }, [user]); // useEffect akan re-run ketika user berubah dari "Fake" ke "Asli"

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(''); setIsLoadingAuth(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) { setAuthError(err.message); } 
    finally { setIsLoadingAuth(false); }
  };

  const handleOfflineMode = () => {
    const offlineUser = { uid: 'offline-local', email: null, isAnonymous: false, isOffline: true } as any;
    setUser(offlineUser);
    localStorage.setItem('nexus_user_uid', 'offline-local');
    setNotes(getLocalNotes());
    setFolders(getLocalFolders());
    setIsReady(true);
  };

  const handleLogout = async () => {
      const isOffline = user?.uid === 'offline-local';
      // [PERCEPAT 3] Hapus jejak saat logout
      localStorage.removeItem('nexus_user_uid');

      if (!isOffline) {
        await signOut(auth);
        clearLocalStorage();
        clearLocalFolders();
      }
      // Mode offline: jangan clear localStorage agar data tetap tersimpan

      setNotes([]);
      setFolders([]);
      setIsReady(false);
      setViewMode('HOME');
      setUser(null);
  };

  const handleUpdateEmail = async (newEmail: string) => {
    if (!auth.currentUser) throw new Error("Anda belum login.");
    
    // Memanggil alat Firebase untuk mengganti email
    await updateEmail(auth.currentUser, newEmail);
    
    // Perbarui data user di memori aplikasi agar tulisan di layar langsung berubah
    setUser({ ...auth.currentUser, email: newEmail });
  };

  const handleClearHistoryCache = async (halfOnly: boolean) => {
      // Bersihkan dari IndexedDB (sumber riwayat Mesin Waktu saat ini)
      const deleted = await clearHistoryFromIndexedDB(halfOnly);
      if (deleted === 0) {
          alert("Tidak ada riwayat mesin waktu/cache yang menyumbat memori.");
          return;
      }
      alert(`✅ Sukses! ${deleted} versi riwayat ${halfOnly ? 'paling lama ' : ''}telah dibersihkan dari memori perangkat.`);
  };

  const handleManualSync = async () => {
      if (!user) return;
      // Mode offline: skip sync
      if (user.uid === 'offline-local') return;
      setSyncStatus('syncing');
      try {
          const localNotes = getLocalNotes();
          if (localNotes.length === 0) {
              setSyncStatus('saved');
              setTimeout(() => setSyncStatus('idle'), 2000);
              return;
          }
          const promises = localNotes.map(async (note) => {
              const noteToSync = { ...note, userId: user.uid };
              await setDoc(doc(db, "notes", note.id), noteToSync, { merge: true });
              removeFromLocalStorage(note.id); 
          });
          await Promise.all(promises);
          setSyncStatus('saved');
          setTimeout(() => setSyncStatus('idle'), 2000);
      } catch (error) {
          console.error("Manual Sync Error:", error);
          setSyncStatus('error');
      }
  };

  useEffect(() => {
      if (isAutoSync) {
          handleManualSync();
      }
  }, [isAutoSync]);

  const handleUpdateNote = (updated: Note) => {
    if (!user) return;
    const noteWithUser = { ...updated, userId: user.uid, updatedAt: Date.now() }; 
    setNotes(prev => prev.map(n => n.id === updated.id ? noteWithUser : n));
    saveToLocalStorage(noteWithUser);
    
    const isOffline = user.uid === 'offline-local';
    if (!isOffline && isAutoSync) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
             setDoc(doc(db, "notes", updated.id), noteWithUser, { merge: true })
                .then(() => { 
                   removeFromLocalStorage(updated.id); 
                   setSyncStatus('saved'); 
                   setTimeout(() => setSyncStatus('idle'), 2000); 
                });
        }, syncInterval); 
    } else if (!isOffline) {
        setSyncStatus('unsaved');
    }
  };

  const handleCreateNote = async (
    title: string, 
    type: 'note' | 'mindmap' = 'note', 
    folderId?: string,
    shouldNavigate: boolean = false 
  ): Promise<string> => {
    if (!user) return '';
    const id = Date.now().toString();
    const finalTitle = title.trim() || 'Untitled';
    const newNote: Note = { 
      id, userId: user.uid, title: finalTitle, content: '', updatedAt: Date.now(), type, folderId: folderId || "" 
    };
    // Inisialisasi mindmapData untuk type mindmap
    if (type === 'mindmap') {
      newNote.mindmapData = {
        nodes: [{ id, text: finalTitle || 'Konsep Utama', x: 400, y: 300 }],
        connections: []
      };
    }
    setNotes(p => [newNote, ...p]);
    saveToLocalStorage(newNote); 
    const isOffline = user.uid === 'offline-local';
    if (!isOffline && isAutoSync) setDoc(doc(db, "notes", id), newNote, { merge: true });
    if (shouldNavigate) navigateTo('EDITOR', id);
    return id;
  };

  const handleDuplicateNotes = async (noteIds: string[]) => {
    if (!user) return;
    const notesToDuplicate = notes.filter(n => noteIds.includes(n.id));
    if (notesToDuplicate.length === 0) return;

    const now = Date.now();
    const duplicatedNotes: Note[] = notesToDuplicate.map((note, index) => {
      const newId = (now + index).toString();
      const currentTitle = note.title || 'Untitled';
      return {
        ...note,
        id: newId,
        title: `(Copy) ${currentTitle}`,
        updatedAt: now + index,
        lastOpenedAt: undefined
      };
    });

    // 1. Perbarui state catatan lokal
    setNotes(prev => [...duplicatedNotes, ...prev]);

    // 2. Simpan setiap catatan baru ke penyimpanan lokal
    duplicatedNotes.forEach(n => saveToLocalStorage(n));

    // 3. Simpan ke database Firebase jika fitur auto sync aktif dan tidak offline
    const isOffline = user.uid === 'offline-local';
    if (!isOffline && isAutoSync) {
      const batchPromises = duplicatedNotes.map(n => setDoc(doc(db, "notes", n.id), n));
      await Promise.all(batchPromises);
    }
  };

  const getTopBarTitle = () => {
    if (viewMode === 'EDITOR') {
      const activeNote = notes.find(n => n.id === currentNoteId);
      return activeNote ? (activeNote.title || 'Untitled Note') : 'Nexus Notes';
    }
    if (viewMode === 'TRACT') {
      return 'Activity Tracker';
    }
    return 'Nexus Notes';
  };

  const handleImportData = async (data: { notes: Note[], folders: Folder[] }) => {
    if (!user) {
        alert("⚠️ GAGAL IMPORT: Anda harus LOGIN terlebih dahulu agar data bisa disimpan ke akun Anda.");
        return;
    }

    try {
        const notesToImport = data.notes || [];
        const foldersToImport = data.folders || [];

        if (notesToImport.length === 0 && foldersToImport.length === 0) {
            alert("File JSON kosong atau format tidak dikenali.");
            return;
        }

        const isOffline = user.uid === 'offline-local';

        if (isOffline) {
            // Mode offline: simpan ke localStorage saja
            notesToImport.forEach(x => {
                const noteWithUser = { ...x, userId: 'offline-local', updatedAt: x.updatedAt || Date.now() };
                saveToLocalStorage(noteWithUser);
            });
            foldersToImport.forEach(x => {
                const folderWithUser = { ...x, userId: 'offline-local' } as Folder;
                saveFolderToLocalStorage(folderWithUser);
            });
        } else {
            const promises = [
                ...notesToImport.map(x => setDoc(doc(db, "notes", x.id), { 
                    ...x, 
                    userId: user.uid, 
                    updatedAt: x.updatedAt || Date.now() 
                })),
                ...foldersToImport.map(x => setDoc(doc(db, "folders", x.id), { 
                    ...x, 
                    userId: user.uid 
                }))
            ];
            await Promise.all(promises);
        }

        alert(`✅ Sukses! Berhasil memulihkan ${notesToImport.length} catatan dan ${foldersToImport.length} folder.`);
        window.location.reload(); 

    } catch (err: any) {
        console.error("Detail Error Import:", err);
        alert(`❌ Terjadi kesalahan saat menyimpan ke database:\n\n${err.message}`);
    }
  };

  const handleDeleteCurrentNote = async () => {
    if (!currentNoteId || !user) return;
    
    // UBAH 1: Konfirmasi dipindahkan ke sampah, bukan hapus permanen
    if (confirm("Pindahkan catatan ini ke Sampah?")) {
      try {
        // UBAH 2: Gunakan handleSoftDelete, jangan deleteDoc
        // Kita masukkan currentNoteId ke dalam array karena handleSoftDelete butuh array
        await handleSoftDelete([currentNoteId], []);
        
        // Kembali ke menu utama setelah dihapus
        navigateTo('HOME');
      } catch (err: any) {
        alert("Gagal memindahkan ke sampah: " + err.message);
      }
    }
  };

  const handleMoveCurrentNote = async (targetFolderId: string | undefined) => {
    if (!currentNoteId || !user) return;
    const isOffline = user.uid === 'offline-local';
    try {
      if (isOffline) {
        const note = notes.find(n => n.id === currentNoteId);
        if (note) {
          const updated = { ...note, folderId: targetFolderId || "", updatedAt: Date.now() };
          saveToLocalStorage(updated);
          setNotes(prev => prev.map(n => n.id === currentNoteId ? updated : n));
        }
      } else {
        await updateDoc(doc(db, "notes", currentNoteId), { 
          folderId: targetFolderId || "", updatedAt: Date.now() 
        });
        setNotes(prev => prev.map(n => 
          n.id === currentNoteId 
            ? { ...n, folderId: targetFolderId || "", updatedAt: Date.now() } 
            : n
        ));
      }
      setShowEditorMoveDialog(false);
      alert("Catatan berhasil dipindahkan!");
    } catch (err: any) {
      alert("Gagal memindahkan: " + err.message);
    }
  };

  // [PERCEPAT 4] Kita HILANGKAN block "if (isAuthLoading)" yang menampilkan Splash Screen.
  // Dan karena state "user" diinisialisasi dengan data dari localStorage,
  // maka kondisi "if (!user)" di bawah ini akan bernilai FALSE (terlewati)
  // sehingga aplikasi langsung merender Konten Utama.

  // --- RENDER LOGIN SCREEN (Hanya tampil jika benar-benar logout / user null) ---
  if (!user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4 transition-colors">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-3xl shadow-2xl shadow-blue-500/10 border border-white dark:border-gray-700 max-w-sm w-full transform transition-all">
            
            <div className="text-center mb-10">
                <div className="relative w-20 h-20 mx-auto mb-6">
                    <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 dark:opacity-40 animate-pulse"></div>
                    <div className="relative w-full h-full bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-600/30 transform hover:rotate-12 transition-transform duration-300">
                        <svg className="w-10 h-10 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </div>
                </div>
                <h1 className="text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">Nexus Notes</h1>
                <div className="h-1 w-12 bg-blue-600 mx-auto mt-2 rounded-full"></div>
            </div>
            
            {(authError || resetMessage) && (
              <div className={`mb-6 p-4 text-xs rounded-xl border flex items-center gap-2 animate-in fade-in zoom-in ${resetMessage ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                <span>{authError || resetMessage}</span>
              </div>
            )}

            {isResetting ? (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <p className="text-xs text-center text-gray-500 mb-4">Masukkan email Anda untuk menerima instruksi reset password.</p>
                <input 
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-5 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Email Address" required
                />
                <button type="submit" disabled={isLoadingAuth} className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl shadow-lg active:scale-95 disabled:opacity-50">
                  {isLoadingAuth ? 'Mengirim...' : 'Kirim Link Reset'}
                </button>
                <button type="button" onClick={() => setIsResetting(false)} className="w-full text-xs text-gray-500 hover:text-blue-600">Kembali ke Login</button>
              </form>
            ) : (
              <form onSubmit={handleEmailAuth} className="space-y-4">
                <input 
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-5 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Email Address" required
                />
                <input 
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-5 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Password" required
                />
                
                <div className="flex justify-end">
                  <button type="button" onClick={() => setIsResetting(true)} className="text-xs text-blue-600 hover:underline">Lupa Password?</button>
                </div>

                <button type="submit" disabled={isLoadingAuth} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3.5 rounded-2xl shadow-lg active:scale-95 disabled:opacity-50">
                  {isLoadingAuth ? 'Memproses...' : 'Masuk Ke Nexus'}
                </button>
              </form>
            )}

            {!isResetting && (
              <>
                <div className="relative my-10">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100 dark:border-gray-700"></div></div>
                  <div className="relative flex justify-center"><span className="px-4 bg-white dark:bg-gray-800 text-gray-400 text-[10px] font-bold">Atau</span></div>
                </div>
                <button onClick={handleOfflineMode} className="w-full bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-2xl text-xs flex items-center justify-center gap-3 border border-gray-100 dark:border-gray-700">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m-2.829-2.829a5 5 0 000-7.07m-4.243 2.121a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.283 8.283l1.414 1.414m-1.414-1.414L3 21" /></svg>
                  Jelajahi Mode Offline
                </button>
              </>
            )}
        </div>
      </div>
    );
  }

  // --- RENDER CONTENT ---
  const handleGraphNodeClick = useCallback((id: string) => {
    navigateTo('EDITOR', id);
  }, [navigateTo]);

  const handleGraphDeleteItems = useCallback((noteIds: string[]) => {
    handleSoftDelete(noteIds, []);
  }, [handleSoftDelete]);

  const handleGraphMoveItems = useCallback((noteIds: string[], targetFolderId: string | undefined) => {
    const isOffline = user?.uid === 'offline-local';
    noteIds.forEach(id => {
      if (isOffline) {
        const note = notes.find(n => n.id === id);
        if (note) {
          const updated = { ...note, folderId: targetFolderId || "", updatedAt: Date.now() };
          saveToLocalStorage(updated);
          setNotes(prev => prev.map(n => n.id === id ? updated : n));
        }
      } else {
        updateDoc(doc(db, "notes", id), { 
            folderId: targetFolderId || "", 
            updatedAt: Date.now() 
        });
      }
    });
  }, [user, notes]);

  const renderContent = () => {
    if (dbError) {
        return (
            <div className="flex flex-col h-full items-center justify-center p-6 text-center">
                 <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">!</div>
                 <h2 className="text-xl font-bold text-red-600 mb-2">Terjadi Kesalahan Database</h2>
                 <div className="bg-gray-100 p-4 rounded-lg text-xs font-mono text-left w-full mb-4 break-words overflow-auto max-h-40 border border-gray-300">
                    {dbError}
                 </div>
                 {dbError.includes('index') && (
                      <div className="space-y-2">
                         <p className="text-sm text-gray-600">Anda perlu membuat Index di Firebase.</p>
                         <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Buka Firebase Console</a>
                      </div>
                 )}
            </div>
        );
    }

    // Data akan langsung terisi dalam sepersekian milidetik dari memori lokal (Cache-First). (hapus */ dibawah ini jika ingin digunakan)
    if (!isReady) {
        // --- SKELETON LOADING: mirip layout kartu catatan untuk feedback visual ---
        return (
          <div className="h-full overflow-y-auto no-scrollbar p-4 space-y-4 animate-pulse">
            <div className="flex items-center gap-2">
              <div className="h-[48px] flex-1 rounded-xl bg-gray-200 dark:bg-gray-800" />
              <div className="h-[48px] w-[48px] rounded-xl bg-gray-200 dark:bg-gray-800" />
              <div className="h-[48px] w-[48px] rounded-xl bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="pt-4">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="p-4 rounded-xl bg-gray-200 dark:bg-gray-800 mb-3 h-28">
                  <div className="w-2/3 h-4 rounded bg-gray-300 dark:bg-gray-700 mb-3" />
                  <div className="w-full h-3 rounded bg-gray-300 dark:bg-gray-700 mb-2" />
                  <div className="w-1/2 h-3 rounded bg-gray-300 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          </div>
        );
    }
    switch (viewMode) {
        case 'TRACT':
            return (
                <div className="absolute inset-0 z-50 bg-white dark:bg-gray-950 overflow-hidden flex flex-col">
                    <TractView 
                        onGoHome={() => navigateTo('HOME')} 
                        userId={user?.uid} 
                        notes={notes} 
                        onLinkClick={(id) => navigateTo('EDITOR', id)} 
                    />
                </div>
            );
        
       case 'SETTINGS':
            return (
                <SettingsView 
                  isAutoSync={isAutoSync}
                  onToggleAutoSync={setIsAutoSync}
                  syncInterval={syncInterval}
                  onChangeInterval={setSyncInterval}
                  onLogout={handleLogout}
                  userEmail={user?.email}
                  isAnonymous={user?.isAnonymous}
                  isOffline={user?.uid === 'offline-local'}
                  notes={notes}
                  folders={folders}
                  onImportData={handleImportData}
                  onClearHistory={handleClearHistoryCache}
                  onUpdateEmail={handleUpdateEmail}
                />
            );
            
        case 'GRAPH': 
            return (
                <GraphView 
                    notes={notes}
                    folders={folders} 
                    onNodeClick={handleGraphNodeClick}
                    isDarkMode={isDarkMode} 
                    activeNoteId={currentNoteId} 
                    // --- TAMBAHKAN PROPS INI ---
                    onDeleteItems={handleGraphDeleteItems}
                    onMoveItems={handleGraphMoveItems}
                />
            );
        
        case 'EDITOR': 
            const n = notes.find(x => x.id === currentNoteId);
            // Jika data belum siap (isReady = false), tampilkan loading. Jika sudah siap tapi data tetap tidak ada, baru tampilkan 404.
            if (!n) return !isReady ? <div className="p-6 text-gray-400">Membuka catatan...</div> : <div>Catatan tidak ditemukan (404)</div>;
            if (n.type === 'mindmap') {
                return (
                    <MindmapEditor
                        note={n}
                        onUpdate={handleUpdateNote}
                        onGoHome={() => navigateTo('HOME')}
                        isDarkMode={isDarkMode}
                    />
                );
            }
            return (
                <Editor 
                    ref={editorRef} 
                    note={n} 
                    allNotes={notes} 
                    onUpdate={handleUpdateNote} 
                    onToggleImmersive={setIsImmersive} // Mengizinkan Editor mematikan/menyalakan TopBar
                    onCreateNewNote={async (title) => {
                        const LINKED_FOLDER_NAME = "Keterhubungan";
                        let linkedFolder = folders.find(f => f.name === LINKED_FOLDER_NAME);
                        let targetId = linkedFolder?.id;
                        if (!targetId) {
                            targetId = 'f_linked_' + Date.now();
                            const newFolder: Folder = { 
                                id: targetId, 
                                name: LINKED_FOLDER_NAME, 
                                createdAt: Date.now(), 
                                userId: user.uid,
                                deletedAt: null 
                            };
                            setFolders(prev => [newFolder, ...prev]);
                            if (user.uid !== 'offline-local') {
                              await setDoc(doc(db, "folders", targetId), newFolder);
                            } else {
                              saveFolderToLocalStorage(newFolder);
                            }
                        }
                        return handleCreateNote(title, 'note', targetId, false);
                    }}
                    onLinkClick={(id) => navigateTo('EDITOR', id)} 
                    onLinkLongPress={setPreviewNoteId} 
                    onGoHome={() => window.history.length > 1 ? window.history.back() : navigateTo('HOME')}
                />
            );

        default: 
            return (
                <HomeView 
                    notes={notes} 
                    folders={folders} 
                    currentFolderId={activeFolderId}
                    onFolderChange={setActiveFolderId}
                    onNoteClick={(id) => navigateTo('EDITOR', id)} 
                    onCreateNote={(type, folderId) => handleCreateNote('', type, folderId, true)} 
                    onCreateFolder={async (name, parentId) => {
                        const id = 'f_' + Date.now();
                        const newFolder: Folder = { 
                            id, 
                            name, 
                            createdAt: Date.now(), 
                            userId: user?.uid || '',
                            parentId: parentId || null
                        };
                        if (user?.uid === 'offline-local') {
                          saveFolderToLocalStorage(newFolder);
                        } else {
                          await setDoc(doc(db, "folders", id), newFolder);
                        }
                        setFolders(prev => [newFolder, ...prev]);
                    }} 
                    onRenameFolder={async (id, n) => {
                        if (user?.uid === 'offline-local') {
                          const folder = folders.find(f => f.id === id);
                          if (folder) {
                            const updated = { ...folder, name: n };
                            saveFolderToLocalStorage(updated);
                            setFolders(prev => prev.map(f => f.id === id ? updated : f));
                          }
                        } else {
                          await updateDoc(doc(db, "folders", id), { name: n });
                        }
                    }} 
                    onDeleteItems={handleSoftDelete} 
                    onRestoreItems={handleRestore}
                    onOpenTractApp={() => navigateTo('TRACT')}
                    onPermanentDelete={handleHardDelete}
                    onDuplicateNotes={handleDuplicateNotes}
                    onMoveItems={(noteIds, folderIds, targetFolderId) => {
                        const isOffline = user?.uid === 'offline-local';
                         // 1. Pindahkan Notes
                         noteIds.forEach(id => {
                            if (isOffline) {
                              const note = notes.find(n => n.id === id);
                              if (note) {
                                const updated = { ...note, folderId: targetFolderId || "", updatedAt: Date.now() };
                                saveToLocalStorage(updated);
                                setNotes(prev => prev.map(n => n.id === id ? updated : n));
                              }
                            } else {
                              updateDoc(doc(db, "notes", id), { 
                                  folderId: targetFolderId || "", 
                                  updatedAt: Date.now() 
                              });
                            }
                         });
            
                         // 2. Pindahkan Folders (Nested)
                         folderIds.forEach(id => {
                            if (isOffline) {
                              const folder = folders.find(f => f.id === id);
                              if (folder) {
                                const updated = { ...folder, parentId: targetFolderId || null } as Folder;
                                saveFolderToLocalStorage(updated);
                                setFolders(prev => prev.map(f => f.id === id ? updated : f));
                              }
                            } else {
                              updateDoc(doc(db, "folders", id), { 
                                  parentId: targetFolderId || null 
                              });
                            }
                         });
                    }}
                    onImportData={handleImportData} 
                />
            );
    }
  };
  
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 transition-colors">
      {/* Sembunyikan TopBar jika sedang Immersive (Layar Penuh) */}
      {!isImmersive && (
          <TopBar 
            mode={viewMode} 
            onToggleMode={() => navigateTo(viewMode === 'GRAPH' ? 'EDITOR' : 'GRAPH', currentNoteId)} 
            title={getTopBarTitle()} 
            isDarkMode={isDarkMode} 
            onToggleTheme={() => setIsDarkMode(p => !p)} 
            onUndo={() => editorRef.current?.undo()} 
            onRedo={() => editorRef.current?.redo()} 
            syncStatus={syncStatus} 
            isAutoSync={isAutoSync} 
            onManualSync={handleManualSync} 
           onOpenSettings={() => navigateTo('SETTINGS')}
            onGoHome={() => window.history.length > 1 ? window.history.back() : navigateTo('HOME')} 
            onForceHome={() => { setActiveFolderId(undefined); navigateTo('HOME'); }} 
            onGoToParent={() => {
                // Gunakan DOMParser untuk akurasi - pastikan match di atribut elemen, bukan teks biasa
                const parentNote = notes.find(n => {
                    if (!n.content) return false;
                    try {
                        const doc = new DOMParser().parseFromString(n.content, 'text/html');
                        return doc.querySelector(`[data-id="${currentNoteId}"]`) !== null;
                    } catch {
                        return new RegExp(`data-id="${currentNoteId}"`).test(n.content);
                    }
                });
                if (parentNote) {
                    navigateTo('EDITOR', parentNote.id);
                } else {
                    alert("Catatan ini belum memiliki Induk (Belum ditautkan dari catatan manapun).");
                }
            }}
            onDeleteNote={handleDeleteCurrentNote}
            onMoveNote={() => setShowEditorMoveDialog(true)}
          />
      )}
      
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {renderContent()}
      </div>
      
      {showEditorMoveDialog && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-gray-800 w-full max-w-sm rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
              <h3 className="font-bold text-lg dark:text-white">Pindahkan ke...</h3>
              <button onClick={() => setShowEditorMoveDialog(false)}><X size={20} className="text-gray-500"/></button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
               <button 
                onClick={() => handleMoveCurrentNote(undefined)}
                className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200"
               >
                 <FolderIcon size={20} className="text-gray-400" />
                 <span>Home (Tanpa Folder)</span>
               </button>

                  {folders.filter(f => !f.deletedAt).map(f => (
                    <button 
                      key={f.id}
                      onClick={() => handleMoveCurrentNote(f.id)}
                   className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200"
                 >
                   <FolderIcon size={20} className="text-amber-500" />
                   <span>{f.name}</span>
                 </button>
               ))}

               {folders.length === 0 && (
                 <div className="p-4 text-center text-gray-400 text-sm">Belum ada folder lain.</div>
               )}
            </div>
          </div>
        </div>
      )}
      
      <PreviewSheet 
        note={notes.find(n => n.id === previewNoteId) || null} 
        onClose={() => setPreviewNoteId(null)} 
        onOpenFull={() => previewNoteId && navigateTo('EDITOR', previewNoteId)} 
      />
    </div>
  );
}
