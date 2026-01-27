import React, { useState, useEffect, useRef } from 'react';
import { Note, Folder, ViewMode, EditorHandle } from './types';
import { Editor } from './components/Editor';
import { GraphView } from './components/GraphView';
import { TopBar } from './components/TopBar';
import { HomeView } from './components/HomeView';
import { PreviewSheet } from './components/PreviewSheet';
import { SettingsView } from './components/SettingsView';

import { db, auth } from './services/firebase'; 
import { 
  collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, updateDoc, where 
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signOut, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  sendPasswordResetEmail
} from 'firebase/auth'; 

// --- HELPER: LOCAL STORAGE ---
const getLocalNotes = (): Note[] => {
  try { return JSON.parse(localStorage.getItem('nexus_backup_notes') || '[]'); } catch { return []; }
};
const saveToLocalStorage = (note: Note) => {
  const local = getLocalNotes();
  const filtered = local.filter(n => n.id !== note.id);
  localStorage.setItem('nexus_backup_notes', JSON.stringify([...filtered, note]));
};
const removeFromLocalStorage = (noteId: string) => {
  const local = getLocalNotes();
  const filtered = local.filter(n => n.id !== noteId);
  localStorage.setItem('nexus_backup_notes', JSON.stringify(filtered));
};
const clearLocalStorage = () => localStorage.removeItem('nexus_backup_notes');

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  
  // Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isLoadingAuth, setIsLoadingAuth] = useState(false); 
  
  // --- STATE BARU: Reset Password ---
  const [isResetting, setIsResetting] = useState(false); 
  const [resetMessage, setResetMessage] = useState('');

  // --- FUNGSI RESET PASSWORD ---
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

  // Database Error
  const [dbError, setDbError] = useState<string>('');

  const [viewMode, setViewMode] = useState<ViewMode>('HOME');
  const [currentNoteId, setCurrentNoteId] = useState<string>(''); 
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [history, setHistory] = useState<ViewMode[]>([]);

  // --- STATE SETTINGS (DENGAN PERSISTENCE) ---
  const [isAutoSync, setIsAutoSync] = useState(() => {
    const saved = localStorage.getItem('nexus_auto_sync');
    return saved !== null ? JSON.parse(saved) : true; 
  });
  
  const [syncInterval, setSyncInterval] = useState(() => {
     const saved = localStorage.getItem('nexus_sync_interval');
     return saved ? Number(saved) : 1500;
  });

  // Effect untuk menyimpan perubahan setting ke LocalStorage
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
  const [isDarkMode, setIsDarkMode] = useState(false);

  // --- PERBAIKAN: EFEK TEMA GELAP ---
  // Ini akan menambahkan class 'dark' ke tag <html> agar Tailwind bekerja
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // --- 1. LOGIKA TOMBOL BACK ANDROID (TAMBAHKAN INI) ---
  useEffect(() => {
    // Set state awal agar history tidak kosong
    window.history.replaceState({ mode: 'HOME', noteId: '' }, '', '');

    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        // Jika tombol Back ditekan, kembalikan tampilan dari history
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

  // Fungsi khusus untuk pindah halaman agar tercatat di history
  const navigateTo = (mode: ViewMode, noteId: string = '') => {
    if (viewMode === mode && currentNoteId === noteId) return;
    
    setViewMode(mode);
    setCurrentNoteId(noteId);
    window.history.pushState({ mode, noteId }, '', '');
  };
  // ----------------------------------------------------

  // --- AUTH LISTENER ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setNotes([]); setFolders([]); setIsReady(false); setAuthError(''); setDbError('');
      }
    });
    return () => unsubscribe();
  }, []);

  // --- FIREBASE LISTENERS ---
  useEffect(() => {
    if (!user) return;
    setDbError('');

    // Query Notes
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
      setNotes(mergedNotes);
      setIsReady(true);
      if (localNotes.length > 0) setSyncStatus('unsaved');
    }, (err) => {
      console.error("Notes Sync Error:", err);
      setDbError(`Gagal memuat Catatan: ${err.message}`);
    });

    // Query Folders
    const qFolders = query(
      collection(db, "folders"), 
      where("userId", "==", user.uid), 
      orderBy("createdAt", "desc")
    );
    
    const unsubFolders = onSnapshot(qFolders, (snap) => {
      setFolders(snap.docs.map(d => d.data() as Folder));
    }, (err) => {
      console.error("Folder Sync Error:", err);
      setDbError(prev => prev ? prev : `Gagal memuat Folder: ${err.message}`);
    });

    return () => { unsubNotes(); unsubFolders(); };
  }, [user]);

  // Auth Functions
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(''); setIsLoadingAuth(true);
    try {
      if (isRegistering) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) { setAuthError(err.message); } 
    finally { setIsLoadingAuth(false); }
  };

  const handleAnonymousLogin = async () => {
    try { await signInAnonymously(auth); } catch (err: any) { setAuthError(err.message); }
  };

  const handleLogout = async () => {
      await signOut(auth); clearLocalStorage(); setViewMode('HOME');
  };

  // --- FUNGSI MANUAL SYNC (HYBRID SYNC) ---
  const handleManualSync = async () => {
      if (!user) return;
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

  // --- AUTO SYNC TRIGGER ---
  useEffect(() => {
      if (isAutoSync) {
          handleManualSync();
      }
  }, [isAutoSync]);

  // --- FUNGSI UPDATE NOTE (DENGAN LOGIKA HYBRID) ---
  const handleUpdateNote = (updated: Note) => {
    if (!user) return;
    const noteWithUser = { ...updated, userId: user.uid }; 
    setNotes(prev => prev.map(n => n.id === updated.id ? noteWithUser : n));
    
    // Simpan ke lokal dulu (Mekanisme Hybrid)
    saveToLocalStorage(noteWithUser);
    
    // Kirim ke cloud jika Auto Sync nyala
    if (isAutoSync) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
             setDoc(doc(db, "notes", updated.id), noteWithUser, { merge: true })
                .then(() => { 
                    removeFromLocalStorage(updated.id); 
                    setSyncStatus('saved'); 
                    setTimeout(() => setSyncStatus('idle'), 2000); 
                });
        }, syncInterval); 
    } else {
        setSyncStatus('unsaved');
    }
  };

  // --- FUNGSI CREATE NOTE (DENGAN LOGIKA HYBRID) ---
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
      id, 
      userId: user.uid, 
      title: finalTitle, 
      content: '', 
      updatedAt: Date.now(), 
      type, 
      folderId: folderId || "" 
    };

    // Update State Lokal
    setNotes(p => [newNote, ...p]);

    // Simpan ke Local Storage segera agar tidak hilang saat refresh
    saveToLocalStorage(newNote); 
    
    // Update Firebase jika sync ON
    if (isAutoSync) {
      setDoc(doc(db, "notes", id), newNote, { merge: true });
    }

    if (shouldNavigate) {
      // Gunakan navigateTo agar tercatat di history
      navigateTo('EDITOR', id);
    }

    return id;
  };

  const getTopBarTitle = () => {
    if (viewMode === 'EDITOR') {
      const activeNote = notes.find(n => n.id === currentNoteId);
      return activeNote ? (activeNote.title || 'Untitled Note') : 'Nexus Notes';
    }
    return 'Nexus Notes';
  };

  // --- RENDER LOGIN SCREEN (Jika User Belum Login) ---
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
                
                {!isRegistering && (
                  <div className="flex justify-end">
                    <button type="button" onClick={() => setIsResetting(true)} className="text-xs text-blue-600 hover:underline">Lupa Password?</button>
                  </div>
                )}

                <button type="submit" disabled={isLoadingAuth} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3.5 rounded-2xl shadow-lg active:scale-95 disabled:opacity-50">
                  {isLoadingAuth ? 'Memproses...' : (isRegistering ? 'Buat Akun Baru' : 'Masuk Ke Nexus')}
                </button>

                <div className="mt-6 text-center">
                  <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-xs text-gray-500 hover:text-blue-600">
                    {isRegistering ? 'Sudah punya akun? Login' : 'Belum punya akun? Daftar Sekarang'}
                  </button>
                </div>
              </form>
            )}

            {!isResetting && (
              <>
                <div className="relative my-10">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100 dark:border-gray-700"></div></div>
                  <div className="relative flex justify-center"><span className="px-4 bg-white dark:bg-gray-800 text-gray-400 text-[10px] font-bold">Atau</span></div>
                </div>
                <button onClick={handleAnonymousLogin} className="w-full bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-2xl text-xs flex items-center justify-center gap-3 border border-gray-100 dark:border-gray-700">Jelajahi Sebagai Tamu</button>
              </>
            )}
        </div>
      </div>
    );
  }

  // --- FUNGSI IMPORT DATA (PINDAHKAN KE SINI) ---
  const handleImportData = async (data: { notes: Note[], folders: Folder[] }) => {
    if (!user) return;
    try {
        const promises = [
            ...data.notes.map(x => setDoc(doc(db, "notes", x.id), { ...x, userId: user.uid })),
            ...data.folders.map(x => setDoc(doc(db, "folders", x.id), { ...x, userId: user.uid }))
        ];
        await Promise.all(promises);
        alert("Import berhasil! Data telah dipulihkan.");
    } catch (err) {
        console.error("Import error:", err);
        alert("Gagal mengimpor data.");
    }
  };

  // --- RENDER CONTENT ---
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

    if (!isReady) return <div className="flex h-full items-center justify-center text-gray-400 font-medium">Memuat data...</div>;

    switch (viewMode) {
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
                  // DATA PENTING AGAR EXPORT TIDAK KOSONG:
                  notes={notes}
                  folders={folders}
                  onImportData={handleImportData}
                />
            );
            
        case 'GRAPH':
           // ... (kode graph view tetap sama)
        
        case 'GRAPH': 
            // PERBAIKAN: Pakai navigateTo saat klik node
            return <GraphView notes={notes} onNodeClick={(id) => navigateTo('EDITOR', id)} isDarkMode={isDarkMode} />;
        
        case 'EDITOR': 
            const n = notes.find(x => x.id === currentNoteId);
            if (!n) return <div>404</div>;
            return (
                <Editor 
                    ref={editorRef} 
                    note={n} 
                    allNotes={notes} 
                    onUpdate={handleUpdateNote} 
                    onCreateNewNote={(title) => handleCreateNote(title, 'note', n.folderId, false)} 
                    // PERBAIKAN: Pakai navigateTo saat klik link
                    onLinkClick={(id) => navigateTo('EDITOR', id)} 
                    onLinkLongPress={setPreviewNoteId} 
                    // PERBAIKAN: Pakai navigateTo saat kembali ke Home
                    onGoHome={() => navigateTo('HOME')} 
                />
            );

        default: 
            return (
                <HomeView 
                    notes={notes} 
                    folders={folders} 
                    // PERBAIKAN: Pakai navigateTo saat klik catatan
                    onNoteClick={(id) => navigateTo('EDITOR', id)} 
                    onCreateNote={(type, folderId) => handleCreateNote('', type, folderId, true)} 
                    onCreateFolder={async (n) => setDoc(doc(db, "folders", 'f_' + Date.now()), { id: 'f_' + Date.now(), name: n, createdAt: Date.now(), userId: user?.uid })} 
                    onRenameFolder={(id, n) => updateDoc(doc(db, "folders", id), { name: n })} 
                    onDeleteItems={(nIds, fIds) => { nIds.forEach(id => deleteDoc(doc(db, "notes", id))); fIds.forEach(id => deleteDoc(doc(db, "folders", id))) }} 
                    onMoveItems={(nIds, tId) => nIds.forEach(id => updateDoc(doc(db, "notes", id), { folderId: tId || "", updatedAt: Date.now() }))} 
                    onImportData={(d) => { d.notes.forEach(x => setDoc(doc(db, "notes", x.id), { ...x, userId: user?.uid })); d.folders.forEach(x => setDoc(doc(db, "folders", x.id), { ...x, userId: user?.uid })) }} 
                />
            );
    }
  };

  // --- RETURN AKHIR (LAYOUT UTAMA) ---
  
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 transition-colors">
      <TopBar 
        mode={viewMode} 
        // PERBAIKAN: Toggle Mode pakai navigateTo agar bisa di-Back
        onToggleMode={() => navigateTo(viewMode === 'GRAPH' ? 'EDITOR' : 'GRAPH', currentNoteId)} 
        title={getTopBarTitle()} 
        isDarkMode={isDarkMode} 
        onToggleTheme={() => setIsDarkMode(p => !p)} 
        onUndo={() => editorRef.current?.undo()} 
        onRedo={() => editorRef.current?.redo()} 
        syncStatus={syncStatus} 
        isAutoSync={isAutoSync} 
        onManualSync={handleManualSync} 
        // PERBAIKAN: Buka Settings pakai navigateTo
        onOpenSettings={() => navigateTo('SETTINGS')} 
      />
      
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {renderContent()}
      </div>
      
      <PreviewSheet 
        note={notes.find(n => n.id === previewNoteId) || null} 
        onClose={() => setPreviewNoteId(null)} 
        // PERBAIKAN: Buka Full dari Preview pakai navigateTo
        onOpenFull={() => previewNoteId && navigateTo('EDITOR', previewNoteId)} 
      />
    </div>
  );
  
}
