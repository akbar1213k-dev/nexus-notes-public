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
  AlertTriangle
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
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];

export function TractView({ onGoHome, userId }: { onGoHome?: () => void, userId?: string }) {
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
  
  // Suggestions State
  const [activitySuggestions, setActivitySuggestions] = useState<{name: string, type: string}[]>(() => {
    const saved = localStorage.getItem('tractapp_activity_suggestions');
    if (saved) return JSON.parse(saved);
    return [
      { name: 'Lari Pagi', type: 'Olahraga' },
      { name: 'Meeting Proyek', type: 'Bekerja' },
      { name: 'Membaca Buku', type: 'Belajar' }
    ];
  });
  const [typeSuggestions, setTypeSuggestions] = useState<string[]>(() => {
    const saved = localStorage.getItem('tractapp_type_suggestions');
    if (saved) return JSON.parse(saved);
    return ['Olahraga', 'Bekerja', 'Belajar', 'Hobi', 'Lainnya'];
  });

  // Form State
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('');
  const [description, setDescription] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('');
  const [durationInput, setDurationInput] = useState('');
  
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

  const handleDeleteActivitySuggestion = (nameToDelete: string) => {
    setActivitySuggestions(activitySuggestions.filter(s => s.name !== nameToDelete));
  };

  const handleDeleteTypeSuggestion = (typeToDelete: string) => {
    setTypeSuggestions(typeSuggestions.filter(t => t !== typeToDelete));
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

    const newActivity: Activity = {
      id: now.toString(),
      name: name.trim(),
      type,
      timestamp: now,
      description: description.trim(),
      userId: userId || '',
      startTime: finalStartTime,
      endTime: finalEndTime,
      duration: finalDuration
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

    setActivitySuggestions(prev => {
      const filtered = prev.filter(s => s.name.toLowerCase() !== trimmedName.toLowerCase());
      return [{ name: trimmedName, type: trimmedType }, ...filtered];
    });

    setTypeSuggestions(prev => {
      const filtered = prev.filter(t => t.toLowerCase() !== trimmedType.toLowerCase());
      return [trimmedType, ...filtered];
    });

    setName(''); setDescription(''); setType('');
    setStartTimeInput(''); setEndTimeInput(''); setDurationInput('');
    setActiveTab('list');
  };

  const handleQuickSave = (suggName: string, suggType: string) => {
    const now = Date.now();
    // RULE 1: Default tanpa input waktu (Waktu mulai = Waktu Simpan)
    const newActivity: Activity = {
      id: now.toString(),
      name: suggName.trim(),
      type: suggType.trim() || 'Lainnya',
      timestamp: now,
      description: description.trim(), 
      userId: userId || '',
      startTime: now
    };

    if (userId) {
      setDoc(doc(db, 'activities', newActivity.id), newActivity).catch(err => console.error("Gagal:", err));
    }

    const updatedActivities = [newActivity, ...activities].sort((a, b) => b.timestamp - a.timestamp);
    setActivities(updatedActivities);
    
    setActivitySuggestions(prev => {
      const filtered = prev.filter(s => s.name.toLowerCase() !== suggName.toLowerCase());
      return [{ name: suggName, type: suggType || 'Lainnya' }, ...filtered];
    });

    setTypeSuggestions(prev => {
      const filtered = prev.filter(t => t.toLowerCase() !== (suggType || 'Lainnya').toLowerCase());
      return [suggType || 'Lainnya', ...filtered];
    });

    setName(''); setDescription(''); setType('');
    setStartTimeInput(''); setEndTimeInput(''); setDurationInput('');
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
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Contoh: Olahraga, Bekerja..."
                  />
                  {/* Bubble Suggestions for Activity Types */}
                  {typeSuggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {typeSuggestions.map(actType => (
                        <span key={actType} className="bg-emerald-50 border border-emerald-100 text-emerald-700 pl-3 pr-1 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 transition-colors">
                          <span 
                            className="cursor-pointer hover:underline"
                            onClick={() => setType(actType)}
                            title="Klik untuk memakai jenis ini"
                          >
                            {actType}
                          </span>
                          <button
                            type="button"
                            onDoubleClick={() => handleDeleteTypeSuggestion(actType)}
                            className="text-emerald-400 hover:bg-emerald-200 hover:text-red-500 p-1 rounded-full transition-colors ml-1"
                            title="Klik ganda (double click) untuk menghapus riwayat jenis ini"
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
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Contoh: Lari pagi, Meeting klien..."
                  />
                  {/* Bubble Suggestions for Activity Names */}
                  {activitySuggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activitySuggestions.map(sugg => (
                        <span key={sugg.name} className="bg-blue-50 border border-blue-100 text-blue-700 pl-3 pr-1 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 transition-colors">
                          <span 
                            className="cursor-pointer hover:underline font-semibold"
                            onClick={() => handleQuickSave(sugg.name, sugg.type)}
                            title="Klik untuk langsung menyimpan aktivitas ini secara otomatis"
                          >
                            {sugg.name}
                          </span>
                          
                          <button
                            type="button"
                            onDoubleClick={() => handleDeleteActivitySuggestion(sugg.name)}
                            className="text-blue-400 hover:bg-blue-200 hover:text-red-500 p-1 rounded-full transition-colors ml-1"
                            title="Klik ganda (double click) untuk menghapus riwayat nama ini"
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
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Waktu Mulai (Opsional)
                    </label>
                    <input
                      type="datetime-local"
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
                <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full mt-2 inline-block">
                  {processedActivities.length} Ditampilkan ({activities.length} Total)
                </span>
              </div>
              
              <div className="grid grid-cols-2 md:flex md:flex-wrap gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
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
              </div>
            </div>

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
                            <div className="flex-1">
                               <h4 className="font-bold text-slate-900 text-base leading-tight mb-1">{activity.name}</h4>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                                  <Clock size={12} className="text-blue-500" />
                                  <span>
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
                               {activity.description}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-end gap-2 mt-1">
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Keterangan
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                />
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
    </div>
  );
}
