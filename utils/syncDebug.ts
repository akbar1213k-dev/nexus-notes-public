// ============================================================
//  MESIN DEBUG SINKRONISASI
//  Mencatat SEMUA peristiwa sinkronisasi (sukses maupun gagal)
//  ke buffer memori, agar bisa disalin menjadi laporan diagnosa.
//  Tampilan panel: components/SyncDebugPanel.tsx
// ============================================================

export type SyncLevel = 'info' | 'success' | 'warn' | 'error';
export type SyncKategori = 'auth' | 'listener' | 'tulis' | 'hapus' | 'lokal' | 'sistem';

export interface SyncLogEntry {
  id: number;
  waktu: number; // epoch milliseconds
  level: SyncLevel;
  kategori: SyncKategori;
  aksi: string;
  pesan: string;
  detail?: unknown;
}

// Ringkasan status catatan: lokal vs Firestore (untuk panel debug)
export interface StatistikSinkron {
  server: number;            // catatan yang versi terbarunya sudah ada di Firestore
  hanyaLokal: number;        // catatan yang hanya ada di antrean lokal (belum pernah tersinkron)
  versiLokalMenang: number;  // ada di server, tapi versi lokal lebih baru (menunggu diunggah)
  total: number;             // gabungan unik lokal + server
  modeOffline: boolean;      // mode lokal penuh (user 'offline-local') — tidak ada sinkronisasi
  diperbaruiPada: number;    // epoch ms statistik terakhir dihitung
}

type Pendengar = () => void;

const BATAS_ENTRI = 300;

// Ubah Error / objek aneh menjadi bentuk yang aman untuk ditampilkan & dicetak
function ringkas(detail: unknown): unknown {
  if (detail instanceof Error) {
    return {
      nama: detail.name,
      pesan: detail.message,
      code: (detail as any).code,
      stack: (detail as any).stack,
    };
  }
  return detail;
}

