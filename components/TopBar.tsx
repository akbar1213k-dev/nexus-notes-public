import React from 'react';
import { ViewMode } from '../types';
import { Network, FileText, ArrowLeft, RotateCcw, Home } from 'lucide-react';

interface TopBarProps {
  mode: ViewMode;
  onToggleMode: () => void;
  canGoBack: boolean;
  onBack: () => void;
  onGoHome: () => void;
  title?: string;
}

export const TopBar: React.FC<TopBarProps> = ({ 
  mode, 
  onToggleMode, 
  canGoBack, 
  onBack, 
  onGoHome,
  title 
}) => {
  return (
    <div className="h-14 bg-white border-b flex items-center justify-between px-4 z-50 relative shrink-0">
      <div className="flex items-center space-x-3 overflow-hidden">
        {mode !== 'HOME' && (
            <button 
                onClick={mode === 'EDITOR' && !canGoBack ? onGoHome : onBack} 
                className="p-1 rounded-full hover:bg-gray-100 -ml-1"
            >
                {mode === 'EDITOR' && !canGoBack ? <ArrowLeft size={22} /> : <ArrowLeft size={22} />}
            </button>
        )}
        
        <h1 
            onClick={onGoHome}
            className="font-bold text-xl truncate max-w-[200px] bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 cursor-pointer"
        >
            {mode === 'HOME' ? 'Nexus Notes' : (title || 'Untitled')}
        </h1>
      </div>
      
      <div className="flex items-center space-x-1">
        {mode === 'EDITOR' && (
             <button className="p-2 text-gray-500 hover:text-gray-900" title="Undo (Mock)">
                <RotateCcw size={18} />
             </button>
        )}
        
        {mode !== 'HOME' && (
            <button 
                onClick={onToggleMode}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    mode === 'GRAPH' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700'
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