// --- HELPER: Penyimpanan catatan ke Firestore (inline vs chunks) ---
// Semua penulisan catatan ke server WAJIB lewat file ini agar keputusan
// inline/potongan konsisten, dan catatan besar tidak gagal tersimpan
// karena batas 1 MiB per dokumen Firestore.

import {
  collection,
  doc,
  getDoc,
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
 * Memuat dan memvalidasi konten penuh catatan yang disimpan sebagai chunks.
 *
 * Mengembalikan null jika dokumen utama tidak memiliki metadata chunk
 * atau tidak ditemukan chunk.
 *
 * Melempar error jika metadata, jumlah chunk, indeks, atau ukuran konten
 * tidak konsisten.
 */
export const muatKontenPenuh = async (
  noteId: string
): Promise<string | null> => {
  const userId = auth.currentUser?.uid;

  if (!userId) {
    throw new Error(
      'Tidak dapat memuat isi catatan: sesi Firebase belum aktif.'
    );
  }

  // Baca metadata utama agar validasi menggunakan informasi terbaru.
  const dokumenUtama = await getDoc(doc(db, 'notes', noteId));

  if (!dokumenUtama.exists()) {
    throw new Error(
      `Tidak dapat memuat isi catatan: dokumen ${noteId} tidak ditemukan.`
    );
  }

  const metadata = dokumenUtama.data() as Note;

  // Fungsi ini hanya digunakan untuk catatan yang mempunyai metadata chunk.
  if (!metadata.chunkCount || metadata.chunkCount <= 0) {
    return null;
  }

  const jumlahChunkDiharapkan = metadata.chunkCount;

  const snap = await getDocs(
    query(
      collection(db, 'notes', noteId, 'chunks'),
      where('userId', '==', userId),
      orderBy('index', 'asc')
    )
  );

  if (snap.empty) {
    throw new Error(
      `Isi catatan ${noteId} tidak dapat dimuat: ` +
      `metadata menyatakan ${jumlahChunkDiharapkan} chunk, tetapi tidak ditemukan.`
    );
  }

  // Pastikan jumlah chunk sesuai dengan metadata dokumen utama.
  if (snap.size !== jumlahChunkDiharapkan) {
    throw new Error(
      `Isi catatan ${noteId} tidak lengkap: ` +
      `diharapkan ${jumlahChunkDiharapkan} chunk, ditemukan ${snap.size}.`
    );
  }

  const potongan: string[] = [];

  // Pastikan indeks berurutan dan setiap chunk memiliki konten string.
  snap.docs.forEach((dokumen, posisi) => {
    const data = dokumen.data();

    if (data.index !== posisi) {
      throw new Error(
        `Isi catatan ${noteId} tidak lengkap: ` +
        `indeks chunk pada posisi ${posisi} adalah ${data.index}.`
      );
    }

    if (typeof data.content !== 'string') {
      throw new Error(
        `Isi catatan ${noteId} tidak valid: ` +
        `konten chunk indeks ${posisi} bukan string.`
      );
    }

    potongan.push(data.content);
  });

  const konten = gabungPotongan(potongan);
  const ukuranHasilByte = ukuranByte(konten);

  // Jika tersedia, contentSize harus cocok dengan hasil penggabungan.
  if (
    typeof metadata.contentSize === 'number' &&
    ukuranHasilByte !== metadata.contentSize
  ) {
    throw new Error(
      `Ukuran isi catatan ${noteId} tidak cocok: ` +
      `metadata ${metadata.contentSize} byte, ` +
      `hasil penggabungan ${ukuranHasilByte} byte.`
    );
  }

  // Cache hanya diisi setelah seluruh validasi berhasil.
  cacheKonten.set(noteId, konten);

  return konten;
};

// Kode klasifikasi hasil penghapusan yang aman dan stabil untuk dipakai caller.
const KODE_HAPUS = {
  UID_KOSONG: 'HAPUS_CATATAN_UID_KOSONG',
  PARENT_TIDAK_DITEMUKAN: 'HAPUS_CATATAN_PARENT_TIDAK_DITEMUKAN',
  PARENT_USERID_HILANG: 'HAPUS_CATATAN_PARENT_USERID_HILANG',
  PARENT_KEPEMILIKAN_TIDAK_COCOK: 'HAPUS_CATATAN_PARENT_KEPEMILIKAN_TIDAK_COCOK',
  BACA_PARENT_GAGAL: 'HAPUS_CATATAN_BACA_PARENT_GAGAL',
  BACA_CHUNK_GAGAL: 'HAPUS_CATATAN_BACA_CHUNK_GAGAL',
  CHUNK_KEPEMILIKAN_TIDAK_COCOK: 'HAPUS_CATATAN_CHUNK_KEPEMILIKAN_TIDAK_COCOK',
  CHUNK_JUMLAH_TIDAK_COCOK: 'HAPUS_CATATAN_CHUNK_JUMLAH_TIDAK_COCOK',
  BATCH_GAGAL: 'HAPUS_CATATAN_BATCH_GAGAL',
} as const;

function buatKesalahanHapus(kode: string, pesan: string, kodeAsli?: string): Error {
  const kesalahan = new Error(pesan) as Error & { code?: string; codeAsli?: string };
  kesalahan.code = kode;
  if (kodeAsli) kesalahan.codeAsli = kodeAsli;
  return kesalahan;
}

/** Hapus catatan beserta semua potongannya dari Firestore dengan verifikasi kepemilikan. */
export const hapusCatatanDariServer = async (
  noteId: string,
  expectedUserId: string
): Promise<void> => {
  if (!expectedUserId) {
    throw buatKesalahanHapus(
      KODE_HAPUS.UID_KOSONG,
      'UID terautentikasi tidak tersedia untuk penghapusan aman.'
    );
  }

  let parentSnap;
  try {
    parentSnap = await getDoc(doc(db, 'notes', noteId));
  } catch (err: any) {
    throw buatKesalahanHapus(
      KODE_HAPUS.BACA_PARENT_GAGAL,
      `Gagal membaca dokumen utama catatan ${noteId}: ${err?.message ?? err}`,
      err?.code
    );
  }

  if (!parentSnap.exists()) {
    throw buatKesalahanHapus(
      KODE_HAPUS.PARENT_TIDAK_DITEMUKAN,
      `Dokumen utama catatan ${noteId} tidak ditemukan.`
    );
  }

  const parentData = parentSnap.data() as Partial<Note>;
  if (!parentData.userId) {
    throw buatKesalahanHapus(
      KODE_HAPUS.PARENT_USERID_HILANG,
      `Dokumen utama catatan ${noteId} tidak memiliki userId.`
    );
  }
  if (parentData.userId !== expectedUserId) {
    throw buatKesalahanHapus(
      KODE_HAPUS.PARENT_KEPEMILIKAN_TIDAK_COCOK,
      `Kepemilikan dokumen utama catatan ${noteId} tidak cocok.`
    );
  }

  let chunksSnap;
  try {
    // Filter userId wajib agar query dapat dibuktikan sesuai Firestore Rules
    // (allow read: request.auth.uid == resource.data.userId). Pola ini sama
    // dengan jalur baca chunk yang sudah bekerja di muatKontenPenuh().
    chunksSnap = await getDocs(
      query(
        collection(db, 'notes', noteId, 'chunks'),
        where('userId', '==', expectedUserId)
      )
    );
  } catch (err: any) {
    throw buatKesalahanHapus(
      KODE_HAPUS.BACA_CHUNK_GAGAL,
      `Gagal membaca potongan catatan ${noteId}: ${err?.message ?? err}`,
      err?.code
    );
  }

  // Catatan inline/kecil yang tidak memiliki subcollection chunks tetap sah.
  // Bila chunks ada, setiap chunk wajib dimiliki oleh expectedUserId.
  chunksSnap.forEach((d) => {
    const chunkData = d.data() as { userId?: string };
    if (!chunkData.userId || chunkData.userId !== expectedUserId) {
      throw buatKesalahanHapus(
        KODE_HAPUS.CHUNK_KEPEMILIKAN_TIDAK_COCOK,
        `Kepemilikan potongan catatan ${noteId} tidak dapat diverifikasi.`
      );
    }
  });

  // Validasi kelengkapan: metadata parent harus cocok dengan potongan milik
  // user yang benar-benar terbaca. Jika tidak cocok, jangan hapus apa pun.
  if (
    typeof parentData.chunkCount === 'number' &&
    chunksSnap.size !== parentData.chunkCount
  ) {
    throw buatKesalahanHapus(
      KODE_HAPUS.CHUNK_JUMLAH_TIDAK_COCOK,
      `Jumlah potongan catatan ${noteId} tidak cocok: ` +
      `metadata ${parentData.chunkCount}, ditemukan ${chunksSnap.size}.`
    );
  }

  const operasi: Operasi[] = [];
  chunksSnap.forEach(d =>
    operasi.push((batch) => batch.delete(d.ref))
  );
  operasi.push((batch) => batch.delete(doc(db, 'notes', noteId)));

  try {
    await commitBertahap(operasi);
  } catch (err: any) {
    throw buatKesalahanHapus(
      KODE_HAPUS.BATCH_GAGAL,
      `Batch penghapusan catatan ${noteId} gagal: ${err?.message ?? err}`,
      err?.code
    );
  }

  bersihkanCacheKonten(noteId);
};
