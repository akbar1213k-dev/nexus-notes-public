import React from 'react';
import { Note } from '../types';
import { X } from 'lucide-react';

interface PreviewSheetProps {
  note: Note | null;
  onClose: () => void;
  onOpenFull: () => void;
}

export const PreviewSheet: React.FC<PreviewSheetProps> = ({ note, onClose, onOpenFull }) => {
  if (!note) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 max-h-[70vh] flex flex-col transform transition-transform duration-300">
        <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-bold text-lg">{note.title}</h3>
            <button onClick={onClose}><X size={20} className="text-gray-500" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 bg-gray-50/50">
            <div 
                className="prose prose-sm max-w-none text-gray-600"
                dangerouslySetInnerHTML={{ __html: note.content }} 
            />
        </div>
        <div className="p-4 border-t bg-white safe-pb">
            <button 
                onClick={onOpenFull}
                className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 active:scale-[0.98] transition-transform"
            >
                Open Page
            </button>
        </div>
      </div>
    </>
  );
};
