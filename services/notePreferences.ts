// --- PREFERENSI MODE TAMPILAN PER CATATAN ---
// Satu dokumen Firestore per (UID + note ID). Penulisan memakai setDoc biasa
// sehingga pemenang konflik ditentukan oleh urutan penulisan yang berhasil
// diproses backend (last-write-wins), bukan jam lokal perangkat.
// localStorage hanya cache awal/fallback; Firestore tetap sumber kebenaran.

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';

export type NoteMode = 'normal' | 'code' | 'preview';

const KOLEKSI = 'note_preferences';
const KUNCI_CACHE = (uid: string, noteId: string) => `nexus_note_mode_${uid}_${noteId}`;
const KUNCI_PREVIEW_LAMA = (noteId: string) => `nexus_preview_${noteId}`;

export const validMode = (value: unknown): value is NoteMode =>
  value === 'normal' || value === 'code' || value === 'preview';

/** ID dokumen deterministik: tidak mungkin bertabrakan antar-UID. */
export const idDokumenPreferensi = (uid: string, noteId: string): string =>
  `${uid}_${noteId}`;

const modeDariData = (data: DocumentData | undefined): NoteMode | null => {
  if (!data) return null;
  const mode = data.mode;
  return validMode(mode) ? mode : null;
};

/** Baca preferensi sekali (dipakai bila listener belum siap). */
export const bacaPreferensiMode = async (
  uid: string,
  noteId: string
): Promise<NoteMode | null> => {
  if (!uid || !noteId) return null;
  const snap = await getDoc(doc(db, KOLEKSI, idDokumenPreferensi(uid, noteId)));
  return snap.exists() ? modeDariData(snap.data()) : null;
};

/**
 * Simpan preferensi tanpa timestamp lokal. `setDoc` menimpa dokumen yang sama;
 * backend Firestore yang menentukan urutan akhir penulisan.
 */
export const simpanPreferensiMode = async (
  uid: string,
  noteId: string,
  mode: NoteMode
): Promise<void> => {
  if (!uid || !noteId) return;
  await setDoc(doc(db, KOLEKSI, idDokumenPreferensi(uid, noteId)), {
    userId: uid,
    noteId,
    mode,
  });
};

/**
 * Cache lokal ber-UID. Membaca key UID-scoped lebih dulu, lalu key preview
 * lama (`nexus_preview_<noteId>`) sebagai migrasi kompatibilitas.
 */
export const bacaCacheMode = (uid: string, noteId: string): NoteMode | null => {
  if (!uid || !noteId) return null;
  try {
    const tersimpan = localStorage.getItem(KUNCI_CACHE(uid, noteId));
    if (validMode(tersimpan)) return tersimpan;

    const lama = localStorage.getItem(KUNCI_PREVIEW_LAMA(noteId));
    if (lama !== null) return lama === 'true' ? 'preview' : 'normal';
  } catch {
    // localStorage bisa diblokir; cache bersifat opsional.
  }
  return null;
};

export const simpanCacheMode = (uid: string, noteId: string, mode: NoteMode): void => {
  if (!uid || !noteId) return;
  try {
    localStorage.setItem(KUNCI_CACHE(uid, noteId), mode);
    // Pertahankan key Web Preview lama tetap sinkron untuk kompatibilitas.
    localStorage.setItem(KUNCI_PREVIEW_LAMA(noteId), String(mode === 'preview'));
  } catch {
    // abaikan kegagalan cache
  }
};

/**
 * Listener preferensi. `metadata.hasPendingWrites` dipakai agar snapshot lama
 * dari cache tidak menimpa pilihan lokal yang belum selesai ditulis.
 */
export const dengarkanPreferensiMode = (
  uid: string,
  noteId: string,
  onData: (mode: NoteMode | null, hasPendingWrites: boolean) => void
): (() => void) => {
  if (!uid || !noteId) return () => {};
  return onSnapshot(
    doc(db, KOLEKSI, idDokumenPreferensi(uid, noteId)),
    { includeMetadataChanges: true },
    (snap) => {
      const mode = snap.exists() ? modeDariData(snap.data()) : null;
      onData(mode, snap.metadata.hasPendingWrites);
    },
    () => {
      // Kegagalan listener (mis. aturan belum dipublikasikan) tidak boleh
      // menjatuhkan editor; lanjutkan dengan cache/default dan izinkan
      // perubahan mode berikutnya tetap dicoba disimpan.
      onData(null, false);
    }
  );
};

/** Hapus cache saat pengguna berganti akun di perangkat yang sama. */
export const bersihkanCacheModePengguna = (uid: string): void => {
  if (!uid) return;
  try {
    const awalan = `nexus_note_mode_${uid}_`;
    const hapus: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(awalan)) hapus.push(key);
    }
    hapus.forEach(key => localStorage.removeItem(key));
  } catch {
    // abaikan
  }
};
