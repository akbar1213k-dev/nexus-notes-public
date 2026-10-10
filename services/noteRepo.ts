// --- HELPER: Penyimpanan catatan ke Firestore (inline vs chunks) ---
// Semua penulisan catatan ke server WAJIB lewat file ini agar keputusan
// inline/potongan konsisten, dan catatan besar tidak gagal tersimpan
// karena batas 1 MiB per dokumen Firestore.

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import type { Note } from '../types';
import { db } from './firebase';
import {
  buatPreview,
  gabungPotongan,
  pecahContent,
  periksaUkuranMindmap,
  perluChunk,
  ukuranByte,
} from '../utils/noteChunks';

// writeBatch maksimal 500 operasi — pakai 400 sebagai batas aman
const MAKS_OPS_BATCH = 400;

type Operasi = (batch: WriteBatch) => void;

/** Jalankan banyak operasi tulis, dipecah per-batch bila melewati batas. */
const commitBertahap = async (daftarOperasi: Operasi[]): Promise<void> => {
  for (let i = 0; i < daftarOperasi.length; i += MAKS_OPS_BATCH) {
    const batch = writeBatch(db);
    daftarOperasi.slice(i, i + MAKS_OPS_BATCH).forEach(op => op(batch));
    await batch.commit();
  }
};

// Cache konten penuh per sesi agar membuka catatan besar tidak unduh ulang
const cacheKonten = new Map<string, string>();

export const bersihkanCacheKonten = (noteId: string): void => {
  cacheKonten.delete(noteId);
};

/**
 * Simpan catatan ke Firestore.
 * - content <= ambang: ditulis inline (seperti sebelumnya); potongan lama
 *   (bila ada) dihapus.
 * - content > ambang: dokumen utama berisi metadata (content: null) dan isi
 *   content dipindah ke subcollection notes/{id}/chunks/0..n-1.
 */
export const simpanCatatanKeServer = async (note: Note, userId: string): Promise<void> => {
  const pesanMindmap = periksaUkuranMindmap(note);
  if (pesanMindmap) throw new Error(pesanMindmap);

  const catatan = { ...note, userId };

  if (!perluChunk(catatan)) {
    // Inline: bersihkan potongan lama bila catatan ini sebelumnya besar
    const potonganLama = await getDocs(collection(db, 'notes', catatan.id, 'chunks'));
    if (!potonganLama.empty) {
      await commitBertahap(potonganLama.docs.map(d => (batch) => batch.delete(d.ref)));
    }
    await setDoc(doc(db, 'notes', catatan.id), catatan, { merge: true });
    bersihkanCacheKonten(catatan.id);
    return;
  }

  const potongan = pecahContent(catatan.content as string);
  const ukuran = ukuranByte(catatan.content as string);
  if (potongan.length > MAKS_OPS_BATCH) {
    throw new Error(
      `Catatan "${catatan.title || catatan.id}" (${(ukuran / 1048576).toFixed(2)} MB) terlalu besar untuk disinkronkan — batas maksimal yang didukung ±${((MAKS_OPS_BATCH * 700) / 1024).toFixed(0)} KB per catatan.`
    );
  }

  const dokumenUtama = {
    ...catatan,
    content: null,
    chunkCount: potongan.length,
    contentSize: ukuran,
    preview: buatPreview(catatan.content as string),
  };

  const operasi: Operasi[] = [
    (batch) => batch.set(doc(db, 'notes', catatan.id), dokumenUtama),
  ];
  potongan.forEach((isi, index) => {
    operasi.push((batch) =>
      batch.set(doc(db, 'notes', catatan.id, 'chunks', String(index)), { index, content: isi })
    );
  });

  // Hapus potongan lebih dari jumlah baru (kasus content mengecil)
  const potonganLama = await getDocs(collection(db, 'notes', catatan.id, 'chunks'));
  potonganLama.docs.forEach(d => {
    const idx = Number(d.id);
    if (!Number.isFinite(idx) || idx >= potongan.length) {
      operasi.push((batch) => batch.delete(d.ref));
    }
  });

  await commitBertahap(operasi);
  bersihkanCacheKonten(catatan.id);
};

/**
 * Muat konten penuh catatan yang tersimpan terpecah (chunks).
 * Mengembalikan null bila catatan tidak punya potongan.
 */
export const muatKontenPenuh = async (noteId: string): Promise<string | null> => {
  if (cacheKonten.has(noteId)) return cacheKonten.get(noteId) as string;

  const snap = await getDocs(
    query(collection(db, 'notes', noteId, 'chunks'), orderBy('index', 'asc'))
  );
  if (snap.empty) return null;

  const konten = gabungPotongan(snap.docs.map(d => (d.data().content as string) ?? ''));
  cacheKonten.set(noteId, konten);
  return konten;
};

/** Hapus catatan beserta semua potongannya dari Firestore. */
export const hapusCatatanDariServer = async (noteId: string): Promise<void> => {
  const operasi: Operasi[] = [];

  const chunks = await getDocs(collection(db, 'notes', noteId, 'chunks'));
  chunks.forEach(d => operasi.push((batch) => batch.delete(d.ref)));
  operasi.push((batch) => batch.delete(doc(db, 'notes', noteId)));

  await commitBertahap(operasi);
  bersihkanCacheKonten(noteId);
};
