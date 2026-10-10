import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Bug, X, Copy, Trash2, CheckCircle2, XCircle, AlertTriangle,
  Info, ChevronDown, ChevronUp, ClipboardCheck
} from 'lucide-react';
import { syncDebug, SyncLevel, SyncLogEntry } from '../utils/syncDebug';

type FilterAktif = 'semua' | SyncLevel;

const GAYA_LEVEL: Record<SyncLevel, { label: string; kelas: string; ikon: React.ReactNode }> = {
  info: { label: 'INFO', kelas: 'text-sky-300 bg-sky-500/15 border-sky-500/30', ikon: <Info size={11} /> },
  success: { label: 'SUKSES', kelas: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30', ikon: <CheckCircle2 size={11} /> },
  warn: { label: 'WARN', kelas: 'text-amber-300 bg-amber-500/15 border-amber-500/30', ikon: <AlertTriangle size={11} /> },
  error: { label: 'ERROR', kelas: 'text-red-300 bg-red-500/15 border-red-500/30', ikon: <XCircle size={11} /> },
};

function formatJam(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function DetailError({ detail }: { detail: unknown }) {
  const [buka, setBuka] = useState(false);
  let teks = '';
  try {
    teks = JSON.stringify(detail, null, 2);
  } catch {
    teks = '<detail tidak bisa ditampilkan>';
  }
  const pendek = teks.length > 120 ? `${teks.slice(0, 120)}…` : teks;

  return (
    <div className="mt-1">
      <pre className="text-[10px] leading-snug text-slate-400 whitespace-pre-wrap break-all font-mono">
        {buka ? teks : pendek}
      </pre>
      {teks.length > 120 && (
        <button
          onClick={(e) => { e.stopPropagation(); setBuka(b => !b); }}
          className="mt-0.5 text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
        >
          {buka ? <><TutupIkon /> sembunyikan</> : <><ChevronDown size={10} /> lihat detail lengkap</>}
        </button>
      )}
    </div>
  );
}

function TutupIkon() {
  return <ChevronUp size={10} />;
}

export function SyncDebugPanel() {
  const entri = useSyncExternalStore(syncDebug.berlangganan, syncDebug.ambilSnapshot);
  const [terbuka, setTerbuka] = useState(false);
  const [filter, setFilter] = useState<FilterAktif>('semua');
  const [tersalin, setTersalin] = useState(false);
  const [sudahDitutup, setSudahDitutup] = useState(false);
  const daftarRef = useRef<HTMLDivElement>(null);

  const jumlah = useMemo(() => ({
    sukses: entri.filter(e => e.level === 'success').length,
    warn: entri.filter(e => e.level === 'warn').length,
    error: entri.filter(e => e.level === 'error').length,
  }), [entri]);

  // Catat perubahan status jaringan browser (sumber masalah sync yang sering terlewat)
  useEffect(() => {
    const online = () => syncDebug.info('sistem', 'JARINGAN_ONLINE', 'Koneksi jaringan kembali tersedia');
    const offline = () => syncDebug.warn('sistem', 'JARINGAN_OFFLINE', 'Perangkat kehilangan koneksi jaringan — tulis akan tertunda di Firestore cache');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  // Buka panel otomatis HANYA jika error baru muncul (setelah panel sengaja ditutup tidak dibuka lagi)
  useEffect(() => {
    if (!terbuka && !sudahDitutup && entri.length > 0 && entri[entri.length - 1].level === 'error') {
      setTerbuka(true);
    }
  }, [entri, terbuka, sudahDitutup]);

  // Auto-scroll ke peristiwa terbaru
  useEffect(() => {
    if (terbuka && daftarRef.current) {
      daftarRef.current.scrollTop = daftarRef.current.scrollHeight;
    }
  }, [entri, terbuka]);

  const terlihat = filter === 'semua' ? entri : entri.filter(e => e.level === filter);

  const salinLaporan = async () => {
    const laporan = syncDebug.buatLaporan();
    try {
      await navigator.clipboard.writeText(laporan);
    } catch {
      // Fallback untuk peramban/blokir clipboard
      const ta = document.createElement('textarea');
      ta.value = laporan;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* diabaikan */ }
      document.body.removeChild(ta);
    }
    setTersalin(true);
    setTimeout(() => setTersalin(false), 2200);
  };

  const tutup = () => {
    setTerbuka(false);
    setSudahDitutup(true);
  };

  const bukaLagi = () => {
    setTerbuka(true);
    setSudahDitutup(false);
  };

  return (
    <>
      {/* Tombol pelampung */}
      <button
        onClick={() => (terbuka ? tutup() : bukaLagi())}
        title="Panel Debug Sinkronisasi"
        aria-label="Panel Debug Sinkronisasi"
        className="fixed bottom-4 right-4 z-[9999] h-12 w-12 rounded-full bg-slate-900 text-white shadow-2xl shadow-slate-900/40 border border-slate-700/60 flex items-center justify-center active:scale-90 transition-transform hover:bg-slate-800"
      >
        <Bug size={20} />
        {jumlah.error > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white dark:border-slate-900">
            {jumlah.error > 99 ? '99+' : jumlah.error}
          </span>
        )}
      </button>

      {/* Panel */}
      {terbuka && (
        <div className="fixed bottom-20 right-4 left-4 sm:left-auto sm:right-4 z-[9999] sm:w-[400px] max-h-[72vh] flex flex-col rounded-2xl border border-slate-700/70 bg-slate-900 text-slate-100 shadow-2xl shadow-black/50 overflow-hidden">
          {/* Kepala */}
          <div className="px-3 py-2.5 border-b border-slate-700/70 flex items-center justify-between gap-2 bg-slate-800/60">
            <div className="flex items-center gap-2 min-w-0">
              <Bug size={15} className="text-red-400 shrink-0" />
              <span className="font-bold text-sm truncate">Debug Sinkronisasi</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={salinLaporan}
                title="Salin laporan lengkap ke clipboard"
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
              >
                {tersalin ? <><ClipboardCheck size={12} /> Tersalin!</> : <><Copy size={12} /> Salin Laporan</>}
              </button>
              <button
                onClick={() => { syncDebug.bersihkan(); setTersalin(false); }}
                title="Hapus semua log"
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-700/60"
              >
                <Trash2 size={13} />
              </button>
              <button
                onClick={tutup}
                title="Tutup panel"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Ringkasan & filter */}
          <div className="px-3 py-2 border-b border-slate-700/50 flex flex-wrap items-center gap-1.5 bg-slate-900/60">
            <span className="text-[10px] font-mono text-slate-400 mr-0.5">
              {entri.length} peristiwa
            </span>
            {jumlah.error > 0 && (
              <span className="text-[10px] font-bold text-red-300 bg-red-500/15 border border-red-500/30 rounded px-1.5 py-0.5">{jumlah.error} error</span>
            )}
            {jumlah.warn > 0 && (
              <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">{jumlah.warn} warn</span>
            )}
            {jumlah.sukses > 0 && (
              <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-1.5 py-0.5">{jumlah.sukses} sukses</span>
            )}
            <div className="flex-1" />
            {(['semua', 'error', 'warn', 'success'] as FilterAktif[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
                  filter === f
                    ? 'bg-slate-100 text-slate-900 border-slate-100 font-bold'
                    : 'text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                {f === 'semua' ? 'Semua' : f === 'success' ? 'Sukses' : f.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Daftar log */}
          <div ref={daftarRef} className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1.5">
            {terlihat.length === 0 ? (
              <p className="text-center text-[11px] text-slate-500 py-6">
                {entri.length === 0
                  ? 'Belum ada peristiwa sinkronisasi. Coba edit catatan atau tekan ikon awan.'
                  : 'Tidak ada peristiwa untuk filter ini.'}
              </p>
            ) : (
              terlihat.map((e: SyncLogEntry) => (
                <div key={e.id} className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">{formatJam(e.waktu)}</span>
                    <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide border rounded px-1 py-[1px] shrink-0 ${GAYA_LEVEL[e.level].kelas}`}>
                      {GAYA_LEVEL[e.level].ikon}
                      {GAYA_LEVEL[e.level].label}
                    </span>
                    <span className="text-[10px] font-mono text-violet-300 shrink-0">[{e.kategori}]</span>
                    <span className="text-[10px] font-mono font-bold text-sky-300 break-all">{e.aksi}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-slate-200 mt-0.5 break-words">{e.pesan}</p>
                  {e.detail !== undefined && <DetailError detail={e.detail} />}
                </div>
              ))
            )}
          </div>

          {/* Kaki */}
          <div className="px-3 py-1.5 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-500 bg-slate-800/40">
            <span>
              Jaringan: <span className={navigator.onLine ? 'text-emerald-400' : 'text-red-400'}>{navigator.onLine ? 'online' : 'OFFLINE'}</span>
            </span>
            <span>Tekan "Salin Laporan" lalu kirim untuk diagnosa</span>
          </div>
        </div>
      )}
    </>
  );
}
