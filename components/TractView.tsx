import React, { useState, useEffect } from 'react';
import { 
  Activity as ActivityIcon, 
  BarChart3, 
  List, 
  Plus, 
  Edit2, 
  Trash2, 
  Clock,
  X,
  AlertTriangle,
  Download,
  Upload
} from 'lucide-react';

import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db } from '../services/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types v
interface Activity {
  id: string;
  name: string;
  type: string;
  timestamp: number;
  description: string;
  userId?: string;
  startTime?: number | null;
  endTime?: number | null;
  duration?: number | null;
  isTimerActive?: boolean;
  pauses?: number[];
  resumes?: number[];
  sessionNotes?: string[]; // <-- TEMPAT PENYIMPANAN BARU UNTUK KETERANGAN SESI
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];

export function TractView({ 
  onGoHome, 
  userId,
  notes = [],
  onLinkClick
}: { 
  onGoHome?: () => void; 
  userId?: string;
  notes?: any[];
  onLinkClick?: (id: string) => void;
}) {

  // ==========================================
  // --- STATE & LOGIKA MENTION CATATAN (@.) ---
  // ==========================================
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionTarget, setMentionTarget] = useState<'new' | 'edit' | 'session'>('new');
  const [mentionCursorPos, setMentionCursorPos] = useState<number | null>(null);

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>, target: 'new' | 'edit' | 'session') => {
      const val = e.target.value;
      if (target === 'new') setDescription(val);
      else if (target === 'edit') setEditDescription(val);
      else if (target === 'session') setEditSessionNote(val);

      const cursorPos = e.target.selectionStart || 0;
      const textBeforeCursor = val.substring(0, cursorPos);
      
      const atIndex = textBeforeCursor.lastIndexOf('@.');
      if (atIndex !== -1) {
          const textAfterAt = textBeforeCursor.substring(atIndex + 2);
          if (!textAfterAt.includes(' ')) {
              setMentionQuery(textAfterAt.toLowerCase());
              setShowMention(true);
              setMentionTarget(target);
              setMentionCursorPos(atIndex);
              return;
          }
      }
      setShowMention(false);
  };

  const handleSelectMention = (noteId: string, noteTitle: string) => {
      const tag = `[[note:${noteId}|${noteTitle}]] `;
      
      let currentText = '';
      let setter: any;
      if (mentionTarget === 'new') { currentText = description; setter = setDescription; }
      else if (mentionTarget === 'edit') { currentText = editDescription; setter = setEditDescription; }
      else if (mentionTarget === 'session') { currentText = editSessionNote; setter = setEditSessionNote; }

      if (mentionCursorPos !== null) {
          const before = currentText.substring(0, mentionCursorPos);
          const afterAt = currentText.substring(mentionCursorPos);
          const spaceIndex = afterAt.indexOf(' ');
          const endIdx = spaceIndex === -1 ? currentText.length : mentionCursorPos + spaceIndex;
          const after = currentText.substring(endIdx);
          
          setter(before + tag + after);
      }
      setShowMention(false);
  };

  const renderRichText = (text: string) => {
      if (!text) return null;
      const parts = text.split(/(\[\[note:[^|]+\|[^\]]+\]\])/g);
      return parts.map((part, i) => {
          const match = part.match(/\[\[note:([^|]+)\|([^\]]+)\]\]/);
          if (match) {
              return (
                  <span 
                      key={i} 
                      onClick={(e) => { e.stopPropagation(); onLinkClick?.(match[1]); }}
                      className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-100 font-bold inline-flex items-center"
                      title="Buka Catatan"
                  >
                      @{match[2]}
                  </span>
              );
          }
          return <span key={i}>{part}</span>;
      });
  };
  // ==========================================
  // PENYIMPANAN HYBRID: Load pertama kali dari LocalStorage (Bisa jalan saat offline)
  const [activities, setActivities] = useState<Activity[]>(() => {
    const saved = localStorage.getItem('tractapp_activities');
    return saved ? JSON.parse(saved) : [];
  });

  // Sinkronisasi otomatis dengan Firebase (Update data dari awan)
  useEffect(() => {
    if (!userId) return;
    const q = query(collection(db, 'activities'), where('userId', '==', userId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedData = snapshot.docs.map(doc => doc.data() as Activity);
        fetchedData.sort((a, b) => b.timestamp - a.timestamp); // Urutkan terbaru
        setActivities(fetchedData);
    });
    return () => unsubscribe();
  }, [userId]);
  
  const [activeTab, setActiveTab] = useState<'input' | 'list' | 'stats'>('input');

  // Suggestions State (Akan sinkron dengan Firebase)
  const [activitySuggestions, setActivitySuggestions] = useState<{name: string, type: string}[]>(() => {
    const saved = localStorage.getItem('tractapp_activity_suggestions');
    return saved ? JSON.parse(saved) : [
      { name: 'Lari Pagi', type: 'Olahraga' },
      { name: 'Meeting Proyek', type: 'Bekerja' },
      { name: 'Membaca Buku', type: 'Belajar' }
    ];
  });
  const [typeSuggestions, setTypeSuggestions] = useState<string[]>(() => {
    const saved = localStorage.getItem('tractapp_type_suggestions');
    return saved ? JSON.parse(saved) : ['Olahraga', 'Bekerja', 'Belajar', 'Hobi', 'Lainnya'];
  });

  // Sinkronisasi Saran (Settings) dari Firebase
  useEffect(() => {
    if (!userId) return;
    const unsub = onSnapshot(doc(db, 'tract_settings', userId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.activitySuggestions) setActivitySuggestions(data.activitySuggestions);
            if (data.typeSuggestions) setTypeSuggestions(data.typeSuggestions);
        }
    });
    return () => unsub();
  }, [userId]);

  const saveSettingsToFirebase = (newActSugg: any[], newTypeSugg: string[]) => {
      if (!userId) return;
      setDoc(doc(db, 'tract_settings', userId), {
          activitySuggestions: newActSugg,
          typeSuggestions: newTypeSugg
      }, { merge: true }).catch(err => console.error("Gagal simpan settings:", err));
  };

  // Form State
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('');
  const [description, setDescription] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('');
  const [durationInput, setDurationInput] = useState('');
  
  // State Baru untuk Timer & Tabel Detail
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
  const [showRestartOption, setShowRestartOption] = useState<string | null>(null);
  const [showDataModal, setShowDataModal] = useState(false); // <-- STATE UNTUK MODAL DATA

  // State & Logika untuk Edit Sesi di Rincian Waktu
  const [editingSessionIndex, setEditingSessionIndex] = useState<number | null>(null);
  const [editSessionStart, setEditSessionStart] = useState('');
  const [editSessionEnd, setEditSessionEnd] = useState('');
  const [editSessionNote, setEditSessionNote] = useState('');

  // Fungsi untuk mengonversi data aktivitas kompleks menjadi array sesi yang mudah dikelola
  const buildSessionsArray = (activity: Activity) => {
      const sessions: { start: number, end: number | null, note: string }[] = [];
      const pauses = activity.pauses || [];
      const resumes = activity.resumes || [];
      const notes = activity.sessionNotes || [];
      
      sessions.push({
          start: activity.startTime || activity.timestamp,
          end: pauses.length > 0 ? pauses[0] : activity.endTime,
          note: notes[0] || ''
      });

      resumes.forEach((res, i) => {
          const pIdx = i + 1;
          sessions.push({
              start: res,
              end: pauses.length > pIdx ? pauses[pIdx] : activity.endTime,
              note: notes[pIdx] || ''
          });
      });
      return sessions;
  };

  // Fungsi inti: Menyimpan array sesi kembali ke bentuk aktivitas dan sinkronisasi Waktu Selesai (endTime)
  const saveSessionsToActivity = (updatedSessions: {start: number, end: number | null, note: string}[]) => {
      if (!detailActivity || updatedSessions.length === 0) return;
      
      // Mengurutkan sesi berdasarkan waktu mulai untuk mencegah data berantakan
      updatedSessions.sort((a, b) => a.start - b.start);

      let updated = { ...detailActivity };
      updated.startTime = updatedSessions[0].start;
      updated.sessionNotes = updatedSessions.map(s => s.note);

      const newPauses: number[] = [];
      const newResumes: number[] = [];
      let isAnyRunning = false;
      let finalEndTime: number | null = null;
      let activeMs = 0;

      for (let i = 0; i < updatedSessions.length; i++) {
          const ses = updatedSessions[i];
          if (i > 0) newResumes.push(ses.start);
          
          if (ses.end) {
              activeMs += (ses.end - ses.start);
              if (i < updatedSessions.length - 1) {
                  newPauses.push(ses.end);
              } else {
                  finalEndTime = ses.end; // Otomatis menjadi waktu selesai aktivitas
              }
          } else {
              isAnyRunning = true;
          }
      }

      // Sinkronisasi status timer dan kalkulasi ulang durasi
      if (!isAnyRunning && finalEndTime) {
          updated.isTimerActive = false;
          updated.endTime = finalEndTime;
          updated.duration = Math.max(0, Math.round(activeMs / 60000));
      } else {
          updated.isTimerActive = true;
          updated.endTime = null;
          updated.duration = null;
      }

      updated.pauses = newPauses;
      updated.resumes = newResumes;

      if (userId) {
          setDoc(doc(db, 'activities', updated.id), updated, { merge: true }).catch(err => console.error(err));
      }
      setActivities(prev => prev.map(a => a.id === updated.id ? updated : a));
      setDetailActivity(updated);
      setEditingSessionIndex(null);
  };

  const handleSaveSessionEdit = () => {
      if (!detailActivity || editingSessionIndex === null) return;
      const currentSessions = buildSessionsArray(detailActivity);
      
      const startMs = new Date(editSessionStart).getTime();
      const endMs = editSessionEnd ? new Date(editSessionEnd).getTime() : null;

      currentSessions[editingSessionIndex] = {
          start: startMs,
          end: endMs,
          note: editSessionNote
      };
      
      saveSessionsToActivity(currentSessions);
  };

  const handleAddSession = () => {
      if (!detailActivity) return;
      const currentSessions = buildSessionsArray(detailActivity);
      const now = Date.now();
      
      // Jika sesi terakhir masih berjalan, sistem menutupnya di waktu sekarang
      if (currentSessions.length > 0 && !currentSessions[currentSessions.length - 1].end) {
           currentSessions[currentSessions.length - 1].end = now;
      }

      // Menambahkan sesi baru default 1 menit
      currentSessions.push({
          start: now,
          end: now + 60000, 
          note: ''
      });
      saveSessionsToActivity(currentSessions);
  };

  const handleDeleteSession = (indexToDelete: number) => {
      if (!detailActivity) return;
      const currentSessions = buildSessionsArray(detailActivity);
      if (currentSessions.length <= 1) {
          alert("Tidak dapat menghapus satu-satunya sesi. Hapus seluruh aktivitas jika perlu.");
          return;
      }
      if (confirm("Apakah Anda yakin ingin menghapus sesi ini? Waktu total akan dihitung ulang secara otomatis.")) {
          currentSessions.splice(indexToDelete, 1);
          saveSessionsToActivity(currentSessions);
      }
  };
  
  // State untuk Pop-up Notifikasi & Toast (Pesan Singkat)
  const [showActiveTimerPopup, setShowActiveTimerPopup] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hasShownPopupRef = React.useRef(false);
  
  // State & Ref Baru untuk Sensor Interaksi Pop-up
  const [isPopupInteracted, setIsPopupInteracted] = useState(false);
  const popupTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // MENGAMBIL SEMUA AKTIVITAS YANG SEDANG AKTIF/DIJEDA
  const activeActivities = activities.filter(a => a.isTimerActive);

  // Efek 1: Hanya untuk memunculkan Pop-up pertama kali
  useEffect(() => {
    if (activeActivities.length > 0 && !hasShownPopupRef.current) {
      setShowActiveTimerPopup(true);
      hasShownPopupRef.current = true;
    }
  }, [activities]);

  // Efek 2: Menghitung 5 detik, BATAL OTOMATIS jika pengguna menyentuh pop-up
  useEffect(() => {
    if (showActiveTimerPopup && !isPopupInteracted) {
      popupTimerRef.current = setTimeout(() => {
        setShowActiveTimerPopup(false);
        setIsPopupInteracted(false); // Reset status
      }, 2000); // 2 Detik
      return () => {
        if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      };
    }
  }, [showActiveTimerPopup, isPopupInteracted]);

  // Fungsi Deteksi Sentuhan
  const handlePopupInteraction = () => {
    if (!isPopupInteracted) {
      setIsPopupInteracted(true);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current); // Hentikan hitungan mundur!
    }
  };

  // Fungsi Menutup Pop-up secara Manual
  const closePopup = () => {
    setShowActiveTimerPopup(false);
    setIsPopupInteracted(false);
  };

  const handlePopupAction = (activity: Activity, action: 'pause' | 'resume' | 'stop') => {
    handleTimerAction(activity, action);
    closePopup(); // Langsung tutup pop-up
    
    // Tampilkan notifikasi kecil (toast) selama 1 detik
    const msgs = {
        pause: "Waktu dijeda",
        resume: "Waktu dilanjutkan",
        stop: "Waktu dihentikan"
    };
    setToastMessage(`${msgs[action]} ✓`);
    setTimeout(() => setToastMessage(null), 1000);
  };
  
  // Save to LocalStorage effects
  useEffect(() => {
    localStorage.setItem('tractapp_activities', JSON.stringify(activities));
  }, [activities]);

  useEffect(() => {
    localStorage.setItem('tractapp_activity_suggestions', JSON.stringify(activitySuggestions));
  }, [activitySuggestions]);

  useEffect(() => {
    localStorage.setItem('tractapp_type_suggestions', JSON.stringify(typeSuggestions));
  }, [typeSuggestions]);
  
  // Edit Modal State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<string>('');
  const [editDescription, setEditDescription] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editDuration, setEditDuration] = useState('');
  
  // List Controls State (Filter, Sort, Group)
  const [groupBy, setGroupBy] = useState<'none' | 'month' | 'type'>('none');
  const [filterType, setFilterType] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'nameAsc' | 'nameDesc'>('newest');

  // Delete Modal State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // --- STATE BARU UNTUK FITUR PILIH DATA ---
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const handleDeleteActivitySuggestion = (nameToDelete: string) => {
    const newSugg = activitySuggestions.filter(s => s.name !== nameToDelete);
    setActivitySuggestions(newSugg);
    saveSettingsToFirebase(newSugg, typeSuggestions);
  };

  const handleDeleteTypeSuggestion = (typeToDelete: string) => {
    const newTypeSugg = typeSuggestions.filter(t => t !== typeToDelete);
    setTypeSuggestions(newTypeSugg);
    saveSettingsToFirebase(activitySuggestions, newTypeSugg);
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const now = Date.now();
    let finalStartTime: number | null = now;
    let finalEndTime: number | null = null;
    let finalDuration: number | null = null;

    const durNum = durationInput ? Number(durationInput) : null;
    const startMs = startTimeInput ? new Date(startTimeInput).getTime() : null;
    const endMs = endTimeInput ? new Date(endTimeInput).getTime() : null;

    // RULE 3: Isi durasi saja -> Selesai = Waktu Simpan, Mulai mundur
    if (durNum && !startMs && !endMs) {
      finalEndTime = now;
      finalDuration = durNum;
      finalStartTime = now - (durNum * 60000);
    } 
    // RULE 4: Mulai & Selesai diisi -> Hitung durasi otomatis
    else if (startMs && endMs) {
      finalStartTime = startMs;
      finalEndTime = endMs;
      finalDuration = Math.max(0, Math.round((endMs - startMs) / 60000));
    } 
    // Mulai & Durasi diisi -> Selesai dihitung maju
    else if (startMs && durNum) {
      finalStartTime = startMs;
      finalDuration = durNum;
      finalEndTime = startMs + (durNum * 60000);
    } 

    // Hanya Mulai diisi
    else if (startMs) {
      finalStartTime = startMs;
    }

    // Tembakan Khusus Fitur Hitung Waktu
    if (isTimerActive) {
      finalStartTime = now;
      finalEndTime = null;
      finalDuration = null;
    }

    const newActivity: Activity = {
      id: now.toString(),
      name: name.trim(),
      type,
      timestamp: now,
      description: description.trim(),
      userId: userId || '',
      startTime: finalStartTime,
      endTime: finalEndTime,
      duration: finalDuration,
      isTimerActive: isTimerActive,
      pauses: [],
      resumes: []
    };

    if (userId) {
      setDoc(doc(db, 'activities', newActivity.id), newActivity).catch(err => {
         console.error("Gagal simpan ke Firebase:", err);
         alert("Gagal sinkronisasi ke awan! Error: " + err.message);
      });
    }

    const updatedActivities = [newActivity, ...activities].sort((a, b) => b.timestamp - a.timestamp);
    setActivities(updatedActivities);
    
    const trimmedName = name.trim();
    const trimmedType = type.trim() || 'Lainnya';

    const newActSugg = [{ name: trimmedName, type: trimmedType }, ...activitySuggestions.filter(s => s.name.toLowerCase() !== trimmedName.toLowerCase())].slice(0, 15);
    const newTypeSugg = [trimmedType, ...typeSuggestions.filter(t => t.toLowerCase() !== trimmedType.toLowerCase())].slice(0, 15);
    
    setActivitySuggestions(newActSugg);
    setTypeSuggestions(newTypeSugg);
    saveSettingsToFirebase(newActSugg, newTypeSugg);
    
    setName(''); setDescription(''); setType('');
    setStartTimeInput(''); setEndTimeInput(''); setDurationInput('');
    setIsTimerActive(false);
    setActiveTab('list');
  };

    const handleQuickSave = (suggName: string, suggType: string) => {
    const now = Date.now();
    let finalStartTime: number | null = now;
    let finalEndTime: number | null = null;
    let finalDuration: number | null = null;

    const durNum = durationInput ? Number(durationInput) : null;
    const startMs = startTimeInput ? new Date(startTimeInput).getTime() : null;
    const endMs = endTimeInput ? new Date(endTimeInput).getTime() : null;

    // Kalkulasi waktu (sama seperti handleSubmit) jika pengguna sempat mengisinya
    if (durNum && !startMs && !endMs) {
      finalEndTime = now;
      finalDuration = durNum;
      finalStartTime = now - (durNum * 60000);
    } else if (startMs && endMs) {
      finalStartTime = startMs;
      finalEndTime = endMs;
      finalDuration = Math.max(0, Math.round((endMs - startMs) / 60000));
    } else if (startMs && durNum) {
      finalStartTime = startMs;
      finalDuration = durNum;
      finalEndTime = startMs + (durNum * 60000);
    } else if (startMs) {
      finalStartTime = startMs;
    }

    // Tembakan Khusus Fitur Hitung Waktu (Agar sinkron dengan status tombol "Sedang Merekam")
    if (isTimerActive) {
      finalStartTime = now;
      finalEndTime = null;
      finalDuration = null;
    }

    const newActivity: Activity = {
      id: now.toString(),
      name: suggName.trim(),
      // Jika pengguna sempat mengubah 'type' di form, pakai yang di form. Jika tidak, pakai saran dari bubble.
      type: type.trim() || suggType.trim() || 'Lainnya',
      timestamp: now,
      description: description.trim(), 
      userId: userId || '',
      startTime: finalStartTime,
      endTime: finalEndTime,
      duration: finalDuration,
      isTimerActive: isTimerActive, // <-- MEMBAWA STATUS TIMER
      pauses: [],                   // <-- MENYIAPKAN ARRAY JEDA
      resumes: []                   // <-- MENYIAPKAN ARRAY LANJUT
    };

    if (userId) {
      setDoc(doc(db, 'activities', newActivity.id), newActivity).catch(err => console.error("Gagal:", err));
    }

    const updatedActivities = [newActivity, ...activities].sort((a, b) => b.timestamp - a.timestamp);
    setActivities(updatedActivities);
    
    const newActSugg = [{ name: suggName, type: suggType || 'Lainnya' }, ...activitySuggestions.filter(s => s.name.toLowerCase() !== suggName.toLowerCase())].slice(0, 15);
    const newTypeSugg = [suggType || 'Lainnya', ...typeSuggestions.filter(t => t.toLowerCase() !== (suggType || 'Lainnya').toLowerCase())].slice(0, 15);
    
    setActivitySuggestions(newActSugg);
    setTypeSuggestions(newTypeSugg);
    saveSettingsToFirebase(newActSugg, newTypeSugg);

    setName(''); setDescription(''); setType('');
    setStartTimeInput(''); setEndTimeInput(''); setDurationInput('');
    setIsTimerActive(false); // <-- Matikan tombol rekam di form
    setActiveTab('list');
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !editingId) return;

    const durNum = editDuration ? Number(editDuration) : null;
    const startMs = editStartTime ? new Date(editStartTime).getTime() : null;
    const endMs = editEndTime ? new Date(editEndTime).getTime() : null;

    let finalStartTime: number | null = startMs;
    let finalEndTime: number | null = endMs;
    let finalDuration: number | null = durNum;

    // RULE 2: Kalkulasi otomatis saat edit
    if (startMs && endMs) {
        finalDuration = Math.max(0, Math.round((endMs - startMs) / 60000));
    } else if (startMs && durNum) {
        finalEndTime = startMs + (durNum * 60000);
    } else if (endMs && durNum) {
        finalStartTime = endMs - (durNum * 60000);
    }

    const originalActivity = activities.find(a => a.id === editingId);

    const updatedActivity: Activity = {
        id: editingId,
        name: editName.trim(),
        type: editType,
        timestamp: originalActivity ? originalActivity.timestamp : Date.now(),
        description: editDescription.trim(),
        userId: userId || '',
        startTime: finalStartTime,
        endTime: finalEndTime,
        duration: finalDuration
    };

    if (userId) {
        setDoc(doc(db, 'activities', editingId), updatedActivity, { merge: true }).catch(err => console.error("Gagal update:", err));
    }

    const updatedActivities = activities.map(act => act.id === editingId ? updatedActivity : act);
    updatedActivities.sort((a, b) => b.timestamp - a.timestamp);

    setActivities(updatedActivities);
    setEditingId(null);
  };
  
  const openEditModal = (activity: Activity) => {
    setEditingId(activity.id);
    setEditName(activity.name);
    setEditType(activity.type);
    setEditDescription(activity.description || '');
    setEditStartTime(activity.startTime ? format(activity.startTime, "yyyy-MM-dd'T'HH:mm") : '');
    setEditEndTime(activity.endTime ? format(activity.endTime, "yyyy-MM-dd'T'HH:mm") : '');
    setEditDuration(activity.duration ? activity.duration.toString() : '');
  };

  const handleTimerAction = (activity: Activity, action: 'pause' | 'resume' | 'stop' | 'restart') => {
    const now = Date.now();
    let updatedActivity = { ...activity };

    if (action === 'pause') {
        updatedActivity.pauses = [...(activity.pauses || []), now];
    } else if (action === 'resume') {
        updatedActivity.resumes = [...(activity.resumes || []), now];
   
    } else if (action === 'stop') {
        updatedActivity.isTimerActive = false;
        updatedActivity.endTime = now;
        
        // Kalkulasi Durasi Bersih
        const startMs = activity.startTime || activity.timestamp;
        const pauses = activity.pauses || [];
        const resumes = activity.resumes || [];
        let totalPauseMs = 0;
        for (let i = 0; i < pauses.length; i++) {
            const p = pauses[i];
            const r = resumes[i] || now;
            totalPauseMs += (r - p);
        }
        const activeMs = (now - startMs) - totalPauseMs;
        updatedActivity.duration = Math.max(0, Math.round(activeMs / 60000));
    } else if (action === 'restart') {
        updatedActivity.isTimerActive = true;
        // Pindahkan endTime lama (atau waktu mulai jika kosong) ke array pauses agar sesi sebelumnya tercatat selesai
        const previousEnd = activity.endTime || activity.startTime || activity.timestamp;
        updatedActivity.pauses = [...(activity.pauses || []), previousEnd];
        updatedActivity.resumes = [...(activity.resumes || []), now];
        updatedActivity.endTime = null;
        updatedActivity.duration = null;
    }

    if (userId) {
        setDoc(doc(db, 'activities', activity.id), updatedActivity, { merge: true }).catch(err => console.error(err));
    }
    setActivities(prev => prev.map(a => a.id === activity.id ? updatedActivity : a));
  };
  
  const confirmDelete = () => {
    if (deletingId) {
      // Hapus dari Firebase
      if (userId) {
         deleteDoc(doc(db, 'activities', deletingId));
      }
      setActivities(activities.filter(a => a.id !== deletingId));
      setDeletingId(null);
    }
  };

  // List Processing Logic (Filter, Sort, Group)
  const processedActivities = activities
    .filter(a => filterType === 'All' || a.type === filterType)
    .sort((a, b) => {
      if (sortBy === 'newest') return b.timestamp - a.timestamp;
      if (sortBy === 'oldest') return a.timestamp - b.timestamp;
      if (sortBy === 'nameAsc') return a.name.localeCompare(b.name);
      if (sortBy === 'nameDesc') return b.name.localeCompare(a.name);
      return 0;
    });

  let groupedActivities: Record<string, Activity[]> = {};
  if (groupBy === 'month') {
    processedActivities.forEach(act => {
      const monthYear = format(act.timestamp, 'MMMM yyyy', { locale: id });
      if (!groupedActivities[monthYear]) groupedActivities[monthYear] = [];
      groupedActivities[monthYear].push(act);
    });
  } else if (groupBy === 'type') {
    processedActivities.forEach(act => {
      const actType = act.type || 'Lainnya';
      if (!groupedActivities[actType]) groupedActivities[actType] = [];
      groupedActivities[actType].push(act);
    });
  } else {
    groupedActivities = { 'Semua Aktivitas': processedActivities };
  }

  const uniqueActivityTypesForFilter = Array.from(new Set(activities.map(a => a.type)));

  // Stats calculations
  const uniqueTypes = Array.from(new Set(activities.map(a => a.type)));
  const statsByType = uniqueTypes.map(t => ({
    name: t,
    value: activities.filter(a => a.type === t).length
  })).filter(s => s.value > 0);

  const totalActivities = activities.length;
  const mostFrequentType = statsByType.length > 0 
    ? statsByType.reduce((prev, current) => (prev.value > current.value) ? prev : current).name 
    : '-';
  
  // --- FILTER SARAN BUBBLE ---
  const visibleTypeSuggestions = typeSuggestions
      .filter(t => t.toLowerCase().includes(type.trim().toLowerCase()))
      .slice(0, 15); 

  const visibleActivitySuggestions = activitySuggestions
      .filter(a => a.name.toLowerCase().includes(name.trim().toLowerCase()))
      .slice(0, 15);
  
  // --- DAFTAR AUTOCOMPLETE UNTUK INPUT (DARI RIWAYAT) ---
  const historyTypesSet = new Set(activities.map(a => a.type).filter(Boolean));
  const historyNamesSet = new Set(activities.map(a => a.name).filter(Boolean));
  const autocompleteTypes = Array.from(historyTypesSet);
  const autocompleteNames = Array.from(historyNamesSet);

  // --- LOGIKA DATA MANAJEMEN (MODAL RELASI) ---
  const uniqueDataMap = new Map<string, string>();
  // Ambil dari riwayat terlebih dahulu agar yang terbaru yang terpilih
  [...activities].reverse().forEach(a => uniqueDataMap.set(a.name, a.type));
  // Tambahkan dari suggestion jika belum masuk
  activitySuggestions.forEach(s => {
      if (!uniqueDataMap.has(s.name)) uniqueDataMap.set(s.name, s.type);
  });
  // Sortir sesuai abjad nama aktivitas
  const allUniqueData = Array.from(uniqueDataMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const handleUpdateMapping = (nameToUpdate: string, newType: string) => {
      if (!newType.trim()) return;
      
      // 1. Update Suggestions (agar input selanjutnya otomatis menggunakan jenis baru)
      const updatedSuggestions = activitySuggestions.map(s =>
          s.name === nameToUpdate ? { ...s, type: newType } : s
      );
      if (!updatedSuggestions.some(s => s.name === nameToUpdate)) {
          updatedSuggestions.push({ name: nameToUpdate, type: newType });
      }

      const updatedTypeSuggestions = [...typeSuggestions];
      if (!updatedTypeSuggestions.includes(newType)) {
          updatedTypeSuggestions.push(newType);
      }

      setActivitySuggestions(updatedSuggestions);
      setTypeSuggestions(updatedTypeSuggestions);
      saveSettingsToFirebase(updatedSuggestions, updatedTypeSuggestions);

      // 2. Update Masal di Riwayat (Semua aktivitas lampau dengan nama ini akan berubah jenisnya)
      if (userId) {
          const activitiesToUpdate = activities.filter(a => a.name === nameToUpdate && a.type !== newType);
          activitiesToUpdate.forEach(act => {
              setDoc(doc(db, 'activities', act.id), { type: newType }, { merge: true }).catch(e => console.error(e));
          });
      }
      
      setToastMessage(`Berhasil mengubah jenis untuk "${nameToUpdate}" ✓`);
      setTimeout(() => setToastMessage(null), 2000);
  };
  // ----------------------------------------------

  // --- FITUR EKSPOR & IMPOR ---
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportData = () => {
    // Mengekspor semua data aktivitas, lengkap dengan waktu dan sesi jedanya
    const dataToExport = JSON.stringify(activities, null, 2);
    const blob = new Blob([dataToExport], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TractApp_Backup_${format(Date.now(), 'yyyyMMdd_HHmmss')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    setToastMessage("Berhasil mengekspor data aktivitas ✓");
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const fileReader = new FileReader();
      fileReader.onload = async (e) => {
        const content = e.target?.result as string;
        const importedData = JSON.parse(content);
        
        if (Array.isArray(importedData)) {
          if (!confirm(`Apakah Anda yakin ingin mengimpor ${importedData.length} data aktivitas? Data lama dengan ID yang sama akan ditimpa.`)) {
             if (fileInputRef.current) fileInputRef.current.value = '';
             return;
          }

          let successCount = 0;
          const newLocalActivities = [...activities];
          
          for (const act of importedData) {
            // Validasi sederhana: pastikan datanya memiliki id dan name
            if (act.id && act.name) { 
              const finalAct = { ...act, userId: userId || '' };
              
              // Simpan ke Firebase jika sedang login
              if (userId) {
                await setDoc(doc(db, 'activities', act.id), finalAct, { merge: true }).catch(err => console.error(err));
              }

              // Update array lokal untuk antisipasi offline
              const existingIndex = newLocalActivities.findIndex(a => a.id === act.id);
              if (existingIndex >= 0) {
                 newLocalActivities[existingIndex] = finalAct;
              } else {
                 newLocalActivities.push(finalAct);
              }
              successCount++;
            }
          }
          
          // Set manual untuk mempercepat pembaruan UI sebelum listener firebase memproses
          newLocalActivities.sort((a, b) => b.timestamp - a.timestamp);
          setActivities(newLocalActivities);
          
          setToastMessage(`Berhasil mengimpor ${successCount} aktivitas ✓`);
          setTimeout(() => setToastMessage(null), 3000);
        } else {
          alert("Format file tidak valid. Pastikan ini adalah file backup JSON TractApp.");
        }
      };
      fileReader.readAsText(file);
    } catch (error) {
      console.error("Gagal impor:", error);
      alert("Terjadi kesalahan saat membaca file. Pastikan file JSON tersebut benar.");
    }
    
    // Reset input file agar dapat digunakan mengimpor file yang sama lagi
    if (fileInputRef.current) fileInputRef.current.value = '';
  };                 

  // --- FUNGSI BARU UNTUK FITUR PILIH DATA ---
  const handleToggleSelectAll = () => {
    if (selectedIds.length === processedActivities.length) {
      setSelectedIds([]); // Batal pilih semua
    } else {
      setSelectedIds(processedActivities.map(a => a.id)); // Pilih semua yang tampil
    }
  };

  const handleExportSelected = () => {
    if (selectedIds.length === 0) return;
    const dataToExport = activities.filter(a => selectedIds.includes(a.id));
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TractApp_Partial_Backup_${format(Date.now(), 'yyyyMMdd_HHmmss')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    setToastMessage(`Berhasil mengekspor ${dataToExport.length} data pilihan ✓`);
    setTimeout(() => setToastMessage(null), 2000);
    setIsSelectionMode(false);
    setSelectedIds([]);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Apakah Anda yakin ingin menghapus ${selectedIds.length} aktivitas yang dipilih? Tindakan ini permanen.`)) {
      if (userId) {
        selectedIds.forEach(id => {
           deleteDoc(doc(db, 'activities', id)).catch(e => console.error(e));
        });
      }
      setActivities(prev => prev.filter(a => !selectedIds.includes(a.id)));
      setSelectedIds([]);
      setIsSelectionMode(false);
      setToastMessage(`${selectedIds.length} data berhasil dihapus ✓`);
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  return (
     <div className="h-full w-full bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row overflow-hidden">
      {/* Menu Navigasi (Horizontal di Mobile, Vertikal di Desktop) */}
      <aside className="w-full md:w-64 bg-white border-b md:border-r md:border-b-0 border-slate-200 flex-shrink-0 flex flex-col z-10 shadow-sm md:shadow-none">
        <div className="p-4 md:p-6 border-b border-slate-100 flex items-center gap-3">
          {onGoHome && (
            <button onClick={onGoHome} className="p-2 -ml-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors" title="Kembali ke Home">
              <X size={18} className="text-slate-600" />
            </button>
          )}
          <h1 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
            <ActivityIcon className="text-blue-600" size={22} />
            <span className="hidden sm:inline">ActivityTracker</span>
            <span className="sm:hidden">Tracker</span>
          </h1>
        </div>
        <nav className="p-2 md:p-4 flex flex-row md:flex-col gap-1 md:gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('input')}
            className={cn(
              "flex-1 md:w-full flex justify-center md:justify-start items-center gap-2 px-3 py-2.5 rounded-lg text-xs md:text-sm font-semibold transition-colors whitespace-nowrap",
              activeTab === 'input' 
                ? "bg-blue-600 text-white shadow-md" 
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Input Aktivitas</span>
            <span className="sm:hidden">Input</span>
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={cn(
              "flex-1 md:w-full flex justify-center md:justify-start items-center gap-2 px-3 py-2.5 rounded-lg text-xs md:text-sm font-semibold transition-colors whitespace-nowrap",
              activeTab === 'list' 
                ? "bg-blue-600 text-white shadow-md" 
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <List size={16} />
            <span className="hidden sm:inline">Riwayat Aktivitas</span>
            <span className="sm:hidden">Riwayat</span>
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={cn(
              "flex-1 md:w-full flex justify-center md:justify-start items-center gap-2 px-3 py-2.5 rounded-lg text-xs md:text-sm font-semibold transition-colors whitespace-nowrap",
              activeTab === 'stats' 
                ? "bg-blue-600 text-white shadow-md" 
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <BarChart3 size={16} />
            <span className="hidden sm:inline">Statistik</span>
            <span className="sm:hidden">Stats</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto pb-24">
        
        {/* TAB: INPUT */}
        {activeTab === 'input' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
              <h2 className="text-2xl font-bold text-slate-800 mb-6">Tambah Aktivitas Baru</h2>
                <form onSubmit={handleSubmit} className="space-y-6">
      
                {/* 1. Jenis Aktivitas */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Jenis Aktivitas
                  </label>
                  <input
                    type="text"
                    required
                    list="type-suggestions-list"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Contoh: Olahraga, Bekerja..."
                  />
                  <datalist id="type-suggestions-list">
                    {autocompleteTypes.map((t, idx) => (
                      <option key={idx} value={t} />
                    ))}
                  </datalist>
                
                  {/* Bubble Suggestions for Activity Types */}
                  {visibleTypeSuggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {visibleTypeSuggestions.map(actType => (
                        <span key={actType} className="bg-emerald-50 border border-emerald-100 text-emerald-700 pl-3 pr-1 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 transition-colors">
                          <span 
                            className="cursor-pointer hover:underline"
                            onClick={() => setType(actType)}
                            title="Klik untuk mengisi jenis ini ke form"
                          >
                            {actType}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteTypeSuggestion(actType)}
                            className="text-emerald-400 hover:bg-emerald-200 hover:text-red-500 p-1 rounded-full transition-colors ml-1"
                            title="Klik untuk menghapus dari daftar bubble"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Keterangan */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Keterangan
                  </label>
                  <textarea
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                    placeholder="Tambahkan detail aktivitas..."
                  />
                </div>

                 {/* 3. Nama Aktivitas */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Nama Aktivitas
                  </label>
                  <input
                    type="text"
                    required
                    list="name-suggestions-list"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Contoh: Lari pagi, Meeting klien..."
                  />
                  <datalist id="name-suggestions-list">
                    {autocompleteNames.map((n, idx) => (
                      <option key={idx} value={n} />
                    ))}
                  </datalist>

                  {/* Bubble Suggestions for Activity Names */}
                  {visibleActivitySuggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {visibleActivitySuggestions.map(sugg => (
                        <span key={sugg.name} className="bg-blue-50 border border-blue-100 text-blue-700 pl-3 pr-1 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 transition-colors hover:bg-blue-100">
                          <span 
                            className="cursor-pointer font-semibold py-0.5"
                            onClick={() => handleQuickSave(sugg.name, sugg.type)}
                            title="Klik untuk LANGSUNG MENYIMPAN aktivitas ini"
                          >
                            {sugg.name}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleDeleteActivitySuggestion(sugg.name)}
                            className="text-blue-400 hover:bg-blue-200 hover:text-red-500 p-1 rounded-full transition-colors ml-1"
                            title="Klik untuk menghapus dari daftar bubble"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>    

                {/* 3.5 Pengaturan Waktu Spesifik */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                 
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-medium text-slate-700">Waktu Mulai (Opsional)</label>
                      <button
                        type="button"
                        onClick={() => setIsTimerActive(!isTimerActive)}
                        className={cn("px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer", isTimerActive ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200")}
                      >
                        {isTimerActive ? '🔴 Sedang Merekam' : '⏱️ Hitung Waktu'}
                      </button>
                    </div>
                    <input
                      type="datetime-local"
                      disabled={isTimerActive}
                  
                      value={startTimeInput}
                      onChange={(e) => setStartTimeInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Waktu Selesai (Opsional)
                    </label>
                    <input
                      type="datetime-local"
                      value={endTimeInput}
                      onChange={(e) => setEndTimeInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Durasi (Menit)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={durationInput}
                      onChange={(e) => setDurationInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                      placeholder="Misal: 60"
                    />
                  </div>
                </div>

                {/* 4. Submit */}
                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={20} />
                    Simpan Aktivitas
                  </button>
                  <p className="text-xs text-slate-500 text-center mt-4 flex items-center justify-center gap-1">
                    <Clock size={12} /> Waktu akan dicatat secara otomatis oleh sistem saat disimpan.
                  </p>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB: LIST */}
        {activeTab === 'list' && (
          <div className="max-w-5xl mx-auto">
            {/* Header List dengan Filter & Sort */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Riwayat Aktivitas</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span 
                    onClick={() => setShowDataModal(true)}
                    className="bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer text-xs font-semibold px-3 py-1 rounded-full inline-block transition-colors shadow-sm"
                    title="Klik untuk mengelola relasi Nama dan Jenis Aktivitas"
                  >
                    {processedActivities.length} Ditampilkan ({activities.length} Total) ⚙️
                  </span>
                  
                  {/* Tombol Ekspor */}
                  <button 
                    onClick={handleExportData}
                    className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer text-xs font-semibold px-3 py-1 rounded-full inline-flex items-center gap-1 transition-colors shadow-sm"
                    title="Ekspor Riwayat sebagai JSON"
                  >
                    <Download size={12} /> Ekspor
                  </button>
                  
                  {/* Tombol Impor */}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-purple-100 text-purple-800 hover:bg-purple-200 cursor-pointer text-xs font-semibold px-3 py-1 rounded-full inline-flex items-center gap-1 transition-colors shadow-sm"
                    title="Impor Riwayat dari JSON"
                  >
                    <Upload size={12} /> Impor
                  </button>
                  
                  {/* Input File Tersembunyi */}
                  <input 
                    type="file" 
                    accept=".json" 
                    ref={fileInputRef} 
                    onChange={handleImportData} 
                    className="hidden" 
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:flex md:flex-wrap gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm items-end">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium text-slate-500 block mb-1">Kumpulkan</label>
                  <select 
                    value={groupBy} 
                    onChange={e => setGroupBy(e.target.value as any)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                  >
                    <option value="none">Tidak ada</option>
                    <option value="month">Per Bulan</option>
                    <option value="type">Per Jenis</option>
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="text-xs font-medium text-slate-500 block mb-1">Filter</label>
                  <select 
                    value={filterType} 
                    onChange={e => setFilterType(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                  >
                    <option value="All">Semua Jenis</option>
                    {uniqueActivityTypesForFilter.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="text-xs font-medium text-slate-500 block mb-1">Urutkan</label>
                  <select 
                    value={sortBy} 
                    onChange={e => setSortBy(e.target.value as any)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
                  >
                    <option value="newest">Terbaru</option>
                    <option value="oldest">Terlama</option>
                    <option value="nameAsc">Nama (A-Z)</option>
                    <option value="nameDesc">Nama (Z-A)</option>
                  </select>
                </div>
                
                {/* TOMBOL PILIH DATA BARU */}
                <div className="col-span-2 md:col-span-1 md:ml-auto w-full md:w-auto mt-2 md:mt-0">
                  <button
                    onClick={() => {
                      setIsSelectionMode(!isSelectionMode);
                      if (isSelectionMode) setSelectedIds([]); // Reset jika dibatalkan
                    }}
                    className={cn(
                      "w-full text-sm font-semibold px-4 py-2 rounded-lg transition-colors border shadow-sm h-[38px] flex justify-center items-center gap-2", 
                      isSelectionMode ? "bg-slate-200 text-slate-800 border-slate-300" : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                    )}
                  >
                    {isSelectionMode ? <><X size={16}/> Batal Pilih</> : "☑ Pilih Data"}
                  </button>
                </div>
              </div>
            </div>

            {/* BAR KOTAK BIRU AKSI PILIHAN */}
            {isSelectionMode && processedActivities.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-6 flex flex-wrap items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-blue-800 bg-blue-100 px-3 py-1 rounded-full">
                    {selectedIds.length} Dipilih
                  </span>
                  <button onClick={handleToggleSelectAll} className="text-sm font-semibold text-blue-600 hover:text-blue-800 underline">
                    {selectedIds.length === processedActivities.length ? "Batal Semua" : "Pilih Semua"}
                  </button>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    disabled={selectedIds.length === 0}
                    onClick={handleExportSelected}
                    className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex justify-center items-center gap-1 shadow-sm"
                  >
                    <Download size={14} /> Ekspor Pilihan
                  </button>
                  <button
                    disabled={selectedIds.length === 0}
                    onClick={handleDeleteSelected}
                    className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex justify-center items-center gap-1 shadow-sm"
                  >
                    <Trash2 size={14} /> Hapus Pilihan
                  </button>
                </div>
              </div>
            )}

            {activities.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <List className="text-slate-400" size={32} />
                </div>
                <h3 className="text-lg font-medium text-slate-900 mb-2">Belum ada aktivitas</h3>
                <p className="text-slate-500 mb-6">Mulai catat aktivitas harian Anda sekarang.</p>
                <button
                  onClick={() => setActiveTab('input')}
                  className="bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium py-2 px-6 rounded-lg transition-colors"
                >
                  Tambah Aktivitas
                </button>
              </div>
            ) : processedActivities.length === 0 ? (
               <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
                <p className="text-slate-500 mb-6">Tidak ada aktivitas yang sesuai dengan filter.</p>
                <button
                  onClick={() => setFilterType('All')}
                  className="bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium py-2 px-6 rounded-lg transition-colors"
                >
                  Reset Filter
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedActivities).map(([groupName, groupActs]) => (
                  <div key={groupName} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    {groupBy !== 'none' && (
                      <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
                        <h3 className="font-semibold text-slate-700">{groupName} <span className="text-sm font-normal text-slate-500 ml-2">({groupActs.length})</span></h3>
                      </div>
                    )}

                    <div className="flex flex-col">
                      {groupActs.map((activity) => (
                        <div key={activity.id} className="border-t border-slate-100 p-4 hover:bg-slate-50 transition-colors flex flex-col gap-3">
                          <div className="flex justify-between items-start gap-3">
  {/* CHECKBOX UNTUK MODE PILIH DATA */}
  {isSelectionMode && (
    <div className="pt-0.5">
      <input
        type="checkbox"
        checked={selectedIds.includes(activity.id)}
        onChange={(e) => {
          if (e.target.checked) setSelectedIds(prev => [...prev, activity.id]);
          else setSelectedIds(prev => prev.filter(id => id !== activity.id));
        }}
        className="w-5 h-5 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 cursor-pointer transition-all"
      />
    </div>
  )}
  
  <div className="flex-1">
     <h4 className="font-bold text-slate-900 text-base leading-tight mb-1">{activity.name}</h4>
                              
                              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                                  {/* Logika Status Timer */}
                                  {(() => {
                                      const isPaused = activity.isTimerActive && (activity.pauses?.length || 0) > (activity.resumes?.length || 0);
                                      return (
                                          <>
                                              <Clock size={12} className={activity.isTimerActive ? (isPaused ? "text-amber-500" : "text-red-500 animate-pulse") : "text-blue-500"} />
                                              {activity.isTimerActive && (
                                                  <span className={cn(
                                                      "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight leading-none",
                                                      isPaused ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                                                  )}>
                                                      {isPaused ? "Dijeda" : "Berjalan"}
                                                  </span>
                                             )}
                                          </>
                                      );
                                  })()}
                                  <span 
                                    onClick={() => setDetailActivity(activity)}
                                    className="cursor-pointer hover:text-blue-600 hover:underline"
                                    title="Klik untuk melihat tabel rincian waktu"
                                  >
                                    {format(activity.startTime || activity.timestamp, 'dd MMM yyyy')} •
                                    <span className="text-slate-800 ml-1">
                                      {format(activity.startTime || activity.timestamp, 'HH:mm')}
                                      {activity.endTime ? ` - ${format(activity.endTime, 'HH:mm')}` : ''}
                                    </span>
                                    {activity.duration ? ` (${activity.duration} menit)` : ''}
                                  </span>
                               </div>
                            </div>
                            
                            <span className={cn(
                                "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
                                activity.type === 'Olahraga' ? "bg-blue-100 text-blue-700" :
                                activity.type === 'Belajar' ? "bg-emerald-100 text-emerald-700" :
                                activity.type === 'Bekerja' ? "bg-amber-100 text-amber-700" :
                                activity.type === 'Hobi' ? "bg-purple-100 text-purple-700" :
                                "bg-slate-100 text-slate-700"
                              )}>
                                {activity.type}
                            </span>
                          </div>
                          
                          {activity.description && (
                            <p className="text-sm text-slate-600 bg-white border border-slate-100 p-3 rounded-lg shadow-sm">
                               {renderRichText(activity.description)}
                            </p>
                          )}

   
                           <div className="flex items-center justify-end gap-2 mt-1">
                            {/* Tombol Kontrol Saat Timer Aktif */}
                            {activity.isTimerActive && (
                                <div className="flex items-center gap-2 mr-auto bg-slate-100 p-1 rounded-lg">
                                    {(!activity.pauses || activity.pauses.length <= (activity.resumes?.length || 0)) ? (
                                        <button
                                          onClick={() => handleTimerAction(activity, 'pause')}
                                          className="px-3 py-1 text-[10px] sm:text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-md shadow-sm transition-colors"
                                        >
                                          ⏸ Jeda
                                        </button>
                                    ) : (
                                        <button
                                          onClick={() => handleTimerAction(activity, 'resume')}
                                          className="px-3 py-1 text-[10px] sm:text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-md shadow-sm transition-colors"
                                        >
                                          ▶ Lanjutkan
                                        </button>
                                    )}
                                    <button
                                      onClick={() => handleTimerAction(activity, 'stop')}
                                      className="px-3 py-1 text-[10px] sm:text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm transition-colors"
                                    >
                                      ⏹ Berhenti
                                    </button>
                                </div>
                            )}

                            {/* Tombol Opsi Mulai Kembali (Muncul jika Timer sudah Berhenti & bukan input manual murni) */}
                            {!activity.isTimerActive && (activity.startTime || activity.resumes?.length) && (
                                <div className="flex items-center gap-1">
                                    {showRestartOption === activity.id ? (
                                        <button
                                            onClick={() => {
                                                handleTimerAction(activity, 'restart');
                                                setShowRestartOption(null);
                                            }}
                                            className="px-3 py-1.5 text-[10px] font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg animate-in slide-in-from-right-2 duration-200"
                                        >
                                            🔄 Mulai Kembali
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => setShowRestartOption(activity.id)}
                                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="Opsi Lanjutan"
                                        >
                                            <Clock size={16} />
                                        </button>
                                    )}
                                </div>
                            )}

                            <button
                              onClick={() => openEditModal(activity)}
                  
                              
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                            >
                              <Edit2 size={14} /> Edit
                            </button>
                            <button
                              onClick={() => setDeletingId(activity.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                            >
                              <Trash2 size={14} /> Hapus
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: STATS */}
        {activeTab === 'stats' && (
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Statistik Aktivitas</h2>
            
            {activities.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
                <p className="text-slate-500">Belum ada data untuk ditampilkan statistik.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                      <List size={24} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">Total Aktivitas</p>
                      <p className="text-3xl font-bold text-slate-900">{totalActivities}</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                      <BarChart3 size={24} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-500">Aktivitas Terbanyak</p>
                      <p className="text-3xl font-bold text-slate-900">{mostFrequentType}</p>
                    </div>
                  </div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Bar Chart */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Distribusi per Jenis</h3>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statsByType} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                          <Tooltip 
                            cursor={{ fill: '#f1f5f9' }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          />
                          <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Pie Chart */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Komposisi Aktivitas</h3>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statsByType}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {statsByType.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Edit Modal - dengan pengaman Waktu (Date) anti-blank */}
      {editingId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h3 className="text-xl font-bold text-slate-800">Edit Aktivitas</h3>
              <button 
                onClick={() => setEditingId(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-5">
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nama Aktivitas
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Mulai</label>
                  <input
                    type="datetime-local"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Selesai</label>
                  <input
                    type="datetime-local"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Durasi (Mnt)</label>
                  <input
                    type="number"
                    min="1"
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Jenis Aktivitas
                </label>
                <input
                  type="text"
                  required
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="Contoh: Olahraga, Bekerja..."
                />
              </div>

              <div>
                <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Keterangan
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => handleDescriptionChange(e, 'edit')}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                />
              </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

       {/* Time Detail Modal */}
      {detailActivity && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => { setDetailActivity(null); setEditingSessionIndex(null); }}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 md:p-6 border-b border-slate-100 bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Clock size={18}/> Rincian Waktu</h3>
              <button 
                onClick={() => { setDetailActivity(null); setEditingSessionIndex(null); }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 md:p-6">
              <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-blue-600">{detailActivity.name}</h4>
                  <button onClick={handleAddSession} className="bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors">
                      <Plus size={14} /> Tambah Sesi
                  </button>
              </div>
              
              {/* PENAMBAHAN: overflow-x-auto & min-w-[550px] agar tabel bisa digeser di HP! */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 pb-1">
                  <table className="w-full text-left text-xs whitespace-nowrap min-w-[550px]">
                      <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider">
                          <tr>
                              <th className="px-3 py-3 font-medium border-b">Sesi</th>
                              <th className="px-3 py-3 font-medium border-b">Waktu</th>
                              <th className="px-3 py-3 font-medium border-b">Keterangan</th>
                              <th className="px-3 py-3 font-medium border-b text-right">Durasi</th>
                              <th className="px-3 py-3 font-medium border-b text-center">Aksi</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {(() => {
                              const sessions = [];
                              const pauses = detailActivity.pauses || [];
                              const resumes = detailActivity.resumes || [];
                              const notes = detailActivity.sessionNotes || [];
                              
                              sessions.push({
                                  index: 0,
                                  start: detailActivity.startTime || detailActivity.timestamp,
                                  end: pauses.length > 0 ? pauses[0] : detailActivity.endTime,
                                  note: notes[0] || '',
                                  isRunning: detailActivity.isTimerActive && pauses.length === 0
                              });

                              resumes.forEach((res, i) => {
                                  const pIdx = i + 1;
                                  sessions.push({
                                      index: pIdx,
                                      start: res,
                                      end: pauses.length > pIdx ? pauses[pIdx] : detailActivity.endTime,
                                      note: notes[pIdx] || '',
                                      isRunning: detailActivity.isTimerActive && pauses.length === pIdx
                                  });
                              });

                              return sessions.map((ses) => {
                                  const mins = ses.end ? Math.max(0, Math.round((ses.end - ses.start) / 60000)) : 0;
                                  const isEditing = editingSessionIndex === ses.index;

                                  // Jika tombol Edit diklik (Muncul Form)
                                  if (isEditing) {
                                      return (
                                          <tr key={ses.index} className="bg-blue-50/50">
                                              <td className="px-3 py-2 text-slate-500 font-medium">Sesi {ses.index + 1}</td>
                                              <td className="px-3 py-2 flex flex-col gap-1">
                                                  <input type="datetime-local" value={editSessionStart} onChange={e => setEditSessionStart(e.target.value)} className="text-[10px] p-1 border border-slate-300 rounded outline-none focus:border-blue-500" />
                                                  <input type="datetime-local" value={editSessionEnd} onChange={e => setEditSessionEnd(e.target.value)} className="text-[10px] p-1 border border-slate-300 rounded outline-none focus:border-blue-500" disabled={ses.isRunning} title={ses.isRunning ? "Sedang Berjalan..." : ""} />
                                              </td>
                                              <td className="px-3 py-2">
                                                  <input type="text" placeholder="Catatan sesi..." value={editSessionNote} onChange={(e) => handleDescriptionChange(e, 'session')} className="text-[10px] p-1.5 border border-slate-300 rounded w-full min-w-[120px] outline-none focus:border-blue-500"/>
                                              </td>
                                              <td className="px-3 py-2 text-right text-slate-400">-</td>
                                              <td className="px-3 py-2 text-center">
                                                  <div className="flex justify-center gap-1">
                                                      <button onClick={handleSaveSessionEdit} className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-bold transition-colors">Simpan</button>
                                                      <button onClick={() => setEditingSessionIndex(null)} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded text-[10px] font-bold transition-colors">Batal</button>
                                                  </div>
                                              </td>
                                          </tr>
                                      )
                                  }

                                  // Tampilan Normal (Read-Only)
                                  return (
                                      <tr key={ses.index} className="hover:bg-slate-50 transition-colors">
                                          <td className="px-3 py-3 text-slate-500 font-medium">Sesi {ses.index + 1}</td>
                                          <td className="px-3 py-3 text-slate-700">
                                              {format(ses.start, 'HH:mm')} - {ses.end ? format(ses.end, 'HH:mm') : <span className="text-red-500 animate-pulse font-bold">Berjalan...</span>}
                                          </td>
                                          <td className="px-3 py-3 text-slate-600 max-w-[150px] truncate" title={ses.note}>{renderRichText(ses.note) || '-'}</td>
                                          <td className="px-3 py-3 text-right font-bold text-slate-700">{ses.end ? `${mins} mnt` : '-'}</td>
                                          <td className="px-3 py-3 text-center">
                                              <div className="flex justify-center gap-1.5">
                                                  <button 
                                                    onClick={() => {
                                                        setEditingSessionIndex(ses.index);
                                                        setEditSessionStart(format(ses.start, "yyyy-MM-dd'T'HH:mm"));
                                                        setEditSessionEnd(ses.end ? format(ses.end, "yyyy-MM-dd'T'HH:mm") : '');
                                                        setEditSessionNote(ses.note);
                                                    }}
                                                    className="text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 p-1.5 rounded transition-colors inline-flex justify-center"
                                                    title="Edit Sesi Ini"
                                                  >
                                                      <Edit2 size={14}/>
                                                  </button>
                                                  <button 
                                                    onClick={() => handleDeleteSession(ses.index)}
                                                    className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded transition-colors inline-flex justify-center"
                                                    title="Hapus Sesi Ini"
                                                  >
                                                      <Trash2 size={14}/>
                                                  </button>
                                              </div>
                                          </td>
                                      </tr>
                                  )
                              });
                          })()}
                      </tbody>
                      {detailActivity.duration != null && (
                          <tfoot className="bg-blue-50 border-t border-blue-200">
                              <tr>
                                  <td colSpan={3} className="px-3 py-3 text-right font-bold uppercase tracking-wider text-blue-700 text-[10px]">Total Durasi Bersih:</td>
                                  <td className="px-3 py-3 text-right font-black text-blue-800 text-base">{detailActivity.duration} mnt</td>
                                  <td></td>
                              </tr>
                          </tfoot>
                      )}
                  </table>
              </div>
            </div>
          </div>
        </div>
      )}
       
      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="text-red-600" size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Hapus Aktivitas?</h3>
              <p className="text-slate-500 mb-6">
                Aktivitas ini akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingId(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                >
                  Hapus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Notifikasi Timer Aktif (Multi-Aktivitas) */}
      {showActiveTimerPopup && activeActivities.length > 0 && (
        <div 
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-white rounded-2xl shadow-2xl border border-slate-200 w-[90%] max-w-sm animate-in slide-in-from-top-4 fade-in duration-300 overflow-hidden"
          onMouseEnter={handlePopupInteraction}
          onTouchStart={handlePopupInteraction}
          onWheel={handlePopupInteraction}
        >
          
          {/* Header Pop-up */}
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {activeActivities.length} Aktivitas Berjalan
            </span>
            <button 
              onClick={closePopup} 
              className="text-slate-400 hover:text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-full p-1 transition-colors"
              title="Tutup Notifikasi"
            >
              <X size={14} />
            </button>
          </div>

          {/* Daftar Aktivitas (Bisa di-scroll jika ada 3 atau lebih) */}
          <div className="max-h-64 overflow-y-auto p-3 space-y-3">
            {activeActivities.map(activity => {
              const isPaused = activity.isTimerActive && (activity.pauses?.length || 0) > (activity.resumes?.length || 0);
              return (
                <div key={activity.id} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm relative">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Clock size={12} className={isPaused ? "text-amber-500" : "text-red-500 animate-pulse"} />
                        <span className={cn("text-[10px] font-bold uppercase tracking-wider", isPaused ? "text-amber-600" : "text-red-600")}>
                          {isPaused ? "Dijeda" : "Merekam"}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm truncate pr-2">{activity.name}</h4>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {isPaused ? (
                      <button
                        onClick={() => handlePopupAction(activity, 'resume')}
                        className="flex-1 px-2 py-2 text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors flex justify-center"
                      >
                        ▶ Lanjut
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePopupAction(activity, 'pause')}
                        className="flex-1 px-2 py-2 text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors flex justify-center"
                      >
                        ⏸ Jeda
                      </button>
                    )}
                    <button
                      onClick={() => handlePopupAction(activity, 'stop')}
                      className="flex-1 px-2 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex justify-center"
                    >
                      ⏹ Stop
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tombol Tutup Besar (Muncul dari bawah HANYA JIKA user menyentuh popup) */}
          {isPopupInteracted && (
            <div className="bg-slate-50 p-3 border-t border-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
               <button 
                 onClick={closePopup}
                 className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold rounded-xl transition-colors"
               >
                 Tutup Notifikasi
               </button>
            </div>
          )}
        </div>
      )}

      {/* Data Management Modal (Hubungan Nama & Jenis) */}
      {showDataModal && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[120]"
          onClick={() => setShowDataModal(false)}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Manajemen Data Aktivitas</h3>
                <p className="text-xs text-slate-500 mt-1">Ubah relasi jenis aktivitas. Perubahan akan diterapkan ke semua riwayat secara masal.</p>
              </div>
              <button 
                onClick={() => setShowDataModal(false)}
                className="text-slate-400 hover:text-slate-600 bg-white p-1.5 rounded-full shadow-sm border border-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="overflow-y-auto p-5 flex-1 bg-slate-50/50">
              <div className="space-y-3">
                {allUniqueData.map(([actName, actType], idx) => (
                  <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:border-blue-300 transition-colors">
                    <span className="font-semibold text-slate-700 text-sm flex-1">{actName}</span>
                    <div className="flex items-center gap-2 sm:w-1/2">
                      <span className="text-xs text-slate-400">Jenis:</span>
                      <input
                        type="text"
                        list="modal-type-suggestions"
                        defaultValue={actType}
                        onBlur={(e) => {
                          if (e.target.value !== actType) {
                             handleUpdateMapping(actName, e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                             e.currentTarget.blur(); // Menekan Enter akan langsung menyimpan
                          }
                        }}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none text-xs bg-slate-50 focus:bg-white transition-colors"
                        placeholder="Ketik jenis..."
                      />
                    </div>
                  </div>
                ))}
              </div>
              <datalist id="modal-type-suggestions">
                {autocompleteTypes.map((t, idx) => (
                  <option key={`mod-${idx}`} value={t} />
                ))}
              </datalist>
            </div>
            <div className="p-4 border-t border-slate-100 bg-white text-center">
               <span className="text-[10px] text-slate-400 font-medium">💡 Ubah teks jenis aktivitas di atas, klik di sembarang tempat (luar kotak) atau tekan Enter untuk menyimpan.</span>
            </div>
          </div>
        </div>
      )}

       {/* Pop-up Mention Keterangan (@.) */}
      {showMention && (
        <div className="fixed inset-0 z-[200] bg-slate-900/20 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowMention(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[60vh] animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="bg-slate-50 p-3 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
                    <span>Pilih Catatan untuk Ditautkan</span>
                    <button onClick={() => setShowMention(false)}><X size={14} /></button>
                </div>
                <div className="overflow-y-auto p-2 flex-1 space-y-1 bg-white">
                    {notes.filter(n => n.title.toLowerCase().includes(mentionQuery)).map(n => (
                        <button
                            key={n.id}
                            onClick={() => handleSelectMention(n.id, n.title)}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-slate-800 text-sm font-medium rounded-lg transition-colors truncate border border-transparent hover:border-blue-100"
                        >
                            {n.title || 'Untitled'}
                        </button>
                    ))}
                    {notes.filter(n => n.title.toLowerCase().includes(mentionQuery)).length === 0 && (
                        <div className="p-4 text-center text-slate-500 text-sm">Tidak ada catatan ditemukan.</div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* Toast Notifikasi Latar Belakang (Muncul 1 Detik) */}
      {toastMessage && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[130] bg-slate-800/90 backdrop-blur-sm text-white px-5 py-2.5 rounded-full text-xs font-medium animate-in fade-in slide-in-from-bottom-4 duration-200 shadow-xl flex items-center gap-2">
          <ActivityIcon size={14} className="text-blue-400" />
          {toastMessage}
        </div>
      )}

    </div>
  );
}
