import React, { useRef } from 'react';
import { Note, Folder } from '../types';
import { Download, Upload, Database, FileJson } from 'lucide-react';

interface BackupManagerProps {
  notes: Note[];
  folders: Folder[];
  // selectedNoteIds dihapus dari sini karena dipindah ke HomeView
  onImport: (data: { notes: Note[]; folders: Folder[] }) => void;
}

const BackupManager: React.FC<BackupManagerProps> = ({ notes, folders, onImport }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportAll = () => {
    const exportData = { notes, folders };
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `NexusNotes_FULL_${dateStr}.json`;
    
    // Download logic
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = JSON.parse(e.target?.result as string);
        if (Array.isArray(result)) {
            onImport({ notes: result, folders: [] });
        } else if (result.notes || result.folders) {
            onImport(result);
        } else {
            alert("Format file tidak dikenali.");
        }
      } catch (error) {
        console.error(error);
        alert("File JSON rusak.");
      }
    };
    reader.readAsText(file);
    if (event.target) event.target.value = '';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-6 shadow-sm border border-gray-200 dark:border-gray-700 animate-in fade-in zoom-in duration-300">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
          <Database size={20} />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">Backup & Restore</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Simpan data secara lokal</p>
        </div>
      </div>

      <div className="flex gap-3">
        <button 
          onClick={handleExportAll}
          className="flex-1 flex items-center justify-center gap-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all active:scale-95"
        >
          <Download size={16} />
          Export All
        </button>

        <input type="file" accept=".json" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 px-4 rounded-lg text-xs font-semibold transition-all shadow-md shadow-blue-500/20 active:scale-95"
        >
          <Upload size={16} />
          Import File
        </button>
      </div>
    </div>
  );
};

export default BackupManager;
