import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Note, Folder } from '../types';
import { 
  Plus, Clock, FileText, Trash2, CheckCircle2, Circle, X, 
  Network, FilePlus, Folder as FolderIcon, FolderPlus, 
  ChevronLeft, FolderInput, Pencil, Download, 
  Search, ArrowUpDown, Calendar, ArrowDownAz, ArrowUpAz // Icon baru ditambahkan
} from 'lucide-react';

interface HomeViewProps {
  notes: Note[];
  folders: Folder[];
  onNoteClick: (id: string) => void;
  onCreateNote: (type: 'note' | 'mindmap', folderId?: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteItems: (noteIds: string[], folderIds: string[]) => void;
  onMoveItems: (noteIds: string[], targetFolderId: string | undefined) => void;
  onImportData?: (data: any) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ 
  notes, 
  folders, 
  onNoteClick, 
  onCreateNote, 
  onCreateFolder,
  onRenameFolder,
  onDeleteItems,
  onMoveItems,
  onImportData
}) => {
  // Navigation State
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);

  // Selection & UI State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [fabExpanded, setFabExpanded] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  
  // 1. Ambil dari penyimpanan lokal, jika tidak ada gunakan default 'updated' (Edit Terbaru)
  const [sortOption, setSortOption] = useState<'updated' | 'created' | 'alphabet'>(() => {
    const saved = localStorage.getItem('nexus_sort_option');
    return (saved as 'updated' | 'created' | 'alphabet') || 'updated';
  });

  // 2. Ambil dari penyimpanan lokal, jika tidak ada gunakan default 'desc' (Terbaru di atas)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    const saved = localStorage.getItem('nexus_sort_direction');
    return (saved as 'asc' | 'desc') || 'desc';
  });

  const [showSortMenu, setShowSortMenu] = useState(false);

  // 3. Simpan otomatis ke penyimpanan lokal setiap kali opsi berubah
  useEffect(() => {
    localStorage.setItem('nexus_sort_option', sortOption);
  }, [sortOption]);

  useEffect(() => {
    localStorage.setItem('nexus_sort_direction', sortDirection);
  }, [sortDirection]);

  // Computed Data
  const currentFolder = folders.find(f => f.id === currentFolderId);



  // LOGIKA UTAMA: Filter & Sort
	// LOGIKA UTAMA: Filter & Sort (DIPERBAIKI)
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    let filteredNotes = [...notes]; // Buat copy array agar aman
    let filteredFolders = [...folders];

    // 1. Filtering
    if (query) {
      filteredNotes = notes.filter(n => 
        (n.title && n.title.toLowerCase().includes(query)) || 
        (n.content && n.content.toLowerCase().includes(query))
      );
      filteredFolders = folders.filter(f => 
        f.name.toLowerCase().includes(query)
      );
    } else {
      filteredNotes = notes.filter(n => {
        if (!currentFolderId) return !n.folderId; 
        return n.folderId === currentFolderId;
      });
      filteredFolders = currentFolderId ? [] : folders; 
    }

    // 2. Sorting Function (Perbaikan Logika Waktu)
    const sorter = (a: any, b: any, type: 'note' | 'folder') => {
      let valA, valB;

      switch (sortOption) {
        case 'alphabet':
          valA = type === 'note' ? (a as Note).title : (a as Folder).name;
          valB = type === 'note' ? (b as Note).title : (b as Folder).name;
          return sortDirection === 'asc' 
            ? valA.localeCompare(valB) 
            : valB.localeCompare(valA);
        
        case 'created':
          // Note ID adalah timestamp pembuatan
          valA = type === 'note' ? parseInt((a as Note).id) : (a as Folder).createdAt;
          valB = type === 'note' ? parseInt((b as Note).id) : (b as Folder).createdAt;
          return sortDirection === 'asc' ? valA - valB : valB - valA;

        case 'updated':
        default:
          // PRIORITASKAN EDIT TERBARU
          // Jika folder, gunakan createdAt. Jika note, PASTIKAN pakai updatedAt
          valA = type === 'note' ? (a as Note).updatedAt : (a as Folder).createdAt;
          valB = type === 'note' ? (b as Note).updatedAt : (b as Folder).createdAt;
          return sortDirection === 'asc' ? valA - valB : valB - valA;
      }
    };

    return {
      visibleNotes: filteredNotes.sort((a, b) => sorter(a, b, 'note')),
      visibleFolders: filteredFolders.sort((a, b) => sorter(a, b, 'folder'))
    };

  }, [notes, folders, currentFolderId, searchQuery, sortOption, sortDirection]);





  const { visibleNotes, visibleFolders } = filteredItems;

  const getPreview = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.substring(0, 100) + (text.length > 100 ? "..." : "");
  };

  // --- LOGIKA EXPORT SELECTED (BARU) ---
  const handleExportSelected = () => {
    // 1. Ambil data yang dipilih
    const notesToExport = notes.filter(n => selectedNoteIds.has(n.id));
    const foldersToExport = folders.filter(f => selectedFolderIds.has(f.id));

    if (notesToExport.length === 0 && foldersToExport.length === 0) return;

    // 2. Buat JSON
    const exportData = { notes: notesToExport, folders: foldersToExport };
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `NexusNotes_Selection_${dateStr}.json`;

    // 3. Download
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 4. Selesai
    handleCancelSelection();
  };
  // -------------------------------------

  // -- Interaction Handlers --

  const handleItemClick = (type: 'note' | 'folder', id: string) => {
    if (selectionMode) {
      toggleSelection(type, id);
    } else {
      if (type === 'folder') {
        setCurrentFolderId(id);
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
    const allSelected = selectedNoteIds.size === visibleNotes.length && selectedFolderIds.size === visibleFolders.length;
    if (allSelected) {
      setSelectedNoteIds(new Set());
      setSelectedFolderIds(new Set());
    } else {
      setSelectedNoteIds(new Set(visibleNotes.map(n => n.id)));
      setSelectedFolderIds(new Set(visibleFolders.map(f => f.id)));
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
      onCreateFolder(name.trim());
    }
    setFabExpanded(false);
  };

  const handleMoveAction = (targetId: string | undefined) => {
    onMoveItems(Array.from(selectedNoteIds), targetId);
    setShowMoveDialog(false);
    handleCancelSelection();
  };

  const totalSelected = selectedNoteIds.size + selectedFolderIds.size;

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
      <div className="p-4 pb-32 overflow-y-auto flex-1 no-scrollbar">
        
        {/* HEADER BARU: Search & Sort (Hanya jika tidak dalam mode seleksi) */}
        {!selectionMode && (
          <div className="mb-6 space-y-3">
            {/* Search Bar */}
            <div className="relative">
              <input 
                type="text" 
                placeholder="Search notes..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white transition-all"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Breadcrumb & Sort Row */}
            <div className="flex items-center justify-between">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 overflow-hidden">
                {currentFolderId ? (
                  <button 
                    onClick={() => { setCurrentFolderId(undefined); setSearchQuery(''); }}
                    className="flex items-center text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap"
                  >
                    <ChevronLeft size={20} />
                    Back
                  </button>
                ) : (
                    <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">
                      {searchQuery ? 'Search Results' : 'My Space'}
                    </h2>
                )}
                {currentFolder && !searchQuery && (
                  <>
                    <span className="text-gray-300">/</span>
                    <span className="font-bold text-gray-800 dark:text-gray-200 truncate">{currentFolder.name}</span>
                  </>
                )}
              </div>

              {/* Sort Button & Menu */}
              <div className="relative">
                 <button 
                   onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu); }}
                   className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                 >
                    {sortOption === 'updated' && <Clock size={14}/>}
                    {sortOption === 'created' && <Calendar size={14}/>}
                    {sortOption === 'alphabet' && <ArrowDownAz size={14}/>}
                    <span>{sortOption === 'updated' ? 'Updated' : sortOption === 'created' ? 'Created' : 'Name'}</span>
                    <ArrowUpDown size={12} className="ml-1 opacity-50"/>
                 </button>

                 {/* Dropdown Menu */}
                 {showSortMenu && (
                   <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                      <div className="p-1">
                        <div className="text-[10px] font-semibold text-gray-400 px-3 py-2 uppercase tracking-wider">Sort By</div>
                        <button onClick={() => { setSortOption('updated'); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${sortOption === 'updated' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}><Clock size={16}/> Edit Terbaru</button>
                        <button onClick={() => { setSortOption('created'); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${sortOption === 'created' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}><Calendar size={16}/> Tanggal Dibuat</button>
                        <button onClick={() => { setSortOption('alphabet'); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${sortOption === 'alphabet' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}><ArrowDownAz size={16}/> Alfabet (A-Z)</button>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-700"></div>
                        <button onClick={() => { setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); setShowSortMenu(false); }} className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                           <span className="flex items-center gap-2">{sortDirection === 'asc' ? <ArrowUpAz size={16}/> : <ArrowDownAz size={16}/>} {sortDirection === 'asc' ? 'Ascending' : 'Descending'}</span>
                        </button>
                      </div>
                   </div>
                 )}
              </div>
            </div>
          </div>
        )}
        
        {/* ... (Render Notes & Folders - Bagian ini SAMA SEPERTI SEBELUMNYA, tidak perlu diubah) ... */}
        {visibleFolders.length === 0 && visibleNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600">
            {searchQuery ? (
               <>
                 <Search size={48} className="mb-4 opacity-50" />
                 <p>No results found for "{searchQuery}"</p>
               </>
            ) : (
               <>
                 <FileText size={48} className="mb-4 opacity-50" />
                 <p>Empty folder. Create something!</p>
               </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
             {/* RENDER FOLDERS */}
            {visibleFolders.map((folder) => {
              const isSelected = selectedFolderIds.has(folder.id);
              return (
                <div 
                  key={folder.id}
                  className={`
                    p-4 rounded-xl shadow-sm border relative overflow-hidden flex items-center gap-4
                    transition-all active:scale-[0.99] cursor-pointer 
                    ${isSelected 
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                        : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                    }
                  `}
                  onClick={() => handleItemClick('folder', folder.id)}
                  onTouchStart={() => handleTouchStart('folder', folder.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                >
                    {selectionMode && (
                        <div className="absolute right-4 text-blue-600 dark:text-blue-400">
                             {isSelected ? <CheckCircle2 size={24} fill="currentColor" className="text-white dark:text-gray-900" /> : <Circle size={24} className="text-gray-300 dark:text-gray-600" />}
                        </div>
                    )}

                    <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                        <FolderIcon size={24} fill="currentColor" className="opacity-80"/>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 truncate">
                            {folder.name}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Folder
                        </p>
                    </div>
                </div>
              );
            })}

            {/* RENDER NOTES */}
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
                  onClick={() => handleItemClick('note', note.id)}
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

                        {/* FOOTER WAKTU: Dibuat (Kiri) & Diedit (Kanan) */}
                        <div className={`flex items-center justify-between mt-3 pt-2 border-t ${isMindMap ? 'border-indigo-100 dark:border-indigo-800' : 'border-gray-100 dark:border-gray-800'}`}>
                            
                            {/* Waktu Dibuat */}
                            <div className="flex items-center text-[10px] text-gray-400 dark:text-gray-500">
                                <Calendar size={10} className="mr-1" />
                                <span>
                                    {new Date(parseInt(note.id)).toLocaleDateString('id-ID', { 
                                        day: 'numeric', month: 'short'
                                    })}
                                </span>
                            </div>

                            {/* Waktu Diedit */}
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
        )}
      </div>

      {/* Footer / Action Bar (Selection Mode) */}
      {selectionMode ? (
        <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t dark:border-gray-800 p-4 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-30">
           
           <div className="flex gap-6 mx-auto">
              {/* Rename (Only if 1 folder selected and no notes) */}
              {selectedFolderIds.size === 1 && selectedNoteIds.size === 0 && (
                 <button 
                   onClick={handleRename}
                   className="flex flex-col items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors"
                 >
                   <Pencil size={20} />
                   <span className="text-[10px] font-medium">Rename</span>
                 </button>
              )}

              {/* Move (Only if notes selected) */}
              {selectedNoteIds.size > 0 && (
                <button 
                  onClick={() => setShowMoveDialog(true)}
                  className="flex flex-col items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors"
                >
                  <FolderInput size={20} />
                  <span className="text-[10px] font-medium">Move</span>
                </button>
              )}

              {/* TOMBOL BARU: EXPORT SELECTED */}
              <button 
                onClick={handleExportSelected}
                className="flex flex-col items-center gap-1 text-gray-500 hover:text-green-600 transition-colors"
              >
                <Download size={20} />
                <span className="text-[10px] font-medium">Export</span>
              </button>

              {/* Delete Button */}
               <button 
                 onClick={handleBulkDelete}
                 className="flex flex-col items-center gap-1 text-gray-500 hover:text-red-600 transition-colors"
               >
                 <Trash2 size={20} />
                 <span className="text-[10px] font-medium">Delete</span>
               </button>
           </div>
        </div>
      ) : (
        /* FAB - Add Button (TETAP SAMA) */
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3 z-20">
            {fabExpanded && (
                <>
                     {!currentFolderId && (
                      <button 
                          onClick={(e) => { e.stopPropagation(); triggerCreateFolder(); }}
                          className="flex items-center gap-2 pr-4 pl-2 py-2 bg-amber-500 text-white rounded-full shadow-lg hover:bg-amber-600 animate-in slide-in-from-bottom-5 fade-in duration-200"
                      >
                          <div className="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center">
                              <FolderPlus size={20} />
                          </div>
                          <span className="font-medium whitespace-nowrap">Folder</span>
                      </button>
                     )}

                    <button 
                        onClick={(e) => { e.stopPropagation(); onCreateNote('mindmap', currentFolderId); }}
                        className="flex items-center gap-2 pr-4 pl-2 py-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 animate-in slide-in-from-bottom-5 fade-in duration-200 delay-75"
                    >
                        <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center">
                            <Network size={20} />
                        </div>
                        <span className="font-medium whitespace-nowrap">Peta Konsep</span>
                    </button>

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
               {folders.filter(f => f.id !== currentFolderId).map(f => (
                 <button 
                   key={f.id}
                   onClick={() => handleMoveAction(f.id)}
                   className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200"
                 >
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
