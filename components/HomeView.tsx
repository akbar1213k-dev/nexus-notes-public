import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Note, Folder } from '../types';
import { 
  Plus, Clock, FileText, Trash2, CheckCircle2, Circle, X, 
  Network, FilePlus, Folder as FolderIcon, FolderPlus, 
  ChevronLeft, FolderInput, Pencil, Download, 
  Search, ArrowUpDown, Calendar, ArrowUpAz, ArrowDownAz,
  RefreshCcw, AlertTriangle, ChevronDown, ChevronRight, Home, Lock, // <--- Tambahkan Lock
  History, Activity
} from 'lucide-react';

interface HomeViewProps {
  notes: Note[];
  folders: Folder[];
  onNoteClick: (id: string) => void;
  onCreateNote: (type: 'note' | 'mindmap', folderId?: string) => void;
  onCreateFolder: (name: string, parentId?: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteItems: (noteIds: string[], folderIds: string[]) => void;
  // UPDATE: onMoveItems sekarang menerima folderIds juga
  onMoveItems: (noteIds: string[], folderIds: string[], targetFolderId: string | undefined) => void;
  onImportData?: (data: any) => void;
  onRestoreItems: (noteIds: string[], folderIds: string[]) => void;
  onOpenTractApp: () => void;
  onPermanentDelete: (noteIds: string[], folderIds: string[]) => void;
}

// --- HELPER BARU: Algoritma Proximity Search (Jarak Maks. 45 Karakter) ---
const checkProximityMatch = (htmlContent: string, searchQuery: string, maxDistance: number = 45) => {
    if (!htmlContent) return false;
    // 1. Bersihkan tag HTML dan karakter khusus agar perhitungan jarak akurat pada teks mentah
    const cleanText = htmlContent.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').toLowerCase();
    const words = searchQuery.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return true;
    // Jika hanya mencari 1 kata, gunakan pencarian standar
    if (words.length === 1) return cleanText.includes(words[0]);

    // 2. Cari semua indeks letak kata-kata kunci
    const allFound: { word: string; start: number; end: number }[] = [];
    words.forEach((word) => {
        let idx = cleanText.indexOf(word);
        while (idx !== -1) {
            allFound.push({ word, start: idx, end: idx + word.length });
            idx = cleanText.indexOf(word, idx + 1);
        }
    });

    // Validasi Cepat: Jika ada satu saja kata kunci yang tidak ada di catatan ini, langsung lewati (false)
    const uniqueWordsFound = new Set(allFound.map(item => item.word));
    if (uniqueWordsFound.size < words.length) return false;

    // Urutkan kata berdasarkan posisinya di dalam teks
    allFound.sort((a, b) => a.start - b.start);

    // 3. Sliding Window Proximity
    for (let i = 0; i < allFound.length; i++) {
        let seen = new Set([allFound[i].word]);
        let currentEnd = allFound[i].end;
        let j = i + 1;

        while (j < allFound.length) {
            if (allFound[j].start - currentEnd <= maxDistance) {
                seen.add(allFound[j].word);
                currentEnd = allFound[j].end;
                
                // Jika semua kata kunci ditemukan dalam area jarak yang berdekatan ini
                if (seen.size === words.length) return true; 
                j++;
            } else {
                break; // Jarak sudah melebihi 45 karakter, batalkan grup susunan ini
            }
        }
    }
    return false;
};
// --------------------------------------------------------------------------

export const HomeView: React.FC<HomeViewProps> = ({
  notes, 
  folders, 
  onNoteClick, 
  onCreateNote, 
  onCreateFolder,
  onRenameFolder,
  onDeleteItems,
  onMoveItems,
  onImportData,
  onRestoreItems,
  onOpenTractApp,
  onPermanentDelete
}) => {
  // Navigation State
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);

  // Trash Mode State
  const [isTrashMode, setIsTrashMode] = useState(false);

  // --- STATE BARU: Kontrol Dropdown Folder ---
  // UBAH 1: Default state menjadi false (Tertutup)
  const [isFoldersOpen, setIsFoldersOpen] = useState(false);

  // --- STATE BARU: Dropdown Recent Notes ---
  const [isRecentsOpen, setIsRecentsOpen] = useState(() => {
    try {
        const saved = localStorage.getItem('nexus_recents_open');
        return saved !== null ? JSON.parse(saved) : true; 
    } catch { return true; }
  });

  useEffect(() => {
    localStorage.setItem('nexus_recents_open', JSON.stringify(isRecentsOpen));
  }, [isRecentsOpen]);

