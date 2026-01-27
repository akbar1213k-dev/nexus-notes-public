import React from 'react';
import { ChevronLeft, Home, Moon, Sun, Undo, Redo, Cloud, Check, WifiOff, Settings, Save } from 'lucide-react';
import { ViewMode } from '../types';

interface TopBarProps {
  mode: ViewMode;
  onToggleMode: () => void;
  canGoBack: boolean;
  onBack: () => void;
  onGoHome: () => void;
  title?: string;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onUndo: () => void;
  onRedo: () => void;
  
  // Props Sync & Settings
  syncStatus: 'idle' | 'syncing' | 'saved' | 'error' | 'unsaved';
  isAutoSync: boolean;
  onManualSync: () => void;
  onOpenSettings: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ 
  mode, canGoBack, onBack, onGoHome, title, 
  isDarkMode, onToggleTheme, onUndo, onRedo,
  syncStatus, isAutoSync, onManualSync, onOpenSettings
}) => {
  
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

  const isMainBrand = !title || title === 'Nexus Notes';

  return (
    <div className="h-16 border-b bg-white/80 dark:bg-gray-900/80 backdrop-blur-md dark:border-gray-800 flex items-center justify-between px-4 shrink-0 transition-colors z-50 sticky top-0 shadow-sm">
      
      {/* Left: Navigation & BRAND (Logo Kiri untuk Home) */}
      <div className={`flex items-center gap-2 ${mode === 'HOME' ? 'flex-1' : 'w-1/3'}`}>
        
        {/* LOGIKA BARU: Jika Home, Tampilkan Logo & Teks di Kiri */}
        {mode === 'HOME' ? (
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
            /* Jika BUKAN Home, Tampilkan Tombol Back/Home seperti biasa */
            <>
                {canGoBack ? (
                  <button onClick={onBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors group">
                    <ChevronLeft size={24} className="text-gray-700 dark:text-gray-200 group-hover:-translate-x-0.5 transition-transform" />
                  </button>
                ) : (
                   <div className="w-10"></div>
                )}
                
                <button onClick={onGoHome} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                    <Home size={20} className="text-gray-700 dark:text-gray-200" />
                </button>
            </>
        )}
      </div>

      {/* Center: Title (Hanya muncul saat Editor/Bukan Home) */}
      <div className="flex items-center justify-center w-1/3 min-w-0">
        {mode !== 'HOME' && (
            <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <span className="font-bold text-lg truncate text-gray-800 dark:text-gray-100 max-w-[200px] sm:max-w-xs text-center">
                  {title}
                </span>
                <span className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">
                  Editing
                </span>
            </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className={`flex items-center justify-end gap-1 ${mode === 'HOME' ? 'flex-none' : 'w-1/3'}`}>
        
        <div className="mr-3 flex items-center justify-end min-w-[30px]">
            {renderSyncIcon()}
        </div>

        {mode === 'EDITOR' && (
          <div className="hidden sm:flex">
            <button onClick={onUndo} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
              <Undo size={18} className="text-gray-700 dark:text-gray-200" />
            </button>
            <button onClick={onRedo} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
              <Redo size={18} className="text-gray-700 dark:text-gray-200" />
            </button>
          </div>
        )}

        <button 
            onClick={onOpenSettings} 
            className={`p-2 rounded-full transition-colors ${mode === 'SETTINGS' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
        >
          <Settings size={20} />
        </button>

        <button onClick={onToggleTheme} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
          {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-gray-600" />}
        </button>
      </div>
    </div>
  );
};
