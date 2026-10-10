// --- HELPER: Pemecahan content besar untuk batas 1 MiB Firestore ---
// Firestore menolak dokumen berukuran > 1.048.576 byte (error
// "invalid-argument"). Catatan dengan content melewati ambang disimpan
// terpotong-potong di subcollection notes/{id}/chunks, tetapi saat dibuka
// kembali digabung menjadi satu catatan utuh bagi user.

import type { Note } from '../types';

// Ukuran tiap potongan (byte). 700 KB menyisakan ruang aman untuk metadata
// dan overhead batas dokumen 1 MiB.
export const UKURAN_POTONGAN = 700 * 1024;

// Ambang: content <= 800 KB tetap disimpan utuh di dokumen utama (inline),
// persis seperti perilaku sebelumnya.
export const AMBANG_CHUNK = 800 * 1024;

const encoder = new TextEncoder();

/** Ukuran string dalam byte UTF-8 (jumlah karakter != jumlah byte). */
export const ukuranByte = (teks: string): number => {
  if (!teks) return 0;
  return encoder.encode(teks).length;
};

/** True jika content catatan perlu disimpan dalam potongan-potongan. */
export const perluChunk = (note: Note): boolean =>
  !!note.content && ukuranByte(note.content) > AMBANG_CHUNK;

/**
 * Pecah content menjadi potongan yang TIDAK putus di tengah karakter
 * multi-byte UTF-8 maupun pasangan surrogate (emoji, aksara non-ASCII).
 */
export const pecahContent = (content: string): string[] => {
  const bytes = encoder.encode(content);
  if (bytes.length <= AMBANG_CHUNK) return [content];

  const potongan: string[] = [];
  const decoder = new TextDecoder();
  let mulai = 0;
  while (mulai < bytes.length) {
    let selesai = Math.min(mulai + UKURAN_POTONGAN, bytes.length);
    // Mundur selagi byte pada posisi 'selesai' masih kelanjutan karakter
    // multi-byte (pola bit 10xxxxxx) agar tidak ada karakter yang terpotong.
    while (selesai > mulai + 1 && selesai < bytes.length && (bytes[selesai] & 0xc0) === 0x80) {
      selesai--;
    }
    potongan.push(decoder.decode(bytes.subarray(mulai, selesai)));
    mulai = selesai;
  }
  return potongan;
};

/** Gabung potongan kembali menjadi satu string utuh. */
export const gabungPotongan = (potongan: string[]): string => potongan.join('');

/** Cuplikan teks polos untuk kartu catatan (dipakai saat content = null). */
export const buatPreview = (content: string, panjang = 300): string =>
  content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, panjang);

/** Pesan error bila mindmapData terlalu besar (belum dichunking). */
export const periksaUkuranMindmap = (note: Note): string | null => {
  if (!note.mindmapData) return null;
  const byteMindmap = ukuranByte(JSON.stringify(note.mindmapData));
  return byteMindmap > AMBANG_CHUNK
    ? `Data mindmap (${(byteMindmap / 1048576).toFixed(2)} MB) terlalu besar untuk disinkronkan — batas maksimal Firestore ±1 MB per dokumen. Mohon kecilkan mindmap ini.`
    : null;
};
