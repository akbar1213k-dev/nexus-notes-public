import React, { useState, useRef } from 'react';
import { Note } from '../types';
import { Plus, Clock, FileText, Trash2, CheckCircle2, Circle, X } from 'lucide-react';

interface HomeViewProps {
  notes: Note[];
  onNoteClick: (id: string) => void;
  onCreateNew: () => void;
  onDeleteNotes: (ids: string[]) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ notes, onNoteClick, onCreateNew, onDeleteNotes }) => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getPreview = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.substring(0, 100) + (text.length > 100 ? "..." : "");
  };

  const sortedNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  // -- Interaction Handlers --

  const handleCardClick = (id: string) => {
    if (selectionMode) {
      toggleSelection(id);
    } else {
      onNoteClick(id);
    }
  };

  const handleCardLongPress = (id: string) => {
    if (!selectionMode) {
      if (navigator.vibrate) navigator.vibrate(50);
      setSelectionMode(true);
      toggleSelection(id);
    }
  };

  const handleTouchStart = (id: string) => {
    longPressTimer.current = setTimeout(() => {
      handleCardLongPress(id);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      
      // Auto exit if empty? Optional. Keeping mode active is usually better UX until explicit cancel.
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === notes.length) {
      setSelectedIds(new Set()); // Deselect all
    } else {
      const allIds = new Set(notes.map(n => n.id));
      setSelectedIds(allIds);
    }
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Delete ${selectedIds.size} note(s)?`)) {
      onDeleteNotes(Array.from(selectedIds));
      handleCancelSelection();
    }
  };

  return (
    <div className="flex-1 h-full relative bg-gray-50 dark:bg-gray-950 transition-colors flex flex-col">
      
      {/* Selection Mode Header Overlay */}
      {selectionMode && (
        <div className="bg-blue-600 text-white px-4 py-3 flex justify-between items-center shadow-md z-30 animate-in slide-in-from-top-5">
          <div className="flex items-center gap-3">
            <button onClick={handleCancelSelection}><X size={24} /></button>
            <span className="font-bold text-lg">{selectedIds.size} Selected</span>
          </div>
          <button 
            onClick={handleSelectAll} 
            className="text-sm font-semibold uppercase tracking-wide"
          >
            {selectedIds.size === notes.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      )}

      <div className="p-4 pb-32 overflow-y-auto flex-1 no-scrollbar">
        {!selectionMode && (
           <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 ml-1">
             Recent Notes
           </h2>
        )}
        
        {sortedNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600">
            <FileText size={48} className="mb-4 opacity-50" />
            <p>No notes yet. Create one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sortedNotes.map((note) => {
              const isSelected = selectedIds.has(note.id);
              return (
                <div 
                  key={note.id}
                  className={`
                    bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border 
                    transition-all active:scale-[0.99] cursor-pointer relative overflow-hidden
                    ${isSelected 
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                        : 'border-gray-100 dark:border-gray-800'
                    }
                  `}
                  onClick={() => handleCardClick(note.id)}
                  onTouchStart={() => handleTouchStart(note.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd} // Cancel on scroll
                >
                    {/* Checkbox indicator */}
                    {selectionMode && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400">
                             {isSelected ? <CheckCircle2 size={24} fill="currentColor" className="text-white dark:text-gray-900" /> : <Circle size={24} className="text-gray-300 dark:text-gray-600" />}
                        </div>
                    )}

                    <div className={selectionMode ? "pr-10" : ""}>
                        <div className="flex justify-between items-start mb-2">
                            <h3 className={`font-bold text-lg line-clamp-1 ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-100'}`}>
                                {note.title || "Untitled"}
                            </h3>
                        </div>
                        
                        <p className="text-gray-500 dark:text-gray-400 text-sm line-clamp-2 mb-3 h-10">
                            {getPreview(note.content) || <span className="italic text-gray-300 dark:text-gray-600">No content</span>}
                        </p>

                        <div className="flex items-center text-xs text-gray-400 dark:text-gray-500">
                            <Clock size={12} className="mr-1" />
                            <span>
                                {new Date(note.updatedAt).toLocaleDateString('id-ID', { 
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                                })}
                            </span>
                        </div>
                    </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer / FAB */}
      {selectionMode ? (
        <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t dark:border-gray-800 p-4 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-30">
           <span className="text-gray-500 text-sm">
             {selectedIds.size} items
           </span>
           <button 
             onClick={handleBulkDelete}
             disabled={selectedIds.size === 0}
             className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold transition-all ${selectedIds.size > 0 ? 'bg-red-600 text-white shadow-lg active:scale-95' : 'bg-gray-200 text-gray-400'}`}
           >
             <Trash2 size={20} />
             Delete
           </button>
        </div>
      ) : (
        <button 
            onClick={onCreateNew}
            className="absolute bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 active:scale-90 transition-all z-20"
        >
            <Plus size={28} />
        </button>
      )}
    </div>
  );
};