function formatWaktu(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function formatWaktuLengkap(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class PencatatSinkronisasi {
  private entri: SyncLogEntry[] = [];
  private snapshot: SyncLogEntry[] = [];
  private pendengar = new Set<Pendengar>();
  private urutan = 0;
  private jumlahError = 0;
  private statistik: StatistikSinkron | null = null;

  catat(
    level: SyncLevel,
    kategori: SyncKategori,
    aksi: string,
    pesan: string,
    detail?: unknown
  ): void {
    const baru: SyncLogEntry = {
      id: ++this.urutan,
      waktu: Date.now(),
      level,
      kategori,
      aksi,
      pesan,
      detail: detail === undefined ? undefined : ringkas(detail),
    };

    this.entri.push(baru);
    if (this.entri.length > BATAS_ENTRI) {
      this.entri.splice(0, this.entri.length - BATAS_ENTRI);
    }
    if (level === 'error') this.jumlahError++;

    // Snapshot baru (array baru) agar useSyncExternalStore mendeteksi perubahan
    this.snapshot = [...this.entri];
    this.pendengar.forEach((fn) => fn());

    // Tetap tampil di Console DevTools agar konsisten dengan perilaku lama
    const gaya = level === 'error' ? 'color:#dc2626;font-weight:bold'
      : level === 'warn' ? 'color:#d97706;font-weight:bold'
      : level === 'success' ? 'color:#059669'
      : 'color:#2563eb';
    console.log(
      `%c[SYNC][${kategori.toUpperCase()}][${aksi}]%c ${pesan}`,
      `background:#0f172a;color:#fff;padding:2px 4px;border-radius:3px;${gaya}`,
      gaya,
      detail ?? ''
    );
  }

  info(kategori: SyncKategori, aksi: string, pesan: string, detail?: unknown): void {
    this.catat('info', kategori, aksi, pesan, detail);
  }

  sukses(kategori: SyncKategori, aksi: string, pesan: string, detail?: unknown): void {
    this.catat('success', kategori, aksi, pesan, detail);
  }

  warn(kategori: SyncKategori, aksi: string, pesan: string, detail?: unknown): void {
    this.catat('warn', kategori, aksi, pesan, detail);
  }

  error(kategori: SyncKategori, aksi: string, pesan: string, detail?: unknown): void {
    this.catat('error', kategori, aksi, pesan, detail);
    console.error(`[SYNC][${kategori.toUpperCase()}][${aksi}] ${pesan}`, detail ?? '');
  }

  // --- API untuk React (useSyncExternalStore) ---
  berlangganan = (fn: Pendengar): (() => void) => {
    this.pendengar.add(fn);
    return () => { this.pendengar.delete(fn); };
  };

  ambilSnapshot = (): SyncLogEntry[] => this.snapshot;

  // --- API statistik lokal vs Firestore (dipakai panel debug) ---
  catatStatistik(s: StatistikSinkron): void {
    this.statistik = s;
    this.pendengar.forEach((fn) => fn());
  }

  resetStatistik(): void {
    this.statistik = null;
    this.pendengar.forEach((fn) => fn());
  }

  ambilStatistik = (): StatistikSinkron | null => this.statistik;

  get totalError(): number {
    return this.jumlahError;
  }

  bersihkan(): void {
    this.entri = [];
    this.snapshot = [];
    this.jumlahError = 0;
    this.statistik = null;
    this.pendengar.forEach((fn) => fn());
  }

  // --- Laporan teks siap-copy untuk dikirim ke orang diagnosa ---
  buatLaporan(): string {
    const baris: string[] = [];
    const isi = (label: string, nilai: string) => baris.push(`${label.padEnd(20, ' ')}: ${nilai}`);

    let uid = '(tidak ada)';
    let autoSync = '-';
    let interval = '-';
    let antreanCatatan = 0;
    let antreanFolder = 0;
    try {
      uid = localStorage.getItem('nexus_user_uid') || '(tidak ada)';
      autoSync = localStorage.getItem('nexus_auto_sync') ?? '-';
      interval = localStorage.getItem('nexus_sync_interval') ?? '-';
      antreanCatatan = JSON.parse(localStorage.getItem('nexus_backup_notes') || '[]').length;
      antreanFolder = JSON.parse(localStorage.getItem('nexus_backup_folders') || '[]').length;
    } catch { /* localStorage tidak tersedia */ }

    const hitung = (lv: SyncLevel) => this.entri.filter((e) => e.level === lv).length;

    baris.push('===== LAPORAN DEBUG SINKRONISASI NEXUS NOTES =====');
    isi('Waktu cetak', formatWaktuLengkap(Date.now()));
    isi('URL', typeof location !== 'undefined' ? location.href : '-');
    isi('Peramban', typeof navigator !== 'undefined' ? navigator.userAgent : '-');
    isi('Status jaringan', typeof navigator !== 'undefined'
      ? (navigator.onLine ? 'online' : 'OFFLINE')
      : '-');
    isi('UID tersimpan', uid);
    isi('Auto sync', autoSync);
    isi('Interval sync (ms)', interval);
    isi('Antrean lokal', `${antreanCatatan} catatan, ${antreanFolder} folder`);
    const st = this.statistik;
    isi('Tersinkron Firestore', st ? `${st.server} catatan` : '(belum diperbarui)');
    isi('Belum tersinkron', st
      ? `${st.hanyaLokal + st.versiLokalMenang} catatan (${st.hanyaLokal} hanya lokal, ${st.versiLokalMenang} versi lokal lebih baru)`
      : '(belum diperbarui)');
    isi('Total catatan', st ? `${st.total} catatan${st.modeOffline ? ' (mode offline — tidak disinkronkan ke server)' : ''}` : '(belum diperbarui)');
    baris.push('-'.repeat(64));
    isi('Ringkasan', `${this.entri.length} peristiwa | ${hitung('success')} sukses | ${hitung('warn')} warn | ${hitung('error')} error | ${hitung('info')} info`);
    baris.push('-'.repeat(64));
    baris.push('RIWAYAT PERISTIWA (terlama -> terbaru):');

    if (this.entri.length === 0) {
      baris.push('(belum ada peristiwa yang tercatat)');
    } else {
      this.entri.forEach((e) => {
        const tag = e.level.toUpperCase().padEnd(7, ' ');
        let barisUtama = `[${formatWaktu(e.waktu)}] ${tag} [${e.kategori}] ${e.aksi} :: ${e.pesan}`;
        if (e.detail !== undefined) {
          try {
            barisUtama += ` | DETAIL: ${JSON.stringify(e.detail)}`;
          } catch {
            barisUtama += ' | DETAIL: <tidak bisa diserialisasi>';
          }
        }
        baris.push(barisUtama);
      });
    }

    baris.push('===== AKHIR LAPORAN =====');
    return baris.join('\n');
  }
}

export const syncDebug = new PencatatSinkronisasi();
