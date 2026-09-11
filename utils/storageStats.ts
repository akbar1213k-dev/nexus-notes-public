import { openHistoryDB } from './historyStore';

const STORE_HISTORY = 'history';

export const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
};

export const getLocalStorageUsage = (): { bytes: number; itemCount: number } => {
  let bytes = 0;
  let itemCount = 0;
  try {
    const encoder = new TextEncoder();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      itemCount++;
      bytes += encoder.encode(key).length;
      const value = localStorage.getItem(key);
      if (value) bytes += encoder.encode(value).length;
    }
  } catch (e) {
    console.error('Gagal menghitung localStorage:', e);
  }
  return { bytes, itemCount };
};

const getCacheStorageUsage = async (): Promise<number> => {
  if (typeof caches === 'undefined') return 0;
  let bytes = 0;
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      for (const request of keys) {
        try {
          const response = await cache.match(request);
          if (!response) continue;
          const blob = await response.clone().blob();
          bytes += blob.size;
        } catch (e) {
          // Abaikan response yang tidak bisa dibaca
        }
      }
    }
  } catch (e) {
    console.error('Gagal menghitung Cache Storage:', e);
  }
  return bytes;
};

export const getIndexOfDBHistoryStats = async (): Promise<{ records: number; versions: number } | null> => {
  try {
    const db = await openHistoryDB();
    if (!db.objectStoreNames.contains(STORE_HISTORY)) return null;
    const chains = await db.getAll(STORE_HISTORY);
    const versions = chains.reduce((sum, c) => sum + c.entries.length, 0);
    return { records: chains.length, versions };
  } catch (e) {
    console.error('Gagal menghitung riwayat IndexedDB:', e);
    return null;
  }
};

export interface StorageStats {
  localBytes: number;
  localItemCount: number;
  cacheBytes: number;
  indexedDBBytes: number;
  totalUsage: number;
  quota: number;
  cacheStorageBytes: number;
  historyRecords: number;
  historyVersions: number;
  supported: boolean;
}

export const getStorageStats = async (): Promise<StorageStats> => {
  const local = getLocalStorageUsage();
  const cacheStorageBytes = await getCacheStorageUsage();
  const history = await getIndexOfDBHistoryStats();

  let totalUsage = 0;
  let quota = 0;
  let supported = false;

  if (navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate();
      totalUsage = estimate.usage || 0;
      quota = estimate.quota || 0;
      supported = true;
    } catch (e) {
      console.error('Gagal membaca estimate storage:', e);
    }
  }

  // IndexedDB dipisahkan dari Cache Storage menggunakan total usage.
  const nonLocal = Math.max(0, totalUsage - local.bytes);
  const indexedDBBytes = Math.max(0, nonLocal - cacheStorageBytes);

  return {
    localBytes: local.bytes,
    localItemCount: local.itemCount,
    cacheBytes: Math.max(0, nonLocal),
    indexedDBBytes,
    totalUsage,
    quota,
    cacheStorageBytes,
    historyRecords: history?.records ?? 0,
    historyVersions: history?.versions ?? 0,
    supported,
  };
};