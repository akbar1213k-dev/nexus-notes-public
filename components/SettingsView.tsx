import React, { useEffect, useState } from 'react';
import { LogOut, Cloud, User, Clock, Edit2, Check, X, HardDrive, RefreshCw, Bug } from 'lucide-react';
import BackupManager from './BackupManager'; // <--- Tambahkan ini
import { Note, Folder } from '../types';     // <--- Tambahkan ini
import { getStorageStats, formatBytes, StorageStats } from '../utils/storageStats';

interface SettingsViewProps {
  isAutoSync: boolean;
  onToggleAutoSync: (val: boolean) => void;
  syncInterval: number;
  onChangeInterval: (val: number) => void;
  onLogout: () => void;
  userEmail?: string | null;
  isAnonymous?: boolean;
  isOffline?: boolean;
  // Props baru untuk Backup
  notes: Note[];
  folders: Folder[];
  onImportData: (data: any) => void;
  onClearHistory: (halfOnly: boolean) => void;
  // Fungsi baru untuk ganti email
  onUpdateEmail?: (newEmail: string) => Promise<void>; 
  isDebugEnabled: boolean;
  onToggleDebug: (val: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isAutoSync,
  onToggleAutoSync,
  syncInterval,
  onChangeInterval,
  onLogout,
  userEmail,
  isAnonymous,
  isOffline,
  notes,        // Baru
  folders,      // Baru
  onImportData, // Baru
  onClearHistory,
  onUpdateEmail,
  isDebugEnabled,
  onToggleDebug
}) => {
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState(userEmail || '');
  const [isUpdating, setIsUpdating] = useState(false);

  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  const loadStorageStats = async () => {
    setStorageStats(null);
    const stats = await getStorageStats();
    setStorageStats(stats);
  };

  useEffect(() => {
    loadStorageStats();
  }, []);

  const handleEmailSubmit = async () => {
    if (!newEmail || newEmail === userEmail || !onUpdateEmail) {
      setIsEditingEmail(false);
      return;
    }
    
    setIsUpdating(true);
    try {
      await onUpdateEmail(newEmail);
      setIsEditingEmail(false);
      alert("Email berhasil diperbarui!");
    } catch (error: any) {
      alert("Gagal mengganti email. Pastikan format email benar dan Anda baru saja login. Detail: " + error.message);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pt-20 pb-32">
      <h2 className="text-3xl font-bold text-gray-800 dark:text-white">Settings</h2>

      {/* Account Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Account</h3>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400 shrink-0">
                    <User size={24} />
                </div>
                <div className="flex-1 mr-4">
                    {!isEditingEmail ? (
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                          {isOffline ? 'Mode Offline' : (isAnonymous ? 'Guest User' : (userEmail || 'Unknown User'))}
                      </p>
                    ) : (
                      <input 
                        type="email" 
                        value={newEmail} 
                        onChange={(e) => setNewEmail(e.target.value)} 
                        disabled={isUpdating}
                        className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        placeholder="Ketik email baru Anda..."
                      />
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                        {isOffline ? 'Semua data tersimpan lokal' : (isAnonymous ? 'Data saved locally (mostly)' : 'Signed in via Email')}
                    </p>
                </div>
            </div>
            
            {/* Tombol Edit / Simpan (Disembunyikan jika Guest User atau Offline) */}
            {!isAnonymous && !isOffline && (
              <div className="flex items-center gap-1 shrink-0">
                {!isEditingEmail ? (
                  <button 
                    onClick={() => {
                      setNewEmail(userEmail || '');
                      setIsEditingEmail(true);
                    }} 
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded-lg transition-all"
                    title="Ganti Email"
                  >
                    <Edit2 size={18} />
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={handleEmailSubmit} 
                      disabled={isUpdating}
                      className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-all disabled:opacity-50"
                      title="Simpan Perubahan"
                    >
                      <Check size={18} />
                    </button>
                    <button 
                      onClick={() => setIsEditingEmail(false)} 
                      disabled={isUpdating}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all disabled:opacity-50"
                      title="Batal"
                    >
                      <X size={18} />
                    </button>
                  </>
                )}
              </div>
            )}
        </div>
      </section>

      {/* Sync Section */}
      <section className={`space-y-4 ${isOffline ? 'opacity-50 pointer-events-none' : ''}`}>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Sync Configuration {isOffline && '(Tidak tersedia di mode offline)'}
        </h3>
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

      {/* Diagnostics Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Diagnostics</h3>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bug size={20} className="text-gray-400" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Tampilkan Debug Sinkronisasi</p>
                <p className="text-xs text-gray-500">
                  Panel diagnostik untuk merekam peristiwa sinkronisasi. Nonaktif secara default.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={isDebugEnabled}
                onChange={(e) => onToggleDebug(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
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

      {/* Storage Usage Website */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Storage Website</h3>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardDrive size={20} className="text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Penyimpanan Website</p>
                  <p className="text-xs text-gray-500">Ukuran data yang tersimpan di perangkat ini</p>
                </div>
              </div>
              <button
                onClick={loadStorageStats}
                disabled={!storageStats}
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded-lg transition-all disabled:opacity-50"
                title="Segarkan"
              >
                <RefreshCw size={18} className={!storageStats ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {storageStats ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">localStorage</p>
                  <p className="text-xs text-gray-500">{storageStats.localItemCount} key tersimpan</p>
                </div>
                <span className="font-mono text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {formatBytes(storageStats.localBytes)}
                </span>
              </div>

              <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Cache (IndexedDB + Cache API)</p>
                  <p className="text-xs text-gray-500">
                    {storageStats.historyVersions > 0
                      ? `${storageStats.historyVersions} versi riwayat dalam ${storageStats.historyRecords} catatan`
                      : 'Tidak ada data cache'}
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {formatBytes(storageStats.cacheBytes)}
                </span>
              </div>

              {storageStats.supported && storageStats.quota > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>Total Terpakai</span>
                    <span className="font-mono">
                      {formatBytes(storageStats.totalUsage)} dari {formatBytes(storageStats.quota)} (
                      {Math.min(100, Math.round((storageStats.totalUsage / storageStats.quota) * 100))}%)
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        storageStats.totalUsage / storageStats.quota > 0.9
                          ? 'bg-red-500'
                          : storageStats.totalUsage / storageStats.quota > 0.7
                          ? 'bg-amber-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ width: `${Math.min(100, (storageStats.totalUsage / storageStats.quota) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 animate-pulse">
              <div className="h-12 rounded-lg bg-gray-200 dark:bg-gray-700 mb-2" />
              <div className="h-12 rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
          )}
        </div>
      </section>

      {/* Danger Zone & Cache Management */}
      <section className="space-y-4">
         <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Storage & Danger Zone</h3>
         
         <div className="grid grid-cols-2 gap-3">
             <button 
                onClick={() => onClearHistory(true)}
                className="flex items-center justify-center gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors font-medium text-sm text-center"
             >
                Hapus 50% Riwayat (Lama)
             </button>
             <button 
                onClick={() => onClearHistory(false)}
                className="flex items-center justify-center gap-2 p-3 rounded-xl border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors font-medium text-sm text-center"
             >
                Bersihkan Semua Cache
             </button>
         </div>

         <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-semibold mt-2"
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