  // --- LOGIKA BARU: Ambil 5 Catatan Terakhir Dibuka ---
  const recentNotes = useMemo(() => {
    // Ambil catatan yang punya lastOpenedAt, tidak dihapus, urutkan desc, ambil 5
    return notes
        .filter(n => n.lastOpenedAt && !n.deletedAt)
        .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
        .slice(0, 5);
  }, [notes]);

  // Selection & UI State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [fabExpanded, setFabExpanded] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
   
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
   
  const [sortOption, setSortOption] = useState<'updated' | 'created' | 'alphabet'>(() => {
    const saved = localStorage.getItem('nexus_sort_option');
    return (saved as 'updated' | 'created' | 'alphabet') || 'updated';
  });

  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    const saved = localStorage.getItem('nexus_sort_direction');
    return (saved as 'asc' | 'desc') || 'desc';
  });

  const [showSortMenu, setShowSortMenu] = useState(false);

  useEffect(() => {
    localStorage.setItem('nexus_sort_option', sortOption);
  }, [sortOption]);

  useEffect(() => {
    localStorage.setItem('nexus_sort_direction', sortDirection);
  }, [sortDirection]);

  // Computed Data
  const currentFolder = folders.find(f => f.id === currentFolderId);

  // LOGIKA UTAMA: Filter & Sort (DENGAN TRASH MODE)
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    
    // 1. Pisahkan Item Sampah vs Aktif
    const baseNotes = notes.filter(n => isTrashMode ? n.deletedAt : !n.deletedAt);
    const baseFolders = folders.filter(f => isTrashMode ? f.deletedAt : !f.deletedAt)

    let filteredNotes = [...baseNotes];
    let filteredFolders = [...baseFolders];

    // 2. Filtering berdasarkan Folder / Search
    if (query) {
      filteredNotes = baseNotes.filter(n => 
        // Pertahankan pencarian pasti/exact untuk Judul Catatan
        (n.title && n.title.toLowerCase().includes(query)) || 
        // Terapkan Proximity Search canggih untuk Isi Konten
        checkProximityMatch(n.content, query)
      );
      // Saat search, tampilkan semua folder yang cocok (flat list - pencarian pasti/exact)
      filteredFolders = baseFolders.filter(f => 
        f.name.toLowerCase().includes(query)
      );
    } else {
      if (isTrashMode) {
         // Tampilkan semua yg terhapus (biarkan filteredNotes/Folders apa adanya dari base)
      } else {
         // --- LOGIKA NESTED FOLDER ---
         
         // 1. Filter Catatan: Hanya yang ada di folder ini
         filteredNotes = baseNotes.filter(n => {
           if (!currentFolderId) return !n.folderId; 
           return n.folderId === currentFolderId;
         });

         // 2. Filter Folder: Tampilkan folder yang Parent-nya adalah folder saat ini
         filteredFolders = baseFolders.filter(f => {
            if (currentFolderId) {
                // Jika sedang di dalam folder, cari sub-folder miliknya
                return f.parentId === currentFolderId;
            } else {
                // Jika di Home (Root), cari folder yang tidak punya parent (atau parent-nya null)
                return !f.parentId;
            }
         });
      }
    }

    // 3. Sorting
    const sorter = (a: any, b: any, type: 'note' | 'folder') => {
       let valA, valB;
       switch (sortOption) {
        case 'alphabet':
          valA = type === 'note' ? (a as Note).title : (a as Folder).name;
          valB = type === 'note' ? (b as Note).title : (b as Folder).name;
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'created':
          valA = type === 'note' ? parseInt((a as Note).id) : (a as Folder).createdAt;
          valB = type === 'note' ? parseInt((b as Note).id) : (b as Folder).createdAt;
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        case 'updated':
        default:
          valA = type === 'note' ? (a as Note).updatedAt : (a as Folder).createdAt;
          valB = type === 'note' ? (b as Note).updatedAt : (b as Folder).createdAt;
          return sortDirection === 'asc' ? valA - valB : valB - valA;
      }
    };

    // 4. Finalisasi Output
    const sortedVisible = filteredFolders.sort((a, b) => sorter(a, b, 'folder'));
    const sortedNavigation = baseFolders.sort((a, b) => sorter(a, b, 'folder'));

    const pinSystemFolder = (list: Folder[]) => {
        const SYSTEM_NAME = "Keterhubungan";
        const systemFolder = list.find(f => f.name === SYSTEM_NAME);
        const others = list.filter(f => f.name !== SYSTEM_NAME);
        return systemFolder ? [systemFolder, ...others] : others;
    };

    return {
      visibleNotes: filteredNotes.sort((a, b) => sorter(a, b, 'note')),
      visibleFolders: pinSystemFolder(sortedVisible),
      navigationFolders: pinSystemFolder(sortedNavigation) 
    };

  }, [notes, folders, currentFolderId, searchQuery, sortOption, sortDirection, isTrashMode]);

  const { visibleNotes, visibleFolders, navigationFolders } = filteredItems;

  const getPreview = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.substring(0, 100) + (text.length > 100 ? "..." : "");
  };

  const handleExportSelected = () => {
    const notesToExport = notes.filter(n => selectedNoteIds.has(n.id));
    const foldersToExport = folders.filter(f => selectedFolderIds.has(f.id));

    if (notesToExport.length === 0 && foldersToExport.length === 0) return;

    const exportData = { notes: notesToExport, folders: foldersToExport };
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `NexusNotes_Selection_${dateStr}.json`;

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    handleCancelSelection();
  };

  const handleItemClick = (type: 'note' | 'folder', id: string, e?: React.MouseEvent) => {
    // Deteksi tombol modifier (Ctrl atau Command)
    const isModifierPressed = e && (e.ctrlKey || e.metaKey);

    if (selectionMode || isModifierPressed) {
      // Jika belum mode seleksi tapi tekan Ctrl, aktifkan mode seleksi
      if (!selectionMode) setSelectionMode(true);
      toggleSelection(type, id);
    } else {
      if (type === 'folder') {
        setCurrentFolderId(id);
        setIsFoldersOpen(false); // Opsional: tutup dropdown saat masuk folder baru
      } else {
        onNoteClick(id);
      }
    }
  };

  const handleLongPress = (type: 'note' | 'folder', id: string) => {
    if (!selectionMode) {
      if (navigator.vibrate) navigator.vibrate(50);
      setSelectionMode(true);
      toggleSelection(type, id);
    }
  };

  const handleTouchStart = (type: 'note' | 'folder', id: string) => {
    longPressTimer.current = setTimeout(() => {
      handleLongPress(type, id);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const toggleSelection = (type: 'note' | 'folder', id: string) => {
    if (type === 'note') {
      setSelectedNoteIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedFolderIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const handleSelectAll = () => {
    // Filter folder biasa saja (kecuali Keterhubungan)
    const selectableFolders = visibleFolders.filter(f => f.name !== "Keterhubungan");
    
    const allSelected = selectedNoteIds.size === visibleNotes.length && 
                        selectedFolderIds.size === selectableFolders.length;

    if (allSelected) {
      setSelectedNoteIds(new Set());
      setSelectedFolderIds(new Set());
    } else {
      setSelectedNoteIds(new Set(visibleNotes.map(n => n.id)));
      // Hanya pilih folder yang bukan sistem
      setSelectedFolderIds(new Set(selectableFolders.map(f => f.id)));
    }
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
    setSelectedFolderIds(new Set());
  };

  const handleBulkDelete = () => {
    const total = selectedNoteIds.size + selectedFolderIds.size;
    if (total === 0) return;
    
    const msg = selectedFolderIds.size > 0 
      ? `Delete ${selectedFolderIds.size} folder(s) and ${selectedNoteIds.size} note(s)? Notes inside deleted folders will be deleted.`
      : `Delete ${total} item(s)?`;

    if (window.confirm(msg)) {
      onDeleteItems(Array.from(selectedNoteIds), Array.from(selectedFolderIds));
      handleCancelSelection();
    }
  };

  const handleRename = () => {
    if (selectedFolderIds.size !== 1) return;
    const folderId = Array.from(selectedFolderIds)[0];
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    const newName = prompt("Rename Folder:", folder.name);
    if (newName && newName.trim() !== "") {
      onRenameFolder(folderId, newName.trim());
      handleCancelSelection();
    }
  };

  const triggerCreateFolder = () => {
    const name = prompt("Enter folder name:");
    if (name && name.trim()) {
      // Kirim currentFolderId sebagai parentId (bisa undefined jika di root)
      onCreateFolder(name.trim(), currentFolderId);
    }
    setFabExpanded(false);
  };

  // --- UPDATE: Handle Move Folder & Note ---
  const handleMoveAction = (targetId: string | undefined) => {
    // Cek apakah target adalah salah satu folder yang sedang dipilih (mencegah loop)
    if (targetId && selectedFolderIds.has(targetId)) {
        alert("Tidak bisa memindahkan folder ke dalam dirinya sendiri!");
        return;
    }

    onMoveItems(Array.from(selectedNoteIds), Array.from(selectedFolderIds), targetId);
    setShowMoveDialog(false);
    handleCancelSelection();
  };

  const totalSelected = selectedNoteIds.size + selectedFolderIds.size;

  const showTrashFolder = !currentFolderId && !searchQuery && !isTrashMode;
  
  // UBAH 2: Helper ini kita abaikan untuk header, karena header sekarang selalu muncul
  // const hasVisibleFolders = visibleFolders.length > 0 || showTrashFolder;

  return (
    <div className="flex-1 h-full relative bg-gray-50 dark:bg-gray-950 transition-colors flex flex-col" onClick={() => { setFabExpanded(false); setShowSortMenu(false); }}>
      
      {/* Selection Header */}
      {selectionMode && (
        <div className="bg-blue-600 text-white px-4 py-3 flex justify-between items-center shadow-md z-30 animate-in slide-in-from-top-5">
          <div className="flex items-center gap-3">
            <button onClick={handleCancelSelection}><X size={24} /></button>
            <span className="font-bold text-lg">{totalSelected} Selected</span>
          </div>
          <button onClick={handleSelectAll} className="text-sm font-semibold uppercase tracking-wide">
            {selectedNoteIds.size === visibleNotes.length && selectedFolderIds.size === visibleFolders.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-4 pb-32 overflow-y-auto flex-1 no-scrollbar space-y-4">

        
        {/* HEADER: Search & Sort Combined */}
        {!selectionMode && (
          <div className="space-y-3">
            
            {/* ROW 1: Search Bar & Sort Button dalam satu baris */}
            <div className="flex items-center gap-2">
                {/* 1. Search Input (Mengisi sisa ruang dengan flex-1) */}
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Search notes..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white transition-all"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  
                  {/* Tombol Clear Search (X) */}
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {/* 2. Sort Button (Dipindahkan ke Sini) */}
                <div className="relative">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu); }}
                      className="flex items-center gap-2 h-[48px] px-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm whitespace-nowrap"
                    >
                       {/* Icon berubah sesuai sortOption */}
                       {sortOption === 'updated' && <Clock size={18}/>}
                       {sortOption === 'created' && <Calendar size={18}/>}
                       {sortOption === 'alphabet' && <ArrowDownAz size={18}/>}
                       
                       {/* Label Teks (Hidden di HP sangat kecil, Muncul di layar agak lebar) */}
                       <span className="hidden sm:inline">
                          {sortOption === 'updated' ? 'Updated' : sortOption === 'created' ? 'Created' : 'Name'}
                       </span>
                       
                       <ArrowUpDown size={14} className="opacity-50 ml-1"/>
                    </button>

                    {/* Dropdown Menu Sort */}
                    {showSortMenu && (
                      <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-1">
                          <div className="text-[10px] font-semibold text-gray-400 px-3 py-2 uppercase tracking-wider">Sort By</div>
                          
                          <button onClick={() => { setSortOption('updated'); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 ${sortOption === 'updated' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                            <Clock size={16}/> Edit Terbaru
                          </button>
                          
                          <button onClick={() => { setSortOption('created'); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 ${sortOption === 'created' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                            <Calendar size={16}/> Tanggal Dibuat
                          </button>
                          
                          <button onClick={() => { setSortOption('alphabet'); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 ${sortOption === 'alphabet' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                            <ArrowDownAz size={16}/> Alfabet (A-Z)
                          </button>
                          
                          <div className="my-1 border-t border-gray-100 dark:border-gray-700"></div>
                          
                          <button onClick={() => { setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); setShowSortMenu(false); }} className="w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center justify-between text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                             <span className="flex items-center gap-2">
                               {sortDirection === 'asc' ? <ArrowUpAz size={16}/> : <ArrowDownAz size={16}/>} 
                               {sortDirection === 'asc' ? 'Urutan Naik' : 'Urutan Turun'}
                             </span>
                          </button>
                        </div>
                      </div>
                    )}
                </div>
            </div>

            {/* ROW 2: Breadcrumb / Trash Indicator (Hanya muncul jika diperlukan) */}
            {isTrashMode && (
              <div className="flex items-center pb-2 animate-in slide-in-from-top-2">
                 <button 
                    onClick={() => { setIsTrashMode(false); setSearchQuery(''); }}
                    className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium text-sm px-1 py-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <ChevronLeft size={18} />
                    <span>Kembali dari Sampah</span>
                  </button>
              </div>
            )}
            {/* --- FITUR BARU: RECENTLY OPENED (Hanya tampil jika tidak search & bukan Trash Mode) --- */}
        {!searchQuery && !isTrashMode && recentNotes.length > 0 && (
          <div className="space-y-2 mb-4 pt-1">
            <button 
              onClick={() => setIsRecentsOpen(!isRecentsOpen)}
              className="w-full flex items-center justify-between p-3 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm transition-all hover:bg-gray-50 dark:hover:bg-gray-800"
            >
               <div className="flex items-center gap-3">
                   <div className="text-gray-400 dark:text-gray-500">
                     {isRecentsOpen ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}
                   </div>
                   <span className="text-base font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide flex items-center gap-2">
                      <History size={16} className="text-blue-500"/> TERBARU DIBUKA
                   </span>
               </div>
            </button>

            {isRecentsOpen && (
               <div className="grid grid-cols-1 gap-2 animate-in fade-in slide-in-from-top-2 duration-200 pl-2 border-l-2 border-gray-100 dark:border-gray-800 ml-4">
                  {recentNotes.map(note => (
                      <div 
                        key={'recent_' + note.id}
                        onClick={(e) => handleItemClick('note', note.id, e)}
                        className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                         <div className="flex items-center gap-3 overflow-hidden">
                            {note.type === 'mindmap' ? (
                                <Network size={18} className="text-indigo-500 shrink-0" />
                            ) : (
                                <FileText size={18} className="text-blue-500 shrink-0" />
                            )}
                            <span className="truncate font-medium text-gray-700 dark:text-gray-200 text-sm">
                                {note.title || "Untitled"}
                            </span>
                         </div>
                         <span className="text-[10px] text-gray-400 whitespace-nowrap">
                            {(() => {
                                const diff = Date.now() - (note.lastOpenedAt || 0);
                                if (diff < 60000) return 'Baru saja';
                                if (diff < 3600000) return Math.floor(diff/60000) + 'm lalu';
                                if (diff < 86400000) return Math.floor(diff/3600000) + 'j lalu';
                                return new Date(note.lastOpenedAt || 0).toLocaleDateString('id-ID', {day: 'numeric', month: 'short'});
                            })()}
                         </span>
                      </div>
                  ))}
               </div>
            )}
          </div>
        )}
          </div>
        )}
        
        {/* --- SECTION: FOLDERS (COLLAPSIBLE / DROPDOWN VIEW) --- */}
        {/* UBAH 3: Render dropdown selalu ada (jika tidak search), untuk navigasi */}
        {!searchQuery && (
          <div className="space-y-2">
            {/* Folder Header / Toggle (TAMPILAN LEBIH BESAR & KONTEKSTUAL) */}
            <button 
              onClick={() => setIsFoldersOpen(!isFoldersOpen)}
              className="w-full flex items-center justify-between p-3 bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm transition-all hover:bg-gray-50 dark:hover:bg-gray-800"
            >
               <div className="flex items-center gap-3">
                   {/* Icon Berubah tergantung state */}
                   <div className="text-gray-400 dark:text-gray-500">
                     {isFoldersOpen ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}
                   </div>
                   
                   {/* TEXT HEADER: Tampilkan Nama Folder Saat Ini atau 'FOLDERS' */}
                   <span className="text-base font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wide">
                      {currentFolder ? currentFolder.name : "FOLDERS"}
                   </span>
               </div>
               
               {/* Indikator jumlah folder (Opsional) */}
               <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
                  {navigationFolders.length + (showTrashFolder ? 1 : 0)}
               </span>
            </button>

            {/* Folder List (Collapsible Content) */}
            {isFoldersOpen && (
              <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-top-2 duration-200 pl-2 border-l-2 border-gray-100 dark:border-gray-800 ml-4">
                  
                  {/* TOMBOL NAVIGASI 'KEMBALI KE UTAMA' (Hanya jika di dalam folder) */}
                  {currentFolderId && (
                      <div 
                        className="p-3 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 text-blue-600 dark:text-blue-400 transition-colors"
                        onClick={() => { 
                          setCurrentFolderId(undefined); 
                          setIsFoldersOpen(false);
                          setSearchQuery('');
                        }}
                      >
                          <Home size={20} />
                          <span className="font-medium">Kembali ke Utama</span>
                      </div>
                  )}

                  {/* FOLDER KHUSUS SAMPAH */}
                  {showTrashFolder && (
                      <div 
                        className="p-3 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                        onClick={() => { setIsTrashMode(true); setIsFoldersOpen(false); }}
                      >
                          <Trash2 size={20} />
                          <div className="flex flex-col">
                             <span className="font-medium">Sampah</span>
                          </div>
                      </div>
                  )}
                
                  {/* LIST SEMUA FOLDER */}
                  {navigationFolders.map((folder) => {
                    const isCurrent = currentFolderId === folder.id;
                    const isSelected = selectedFolderIds.has(folder.id);
                    
                    // --- DETEKSI FOLDER SPESIAL ---
                    const isLinkedFolder = folder.name === "Keterhubungan"; 

                    if (isCurrent) return null;

                    return (
                      <div 
                        key={folder.id}
                        className={`
                          p-3 rounded-lg flex items-center gap-3 transition-all relative overflow-hidden
                          ${isLinkedFolder 
                            // STYLE KHUSUS: Gradient & Border Ungu
                            ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/40 dark:to-purple-900/40 border border-indigo-100 dark:border-indigo-800' 
                            // STYLE BIASA
                            : isSelected 
                              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' 
                              : 'hover:bg-amber-50 dark:hover:bg-amber-900/20 text-gray-700 dark:text-gray-300'
                          }
                          ${!isLinkedFolder ? 'cursor-pointer' : selectionMode ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}
                        `}
                        onClick={(e) => {
                            // PROTEKSI: Jangan bisa diklik jika sedang mode select & ini folder spesial
                            if (selectionMode && isLinkedFolder) return;
                            handleItemClick('folder', folder.id, e);
                        }}
                        onTouchStart={() => {
                            if (isLinkedFolder) return; // Disable long press selection
                            handleTouchStart('folder', folder.id);
                        }}
                        onTouchEnd={handleTouchEnd}
                        onTouchMove={handleTouchEnd}
                      >
                          {/* ICON: Gunakan Network untuk folder spesial */}
                          {isLinkedFolder ? (
                             <div className="p-1.5 bg-indigo-100 dark:bg-indigo-800 rounded-md text-indigo-600 dark:text-indigo-300">
                                <Network size={18} />
                             </div>
                          ) : (
                             <FolderIcon size={20} className={isSelected ? "fill-blue-200" : "text-amber-500"} />
                          )}
                          
                          <div className="flex-1 min-w-0 flex flex-col">
                              <h3 className={`font-medium truncate ${isLinkedFolder ? 'text-indigo-900 dark:text-indigo-200 font-bold' : ''}`}>
                                  {folder.name}
                              </h3>
                              {isLinkedFolder && (
                                <span className="text-[10px] text-indigo-400 dark:text-indigo-500 uppercase tracking-wider font-semibold">
                                  System Folder
                                </span>
                              )}
                          </div>

                          {/* SELECTION INDICATOR */}
                          {selectionMode && (
                              <div className="text-blue-600 dark:text-blue-400 pl-2">
                                    {isLinkedFolder ? (
                                        // Tampilkan Gembok jika folder spesial
                                        <Lock size={18} className="text-gray-400 dark:text-gray-600" />
                                    ) : (
                                        // Tampilkan Checkbox untuk folder biasa
                                        isSelected 
                                          ? <CheckCircle2 size={18} fill="currentColor" className="text-white dark:text-gray-900" /> 
                                          : <Circle size={18} className="text-gray-300 dark:text-gray-600" />
                                    )}
                              </div>
                          )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* RENDER NOTES */}
        {/* Menggunakan grid untuk notes */}
        <div className="grid grid-cols-1 gap-3">
            {/* Header Notes Kecil */}
            {visibleNotes.length > 0 && (
               <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-2 mb-1">
                  Notes
               </h3>
            )}

            {visibleNotes.length === 0 && (
               <div className="flex flex-col items-center justify-center py-10 text-gray-400 opacity-60">
                  <FileText size={40} className="mb-2"/>
                  <p className="text-sm">Belum ada catatan di sini</p>
               </div>
            )}

            {visibleNotes.map((note) => {
                const isSelected = selectedNoteIds.has(note.id);
                const isMindMap = note.type === 'mindmap';
                
                return (
                  <div 
                    key={note.id}
                    className={`
                      p-4 rounded-xl shadow-sm border relative overflow-hidden
                      transition-all active:scale-[0.99] cursor-pointer 
                      ${isSelected 
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                          : isMindMap 
                              ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800' 
                              : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800'
                      }
                    `}
                    onClick={(e) => handleItemClick('note', note.id, e)}
                    onTouchStart={() => handleTouchStart('note', note.id)}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchEnd}
                  >
                      {selectionMode && (
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400">
                                {isSelected ? <CheckCircle2 size={24} fill="currentColor" className="text-white dark:text-gray-900" /> : <Circle size={24} className="text-gray-300 dark:text-gray-600" />}
                          </div>
                      )}

                      <div className={selectionMode ? "pr-10" : ""}>
                          <div className="flex justify-between items-start mb-2">
                              <h3 className={`font-bold text-lg line-clamp-1 flex items-center gap-2 ${isSelected ? 'text-blue-700 dark:text-blue-300' : (isMindMap ? 'text-indigo-800 dark:text-indigo-200' : 'text-gray-800 dark:text-gray-100')}`}>
                                  {isMindMap && <Network size={16} className="shrink-0" />}
                                  {note.title || "Untitled"}
                              </h3>
                          </div>
                          
                          <p className={`text-sm line-clamp-2 mb-3 h-10 ${isMindMap ? 'text-indigo-600/70 dark:text-indigo-300/70' : 'text-gray-500 dark:text-gray-400'}`}>
                              {getPreview(note.content) || <span className="italic opacity-50">No content</span>}
                          </p>

                          {/* FOOTER WAKTU */}
                          <div className={`flex items-center justify-between mt-3 pt-2 border-t ${isMindMap ? 'border-indigo-100 dark:border-indigo-800' : 'border-gray-100 dark:border-gray-800'}`}>
                              <div className="flex items-center text-[10px] text-gray-400 dark:text-gray-500">
                                  <Calendar size={10} className="mr-1" />
                                  <span>
                                      {new Date(parseInt(note.id)).toLocaleDateString('id-ID', { 
                                          day: 'numeric', month: 'short'
                                      })}
                                  </span>
                              </div>
                              <div className={`flex items-center text-[10px] font-medium ${isMindMap ? 'text-indigo-500 dark:text-indigo-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                  <span className="mr-1 opacity-70">Update:</span>
                                  <span>
                                      {new Date(note.updatedAt).toLocaleTimeString('id-ID', { 
                                          hour: '2-digit', minute: '2-digit'
                                      })}
                                  </span>
                                  <Clock size={10} className="ml-1" />
                              </div>
                          </div>
                      </div>
                  </div>
                );
              })}
        </div>
      </div>

      {/* Footer / Action Bar (Selection Mode) */}
      {selectionMode ? (
        <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t dark:border-gray-800 p-4 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-30">
           
           <div className="flex gap-6 mx-auto">
              
              {/* --- ACTION KHUSUS TRASH MODE --- */}
              {isTrashMode ? (
                <>
                  <button 
                    onClick={() => {
                       // @ts-ignore
                       onRestoreItems(Array.from(selectedNoteIds), Array.from(selectedFolderIds));
                       handleCancelSelection();
                    }}
                    className="flex flex-col items-center gap-1 text-gray-500 hover:text-green-600 transition-colors"
                  >
                    <RefreshCcw size={20} />
                    <span className="text-[10px] font-medium">Restore</span>
                  </button>

                  <button 
                    onClick={() => {
                       // @ts-ignore
                       onPermanentDelete(Array.from(selectedNoteIds), Array.from(selectedFolderIds));
                       handleCancelSelection();
                    }}
                    className="flex flex-col items-center gap-1 text-gray-500 hover:text-red-600 transition-colors"
                  >
                    <AlertTriangle size={20} />
                    <span className="text-[10px] font-medium">Hapus Permanen</span>
                  </button>
                </>
              ) : (
                /* --- ACTION MODE NORMAL --- */
                <>
                  {selectedFolderIds.size === 1 && selectedNoteIds.size === 0 && (
                     <button onClick={handleRename} className="flex flex-col items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors">
                       <Pencil size={20} /> <span className="text-[10px] font-medium">Rename</span>
                     </button>
                  )}

                  {/* UBAH: Tombol Move aktif jika ada Note ATAU Folder yang dipilih */}
                  {(selectedNoteIds.size > 0 || selectedFolderIds.size > 0) && (
                    <button onClick={() => setShowMoveDialog(true)} className="flex flex-col items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors">
                      <FolderInput size={20} /> <span className="text-[10px] font-medium">Move</span>
                    </button>
                  )}

                  <button onClick={handleExportSelected} className="flex flex-col items-center gap-1 text-gray-500 hover:text-green-600 transition-colors">
                    <Download size={20} /> <span className="text-[10px] font-medium">Export</span>
                  </button>

                  <button onClick={handleBulkDelete} className="flex flex-col items-center gap-1 text-gray-500 hover:text-red-600 transition-colors">
                     <Trash2 size={20} /> <span className="text-[10px] font-medium">Delete</span>
                  </button>
                </>
              )}
           </div>
        </div>

      ) : !isTrashMode && (
        /* FAB - Add Button */
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3 z-20">
            {fabExpanded && (
                <>
                  {/* 0. Tombol TRACT APP */}
                    <button 
                        onClick={(e) => { e.stopPropagation(); onOpenTractApp(); }} 
                        className="flex items-center gap-2 pr-4 pl-2 py-2 bg-emerald-600 text-white rounded-full shadow-lg hover:bg-emerald-700 animate-in slide-in-from-bottom-5 fade-in duration-200"
                    >
                        <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center">
                            <Activity size={20} />
                        </div>
                        <span className="font-medium whitespace-nowrap">TractApp</span>
                    </button>
                  
                    {/* 1. Tombol FOLDER (Selalu Muncul) */}
                    <button 
                        onClick={(e) => { e.stopPropagation(); triggerCreateFolder(); }} 
                        className="flex items-center gap-2 pr-4 pl-2 py-2 bg-amber-500 text-white rounded-full shadow-lg hover:bg-amber-600 animate-in slide-in-from-bottom-5 fade-in duration-200"
                    >
                        <div className="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center">
                            <FolderPlus size={20} />
                        </div>
                        <span className="font-medium whitespace-nowrap">Folder</span>
                    </button>

                    {/* 2. Tombol PETA KONSEP (Tadi hilang, saya kembalikan) */}
                    <button 
                        onClick={(e) => { e.stopPropagation(); onCreateNote('mindmap', currentFolderId); }} 
                        className="flex items-center gap-2 pr-4 pl-2 py-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 animate-in slide-in-from-bottom-5 fade-in duration-200 delay-75"
                    >
                        <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center">
                            <Network size={20} />
                        </div>
                        <span className="font-medium whitespace-nowrap">Peta Konsep</span>
                    </button>

                    {/* 3. Tombol CATATAN */}
                    <button 
                        onClick={(e) => { e.stopPropagation(); onCreateNote('note', currentFolderId); }}
                        className="flex items-center gap-2 pr-4 pl-2 py-2 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 animate-in slide-in-from-bottom-5 fade-in duration-200 delay-100"
                    >
                         <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
                            <FilePlus size={20} />
                        </div>
                        <span className="font-medium whitespace-nowrap">Catatan</span>
                    </button>
                </>
            )}

            <button 
                onClick={(e) => { e.stopPropagation(); setFabExpanded(!fabExpanded); }}
                className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all ${fabExpanded ? 'bg-gray-700 rotate-45 text-white' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-90'}`}
            >
                <Plus size={28} />
            </button>
        </div>
      )}

      {/* Move Dialog Modal (TETAP SAMA) */}
      {showMoveDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-gray-800 w-full max-w-sm rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
              <h3 className="font-bold text-lg dark:text-white">Move to...</h3>
              <button onClick={() => setShowMoveDialog(false)}><X size={20} className="text-gray-500"/></button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
               {currentFolderId && (
                   <button 
                    onClick={() => handleMoveAction(undefined)}
                    className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200"
                   >
                     <FolderIcon size={20} className="text-gray-400" />
                     Home (Root)
                   </button>
               )}
              
              {/* HANYA tampilkan folder yang TIDAK dihapus (!f.deletedAt) */}
                {/* Filter folder tujuan agar valid (bukan yang sedang dihapus, bukan folder saat ini, dan BUKAN folder yang sedang dipindahkan) */}
                {folders.filter(f => 
                    f.id !== currentFolderId && 
                    !f.deletedAt &&
                    !selectedFolderIds.has(f.id) // Penting: Jangan tampilkan folder yang sedang dipilih untuk dipindah
                ).map(f => (
                 <button key={f.id} onClick={() => handleMoveAction(f.id)} className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200">
                   <FolderIcon size={20} className="text-amber-500" />
                   {f.name}
                 </button>
               ))}
              
               {folders.length <= (currentFolderId ? 1 : 0) && (
                 <div className="p-4 text-center text-gray-400 text-sm">No other folders available</div>
               )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
