import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { HistoryChain, HistoryChainEntry } from '../types';
import { replayChain } from './diff';

const DB_NAME = 'nexus-notes';
const DB_VERSION = 1;
const STORE_HISTORY = 'history';

interface NexusDB extends DBSchema {
  history: {
    key: string; // noteId
    value: HistoryChain;
    indexes: {
      noteId: string;
      updatedAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<NexusDB>> | null = null;

export const openHistoryDB = (): Promise<IDBPDatabase<NexusDB>> => {
  if (dbPromise) return dbPromise;
  dbPromise = openDB<NexusDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const store = db.createObjectStore(STORE_HISTORY, { keyPath: 'noteId' });
        store.createIndex('noteId', 'noteId');
        store.createIndex('updatedAt', 'updatedAt');
      }
    },
  });
  return dbPromise;
};

// Ambil rantai riwayat sebuah catatan dari IndexedDB
export const getHistoryChain = async (noteId: string): Promise<HistoryChain | undefined> => {
  try {
    const db = await openHistoryDB();
    return await db.get(STORE_HISTORY, noteId);
  } catch (e) {
    console.error('Gagal membaca riwayat dari IndexedDB:', e);
    return undefined;
  }
};

// Simpan (tulis ulang) rantai riwayat sebuah catatan. Satu `put` = atomik.
export const saveHistoryChain = async (chain: HistoryChain): Promise<void> => {
  try {
    const db = await openHistoryDB();
    await db.put(STORE_HISTORY, chain);
  } catch (e) {
    console.error('Gagal menyimpan riwayat ke IndexedDB:', e);
  }
};

export const deleteHistoryChain = async (noteId: string): Promise<void> => {
  try {
    const db = await openHistoryDB();
    await db.delete(STORE_HISTORY, noteId);
  } catch (e) {
    console.error('Gagal menghapus riwayat dari IndexedDB:', e);
  }
};

// Bersihkan riwayat seluruh catatan: semua (halfOnly=false) atau 50% terlama (halfOnly=true).
// Mengembalikan jumlah versi yang dihapus.
export const clearHistory = async (halfOnly: boolean): Promise<number> => {
  try {
    const db = await openHistoryDB();
    const chains = await db.getAll(STORE_HISTORY);

    if (!halfOnly) {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      await tx.store.clear();
      await tx.done;
      return chains.reduce((sum, c) => sum + c.entries.length, 0);
    }

    let removed = 0;
    const tx = db.transaction(STORE_HISTORY, 'readwrite');
    for (const chain of chains) {
      if (chain.entries.length <= 1) continue; // satu versi = tidak dipangkas
      const contents = replayChain(chain.entries);
      const cutoff = Math.ceil(chain.entries.length / 2);
      removed += cutoff;
      const kept = chain.entries.slice(cutoff);
      const keptContents = contents.slice(cutoff);
      // Pertahankan invariant: entri terdepan harus 'base'.
      const nextEntries: HistoryChainEntry[] = kept.map((e, i) => {
        if (i === 0) {
          return { kind: 'base', content: keptContents[i], time: e.time, preview: e.preview, charCount: e.charCount };
        }
        return e;
      });
      await tx.store.put({ ...chain, entries: nextEntries, updatedAt: Date.now() });
    }
    await tx.done;
    return removed;
  } catch (e) {
    console.error('Gagal membersihkan riwayat dari IndexedDB:', e);
    return 0;
  }
};

// One-time cleanup: buang semua history lama di localStorage (key nexus_history_*)
export const cleanupLegacyLocalStorage = (): void => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nexus_history_')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    if (keys.length > 0) {
      console.log(`🧹 ${keys.length} riwayat legacy (localStorage) dibuang.`);
    }
  } catch (e) {
    console.error('Gagal membersihkan history legacy:', e);
  }
};