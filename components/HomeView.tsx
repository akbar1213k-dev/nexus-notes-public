import React from 'react';
import { Note } from '../types';
import { Plus, Clock, FileText } from 'lucide-react';

interface HomeViewProps {
  notes: Note[];
  onNoteClick: (id: string) => void;
  onCreateNew: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ notes, onNoteClick, onCreateNew }) => {
  // Helper to strip HTML tags for preview
  const getPreview = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.substring(0, 100) + (text.length > 100 ? "..." : "");
  };

  // Sort notes by updated date (newest first)
  const sortedNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex-1 h-full relative bg-gray-50">
      <div className="p-4 pb-24 overflow-y-auto h-full no-scrollbar">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 ml-1">
          Recent Notes
        </h2>
        
        {sortedNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <FileText size={48} className="mb-4 opacity-50" />
            <p>No notes yet. Create one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sortedNotes.map((note) => (
              <div 
                key={note.id}
                onClick={() => onNoteClick(note.id)}
                className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 active:scale-[0.99] transition-transform cursor-pointer"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-gray-800 line-clamp-1">
                    {note.title || "Untitled"}
                  </h3>
                </div>
                
                <p className="text-gray-500 text-sm line-clamp-2 mb-3 h-10">
                  {getPreview(note.content) || <span className="italic text-gray-300">No content</span>}
                </p>

                <div className="flex items-center text-xs text-gray-400">
                  <Clock size={12} className="mr-1" />
                  <span>
                    {new Date(note.updatedAt).toLocaleDateString('id-ID', { 
                       day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      <button 
        onClick={onCreateNew}
        className="absolute bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 active:scale-90 transition-all z-20"
      >
        <Plus size={28} />
      </button>
    </div>
  );
};