import React from 'react';
import { LogOut, Cloud, User, Clock } from 'lucide-react';
import BackupManager from './BackupManager'; // <--- Tambahkan ini
import { Note, Folder } from '../types';     // <--- Tambahkan ini

interface SettingsViewProps {
  isAutoSync: boolean;
  onToggleAutoSync: (val: boolean) => void;
  syncInterval: number;
  onChangeInterval: (val: number) => void;
  onLogout: () => void;
  userEmail?: string | null;
  isAnonymous?: boolean;
  // Props baru untuk Backup
  notes: Note[];
  folders: Folder[];
  onImportData: (data: any) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isAutoSync,
  onToggleAutoSync,
  syncInterval,
  onChangeInterval,
  onLogout,
  userEmail,
  isAnonymous,
  notes,        // Baru
  folders,      // Baru
  onImportData  // Baru
}) => {
  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pt-20 pb-32">
      <h2 className="text-3xl font-bold text-gray-800 dark:text-white">Settings</h2>

      {/* Account Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Account</h3>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400">
                    <User size={24} />
                </div>
                <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                        {isAnonymous ? 'Guest User' : (userEmail || 'Unknown User')}
                    </p>
                    <p className="text-xs text-gray-500">
                        {isAnonymous ? 'Data saved locally (mostly)' : 'Signed in via Email'}
                    </p>
                </div>
            </div>
        </div>
      </section>

      {/* Sync Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Sync Configuration</h3>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">

            {/* Auto Sync Toggle */}
            <div className="p-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3">
                    <Cloud size={20} className="text-gray-400" />
                    <div>
                        <p className="font-medium text-gray-900 dark:text-white">Auto Sync</p>
                        <p className="text-xs text-gray-500">Automatically save changes to cloud</p>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={isAutoSync} onChange={(e) => onToggleAutoSync(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
            </div>

            {/* Sync Interval */}
            <div className={`p-4 transition-opacity ${!isAutoSync ? 'opacity-50 pointer-events-none' : ''}`}>
                 <div className="flex items-center gap-3 mb-3">
                    <Clock size={20} className="text-gray-400" />
                    <div>
                        <p className="font-medium text-gray-900 dark:text-white">Sync Interval</p>
                        <p className="text-xs text-gray-500">Wait time before saving (ms)</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <input 
                        type="number" 
                        value={syncInterval} 
                        onChange={(e) => onChangeInterval(Number(e.target.value))}
                        className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono"
                        placeholder="Masukkan durasi (ms)"
                    />
                    <span className="font-mono text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">ms</span>
                </div>
            </div>
        </div>
      </section>

      {/* Backup Section (DITAMBAHKAN DI SINI) */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Data Management</h3>
        <BackupManager 
            notes={notes}
            folders={folders}
            onImport={onImportData}
        />
      </section>

      {/* Danger Zone */}
      <section className="space-y-4">
         <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-semibold"
         >
            <LogOut size={20} />
            Sign Out
         </button>
      </section>

      <div className="text-center text-xs text-gray-400 mt-8">
        Nexus Notes v1.0.0 &bull; Built by Akbar
      </div>
    </div>
  );
};
