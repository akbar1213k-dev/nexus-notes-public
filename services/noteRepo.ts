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
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import type { Note } from '../types';
import { auth, db } from './firebase';
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
    // DEBUG: periksa tahap pembacaan chunks
    console.log('[SYNC-DEBUG] MULAI_BACA_CHUNKS', {
      id: catatan.id,
      title: catatan.title,
      userId,
    });

    let potonganLama;

    try {
      potonganLama = await getDocs(
        query(
          collection(db, 'notes', catatan.id, 'chunks'),
          where('userId', '==', userId)
        )
      );

      console.log('[SYNC-DEBUG] BERHASIL_BACA_CHUNKS', {
        id: catatan.id,
        jumlahChunks: potonganLama.size,
      });
    } catch (error: any) {
      console.error('[SYNC-DEBUG] GAGAL_BACA_CHUNKS', {
        id: catatan.id,
        code: error?.code,
        message: error?.message,
      });

      throw error;
    }

    if (!potonganLama.empty) {
      await commitBertahap(
        potonganLama.docs.map(d => (batch) => batch.delete(d.ref))
      );
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
      batch.set(doc(db, 'notes', catatan.id, 'chunks', String(index)), { index, content: isi, userId })
    );
  });

  // Hapus potongan lebih dari jumlah baru (kasus content mengecil)
  const potonganLama = await getDocs(
    query(
      collection(db, 'notes', catatan.id, 'chunks'),
      where('userId', '==', userId)
    )
  );
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
 *
 * LOG DIAGNOSTIK SEMENTARA:
 * Hapus log setelah penyebab masalah ditemukan.
 */
export const muatKontenPenuh = async (
  noteId: string
): Promise<string | null> => {
  const userId = auth.currentUser?.uid;

  console.info('[CHUNK-DIAG] MULAI_BACA', {
    noteId,
    userId: userId ?? null,
    waktu: new Date().toISOString(),
  });

  if (!userId) {
    console.error('[CHUNK-DIAG] AUTH_TIDAK_AKTIF', { noteId });

    throw new Error(
      'Tidak dapat memuat isi catatan: sesi Firebase belum aktif.'
    );
  }

  if (cacheKonten.has(noteId)) {
    const kontenCache = cacheKonten.get(noteId) as string;

    console.info('[CHUNK-DIAG] CACHE_DIGUNAKAN', {
      noteId,
      ukuranKarakter: kontenCache.length,
      ukuranByte: ukuranByte(kontenCache),
    });

    return kontenCache;
  }

  try {
    const snap = await getDocs(
      query(
        collection(db, 'notes', noteId, 'chunks'),
        where('userId', '==', userId),
        orderBy('index', 'asc')
      )
    );

    console.info('[CHUNK-DIAG] QUERY_SELESAI', {
      noteId,
      jumlahChunksDitemukan: snap.size,
      idDokumen: snap.docs.map(d => d.id),
      indexChunks: snap.docs.map(d => d.data().index),
    });

    if (snap.empty) {
      console.warn('[CHUNK-DIAG] CHUNK_KOSONG', {
        noteId,
        userId,
      });

      return null;
    }

    const potongan = snap.docs.map(
      d => (d.data().content as string) ?? ''
    );

    const konten = gabungPotongan(potongan);
    const ukuranHasilByte = ukuranByte(konten);

    console.info('[CHUNK-DIAG] GABUNG_SELESAI', {
      noteId,
      jumlahChunks: potongan.length,
      ukuranKarakter: konten.length,
      ukuranByte: ukuranHasilByte,
      kontenKosong: konten.length === 0,
    });

    cacheKonten.set(noteId, konten);

    return konten;
  } catch (err) {
    console.error('[CHUNK-DIAG] BACA_CHUNK_ERROR', {
      noteId,
      userId,
      error:
        err instanceof Error ? err.message : String(err),
      code:
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code?: string }).code
          : undefined,
    });

    throw err;
  }
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
