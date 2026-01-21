import React from 'react';
import { Note } from '../types';
import { Plus, Clock, FileText, Trash2 } from 'lucide-react';

interface HomeViewProps {
  notes: Note[];
  onNoteClick: (id: string) => void;
  onCreateNew: () => void;
  onDeleteNote: (id: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ notes, onNoteClick, onCreateNew, onDeleteNote }) => {
  const getPreview = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.substring(0, 100) + (text.length > 100 ? "..." : "");
  };

  const sortedNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex-1 h-full relative bg-gray-50 dark:bg-gray-950 transition-colors">
      <div className="p-4 pb-24 overflow-y-auto h-full no-scrollbar">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 ml-1">
          Recent Notes
        </h2>
        
        {sortedNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-600">
            <FileText size={48} className="mb-4 opacity-50" />
            <p>No notes yet. Create one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sortedNotes.map((note) => (
              <div 
                key={note.id}
                className="bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col group relative"
              >
                <div 
                  onClick={() => onNoteClick(note.id)}
                  className="cursor-pointer active:scale-[0.99] transition-transform"
                >
                    <div className="flex justify-between items-start mb-2 pr-8">
                      <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 line-clamp-1">
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

                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if(window.confirm('Delete this note?')) {
                        onDeleteNote(note.id);
                    }
                  }}
                  className="absolute top-4 right-4 p-2 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
                >
                    <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button 
        onClick={onCreateNew}
        className="absolute bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 active:scale-90 transition-all z-20"
      >
        <Plus size={28} />
      </button>
    </div>
  );
};