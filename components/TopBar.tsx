import React, { useState } from 'react';
import { 
  ChevronLeft, Moon, Sun, Cloud, Check, WifiOff, Settings, Save, Network,
  MoreVertical, Trash2, FolderInput, Home, CornerLeftUp
} from 'lucide-react';
import { ViewMode } from '../types';

interface TopBarProps {
  mode: ViewMode;
  title?: string; 
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onUndo: () => void;
  onRedo: () => void;
  syncStatus: 'idle' | 'syncing' | 'saved' | 'error' | 'unsaved';
  isAutoSync: boolean;
  onManualSync: () => void;
  onOpenSettings: () => void;
  onGoHome: () => void;
  onForceHome: () => void;
  onGoToParent?: () => void;
  onToggleMode: () => void;
  onDeleteNote?: () => void;
  onMoveNote?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ 
  mode, onGoHome, onForceHome, onGoToParent,
  isDarkMode, onToggleTheme,
  syncStatus, isAutoSync, onManualSync, onOpenSettings,
  onToggleMode,
  onDeleteNote,
  onMoveNote
}) => {
  const [showMenu, setShowMenu] = useState(false);

  // --- Render Ikon Sync (Sama untuk semua halaman) ---
  const renderSyncIcon = () => {
    if (syncStatus === 'syncing') return <Cloud size={20} className="text-blue-500 animate-pulse" />;
    if (syncStatus === 'error') return <WifiOff size={20} className="text-red-500" />;
    if (syncStatus === 'saved') return <Check size={20} className="text-green-500" />;
    if (!isAutoSync && syncStatus === 'unsaved') {
       return (
         <button 
            onClick={onManualSync} 
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-full shadow-sm transition-all active:scale-95 animate-in fade-in"
         >
            <Save size={14} className="animate-bounce" />
            <span className="text-[10px] font-bold tracking-wider">SAVE</span>
         </button>
       );
    }
    return <Cloud size={20} className="text-gray-300 dark:text-gray-600" />;
  };

  return (
    <div className="h-16 border-b bg-white/80 dark:bg-gray-900/80 backdrop-blur-md dark:border-gray-800 flex items-center justify-between px-4 shrink-0 transition-colors z-50 sticky top-0 shadow-sm">
      
      {/* --- BAGIAN KIRI --- */}
      <div className="flex items-center gap-2">
        {mode === 'HOME' ? (
            // LOGO (Hanya di Home)
            <div className="flex items-center gap-3 cursor-pointer animate-in fade-in slide-in-from-left-2 duration-300">
                <div className="relative w-8 h-8 flex items-center justify-center bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-lg shadow-md hover:rotate-12 transition-transform">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                </div>
                <span className="font-extrabold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300">
                    Nexus Notes
                </span>
            </div>
      ) : (
            // TOMBOL KEMBALI, NAIK CABANG & HOME (Untuk halaman lain)
            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-300">
                <button 
                    onClick={onGoHome} 
                    className="flex items-center gap-2 pr-3 py-2 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Kembali ke Riwayat"
                >
                    <div className="p-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                        <ChevronLeft size={20} />
                    </div>
                    <span className="font-semibold text-sm hidden sm:inline">Kembali</span>
                </button>

                {/* TOMBOL CABANG NAIK (Hanya muncul jika di halaman EDITOR dan fungsinya tersedia) */}
                {mode === 'EDITOR' && onGoToParent && (
                    <button 
                        onClick={onGoToParent} 
                        className="flex items-center gap-2 pr-3 py-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
                        title="Naik ke Catatan Induk"
                    >
                        <div className="p-1.5 bg-indigo-50 dark:bg-indigo-900/40 rounded-full flex items-center justify-center">
                            <CornerLeftUp size={18} />
                        </div>
                        <span className="font-semibold text-sm hidden sm:inline">Naik</span>
                    </button>
                )}

                <button 
                    onClick={onForceHome} 
                    className="flex items-center gap-2 pr-3 py-2 text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors border-none bg-transparent"
                    title="Ke Halaman Utama"
                >
                    <div className="p-1.5 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                        <Home size={18} className="text-gray-600 dark:text-gray-300" />
                    </div>
                    <span className="font-semibold text-sm">Home</span>
                </button>
            </div>
        )}
      </div>

      {/* --- BAGIAN KANAN --- */}
      <div className="flex items-center justify-end gap-2">
        
        {/* 1. Sync Status (Selalu Ada) */}
        <div className="mr-1 flex items-center justify-end min-w-[24px]">
            {renderSyncIcon()}
        </div>

        {/* 2. Logic Ikon Berdasarkan Halaman */}

        {/* HALAMAN UTAMA (HOME): Sync, Settings, Graph */}
        {mode === 'HOME' && (
            <>
                <button 
                    onClick={onOpenSettings} 
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors"
                    title="Pengaturan"
                >
                    <Settings size={20} />
                </button>
                <button 
                    onClick={onToggleMode} 
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors ml-1"
                    title="Graph View"
                >
                    <Network size={20} />
                </button>
            </>
        )}

        {/* HALAMAN CATATAN (EDITOR): Sync, Settings, Graph, Kebab (Pindah/Hapus) */}
        {mode === 'EDITOR' && (
            <>
                <button 
                    onClick={onOpenSettings} 
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors"
                    title="Pengaturan"
                >
                    <Settings size={20} />
                </button>
                
                <button 
                    onClick={onToggleMode} 
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors ml-1"
                    title="Graph View"
                >
                    <Network size={20} />
                </button>

                {/* Kebab Menu */}
                <div className="relative ml-1">
                    <button 
                      onClick={() => setShowMenu(!showMenu)}
                      className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors"
                    >
                      <MoreVertical size={20} />
                    </button>

                    {showMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                          <div className="p-1">
                            <button 
                              onClick={() => { setShowMenu(false); onMoveNote && onMoveNote(); }}
                              className="w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                              <FolderInput size={16} />
                              <span>Pindahkan</span>
                            </button>
                            
                            <button 
                              onClick={() => { setShowMenu(false); onDeleteNote && onDeleteNote(); }}
                              className="w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <Trash2 size={16} />
                              <span>Hapus Catatan</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                </div>
            </>
        )}

        {/* HALAMAN PENGATURAN (SETTINGS): Sync, Theme */}
        {mode === 'SETTINGS' && (
            <button 
                onClick={onToggleTheme} 
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                title="Ganti Tema"
            >
                {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-gray-600" />}
            </button>
        )}

        {/* HALAMAN GRAPH (GRAPH): Sync, Settings, Theme */}
        {mode === 'GRAPH' && (
            <>
                <button 
                    onClick={onOpenSettings} 
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors"
                    title="Pengaturan"
                >
                    <Settings size={20} />
                </button>
                <button 
                    onClick={onToggleTheme} 
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    title="Ganti Tema"
                >
                    {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-gray-600" />}
                </button>
            </>
        )}

      </div>
    </div>
  );
};
