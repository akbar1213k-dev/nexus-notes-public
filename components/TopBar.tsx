import React from 'react';
import { ViewMode } from '../types';
import { Network, FileText, ArrowLeft, Sun, Moon, Undo, Redo } from 'lucide-react'; // Tambahkan Undo, Redo

interface TopBarProps {
  mode: ViewMode;
  onToggleMode: () => void;
  canGoBack: boolean;
  onBack: () => void;
  onGoHome: () => void;
  title?: string;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  // TAMBAHKAN INI:
  onUndo?: () => void;
  onRedo?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ 
  mode, 
  onToggleMode, 
  canGoBack, 
  onBack, 
  onGoHome,
  title,
  isDarkMode,
  onToggleTheme,
  onUndo, // Terima props ini
  onRedo  // Terima props ini
}) => {
  return (
    <div className="h-14 bg-white dark:bg-gray-900 border-b dark:border-gray-800 flex items-center justify-between px-4 z-50 relative shrink-0 transition-colors">
      <div className="flex items-center space-x-3 overflow-hidden">
        {mode !== 'HOME' && (
            <button 
                onClick={mode === 'EDITOR' && !canGoBack ? onGoHome : onBack} 
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 -ml-1 text-gray-700 dark:text-gray-200"
            >
                <ArrowLeft size={22} />
            </button>
        )}
        
        <h1 
            onClick={onGoHome}
            className="font-bold text-xl truncate max-w-[150px] bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 cursor-pointer"
        >
            {mode === 'HOME' ? 'Nexus Notes' : (title || 'Untitled')}
        </h1>
      </div>
      
      <div className="flex items-center space-x-1">
        {/* TOMBOL UNDO & REDO BARU (Hanya muncul saat di Editor) */}
        {mode === 'EDITOR' && (
          <div className="flex items-center mr-2 border-r dark:border-gray-700 pr-2 space-x-1">
            <button 
              onClick={onUndo}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              title="Undo"
            >
              <Undo size={18} />
            </button>
            <button 
              onClick={onRedo}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              title="Redo"
            >
              <Redo size={18} />
            </button>
          </div>
        )}

        <button 
          onClick={onToggleTheme}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        
        {mode !== 'HOME' && (
            <button 
                onClick={onToggleMode}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    mode === 'GRAPH' 
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' 
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}
            >
                {mode === 'EDITOR' ? <Network size={16} /> : <FileText size={16} />}
                <span className="hidden sm:inline">{mode === 'EDITOR' ? 'Graph' : 'Editor'}</span>
            </button>
        )}
      </div>
    </div>
  );
};
