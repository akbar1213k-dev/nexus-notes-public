import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import { Note, EditorHandle, HistoryChain, HistoryWordDiff } from '../types';
import { makePatch, applyPatch, replayChain } from '../utils/diff';
import { getHistoryChain, saveHistoryChain, cleanupLegacyLocalStorage } from '../utils/historyStore';
import { exportNetworkAsJSON } from '../utils/networkExport';
import { applyLock, removeLock } from '../utils/lockManager';
import type { LockAction } from '../utils/lockManager';
import { 
  Image as ImageIcon, Table, AtSign, 
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, CheckSquare, 
  Indent, Outdent, MoreHorizontal,
  Plus, Trash2, Home, Network, Copy, Check,
  Scissors, Scan, MoreVertical,
  Undo, Redo, Sliders, Code,
  Search, X, ChevronUp, ChevronDown, History, Play, Eye, Download,
Upload, Replace, ReplaceAll, Clipboard, AlertTriangle, Lock, Unlock,
} from 'lucide-react';
interface EditorProps {
  note: Note;
  allNotes: Note[];
  onUpdate: (updatedNote: Note) => void;
  onCreateNewNote: (title: string) => Promise<string>;
  onLinkClick: (noteId: string) => void;
  onLinkLongPress: (noteId: string) => void;
  onGoHome: () => void;
  onToggleImmersive: (isImmersive: boolean) => void; // Kabel dari App.tsx
  onArchiveWholeContent?: (html: string, mode: 'cut' | 'delete') => Promise<boolean>;
  onArchiveSelectionContent?: (html: string, sourceContent: string, removeSource: boolean) => Promise<boolean>;
  onSelectionAvailabilityChange?: (hasSelection: boolean) => void;
}
type ToolbarMenu = 'NONE' | 'FORMAT' | 'LIST' | 'TABLE' | 'IMAGE' | 'LOCK';

// === FUNGSI BARU: Membersihkan dan merapikan (Pretty Print) HTML ===
const formatAndCleanHTML = (html: string) => {
    let formatted = '';
    let pad = 0;
    let divDepth = 0; // Menghitung kedalaman tag div untuk menentukan level 1, 2, 3, dst.
    
    // 1. Bersihkan karakter gaib/kosong penyita spasi
    let clean = html.replace(/[\u200B-\u200D\uFEFF\u200E]/g, '');
    
    // 2. Bersihkan variabel Tailwind (--tw-...)
    clean = clean.replace(/--tw-[a-zA-Z0-9-]+:\s*[^;]+;\s*/g, '');
    
    // 3. Hapus atribut style jika isinya menjadi kosong
    clean = clean.replace(/style="\s*"/g, '');

    // (Spasi pada <br> telah dibatalkan/dihapus sesuai permintaan)

    // 4. Tambahkan baris baru (enter) di antara tag penutup dan pembuka
    clean = clean.replace(/></g, '>\n<');
    
    // 5. Logika Indentasi dan Spasi Div
    const lines = clean.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        
        // A. Cek apakah baris ini adalah tag PENUTUP div
        const isClosingDiv = line.match(/^<\/div>/i);
        if (isClosingDiv) {
            // Turunkan level kedalaman div SEBELUM diproses
            divDepth = Math.max(0, divDepth - 1);
        }

        // Turunkan indentasi visual untuk semua tag penutup
        if (line.match(/^<\/[a-zA-Z0-9]+>/)) {
            pad = Math.max(0, pad - 1);
        }
        
        // B. Cek apakah baris ini adalah tag PEMBUKA div
        const isOpeningDiv = line.match(/^<div[^>]*>/i);
        
        // --- ATURAN SPASI: SEBELUM PEMBUKA DIV (Hanya Level 1 & 2) ---
        // Karena divDepth bertambah setelah ini, maka level 1 = 0, level 2 = 1. (Berarti < 2)
        if (isOpeningDiv && divDepth < 2) {
            formatted += '\n'; 
        }

        // Tulis baris kode ke variabel hasil (dengan spasi menjorok / indent)
        formatted += '  '.repeat(pad) + line + '\n';
        
        // --- ATURAN SPASI: SESUDAH PENUTUP DIV (Hanya Level 1 & 2) ---
        if (isClosingDiv && divDepth < 2) {
            formatted += '\n'; 
        }

        // Naikkan indentasi visual jika baris ini tag pembuka (Bukan tag mandiri seperti img/br/input)
        if (line.match(/^<[^/?][^>]*>/) && 
            !line.match(/<\/[a-zA-Z0-9]+>$/) && 
            !line.match(/<[^>]+(?:hr|br|img|input)[^>]*>/i)) {
            pad += 1;
        }

        // Jika ini tag PEMBUKA div, naikkan level kedalaman div SETELAH diproses
        if (isOpeningDiv) {
            divDepth += 1;
        }
    }
    
    // Bersihkan enter berlebih (jika ada lebih dari 2 enter berturut-turut jadikan 1 spasi enter saja)
    return formatted.replace(/\n{3,}/g, '\n\n').trim();
};

// --- MESIN WAKTU: Tipe Entri History Di Memori ---
// Setiap entri di RAM selalu membawa `content` (konten penuh sudah dimaterialisasi),
// sementara di penyimpanan hanya index 0 yang menyimpan content penuh ('base'),
// sisanya menyimpan selisih ('patch').
interface HistEntry {
  kind: 'base' | 'patch';
  time: number;
  content: string;
  patchText?: string;
  preview: string;
  charCount: number;
  wordDiff: HistoryWordDiff | null;
}

const MAX_HISTORY_VERSIONS = 50;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 Jam

// Bersihkan HTML menjadi teks polos (untuk preview & diff kata)
const cleanText = (htmlStr: string): string => {
  const temp = document.createElement('div');
  // Ubah tag ganti baris menjadi spasi biasa agar teks tidak menempel
  temp.innerHTML = htmlStr.replace(/<br\s*[\/]?>/gi, ' ').replace(/<\/p>/gi, ' </p>');
  return (temp.textContent || temp.innerText || "").replace(/\s+/g, ' ').trim();
};

// --- ARSIP: pemetaan node untuk menghitung konten sumber tanpa menyentuh DOM live ---
const jalurNodeDalam = (node: Node, root: Node): number[] | null => {
  const jalur: number[] = [];
  let cur: Node | null = node;
  while (cur && cur !== root) {
    const induk = cur.parentNode;
    if (!induk) return null;
    jalur.unshift(Array.prototype.indexOf.call(induk.childNodes, cur));
    cur = induk;
  }
  return cur === root ? jalur : null;
};

const nodeDariJalur = (root: Node, jalur: number[]): Node | null => {
  let cur: Node | null = root;
  for (const indeks of jalur) {
    if (!cur || !cur.childNodes[indeks]) return null;
    cur = cur.childNodes[indeks];
  }
  return cur;
};

// Serialisasi teks polos yang menghasilkan SATU newline per batas blok.
// innerText browser dapat memberi dua newline untuk <p>, sehingga hasil tempel
// terlihat berjarak ganda. Fungsi ini menjaga baris kosong yang memang ada
// (blok kosong menghasilkan satu newline tambahan) tanpa menggandakan baris.
const TAG_BLOK_TEKS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER'
]);

const htmlKeTeksPolos = (html: string): string => {
  const root = document.createElement('div');
  root.innerHTML = html;
  let hasil = '';

  const akhirBaris = () => {
    if (hasil && !hasil.endsWith('\n')) hasil += '\n';
  };

  const jalan = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      hasil += (node.nodeValue || '').replace(/\u00a0/g, ' ');
      return;
    }
    if (!(node instanceof HTMLElement)) {
      node.childNodes.forEach(jalan);
      return;
    }
    const tag = node.tagName;
    if (tag === 'BR') {
      hasil += '\n';
      return;
    }
    if (tag === 'IMG') {
      const alt = node.getAttribute('alt');
      if (alt) hasil += alt;
      return;
    }
    const blok = TAG_BLOK_TEKS.has(tag);
    if (blok) akhirBaris();
    node.childNodes.forEach(jalan);
    if (blok) akhirBaris();
  };

  root.childNodes.forEach(jalan);
  return hasil.replace(/^\n+/, '').replace(/\n+$/, '');
};

// --- PEMETAAN SELEKSI VISUAL KE MODE KODE HTML ---
const PRIORITAS_BLOK_KODE = [
  '.todo-item', 'li', 'p', 'h1,h2,h3,h4,h5,h6',
  'blockquote', 'pre', 'td,th', 'div'
];

const cariBlokKode = (node: Node, root: HTMLElement): HTMLElement | null => {
  let cur: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement;
  let terbaik: HTMLElement | null = null;
  let prioritasTerbaik = PRIORITAS_BLOK_KODE.length;

  while (cur && cur !== root) {
    for (let i = 0; i < PRIORITAS_BLOK_KODE.length; i++) {
      if (cur.matches(PRIORITAS_BLOK_KODE[i])) {
        if (i < prioritasTerbaik) {
          terbaik = cur;
          prioritasTerbaik = i;
        }
        break;
      }
    }
    if (prioritasTerbaik === 0) break;
    cur = cur.parentElement;
  }

  return terbaik;
};

// Menggunakan sentinel komentar pada clone DOM agar offset tepat, termasuk
// saat ada beberapa elemen dengan HTML identik.
const petakanRangeKeKode = (
  range: Range,
  root: HTMLElement
): { codeText: string; start: number; end: number } | null => {
  let blokAwal = cariBlokKode(range.startContainer, root);
  let blokAkhir = cariBlokKode(range.endContainer, root);
  if (!blokAwal || !blokAkhir) return null;

  // Jika salah satu blok membungkus yang lain, pilih blok terluar.
  if (blokAwal.contains(blokAkhir)) {
    blokAkhir = blokAwal;
  } else if (blokAkhir.contains(blokAwal)) {
    blokAwal = blokAkhir;
  }

  const jalurAwal = jalurNodeDalam(blokAwal, root);
  const jalurAkhir = jalurNodeDalam(blokAkhir, root);
  if (!jalurAwal || !jalurAkhir) return null;

  const salinan = root.cloneNode(true) as HTMLElement;
  const awalClone = nodeDariJalur(salinan, jalurAwal) as HTMLElement | null;
  const akhirClone = nodeDariJalur(salinan, jalurAkhir) as HTMLElement | null;
  if (!awalClone || !akhirClone || !awalClone.parentNode || !akhirClone.parentNode) {
    return null;
  }

  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const namaAwal = `NEXUS_S_${nonce}`;
  const namaAkhir = `NEXUS_E_${nonce}`;
  const htmlAwal = `<!--${namaAwal}-->`;
  const htmlAkhir = `<!--${namaAkhir}-->`;

  awalClone.parentNode.insertBefore(document.createComment(namaAwal), awalClone);
  akhirClone.parentNode.insertBefore(document.createComment(namaAkhir), akhirClone.nextSibling);

  const bertanda = salinan.innerHTML;
  const posAwal = bertanda.indexOf(htmlAwal);
  const posAkhir = bertanda.indexOf(htmlAkhir);
  if (posAwal < 0 || posAkhir < 0) return null;

  const codeText = bertanda.replace(htmlAwal, '').replace(htmlAkhir, '');
  const start = posAwal;
  const end = posAkhir - htmlAwal.length;
  if (start < 0 || end < start || end > codeText.length) return null;

  return { codeText, start, end };
};

const wordsFrom = (text: string): string[] => text.split(/\s+/).filter(Boolean);

// Bandingkan dua teks bersih -> kata yang ditambah / dihapus
const computeWordDiff = (prevText: string, currentText: string): HistoryWordDiff => {
  const cur = wordsFrom(currentText);
  const prv = wordsFrom(prevText);
  return {
    added: cur.filter((w) => !prv.includes(w)),
    removed: prv.filter((w) => !cur.includes(w)),
  };
};

// Bentuk entri memory dari konten penuh (dipakai untuk seed/base)
const makeMemEntry = (content: string, time: number): HistEntry => {
  const text = cleanText(content);
  return {
    kind: 'base',
    time,
    content,
    preview: text.substring(0, 120) || "(Kosong)",
    charCount: text.length,
    wordDiff: null,
  };
};

export const Editor = forwardRef<EditorHandle, EditorProps>(({ 
  note: rawNote, 
  allNotes = [], 
  onUpdate, 
  onCreateNewNote,
  onLinkClick,
  onLinkLongPress,
  onGoHome,
  onToggleImmersive, // <--- TAMBAHKAN KABEL INI DI SINI
  onArchiveWholeContent,
  onArchiveSelectionContent,
  onSelectionAvailabilityChange
}, ref) => {
  // PENGAMAN ANTI CRASH (Mencegah Layar Blank Putih)
  // Jika data 'note' dari luar ternyata kosong/belum dimuat, 
  // kita berikan data palsu sementara agar aplikasi tidak panik.
  const note = rawNote ? 
    { ...rawNote, content: rawNote.content || '<p><br></p>' } : 
    { id: 'safe-temp', title: 'Memuat...', content: '<p><br></p>', type: 'text' } as any;

  // Tujuan arsip aktif, hanya jika lolos validasi yang sama dengan App.
  const tujuanArsipAktif = allNotes.find(n =>
    n.id === note.archiveTargetId && !n.deletedAt && n.type === 'note'
  ) || null;
  const punyaTujuanArsip = !!tujuanArsipAktif;

  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const savedSelection = useRef<Range | null>(null); // Menyimpan posisi seleksi teks
  const lastSelectionRef = useRef<Range | null>(null); // Simpan seleksi drag terakhir (non-kosong) di editor
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [cursorRange, setCursorRange] = useState<Range | null>(null);
  // --- STATE BARU UNTUK NOTIFIKASI COPY & CUT ---
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showCutToast, setShowCutToast] = useState(false);
  const [showClipboardFailToast, setShowClipboardFailToast] = useState(false);
  // --- STATE BARU: NOTIFIKASI CLIPBOARD KOSONG (PASTE) ---
  const [showPasteEmptyToast, setShowPasteEmptyToast] = useState(false);
  // --- STATE: MENUNGGU TEMPEL NATIVE (FALLBACK SAAT IZIN DITOLAK) ---
  const [showPastePromptToast, setShowPastePromptToast] = useState(false);
  // --- STATE: NOTIFIKASI KONTEN TERKUNCI (LOCK ENFORCEMENT) ---
  const [lockToastMsg, setLockToastMsg] = useState<string | null>(null);
  const lockToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingNativePaste = useRef(false);
  const nativePasteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // --- STATE BARU: Dialog Checkbox ---
  const [showCheckboxDialog, setShowCheckboxDialog] = useState(false);
  const [checkboxInterval, setCheckboxInterval] = useState<string>('1');
  // --- STATE BARU UNTUK TOOLS ---
  const [showOptionMenu, setShowOptionMenu] = useState(false);
  const arsipSeleksiRef = useRef(false);
  // --- STATE: Transparansi Tombol Utama (Solid sementara saat diklik) ---
  const [mainBtnSolid, setMainBtnSolid] = useState(false);
  const mainBtnOpacityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // --- STATE BARU: Mode Kode (HTML) ---
  const [isCodeView, setIsCodeView] = useState(false);
  // Draft lokal mode kode: beralih mode tidak boleh menulis ulang note.content.
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const pendingCodeSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const codeRemoteBaseRef = useRef<string>('');
  const codeDraftDirtyRef = useRef(false);
  
  // --- STATE BARU: Mode Live Preview (Browser Mini) ---
  const [isPreviewMode, setIsPreviewMode] = useState(() => {
      // 1. Cek Memori Lokal dulu per catatan (Apakah sebelumnya nyala/mati)
      if (rawNote?.id) {
          const saved = localStorage.getItem(`nexus_preview_${rawNote.id}`);
          if (saved !== null) return saved === 'true';
      }
      // 2. Jika tidak ada di memori, lakukan auto-detect seperti biasa
      const text = (rawNote?.content || '').toLowerCase();
      return text.includes('<!doctype html') || text.includes('<html');
  });
  
  // --- STATE IMMERSIVE (FULL SCREEN) & TIMERS ---
  const [isImmersive, setIsImmersive] = useState(false);
  const [isHoveringUI, setIsHoveringUI] = useState(false);
  const immersiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [floatingBtnPrimed, setFloatingBtnPrimed] = useState(false);
  const floatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- STATE BARU: Penahan Flicker Iframe ---
  // Mencegah iframe memuat ulang secara paksa saat data sedang disinkronisasi ke Firebase
  const [previewContent, setPreviewContent] = useState('');

  // --- STATE BARU: Tampilkan Modal Riwayat Mesin Waktu ---
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // --- STATE PENCARIAN (PROXIMITY SEARCH) ---
  type SearchMatch = { start: number; end: number };
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [showReplace, setShowReplace] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  
  const codeEditorRef = useRef<HTMLTextAreaElement>(null); // Referensi untuk textarea mode HTML
  const iframeRef = useRef<HTMLIFrameElement>(null); // Referensi pengendali untuk browser mini (Iframe)
  const fileInputRef = useRef<HTMLInputElement>(null); // Referensi input file untuk impor

  // --- STATE BARU: MESIN WAKTU (HISTORY MANAGER 24 JAM, DIFF-BASED + INDEXEDDB) ---
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [hydrated, setHydrated] = useState(false);
  const [expandedHistoryIdx, setExpandedHistoryIdx] = useState<number | null>(null); // State untuk buka/tutup rincian
  const isTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref sinkron untuk menghindari stale closure di timer/handler (fix bug historyIndex).
  const historyContentRef = useRef<HistEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Update ref + state secara atomik (satu-satunya jalur mutasi history di memori)
  const applyHistory = (entries: HistEntry[], index: number) => {
    historyContentRef.current = entries;
    historyIndexRef.current = index;
    setHistory(entries);
    setHistoryIndex(index);
  };

  // Konversi entri memori -> rantai penyimpanan ringkas (base di index 0 + patch sisanya)
  const toStoredChain = (entries: HistEntry[], index: number): HistoryChain => ({
    noteId: note.id,
    currentIndex: index,
    entries: entries.map((e, i) => {
      const common = { time: e.time, preview: e.preview, charCount: e.charCount };
      if (i === 0) return { kind: 'base', content: e.content, ...common };
      return { kind: 'patch', patchText: e.patchText ?? '', ...common };
    }),
    updatedAt: Date.now(),
  });

  // Tulis rantai ke IndexedDB, serial agar put yang lebih baru tidak ditimpa yang lama
  const persistChain = (entries: HistEntry[], index: number) => {
    if (note.id === 'safe-temp') return;
    const chain = toStoredChain(entries, index);
    const task = persistQueueRef.current
      .catch(() => {})
      .then(() => saveHistoryChain(chain));
    persistQueueRef.current = task;
  };

  // Tambahkan versi baru (dengan debounce dijalankan pemanggil). Memangkas masa depan
  // bila terakhir kali user melakukan undo, dedupe, lalu memotong ke 50 versi maksimal.
  const appendHistory = (newContent: string, time?: number) => {
    const entries = historyContentRef.current;
    const index = historyIndexRef.current;
    const now = time ?? Date.now();

    if (entries.length === 0) {
      const seed = makeMemEntry(newContent, now);
      applyHistory([seed], 0);
      persistChain([seed], 0);
      return;
    }

    // Jika habis undo (misal C -> B) lalu ketik hal baru (D), buang masa depan (C).
    let current = entries.slice(0, index + 1);
    const last = current[current.length - 1];
    if (!last || last.content === newContent) return; // dedupe
    const patchText = makePatch(last.content, newContent);
    if (!patchText) return; // secara byte identik

    const text = cleanText(newContent);
    const entry: HistEntry = {
      kind: 'patch',
      patchText,
      time: now,
      content: newContent,
      preview: text.substring(0, 120) || "(Kosong)",
      charCount: text.length,
      wordDiff: null,
    };
    current.push(entry);

    if (current.length > MAX_HISTORY_VERSIONS) {
      current.splice(0, current.length - MAX_HISTORY_VERSIONS);
      // Pastikan entri terdepan selalu 'base' agar replay selalu punya titik mulai
      const head = current[0];
      if (head && head.kind !== 'base') {
        current[0] = { ...head, kind: 'base', patchText: undefined };
      }
    }

    applyHistory(current, current.length - 1);
    persistChain(current, current.length - 1);
  };

  // --- FUNGSI BARU: Sinkronisasi Preview & Memori Lokal ---
  useEffect(() => {
      if (note.id && note.id !== 'safe-temp') {
          // 1. Simpan status preview ke memori browser per catatan
          localStorage.setItem(`nexus_preview_${note.id}`, String(isPreviewMode));
          
          // 2. Jika Preview nyala, persiapkan konten iframe & masuk ke Immersive Full Screen
          if (isPreviewMode) {
              setIsCodeView(false);
              setPreviewContent(note.content);
              setIsImmersive(true); // Langsung layar penuh
          } else {
              setIsImmersive(false); // Kembalikan ke mode editor biasa
          }
      }
  }, [isPreviewMode, note.id]);

  // --- ENGINE IMMERSIVE & PELACAK KURSOR MOUSE ---
  // Lapor ke App.tsx agar TopBar disembunyikan
  useEffect(() => {
      onToggleImmersive(isImmersive);
  }, [isImmersive, onToggleImmersive]);

  // Timer 5 Detik & Sensor Area UI
  useEffect(() => {
      if (!isPreviewMode) return; // Matikan mesin hitung mundur jika bukan mode preview

      // Jika kursor sedang menyorot area tombol (atas/bawah), tahan agar tidak disembunyikan
      if (isHoveringUI) {
          if (immersiveTimerRef.current) clearTimeout(immersiveTimerRef.current);
          return;
      }

      // Mulai hitung mundur 5 detik jika kursor dibiarkan saja di tengah web
      if (!isImmersive) {
          if (immersiveTimerRef.current) clearTimeout(immersiveTimerRef.current);
          immersiveTimerRef.current = setTimeout(() => {
              setIsImmersive(true);
              setFloatingBtnPrimed(false); // Reset status tombol transparan
          }, 5000);
      }

      return () => {
          if (immersiveTimerRef.current) clearTimeout(immersiveTimerRef.current);
      };
  }, [isPreviewMode, isImmersive, isHoveringUI]);

  // Sensor Area (Atas & Bawah Layar)
  useEffect(() => {
      if (!isPreviewMode || isImmersive) return;

      const handleMouseMove = (e: MouseEvent) => {
          // Anggap 120px dari atas (TopBar) dan 150px dari bawah (Toolbar) sebagai "Area Tombol"
          if (e.clientY < 120 || e.clientY > window.innerHeight - 150) {
              setIsHoveringUI(true);
          } else {
              setIsHoveringUI(false);
          }
      };

      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isPreviewMode, isImmersive]);

  // Jejak rekam untuk membedakan perubahan lokal vs perubahan dari Firebase (Perangkat B)
  const lastLocalHTML = useRef('');

  // RAF THROTTLE: penanda RAF yang sedang antre (maksimal satu per frame)
  const rafRef = useRef<number | null>(null);

  // MEMBUKA KUNCI SINKRONISASI REAL-TIME (ANTI KEDIP & TAHAN SCROLL)
  useEffect(() => {
      if (isPreviewMode && note.content !== previewContent && note.content !== lastLocalHTML.current) {
          // JANGAN gunakan setPreviewContent() lagi karena itu yang menyebabkan layar berkedip & scroll terlempar ke atas.
          // Sebagai gantinya, kirim HTML baru lewat "kabel" langsung ke dalam Iframe!
          if (iframeRef.current && iframeRef.current.contentWindow) {
              iframeRef.current.contentWindow.postMessage({
                  type: 'SYNC_FROM_NEXUS',
                  html: note.content
              }, '*');
          }
          lastLocalHTML.current = note.content; // Sinkronkan jejak
      }
  }, [isPreviewMode, note.content, previewContent]);
  // PENDENGAR PESAN DARI IFRAME (KABEL KOMUNIKASI)
  useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
          if (event.data && event.data.type === 'SYNC_APP_STATE') {
              // Lindungi dari payload tidak valid
              if (typeof event.data.html !== 'string') return;

              // 1. Catat bahwa HTML ini berasal dari ketikan perangkat ini (Lokal)
              lastLocalHTML.current = event.data.html; 
              
              // 2. Diam-diam simpan ke Firebase (tanpa mengganggu/me-refresh iframe kita)
              onUpdate({ ...note, content: event.data.html });
              
              // 3. Rekam ke Mesin Waktu agar perubahan dari Preview bisa di-undo
              recordHistory(event.data.html);
              
              // PERBAIKAN: Kita HAPUS perintah setPreviewContent() di sini
              // agar layar Iframe tidak berkedip dan kursor tidak hilang saat Anda mengetik!
          }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
  }, [note, onUpdate]);
  
  // Fungsi untuk Memuat History dari IndexedDB saat Catatan Dibuka
  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      // Jangan tersisa timer ketikan dari catatan sebelumnya
      if (isTypingTimer.current) {
        clearTimeout(isTypingTimer.current);
        isTypingTimer.current = null;
      }
      cleanupLegacyLocalStorage(); // one-time: buang history localStorage lama

      // Seed instan agar UI tidak menunggu IndexedDB (anti-flicker)
      applyHistory([makeMemEntry(note.content, Date.now())], 0);
      setHydrated(false);

      if (!note.id || note.id === 'safe-temp') {
        setHydrated(true);
        return;
      }

      try {
        const chain = await getHistoryChain(note.id);
        if (cancelled) return;
        if (chain && chain.entries && chain.entries.length > 0) {
          const now = Date.now();
          const fresh = chain.entries.filter((e) => now - e.time < HISTORY_TTL_MS);
          if (fresh.length > 0) {
            const titled: (HistEntry)[] = [];
            const contents = replayChain(fresh);
            for (let i = 0; i < fresh.length; i++) {
              const e = fresh[i];
              const preview = e.preview ?? (cleanText(contents[i]).substring(0, 120) || "(Kosong)");
              const entry: HistEntry = {
                kind: i === 0 ? 'base' : (e.kind === 'base' ? 'base' : 'patch'),
                time: e.time,
                content: contents[i],
                patchText: i > 0 && e.kind === 'patch' ? e.patchText : undefined,
                preview,
                charCount: e.charCount ?? cleanText(contents[i]).length,
                wordDiff: null,
              };
              titled.push(entry);
            }

            // Tuning: hanya index terdepan boleh 'base' (jaga invariant replay)
            if (titled[0].kind !== 'base') {
              titled[0] = { ...titled[0], kind: 'base', patchText: undefined };
            }

            const restoredIndex = Math.min(chain.currentIndex ?? titled.length - 1, titled.length - 1);
            historyContentRef.current = titled;
            historyIndexRef.current = restoredIndex;
            setHistory(titled);
            setHistoryIndex(restoredIndex);
            setHydrated(true);
            return;
          }
        }
      } catch (e) {
        console.error("Gagal membaca sejarah dari IndexedDB:", e);
        if (cancelled) return;
      }

      // Jika tidak ada history (atau semua sudah basi), konten saat ini jadi titik awal
      applyHistory([makeMemEntry(note.content, Date.now())], 0);
      setHydrated(true);
    };

    initialize();
    return () => {
      cancelled = true;
      historyContentRef.current = [];
      historyIndexRef.current = -1;
    };
  }, [note.id]); // Berjalan tiap kali kamu ganti/buka catatan

  // --- FUNGSI CUT SELURUH CATATAN ---
  // Salin dulu; jika ada tujuan arsip, arsipkan seluruh isi melalui App dan
  // biarkan App mengosongkan sumber hanya setelah penyimpanan tujuan berhasil.
  const handleCutContent = async () => {
    if (isCodeView) {
        if (!codeEditorRef.current) return;
        // LOCK ENFORCEMENT: potong seluruh isi menyalin & menghapus sekaligus.
        if (htmlHasLock(note.content || '', 'copy') || htmlHasLock(note.content || '', 'delete')) {
            notifyLocked('both');
            return;
        }
        const textContent = codeEditorRef.current.value;
        const copied = await writeToClipboard(textContent);
        if (!copied) {
            setShowClipboardFailToast(true);
            setTimeout(() => setShowClipboardFailToast(false), 3000);
            return;
        }
        if (punyaTujuanArsip && onArchiveWholeContent) {
            const ok = await onArchiveWholeContent(note.content, 'cut');
            if (!ok) return;
        } else {
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            )?.set;
            if (nativeSetter) nativeSetter.call(codeEditorRef.current, '');
            else codeEditorRef.current.value = '';
            codeEditorRef.current.dispatchEvent(new Event('input', { bubbles: true }));
            pushUndoState(note.content, '');
            onUpdate({ ...note, content: '' });
        }
        setShowCutToast(true);
        setTimeout(() => setShowCutToast(false), 2000);
        return;
    }

    // MODE VISUAL: selalu seluruh catatan, bukan hanya seleksi.
    if (editorRef.current) {
        // LOCK ENFORCEMENT: potong seluruh isi menyalin & menghapus sekaligus.
        const htmlContent = editorRef.current.innerHTML;
        if (htmlHasLock(htmlContent, 'copy') || htmlHasLock(htmlContent, 'delete')) {
            notifyLocked('both');
            return;
        }
        const textContent = htmlKeTeksPolos(htmlContent);
        const copied = await writeToClipboard(textContent, htmlContent);
        if (!copied) {
            setShowClipboardFailToast(true);
            setTimeout(() => setShowClipboardFailToast(false), 3000);
            return;
        }

        if (punyaTujuanArsip && onArchiveWholeContent) {
            const ok = await onArchiveWholeContent(htmlContent, 'cut');
            if (!ok) return; // sumber tidak disentuh bila arsip gagal
        } else {
            editorRef.current.innerHTML = '<p><br/></p>';
            pushUndoState(note.content, '<p><br/></p>');
            onUpdate({ ...note, content: '<p><br/></p>' });
        }
        setShowCutToast(true);
        setTimeout(() => setShowCutToast(false), 2000);
    }
  };

  // --- FUNGSI SELECT ALL (PILIH SEMUA) ---
  // Mendukung mode kode (textarea.select()) DAN mode visual (Range API).
  const handleSelectAll = () => {
    if (isCodeView) {
        if (codeEditorRef.current) {
            codeEditorRef.current.select();
        }
        return;
    }
    if (editorRef.current) {
        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
  };

  // --- FUNGSI HAPUS SEMUA ISI (KECUALI JUDUL) ---
  // Berjalan seketika tanpa konfirmasi, dan langsung terhubung dengan fitur Undo (Mesin Waktu).
  // Mendukung mode kode (codeEditorRef) DAN mode visual (editorRef).
  const handleDeleteAllContent = async () => {
    if (isCodeView) {
        if (!codeEditorRef.current) return;
        if (punyaTujuanArsip && onArchiveWholeContent) {
            await onArchiveWholeContent(note.content, 'delete');
            return;
        }
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (nativeSetter) nativeSetter.call(codeEditorRef.current, '');
        else codeEditorRef.current.value = '';
        codeEditorRef.current.dispatchEvent(new Event('input', { bubbles: true }));
        pushUndoState(note.content, '');
        onUpdate({ ...note, content: '' });
        return;
    }
    if (editorRef.current) {
        if (punyaTujuanArsip && onArchiveWholeContent) {
            await onArchiveWholeContent(editorRef.current.innerHTML, 'delete');
            return;
        }
        const emptyContent = '<p><br/></p>';
        pushUndoState(editorRef.current.innerHTML, emptyContent);
        editorRef.current.innerHTML = emptyContent;
        onUpdate({ ...note, content: emptyContent });
    }
  };

  // --- HELPER REKAM STATE UNDO (MESIN WAKTU) ---
  // Dorong kondisi 'before' (isi sebelumnya) dan 'after' (isi baru) ke riwayat Undo.
  // Memungkinkan aksi penimpaan/penghapusan (Tempel & Hapus Semua) dapat di-undo sempurna.
  const pushUndoState = (beforeContent: string, afterContent: string) => {
    const t = Date.now();
    const beforeFlag = historyContentRef.current.length === 0
      || historyContentRef.current[historyIndexRef.current]?.content !== beforeContent;
    if (beforeFlag) appendHistory(beforeContent, t);
    if (beforeContent !== afterContent) appendHistory(afterContent, t + 1);
  };

  // --- FUNGSI TEMPEL (PASTE) DARI SYSTEM CLIPBOARD ---
  // Cek clipboard secara async. Jika berisi teks: rekam state ke Undo lalu
  // timpa seluruh isi editor. Jika kosong/bukan teks: batalkan & tampilkan toast.
  // Mendukung mode visual (editorRef) DAN mode kode (codeEditorRef).
  const handlePasteFromClipboard = async () => {
      // L1: Strategi dinamis — coba readText; jika izin ditolak, fallback ke paste NATIVE.
      //     (clipboard-read yang 'denied' tidak bisa dibaca ulang oleh API; jalur native
      //      yang dipicu user TIDAK membutuhkan izin itu.)
      if (awaitingNativePaste.current) {
          return; // sedang menunggu paste manual, jangan tumpuk proses
      }

      try {
          const text = await navigator.clipboard.readText();
          if (!text || !text.trim()) {
              // Clipboard benar-benar kosong
              setShowPasteEmptyToast(true);
              setTimeout(() => setShowPasteEmptyToast(false), 2000);
              return;
          }
          applyClipboardContent(text);
      } catch (err: any) {
          // Permission denied / API tidak tersedia (mis. bukan HTTPS)
          console.error("Gagal membaca clipboard via API:", err);
          const isPermissionError =
              err?.name === 'NotAllowedError' ||
              err?.name === 'SecurityError' ||
              !navigator.clipboard ||
              !(navigator.clipboard as any).readText;
          if (isPermissionError) {
              // Ganti pendekatan: gunakan jalur paste NATIVE (tidak butuh izin)
              triggerNativePaste();
          } else {
              setShowPasteEmptyToast(true);
              setTimeout(() => setShowPasteEmptyToast(false), 2000);
          }
      }
  };

  // Terapkan konten teks ke editor (mode kode/visual) lengkap dengan integrasi Undo
  const applyClipboardContent = (text: string) => {
      if (!text || !text.trim()) {
          setShowPasteEmptyToast(true);
          setTimeout(() => setShowPasteEmptyToast(false), 2000);
          return;
      }
      if (isCodeView) {
          // MODE KODE: Overwrite isi textarea
          if (!codeEditorRef.current) return;
          pushUndoState(note.content, text);
          setTextareaValue(text);
          onUpdate({ ...note, content: text });
      } else {
          // MODE VISUAL: Overwrite isi contentEditable
          if (!editorRef.current) return;
          // LOCK ENFORCEMENT: menimpa seluruh isi berarti menghapus area delete-locked.
          if (editorRef.current.querySelector('uneditable[data-lock~="delete"]')) {
              notifyLocked('delete');
              return;
          }
          const pasteHtml = text.split(/\r?\n/).map(line => `<p>${line || '<br/>'}</p>`).join('');
          pushUndoState(editorRef.current.innerHTML, pasteHtml);
          editorRef.current.innerHTML = pasteHtml;
          onUpdate({ ...note, content: pasteHtml });
      }
  };

  // Set nilai textarea lewat native setter agar React mendeteksi perubahan
  const setTextareaValue = (value: string) => {
      if (!codeEditorRef.current) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeSetter) nativeSetter.call(codeEditorRef.current, value);
      else codeEditorRef.current.value = value;
      codeEditorRef.current.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // --- HELPER: COPY LEGACY (TIDAK BUTUH IZIN ASYNC CLIPBOARD) ---
  // Jalur ini menerapkan deteksi lewat event 'copy': bila peramban benar-benar
  // menjalankan operasi salin, listener override data dengan teks kita. Hasil
  // true HANYA berarti data benar-benar disetel -- hindari 'true' palsu yang
  // membuat toast sukses padahal clipboard kosong.
  const legacyCopyText = (text: string): boolean => {
      let ok = false;
      const handler = (e: ClipboardEvent) => {
          try {
              e.clipboardData?.setData('text/plain', text);
              e.preventDefault();
              ok = true;
          } catch (err) {
              console.error("Set clipboard data (legacy) gagal:", err);
          }
      };
      let textarea: HTMLTextAreaElement | null = null;
      document.addEventListener('copy', handler);
      try {
          textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.top = '0';
          textarea.style.left = '-9999px';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          textarea.setSelectionRange(0, textarea.value.length);
          document.execCommand('copy');
      } catch (err) {
          console.error("Legacy copy gagal:", err);
          ok = false;
      } finally {
          if (textarea && textarea.parentNode) textarea.parentNode.removeChild(textarea);
          document.removeEventListener('copy', handler);
      }
      return ok;
  };

  // Chrome Android / Safari iOS tidak andal menulis text/html via ClipboardItem
  // (bisa resolve tapi clipboard tetap kosong). Rich-copy dibatasi ke desktop.
  const isMobileDevice = typeof navigator !== 'undefined' && /Android|iPad|iPhone|iPod/i.test(navigator.userAgent);

  // --- HELPER: WRITE KE CLIPBOARD DENGAN FALLBACK BERTINGKAT ---
  // A) Tanpa API async (non-secure/WebView): legacy sinkron langsung (dalam gesture).
  // B) Kaya HTML+teks via ClipboardItem -- khusus desktop.
  // C) Teks polos via writeText -- paling andal di Chrome Android (secure context).
  // D) Legacy sinkron dengan deteksi event copy (tidak pernah 'sukses' palsu).
  const writeToClipboard = async (text: string, html?: string): Promise<boolean> => {
      // Tingkat A: API async tidak tersedia -> langsung jalur legacy sinkron
      if (!navigator.clipboard?.write && !navigator.clipboard?.writeText) {
          return legacyCopyText(text);
      }

      // Tingkat B: tulis kaya (HTML + plain text) hanya di desktop
      try {
          if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write && html && !isMobileDevice) {
              const clipboardItem = new ClipboardItem({
                  "text/html": new Blob([html], { type: "text/html" }),
                  "text/plain": new Blob([text], { type: "text/plain" })
              });
              await navigator.clipboard.write([clipboardItem]);
              return true;
          }
      } catch (err) {
          // lanjut ke tingkat berikutnya
          console.error("ClipboardItem (HTML) write gagal:", err);
      }

      // Tingkat C: teks polos via writeText
      try {
          if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(text);
              return true;
          }
      } catch (err) {
          console.error("writeText gagal:", err);
      }

      // Tingkat D: jalur legacy sinkron (hasil akurat berkat deteksi event copy)
      return legacyCopyText(text);
  };

  // --- FALLBACK NATIVE PASTE ---
  // Fokus editor & minta user menekan lama / Ctrl+V, lalu tangkap event paste asli.
  const triggerNativePaste = () => {
      if (awaitingNativePaste.current) return;
      awaitingNativePaste.current = true;

      // Bersihkan state menunggu lama yang masih tersisa
      if (nativePasteTimeout.current) clearTimeout(nativePasteTimeout.current);

      // Fokus ke elemen target yang benar
      const target = isCodeView ? codeEditorRef.current : editorRef.current;
      if (target) {
          (target as HTMLElement).focus();
          // Pindahkan kursor ke akhir (mode visual) agar paste default tidak nyelip di awal
          if (!isCodeView && (target as HTMLElement).isContentEditable) {
              try {
                  const range = document.createRange();
                  range.selectNodeContents(target as HTMLElement);
                  range.collapse(false);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
              } catch (e) { /* abaikan */ }
          }
      }

      // Tampilkan instruksi
      setShowPastePromptToast(true);
      if (nativePasteTimeout.current) clearTimeout(nativePasteTimeout.current);
      nativePasteTimeout.current = setTimeout(() => {
          setShowPastePromptToast(false);
          awaitingNativePaste.current = false;
      }, 6000);

      // Pasang listener paste SEKALI pada elemen target (menimpa handler gambar saat fallback aktif)
      if (target) {
          const el = target as HTMLElement;
          const handler = (e: ClipboardEvent) => {
              e.preventDefault();
              e.stopPropagation(); // cegah handler React onPaste / default menjalankan paste ganda
              // Hentikan timeout & bersihkan state
              if (nativePasteTimeout.current) clearTimeout(nativePasteTimeout.current);
              awaitingNativePaste.current = false;
              setShowPastePromptToast(false);

              const text = e.clipboardData?.getData('text') || '';
              if (text && text.trim()) {
                  applyClipboardContent(text);
              } else {
                  setShowPasteEmptyToast(true);
                  setTimeout(() => setShowPasteEmptyToast(false), 2000);
              }
              el.removeEventListener('paste', handler);
          };
          el.addEventListener('paste', handler);
      }
  };

  // --- PENCARIAN: HITUNG POSISI DARI TEKS (PROXIMITY 45 KARAKTER) ---
  // Cari semua posisi match dari teks mentah (dipakai mode visual & mode kode)
  const findSearchMatches = (text: string, query: string): { start: number; end: number }[] => {
      const lowerText = text.toLowerCase();
      const words = query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
      const matches: { start: number; end: number }[] = [];

      if (words.length === 1) {
          let idx = lowerText.indexOf(words[0]);
          while (idx !== -1) {
              matches.push({ start: idx, end: idx + words[0].length });
              idx = lowerText.indexOf(words[0], idx + 1);
          }
      } else {
          const allFound: { word: string; start: number; end: number }[] = [];
          words.forEach((word) => {
              let idx = lowerText.indexOf(word);
              while (idx !== -1) {
                  allFound.push({ word, start: idx, end: idx + word.length });
                  idx = lowerText.indexOf(word, idx + 1);
              }
          });

          allFound.sort((a, b) => a.start - b.start);

          for (let i = 0; i < allFound.length; i++) {
              const seen = new Set([allFound[i].word]);
              let currentEnd = allFound[i].end;
              let j = i + 1;

              while (j < allFound.length) {
                  if (allFound[j].start - currentEnd <= 45) { // Jarak 45 Karakter
                      seen.add(allFound[j].word);
                      currentEnd = allFound[j].end;

                      if (seen.size === words.length) {
                          matches.push({ start: allFound[i].start, end: currentEnd });
                          break;
                      }
                      j++;
                  } else {
                      break;
                  }
              }
          }
      }
      return matches;
  };

  // Ambil teks editor saat ini (visual: gabungan text node; kode: textarea)
  const getEditorSearchText = (): string => {
      if (isCodeView) return codeEditorRef.current?.value ?? '';
      if (!editorRef.current) return '';
      const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT, null);
      let text = '';
      let node: Node | null;
      while ((node = walker.nextNode())) {
          if (node.nodeValue) text += node.nodeValue;
      }
      return text;
  };

  const performSearch = (query: string) => {
      if (!query.trim() || !getEditorSearchText()) {
          setSearchResults([]);
          setCurrentSearchIndex(0);
          return;
      }
      const matches = findSearchMatches(getEditorSearchText(), query);
      setSearchResults(matches.length > 0 ? matches : []);
      setCurrentSearchIndex(0);
  };

  // Scroll ke match aktif (visual: elemen mark; kode: textarea)
  const scrollToMatch = (match: SearchMatch) => {
      if (isCodeView) {
          if (codeEditorRef.current) {
              const before = (codeEditorRef.current.value || '').substring(0, match.start);
              const lines = before.split('\n').length;
              const lineHeight = 20; // Perkiraan tinggi teks 20px per baris
              codeEditorRef.current.scrollTop = (lines - 1) * lineHeight - (codeEditorRef.current.clientHeight / 2);
          }
          return;
      }
      if (editorRef.current) {
          const cur = editorRef.current.querySelector('mark.search-current');
          if (cur) {
              cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  };

  // Tampilkan highlight NON-DESTRUKTIF & terlihat di DOM editor mode visual.
  // Tidak menyentuh note.content dan tidak memicu onUpdate => aman dari efek sinkronisasi.
  const applySearchHighlight = () => {
      const ed = editorRef.current;
      if (!ed || isCodeView) return;

      // Hapus highlight lama (mempertahankan seluruh teks, tidak menghapus konten)
      ed.querySelectorAll('mark.search-hit, mark.search-current').forEach((m) => {
          const parent = m.parentNode;
          if (parent) {
              parent.replaceChild(document.createTextNode(m.textContent || ''), m);
              parent.normalize();
          }
      });

      if (!searchQuery.trim()) return;

      const text = getEditorSearchText();
      const matches = findSearchMatches(text, searchQuery);
      if (matches.length === 0) return;

      // Kumpulkan posisi global setiap text node
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null);
      const nodes: Text[] = [];
      const starts: number[] = [];
      let cursor = 0;
      while (walker.nextNode()) {
          const t = walker.currentNode as Text;
          nodes.push(t);
          starts.push(cursor);
          cursor += (t.nodeValue || '').length;
      }

      // Petakan setiap match ke text node yang memuat start-nya
      const marks: { node: Text; start: number; end: number; index: number }[] = [];
      matches.forEach((m, i) => {
          for (let k = 0; k < nodes.length; k++) {
              const len = nodes[k].nodeValue?.length ?? 0;
              if (m.start >= starts[k] && m.start < starts[k] + len) {
                  marks.push({ node: nodes[k], start: m.start - starts[k], end: m.end - starts[k], index: i });
                  break;
              }
          }
      });

      // Bungkus dari posisi paling belakang agar offset tidak bergeser
      marks.sort((a, b) => b.start - a.start);
      marks.forEach(({ node, start, end, index }) => {
          const val = node.nodeValue || '';
          if (start < 0 || end > val.length || end <= start) return;
          const mark = document.createElement('mark');
          mark.className = index === currentSearchIndex ? 'search-current' : 'search-hit';
          mark.textContent = val.slice(start, end);
          const frag = document.createDocumentFragment();
          if (start > 0) frag.appendChild(document.createTextNode(val.slice(0, start)));
          frag.appendChild(mark);
          if (end < val.length) frag.appendChild(document.createTextNode(val.slice(end)));
          node.parentNode?.replaceChild(frag, node);
      });
  };

  // Terapkan ulang highlight setiap kali ada perubahan (setelah sinkronisasi DOM).
  // requestAnimationFrame memastikan ia berjalan setelah innerHTML disinkronkan dari note.content.
  useEffect(() => {
      if (isCodeView) return;
      const raf = requestAnimationFrame(() => applySearchHighlight());
      return () => cancelAnimationFrame(raf);
  }, [searchQuery, searchResults, currentSearchIndex, note.content, isCodeView]);

  const navigateSearch = (direction: 'next' | 'prev') => {
      if (searchResults.length === 0) return;
      let newIndex = currentSearchIndex + (direction === 'next' ? 1 : -1);
      if (newIndex < 0) newIndex = searchResults.length - 1;
      if (newIndex >= searchResults.length) newIndex = 0;

      setCurrentSearchIndex(newIndex);
      const nextMatch = searchResults[newIndex];
      // Highlight dipasang ulang oleh useEffect (rAF). Scroll setelah mark benar-benar siap
      // (double rAF menjamin urutan setelah effect).
      requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToMatch(nextMatch));
      });
  };

  // Konfirmasi & fokuskan match (dipanggil saat Enter) - HANYA menggulir, TIDAK mengubah teks
  const confirmSearchMatch = () => {
      if (searchResults.length === 0) return;
      const match = searchResults[currentSearchIndex];
      if (isCodeView && codeEditorRef.current) {
          codeEditorRef.current.focus();
          codeEditorRef.current.setSelectionRange(match.start, match.end);
      }
      scrollToMatch(match);
  };

  // Ganti teks pada DOM editor mode visual berdasarkan posisi (start,end) pada teks bersih.
  // Menghapus highlight dulu & memproses dari posisi paling belakang agar offset tidak bergeser.
  const replaceInVisualDom = (ranges: { start: number; end: number }[]) => {
      if (!editorRef.current || ranges.length === 0) return;
      const ed = editorRef.current;

      // Hapus semua mark highlight agar teks bersih & posisi akurat
      ed.querySelectorAll('mark.search-hit, mark.search-current').forEach((m) => {
          const parent = m.parentNode;
          if (parent) {
              parent.replaceChild(document.createTextNode(m.textContent || ''), m);
              parent.normalize();
          }
      });

      // Kumpulkan posisi global setiap text node
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null);
      const nodes: Text[] = [];
      const starts: number[] = [];
      let cursor = 0;
      while (walker.nextNode()) {
          const t = walker.currentNode as Text;
          nodes.push(t);
          starts.push(cursor);
          cursor += (t.nodeValue || '').length;
      }

      // Petakan setiap range ke text node
      const marks: { node: Text; start: number; end: number }[] = [];
      ranges.forEach((r) => {
          for (let k = 0; k < nodes.length; k++) {
              const len = nodes[k].nodeValue?.length ?? 0;
              if (r.start >= starts[k] && r.start < starts[k] + len) {
                  marks.push({ node: nodes[k], start: r.start - starts[k], end: Math.min(r.end - starts[k], len) });
                  break;
              }
          }
      });

      // Proses dari paling belakang agar posisi node lain tidak bergeser
      marks.sort((a, b) => b.start - a.start);
      marks.forEach(({ node, start, end }) => {
          const len = node.nodeValue?.length ?? 0;
          if (start < 0 || end > len || end <= start) return;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          range.deleteContents();
          range.insertNode(document.createTextNode(replaceQuery));
          node.parentNode?.normalize();
      });
  };

  // Hitung ulang hasil pencarian, lalu arahkan ke match pertama setelah posisi tertentu
  const refreshSearchAfterReplace = (afterPos: number) => {
      const text = getEditorSearchText();
      const matches = findSearchMatches(text, searchQuery);
      setSearchResults(matches.length > 0 ? matches : []);
      let next = matches.findIndex((m) => m.start >= afterPos);
      if (next === -1) next = 0;
      setCurrentSearchIndex(next);
  };

  // Ganti HANYA match yang sedang aktif (currentSearchIndex)
  const replaceCurrentMatch = () => {
      if (searchResults.length === 0) return;
      const match = searchResults[currentSearchIndex];
      if (isCodeView) {
          const ta = codeEditorRef.current;
          if (!ta) return;
          const val = ta.value;
          const nextVal = val.slice(0, match.start) + replaceQuery + val.slice(match.end);
          ta.value = nextVal;
          onUpdate({ ...note, content: nextVal });
          recordHistory(nextVal);
          // Cari match berikutnya setelah posisi yang direplace
          const text = nextVal;
          const matches = findSearchMatches(text, searchQuery);
          setSearchResults(matches.length > 0 ? matches : []);
          let next = matches.findIndex((m) => m.start >= match.start);
          if (next === -1) next = 0;
          setCurrentSearchIndex(next);
          return;
      }
      replaceInVisualDom([{ start: match.start, end: match.end }]);
      handleInput(); // Simpan; note.content berubah -> efek highlight refresh otomatis
      refreshSearchAfterReplace(match.start);
  };

  // Ganti SEMUA kejadian yang ditemukan
  const replaceAllMatches = () => {
      if (!searchQuery.trim()) return;
      if (isCodeView) {
          const ta = codeEditorRef.current;
          if (!ta) return;
          const val = ta.value;
          const matches = findSearchMatches(val, searchQuery);
          if (matches.length === 0) return;
          let nextVal = val;
          for (let i = matches.length - 1; i >= 0; i--) {
              const m = matches[i];
              nextVal = nextVal.slice(0, m.start) + replaceQuery + nextVal.slice(m.end);
          }
          ta.value = nextVal;
          lastLocalHTML.current = nextVal;
          onUpdate({ ...note, content: nextVal });
          recordHistory(nextVal);
          performSearch(searchQuery);
          return;
      }
      const matches = findSearchMatches(getEditorSearchText(), searchQuery);
      if (matches.length === 0) return;
      replaceInVisualDom(matches);
      handleInput();
      performSearch(searchQuery);
  };
  
  const [activeMenu, setActiveMenu] = useState<ToolbarMenu>('NONE');
  const [isTableContext, setIsTableContext] = useState(false);

  // --- STATE GAMBAR ---
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [imageWidth, setImageWidth] = useState<number>(100); // Dalam persen

  // --- HELPER: Base64 to Blob (Untuk Copy Image) ---
  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data.split(',')[1]);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  // --- MESIN WAKTU: SISTEM UNDO/REDO BUATAN SENDIRI ---
  const performUndo = () => {
    const index = historyIndexRef.current;
    const entries = historyContentRef.current;
    if (index > 0) {
      const newIndex = index - 1;
      const restoredContent = entries[newIndex].content;
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
      onUpdate({ ...note, content: restoredContent });
      persistChain(entries, newIndex); // simpan posisi kursor agar supaya stabil setelah reload

      // Fokuskan kembali kursor agar user tidak bingung
      if (isCodeView && codeEditorRef.current) codeEditorRef.current.focus();
      else if (!isCodeView && editorRef.current) editorRef.current.focus();
    }
  };

  const performRedo = () => {
    const index = historyIndexRef.current;
    const entries = historyContentRef.current;
    if (index < entries.length - 1) {
      const newIndex = index + 1;
      const restoredContent = entries[newIndex].content;
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
      onUpdate({ ...note, content: restoredContent });
      persistChain(entries, newIndex);

      // Fokuskan kembali kursor
      if (isCodeView && codeEditorRef.current) codeEditorRef.current.focus();
      else if (!isCodeView && editorRef.current) editorRef.current.focus();
    }
  };

  // Hitung sekali diff kata per versi saat modal dibuka (lazy + cache), sehingga
  // render modal tidak membebani CPU untuk setiap item.
  useEffect(() => {
    if (!showHistoryModal) return;
    const entries = historyContentRef.current;
    let changed = false;
    const next = entries.map((e, i) => {
      if (i > 0 && !e.wordDiff) {
        changed = true;
        return { ...e, wordDiff: computeWordDiff(cleanText(entries[i - 1].content), cleanText(e.content)) };
      }
      return e;
    });
    if (changed) applyHistory(next, historyIndexRef.current);
  }, [showHistoryModal]);

  // Ambil range seleksi editor: utamakan seleksi live, lalu seleksi terakhir
  // yang masih valid saat fokus berpindah ke toolbar.
  const ambilRangeEditor = (): Range | null => {
    const el = editorRef.current;
    if (!el) return null;

    const selection = window.getSelection();
    let range: Range | null = null;

    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const live = selection.getRangeAt(0);
      if (el.contains(live.startContainer) && el.contains(live.endContainer)) {
        range = live.cloneRange();
      }
    }

    const tersimpan = lastSelectionRef.current;
    if (!range && tersimpan && !tersimpan.collapsed
        && tersimpan.startContainer.isConnected
        && el.contains(tersimpan.startContainer)
        && el.contains(tersimpan.endContainer)) {
      range = tersimpan.cloneRange();
    }

    return range && !range.collapsed ? range : null;
  };

  // --- ARSIP: tangkap seleksi + hitung konten sumber tanpa memutasi DOM live ---
  // DOM tidak diubah sama sekali: konten sumber dihitung dari clone editor,
  // sehingga seleksi, kursor, dan format asli tetap utuh. Jika gagal, caller
  // wajib membatalkan operasi arsip.
  const captureArchiveSelection = (): { selectedHtml: string; sourceContent: string } | null => {
    const el = editorRef.current;
    if (!el || note.id === 'safe-temp') return null;

    const range = ambilRangeEditor();
    if (!range) return null;

    const startPath = jalurNodeDalam(range.startContainer, el);
    const endPath = jalurNodeDalam(range.endContainer, el);
    if (!startPath || !endPath) return null;

    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    const selectedHtml = holder.innerHTML
      .replace(/<mark class="search-(?:hit|current)">([\s\S]*?)<\/mark>/gi, '$1');
    if (!selectedHtml.trim()) return null;

    const salinan = el.cloneNode(true) as HTMLElement;
    const startNode = nodeDariJalur(salinan, startPath);
    const endNode = nodeDariJalur(salinan, endPath);
    if (!startNode || !endNode) return null;

    const cloneRange = document.createRange();
    try {
      cloneRange.setStart(startNode, range.startOffset);
      cloneRange.setEnd(endNode, range.endOffset);
    } catch {
      return null;
    }
    cloneRange.deleteContents();

    const sourceContent = salinan.innerHTML
      .replace(/<mark class="search-(?:hit|current)">([\s\S]*?)<\/mark>/gi, '$1');

    return { selectedHtml, sourceContent };
  };

  // --- MODE KODE: draft lokal + seleksi hasil pemetaan ---
  const bolehKeluarModeKode = (): boolean => {
    if (!isCodeView) return true;
    if (!codeDraftDirtyRef.current || codeDraft === null) return true;

    const remoteBerubah =
      (note.content || '') !== codeRemoteBaseRef.current;

    if (remoteBerubah) {
      const simpan = window.confirm(
        'Versi catatan berubah dari server saat Anda mengedit HTML. ' +
        'OK = simpan draf lokal. Batal = tetap di mode kode.'
      );

      if (!simpan) return false;
    }

    onUpdate({ ...note, content: codeDraft });
    return true;
  };

  const toggleModeKode = () => {
    if (isCodeView) {
      if (!bolehKeluarModeKode()) return;
      setCodeDraft(null);
      pendingCodeSelectionRef.current = null;
      codeRemoteBaseRef.current = '';
      codeDraftDirtyRef.current = false;
      setIsCodeView(false);
    } else {
      const el = editorRef.current;
      const range = el ? ambilRangeEditor() : null;
      let draft = note.content || '';
      let seleksiKode: { start: number; end: number } | null = null;

      if (el && range) {
        const peta = petakanRangeKeKode(range, el);
        if (peta) {
          draft = peta.codeText;
          seleksiKode = { start: peta.start, end: peta.end };
        }
      }

      codeRemoteBaseRef.current = note.content || '';
      codeDraftDirtyRef.current = false;
      setCodeDraft(draft);
      pendingCodeSelectionRef.current = seleksiKode;
      setIsCodeView(true);
      setIsPreviewMode(false);
    }

    setSearchQuery('');
    setSearchResults([]);
    setShowReplace(false);
    setReplaceQuery('');
  };

  // Ikuti perubahan note (termasuk update dari perangkat lain) saat mode kode.
  // Draft yang sudah diubah pengguna tidak boleh ditimpa diam-diam.
  useEffect(() => {
    if (!isCodeView) return;

    const remote = note.content || '';

    if (remote === codeRemoteBaseRef.current) return;

    // Jika draft lokal sudah berubah, pertahankan baseline lama
    // agar konflik remote tetap bisa dideteksi saat keluar mode.
    if (codeDraftDirtyRef.current) return;

    codeRemoteBaseRef.current = remote;
    setCodeDraft(remote);
    pendingCodeSelectionRef.current = null;
  }, [note.content, isCodeView]);

  // Terapkan seleksi setelah textarea mode kode benar-benar ter-render.
  useLayoutEffect(() => {
    if (!isCodeView) return;
    const target = pendingCodeSelectionRef.current;
    const ta = codeEditorRef.current;
    if (!target || !ta) return;

    ta.focus();
    ta.setSelectionRange(target.start, target.end);

    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const baris = ta.value.slice(0, target.start).split('\n').length;
    ta.scrollTop = Math.max(0, (baris - 1) * lineHeight - ta.clientHeight / 2);
    pendingCodeSelectionRef.current = null;
  }, [isCodeView, codeDraft]);

  // --- CLIPBOARD: Ctrl+C / menu konteks Copy (seleksi saja) ---
  // Menulis HTML seleksi + teks polos hasil serialisasi sendiri agar tidak
  // muncul baris kosong ganda dari innerText browser.
  const handleCopyEvent = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isCodeView) return;
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;

    // LOCK ENFORCEMENT: copy lock menahan penyalinan (termasuk seleksi campuran).
    if (rangeHasCopyLock(range, el)) {
      e.preventDefault();
      notifyLocked('copy');
      return;
    }

    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    const html = holder.innerHTML;
    if (!html.trim()) return;

    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', htmlKeTeksPolos(html));
    e.preventDefault();
  };

  // --- CLIPBOARD: Ctrl+X / menu konteks Cut (seleksi saja) ---
  // Selalu memakai serialisasi sendiri agar teks polos tidak berganda baris.
  // Dengan tujuan arsip: arsipkan dulu. Tanpa tujuan: hapus seleksi setelah copy.
  const handleCutEvent = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (arsipSeleksiRef.current) {
      e.preventDefault();
      return;
    }

    // Cut hanya berlaku bila ada seleksi live (bukan fallback seleksi lama).
    const liveSel = window.getSelection();
    if (!liveSel || liveSel.rangeCount === 0 || liveSel.isCollapsed) return;

    // LOCK ENFORCEMENT: cut menyentuh copy lock maupun delete lock.
    const cutEl = editorRef.current;
    if (cutEl) {
      const cutRange = liveSel.getRangeAt(0);
      if (cutEl.contains(cutRange.startContainer)
          && (rangeHasCopyLock(cutRange, cutEl) || rangeHasDeleteLock(cutRange, cutEl))) {
        e.preventDefault();
        notifyLocked('both');
        return;
      }
    }

    const cap = captureArchiveSelection();
    if (!cap) return; // tidak ada seleksi valid -> cut native

    e.clipboardData.setData('text/html', cap.selectedHtml);
    e.clipboardData.setData('text/plain', htmlKeTeksPolos(cap.selectedHtml));
    e.preventDefault();

    if (punyaTujuanArsip && onArchiveSelectionContent) {
      arsipSeleksiRef.current = true;
      void onArchiveSelectionContent(cap.selectedHtml, cap.sourceContent, true)
        .catch(() => {})
        .finally(() => { arsipSeleksiRef.current = false; });
      return;
    }

    // Cut normal: hapus seleksi setelah clipboard terisi.
    const sel = window.getSelection();
    const el = editorRef.current;
    if (sel && el && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (el.contains(range.startContainer) && el.contains(range.endContainer)) {
        range.deleteContents();
        handleInput();
      }
    }
  };

  // --- LOCK ENFORCEMENT: cek DELETE LOCK untuk input yang menghapus/mengganti teks ---
  // Dipanggil dari handleBeforeInput dan handleKeyDown.
  const isDeleteLockedInput = (inputType: string): boolean => {
    if (!editorRef.current) return false;
    const root = editorRef.current;

    // Hanya tipe input yang menghapus/mengganti konten yang diperiksa.
    const isDeletion = inputType.startsWith('delete');
    const isInsertion = inputType.startsWith('insert');
    if (!isDeletion && !isInsertion) return false;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return false;

    if (!range.collapsed) {
      // Seleksi: campuran teks biasa + terkunci = batalkan seluruh operasi.
      return rangeHasDeleteLock(range, root);
    }

    // Caret: periksa wrapper di posisi kursor, lalu karakter yang akan terhapus.
    if (getLockFlagAt(range.startContainer, 'delete')) return true;
    if (inputType === 'insertText' || inputType === 'insertCompositionText' || inputType === 'insertFromPaste') {
      return false; // pengetikan di caret kosong dalam teks biasa
    }

    const probe = document.createRange();
    try {
      if (inputType === 'deleteContentBackward' || inputType === 'deleteWordBackward'
          || inputType === 'deleteSoftLineBackward' || inputType === 'deleteHardLineBackward') {
        if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
          probe.setStart(range.startContainer, range.startOffset - 1);
          probe.setEnd(range.startContainer, range.startOffset);
        } else {
          return false;
        }
      } else if (inputType === 'deleteContentForward' || inputType === 'deleteWordForward'
          || inputType === 'deleteSoftLineForward' || inputType === 'deleteHardLineForward') {
        if (range.startContainer.nodeType === Node.TEXT_NODE
            && range.startOffset < (range.startContainer as Text).length) {
          probe.setStart(range.startContainer, range.startOffset);
          probe.setEnd(range.startContainer, range.startOffset + 1);
        } else {
          return false;
        }
      } else {
        return false;
      }
    } catch {
      return false;
    }

    return rangeHasDeleteLock(probe, root);
  };

  // Petakan tombol keyboard ke inputType agar jalur fallback konsisten dengan beforeinput.
  const keyToInputType = (e: React.KeyboardEvent): string | null => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Backspace') return mod ? 'deleteWordBackward' : 'deleteContentBackward';
    if (e.key === 'Delete') return mod ? 'deleteWordForward' : 'deleteContentForward';
    return null;
  };

  // --- DELETE KEY / menu konteks Delete: hanya seleksi, bukan Backspace ---
  const handleBeforeInput = async (e: React.FormEvent<HTMLDivElement>) => {
    const ev = e.nativeEvent as InputEvent;

    // 0. LOCK ENFORCEMENT: delete lock menahan semua penghapusan/penggantian.
    if (isDeleteLockedInput(ev.inputType)) {
      e.preventDefault();
      notifyLocked('delete');
      return;
    }

    if (ev.inputType !== 'deleteContentForward' && ev.inputType !== 'deleteByCut') return;
    if (!punyaTujuanArsip || !onArchiveSelectionContent) return;

    // Hanya seleksi live; kursor tanpa seleksi harus tetap menghapus normal.
    const liveSel = window.getSelection();
    if (!liveSel || liveSel.rangeCount === 0 || liveSel.isCollapsed) return;

    if (arsipSeleksiRef.current) {
      e.preventDefault();
      return;
    }

    const cap = captureArchiveSelection();
    if (!cap) return; // kursor tanpa seleksi -> hapus karakter normal

    e.preventDefault();
    arsipSeleksiRef.current = true;
    try {
      await onArchiveSelectionContent(cap.selectedHtml, cap.sourceContent, true);
    } finally {
      arsipSeleksiRef.current = false;
    }
  };

  // Expose undo/redo to parent via Ref
  useImperativeHandle(ref, () => ({
    undo: performUndo,
    redo: performRedo,
    getContent: () => historyContentRef.current[historyIndexRef.current]?.content ?? note.content,
    captureArchiveSelection
  }));

  // --- TOMBOL UTAMA: Atur Opacity Solid (100%) sementara selama 3 detik ---
  // Klik pada tombol utama (Titik Tiga, Salin, Kembali) menjadikan tombol solid,
  // dan timer di-reset setiap kali ada klik baru.
  const activateMainBtnSolid = () => {
      setMainBtnSolid(true);
      if (mainBtnOpacityTimerRef.current) clearTimeout(mainBtnOpacityTimerRef.current);
      mainBtnOpacityTimerRef.current = setTimeout(() => {
          setMainBtnSolid(false); // Kembali ke opacity 25% setelah 3 detik tanpa interaksi
      }, 3000);
  };

  // --- TUTUP MODE OPSI (Tumpukan tombol opsi) ---
  const closeOptionMenu = () => {
      setShowOptionMenu(false);
      // Kembalikan tampilan tombol utama langsung ke transparansi 25%
      setMainBtnSolid(false);
      if (mainBtnOpacityTimerRef.current) clearTimeout(mainBtnOpacityTimerRef.current);
  };

  // --- KLIK DI CATATAN ATAU LUAR MENU: tutup mode opsi ---
  useEffect(() => {
      if (!showOptionMenu) return;
      const handleOutsideClick = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          // Abaikan klik pada tombol-tombol opsi
          if (target.closest('[data-option-btn]')) return;
          // Abaikan klik pada tombol utama (mis. klik yang baru saja membuka menu)
          if (target.closest('[data-main-btn]')) return;
          // Klik pada area catatan juga menutup mode lanjutan.
          closeOptionMenu();
      };
      document.addEventListener('click', handleOutsideClick);
      return () => document.removeEventListener('click', handleOutsideClick);
  }, [showOptionMenu]);

  // Mode lanjutan kembali ke mode awal setelah 3 detik tanpa interaksi.
  useEffect(() => {
      if (!showOptionMenu) return;
      const timer = setTimeout(() => setShowOptionMenu(false), 3000);
      return () => clearTimeout(timer);
  }, [showOptionMenu]);

  // Tutup mode lanjutan saat catatan/mode tampilan berubah.
  useEffect(() => {
      setShowOptionMenu(false);
  }, [note.id, isCodeView, isPreviewMode]);

  // Ganti catatan: buang draft/penanda lama agar tidak bocor ke catatan baru.
  useEffect(() => {
      setCodeDraft(null);
      pendingCodeSelectionRef.current = null;
      codeRemoteBaseRef.current = '';
      codeDraftDirtyRef.current = false;
      setIsCodeView(false);
      lastLocalHTML.current = '';
      lastSelectionRef.current = null;
      savedSelection.current = null;
  }, [note.id]);

  // Mode kode/preview tidak memiliki seleksi editor visual.
  useEffect(() => {
      if (isCodeView || isPreviewMode) onSelectionAvailabilityChange?.(false);
  }, [isCodeView, isPreviewMode, onSelectionAvailabilityChange]);

  // Tangkap seleksi teks terakhir (non-kosong) di dalam editor.
  // Pada perangkat sentuh, mengetuk tombol toolbar meng-collapse pilihan teks,
  // jadi simpan range saat drag/selectionchange agar konversi daftar tetap bisa
  // membaca pilihan user (block → checkbox/bullet).
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      const el = editorRef.current;
      const valid = !!(
        sel && sel.rangeCount > 0 && !sel.isCollapsed && el &&
        el.contains(sel.getRangeAt(0).startContainer) &&
        el.contains(sel.getRangeAt(0).endContainer)
      );

      if (valid && sel) {
        lastSelectionRef.current = sel.getRangeAt(0).cloneRange();
      }
      onSelectionAvailabilityChange?.(valid);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [onSelectionAvailabilityChange]);

  // Sync content awal perubahan
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const domHtml = el.innerHTML;

    // Fast path HANYA jika DOM terpasang sudah berisi konten yang sama.
    // DOM baru yang kosong (mis. setelah keluar dari mode kode) tidak boleh dilewati
    // hanya karena lastLocalHTML masih sama dengan note.content.
    if (lastLocalHTML.current === note.content && domHtml === note.content) {
      addCheckboxListeners();
      return;
    }

    if (domHtml !== note.content) {
      const isFocused = document.activeElement === el;

      el.innerHTML = note.content;

      // Opsional: Jika sedang fokus, kembalikan kursor ke akhir teks
      // agar tidak hilang total saat update masuk
      if (isFocused) {
          try {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(el);
            range.collapse(false); // Pindahkan kursor ke paling akhir
            sel?.removeAllRanges();
            sel?.addRange(range);
          } catch (e) {
                // Abaikan error seleksi jika terjadi
              }
          }
        }
        addCheckboxListeners();
        lastSelectionRef.current = null; // konten diganti, seleksi lama tidak relevan
      }, [note.id, note.content, isCodeView]); // <--- PERBAIKAN: Tambahkan isCodeView di dalam kurung siku ini

      // akhir perubahan

  const addCheckboxListeners = () => {
    if (!editorRef.current) return;
    
    // Cleanup listeners lama untuk mencegah event stacking
    if (checkboxAbortRef.current) {
        checkboxAbortRef.current.abort();
    }
    const controller = new AbortController();
    checkboxAbortRef.current = controller;
    
    const checkboxes = editorRef.current.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const target = cb as HTMLInputElement;
        const parent = target.closest('.todo-item') as HTMLElement;
        
        if (parent) {
            // SELURUH wrapper jadi editing-host TUNGGAL agar drag-select bisa
            // melintasi beberapa checkbox sekaligus (bukan non-editable + span editable
            // terpisah yang mengunci seleksi di satu item).
            parent.contentEditable = 'true';
            let span = parent.querySelector('span');
            if (span) {
                span.removeAttribute('contenteditable');
                span.style.outline = 'none';
            }
        }

        target.addEventListener('click', (e) => {
            const el = e.target as HTMLInputElement;
            const p = el.closest('.todo-item');
            
            if (p) {
                if (el.checked) {
                    el.setAttribute('checked', 'checked');
                    p.classList.add('completed');
                    if (el.dataset.days) {
                        el.setAttribute('data-checked-time', Date.now().toString());
                    }
                } else {
                    el.removeAttribute('checked');
                    p.classList.remove('completed');
                    el.removeAttribute('data-checked-time');
                }
                handleInput(); 
            }
        }, { signal: controller.signal });
    });
  };

  // Di dalam komponen Editor, sejajar dengan ref lain:
  const isIgnoringClick = useRef(false); // Tambahan untuk mencegah klik tidak sengaja
  const checkboxAbortRef = useRef<AbortController | null>(null); // Cleanup checkbox listeners
  const mentionCreatedIdsRef = useRef<Set<string>>(new Set()); // Track newly created note IDs for autocomplete
  
    // --- KEYBOARD HANDLING (FULL FIX) ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 0. LOCK ENFORCEMENT: fallback bila browser tidak memicu beforeinput.
    const lockInputType = keyToInputType(e);
    if (lockInputType && isDeleteLockedInput(lockInputType)) {
        e.preventDefault();
        notifyLocked('delete');
        return;
    }

    // 1. Handle Mention List (Tetap sama)
    if (showMentionList) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const currentFiltered = allNotes.filter(n => 
                n.title.toLowerCase().includes(mentionQuery.toLowerCase()) && 
                n.id !== note.id 
            );
            handleMentionSelect(currentFiltered.length > 0 ? currentFiltered[0] : null);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            setShowMentionList(false);
            return;
        }
    }

    const selection = window.getSelection();
    if (!selection?.anchorNode) return;
    
    // Normalisasi Node
    let node: Node | null = selection.anchorNode;
    if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentNode;
    }

    // 2. DETEKSI LIST / BLOCKQUOTE (Format biasa)
    const block = (node as HTMLElement).closest('li, blockquote');
    if (block) {
        // ... (Kode lama untuk Li/Blockquote bisa dibiarkan atau pakai logika standar)
        // Agar aman, fokus pada perbaikan Checkbox di bawah ini
    }

    // 4. HANDLE MENTION CHIP DELETION (Backspace/Delete)
    // Chip ber-contenteditable="false" tidak bisa dihapus normal oleh browser;
    // deteksi saat kursor tepat bersebelahan lalu hapus chip secara manual.
    if ((e.key === 'Backspace' || e.key === 'Delete') && selection.rangeCount > 0) {
      const caretRange = selection.getRangeAt(0);
      if (caretRange.collapsed) {
        const selNode = selection.anchorNode;
        const selOffset = selection.anchorOffset;
        let chipToRemove: HTMLElement | null = null;
        let caretParent: Node | null = null;
        let caretOffset = 0;
        let removeSpacerText = false;

        const findPrevChip = (start: Node | null): HTMLElement | null => {
          let prev = start;
          while (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent) {
            prev = prev.previousSibling;
          }
          return prev && (prev as HTMLElement).classList?.contains('mention-chip')
            ? (prev as HTMLElement)
            : null;
        };
        const findNextChip = (start: Node | null): HTMLElement | null => {
          let next = start;
          while (next && next.nodeType === Node.TEXT_NODE && !next.textContent) {
            next = next.nextSibling;
          }
          return next && (next as HTMLElement).classList?.contains('mention-chip')
            ? (next as HTMLElement)
            : null;
        };

        if (e.key === 'Backspace') {
          if (selNode && selNode.nodeType === Node.TEXT_NODE) {
            const text = selNode.textContent || '';
            if (selOffset === 0) {
              chipToRemove = findPrevChip(selNode.previousSibling);
              if (chipToRemove) { caretParent = selNode.parentNode; caretOffset = 0; }
            } else if (
              selOffset === text.length &&
              /^[\u00A0\s]*$/.test(text.slice(0, selOffset))
            ) {
              // Kursor di ujung teks pemisah (hanya nbsp/spasi) setelah chip
              chipToRemove = findPrevChip(selNode.previousSibling);
              if (chipToRemove) { caretParent = selNode.parentNode; caretOffset = 0; removeSpacerText = true; }
            }
          } else if (selNode && selNode.nodeType === Node.ELEMENT_NODE && selOffset > 0) {
            const prevChild = (selNode as HTMLElement).childNodes[selOffset - 1];
            chipToRemove = prevChild ? findPrevChip(prevChild) : null;
            if (chipToRemove) { caretParent = selNode; caretOffset = selOffset - 1; }
          }
        } else { // Delete
          if (selNode && selNode.nodeType === Node.TEXT_NODE) {
            const text = selNode.textContent || '';
            if (selOffset >= text.length) {
              chipToRemove = findNextChip(selNode.nextSibling);
              if (chipToRemove) { caretParent = selNode.parentNode; caretOffset = selOffset; }
            }
          } else if (selNode && selNode.nodeType === Node.ELEMENT_NODE) {
            const nextChild = (selNode as HTMLElement).childNodes[selOffset] || null;
            chipToRemove = nextChild ? findNextChip(nextChild) : null;
            if (chipToRemove) { caretParent = selNode; caretOffset = selOffset; }
          }
        }

        if (chipToRemove) {
          e.preventDefault();

          // Buang teks pemisah (nbsp/spasi) yang menggantung setelah chip
          if (removeSpacerText && selNode && selNode.nodeType === Node.TEXT_NODE) {
            (selNode as Text).remove();
          }
          chipToRemove.remove();

          // Pulihkan kursor di posisi chip yang baru saja dihapus
          if (caretParent) {
            try {
              const r = document.createRange();
              r.setStart(caretParent, caretOffset);
              r.collapse(true);
              selection.removeAllRanges();
              selection.addRange(r);
            } catch (err) {
              console.error("Error restoring caret after chip delete:", err);
            }
          }

          handleInput();
          return;
        }
      }
    }

    // 3. HANDLE TODO ITEMS (CHECKBOX)
    const todoItem = (node as HTMLElement).closest('.todo-item');
    if (todoItem) {
        const currentItem = todoItem as HTMLElement;
        const currentSpan = currentItem.querySelector('span');
        
        // Cek apakah kursor ada di AWAL baris (offset 0)
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        const startInSpan = !!(currentSpan && (currentSpan === startContainer || currentSpan.contains(startContainer)));
        // Wrapper sekarang editable: kursor bisa berada di dalam span (biasanya)
        // atau langsung di div (saat klik sebelum spasi/area kosong).
        const isAtStart = range.collapsed && (
          (startInSpan && range.startOffset === 0) ||
          (startContainer === currentItem && range.startOffset <= 1)
        );

        // --- START: DELETE di akhir item ---
        // Dengan wrapper editable, Delete di ujung item bisa "menelan" checkbox
        // berikutnya. Cegah agar tidak menggabungkan dua checkbox.
        if (e.key === 'Delete' && range.collapsed && startInSpan) {
            const textLen = currentSpan?.textContent?.length || 0;
            let atEndOfSpan = false;
            if (startContainer.nodeType === Node.TEXT_NODE) {
                if (range.startOffset >= textLen && !startContainer.nextSibling) atEndOfSpan = true;
            } else if (startContainer === currentSpan) {
                if (range.startOffset >= currentSpan!.childNodes.length) atEndOfSpan = true;
            }
            const nextTodo = currentItem.nextElementSibling;
            if (atEndOfSpan && nextTodo && nextTodo.classList.contains('todo-item')) {
                e.preventDefault();
                return;
            }
        }
        // --- END: DELETE di akhir item ---

        // --- A. BACKSPACE: UBAH JADI TEKS BIASA ---
        if (e.key === 'Backspace' && isAtStart) {
            e.preventDefault();
            
            // 1. Buat elemen Paragraf (P) baru
            const p = document.createElement('p');
            
            // 2. Pindahkan isi teks dari Checkbox ke P
            // Menggunakan innerHTML agar format bold/italic di dalamnya tetap ada
            if (currentSpan) {
                p.innerHTML = currentSpan.innerHTML;
            }
            
            // 3. Jika kosong, beri <br> agar baris tetap ada
            if (p.innerHTML.trim() === '') p.innerHTML = '<br>';

            // 4. Ganti Checkbox dengan P
            if (todoItem.parentNode) {
                todoItem.parentNode.replaceChild(p, todoItem);
                
                // 5. Kembalikan kursor ke awal P
                const newRange = document.createRange();
                newRange.setStart(p, 0);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
            }
            
            handleInput(); // Simpan
            return;
        }

        // --- B. ENTER: HAPUS JIKA KOSONG, SPLIT JIKA ADA KONTEN ---
        if (e.key === 'Enter') {
            e.preventDefault();
            
            // Cek apakah span kosong (hanya &nbsp;, <br>, atau benar-benar kosong)
            const spanText = currentSpan?.textContent?.replace(/[\u00A0\s]/g, '') || '';
            const spanHtml = currentSpan?.innerHTML?.replace(/&nbsp;/g, '').replace(/<br\s*\/?>/gi, '').trim() || '';
            const isEmpty = spanText.length === 0 && spanHtml.length === 0;
            
            if (isEmpty) {
                // --- KOSONG: Hapus checkbox, konversi ke paragraf ---
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                
                if (todoItem.parentNode) {
                    todoItem.parentNode.replaceChild(p, todoItem);
                    
                    // Kursor di awal paragraf baru
                    const newRange = document.createRange();
                    newRange.setStart(p, 0);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
                
                handleInput();
                return;
            }
            
            // --- ADA KONTEN: Split line (buat checkbox baru di bawah) ---
            // Buat elemen baru (wariskan recurring dari parent jika ada)
            const isRecurringParent = currentItem.classList.contains('recurring');
            const newItem = document.createElement('div');
            newItem.className = 'todo-item' + (isRecurringParent ? ' recurring' : '');
            newItem.contentEditable = 'true';
            
            const newCheckbox = document.createElement('input');
            newCheckbox.type = 'checkbox';
            if (isRecurringParent) {
                const srcDays = currentItem.querySelector('input')?.getAttribute('data-days');
                if (srcDays) newCheckbox.setAttribute('data-days', srcDays);
            }
            
            const newSpan = document.createElement('span');
            newSpan.style.outline = 'none';

            // Logika Potong Teks (Cut & Paste ke bawah)
            if (currentSpan && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                
                // Pastikan range valid di dalam span ini
                if (currentSpan.contains(range.startContainer)) {
                    const splitRange = document.createRange();
                    splitRange.setStart(range.startContainer, range.startOffset);
                    splitRange.setEndAfter(currentSpan.lastChild || currentSpan);
                    
                    const contentFragment = splitRange.extractContents(); // POTONG
                    
                    if (contentFragment.textContent?.trim() || contentFragment.childNodes.length > 0) {
                        newSpan.appendChild(contentFragment);
                    } else {
                        newSpan.innerHTML = '\u00A0'; // Spasi kosong
                    }
                } else {
                    newSpan.innerHTML = '\u00A0';
                }
            }

            newItem.appendChild(newCheckbox);
            newItem.appendChild(newSpan);
            
            // Masukkan di bawah item sekarang
            if (currentItem.nextSibling) {
                currentItem.parentNode?.insertBefore(newItem, currentItem.nextSibling);
            } else {
                currentItem.parentNode?.appendChild(newItem);
            }

            // Pindahkan fokus
            setTimeout(() => {
                addCheckboxListeners(); // Re-bind event click
                const newRange = document.createRange();
                
                // Fokus ke awal span baru
                if (newSpan.firstChild) {
                     newRange.setStart(newSpan.firstChild, 0);
                } else {
                     newRange.setStart(newSpan, 0);
                }
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 0);

            handleInput();
            return;
        }
    }
  };

  // --- RAF THROTTLE: pembungkus penjadwalan (maksimal satu eksekusi per frame) ---
  // Seluruh pemanggilan yang ada tetap memanggil handleInput; eksekusi proses
  // ditunda ke frame berikutnya dan hanya satu yang boleh antre per frame.
  const handleInput = () => {
    if (!editorRef.current) return;
    if (rafRef.current !== null) return; // Sudah ada RAF yang tertunda — jangan dobel
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null; // Reset dulu sebelum memproses agar panggilan berikutnya sah
      handleInputInternal();
    });
  };

  // Tubuh pemrosesan input ASLI (dipertahankan identik dari handleInput lama)
  const handleInputInternal = () => {
    if (!editorRef.current) return;
    checkSelectionContext();

    // --- LOGIKA MENTION (@.) ---
    const selection = window.getSelection();

    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;

      if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
        const textBeforeCursor = textNode.textContent.slice(0, range.startOffset);

        // 1. KONDISI TRIGGER: Jika menu BELUM terbuka
        if (!showMentionList) {
          // Cek apakah user mengetik "@."
          if (textBeforeCursor.endsWith('@.')) {
            const atIndex = textBeforeCursor.lastIndexOf('@');

            try {
              // --- LANGKAH 1: HAPUS TITIK (.) DULU SEBELUM UPDATE STATE ---
              // Ini krusial agar 'content' yang dikirim ke onUpdate sudah bersih.
              // Jika tidak, useEffect akan mendeteksi perbedaan dan mereset kursor.
              const deleteRange = document.createRange();
              if (range.startOffset > 0) {
                 deleteRange.setStart(textNode, range.startOffset - 1);
                 deleteRange.setEnd(textNode, range.startOffset);
                 deleteRange.deleteContents(); // Hapus titiknya
              }

              // --- LANGKAH 2: PERBAIKI POSISI KURSOR ---
              const newRange = document.createRange();
              // Karena titik sudah dihapus, posisi target ada tepat setelah '@'
              const newCursorPos = atIndex + 1;
              
              // Safety check agar tidak error jika index kacau
              if (newCursorPos <= textNode.textContent.length) {
                  newRange.setStart(textNode, newCursorPos);
              } else {
                  newRange.setStart(textNode, textNode.textContent.length);
              }
              newRange.collapse(true);

              selection.removeAllRanges();
              selection.addRange(newRange);
              setCursorRange(newRange);

              // --- LANGKAH 3: BUKA MENU ---
              const rect = newRange.getBoundingClientRect();
              setMentionPosition({ top: rect.top - 40, left: rect.left });
              setMentionQuery('');
              setShowMentionList(true);
              
            } catch (err) {
              console.error("Error adjusting cursor:", err);
            }
          }
        } 
        // 2. KONDISI UPDATE: Jika menu SUDAH terbuka
        else {
           const atIndex = textBeforeCursor.lastIndexOf('@');
           if (atIndex !== -1) {
              const query = textBeforeCursor.slice(atIndex + 1);
              setMentionQuery(query);
              setCursorRange(range);
           } else {
              setShowMentionList(false);
           }
        }
      }
    }

    // --- LANGKAH TERAKHIR: SIMPAN KE STATE (ONUPDATE) ---
    // Hapus tag highlight pencarian agar tidak ikut tersimpan ke dalam konten
    const content = editorRef.current.innerHTML
        .replace(/<mark class="search-(?:hit|current)">(.*?)<\/mark>/gi, '$1');
    lastLocalHTML.current = content;
    onUpdate({ ...note, content });
    recordHistory(content); // Rekam perubahan ke dalam Mesin Waktu
  };

  // --- RAF THROTTLE: pembersihan & flush saat ganti catatan (note.id) / unmount ---
  // Saat note.id BERUBAH, cleanup ini berjalan SEBELUM efek sinkron konten menukar
  // isi DOM ke catatan baru (React menjalankan semua cleanup lebih dulu, lalu semua
  // tubuh efek). Jadi DOM pada saat ini masih milik catatan LAMA -> flush aman dari
  // tulis-silang antar catatan. Saat unmount, editorRef sudah dilepas React sehingga
  // handleInputInternal langsung no-op (guard editorRef.current).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        handleInputInternal(); // Flush konten terakhir dengan closure catatan lama
      }
    };
  }, [note.id]);

  // --- FUNGSI BARU: Perekam Mesin Waktu (Debounced, Diff-Based) ---
  const recordHistory = (newContent: string) => {
      // Tunggu user berhenti mengetik 1 detik sebelum merekam, agar history tidak dipenuhi per huruf
      if (isTypingTimer.current) clearTimeout(isTypingTimer.current);

      isTypingTimer.current = setTimeout(() => {
          isTypingTimer.current = null;
          if (!note.id || note.id === 'safe-temp') return;
          appendHistory(newContent);
      }, 1000); // 1 detik delay
  };

  const checkSelectionContext = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        let node = selection.anchorNode;
        let insideTable = false;
        while (node && node !== editorRef.current) {
            if (node.nodeName === 'TABLE') {
                insideTable = true;
                break;
            }
            node = node.parentNode;
        }
        setIsTableContext(insideTable);
    }
  };

  const insertMention = async (targetNoteId: string, targetTitle: string) => {
    if (!cursorRange || !editorRef.current) return;

    // Aktifkan pemblokir klik sementara agar link tidak langsung terpicu saat dibuat
    isIgnoringClick.current = true;
    setTimeout(() => { isIgnoringClick.current = false; }, 500);

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(cursorRange);
    }

    const textNode = cursorRange.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
        const text = textNode.textContent;
        // Cari posisi '@' terakhir sebelum kursor
        const atIndex = text.lastIndexOf('@', cursorRange.startOffset - 1);
        if (atIndex >= 0) {
            cursorRange.setStart(textNode, atIndex);
            cursorRange.deleteContents();
        }
    }

    // 1. Pastikan posisi kursor di browser sudah akurat setelah '@' dihapus
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(cursorRange);
    }

    // 2. Sisipkan chip via DOM manipulation (bukan execCommand).
    // execCommand('insertHTML') menghapus atribut class/data-id di Chrome
    // saat menyisipkan ke dalam <li> atau checkbox <span> (nested contentEditable).
    // Ambil range FRESH dari seleksi yang hidup agar aman jika teks node
    // tadi ikut terhapus/diubah browser saat deleteContents.
    const liveSel = window.getSelection();
    let insertRange = liveSel && liveSel.rangeCount > 0
      ? liveSel.getRangeAt(0).cloneRange()
      : null;
    if (!insertRange) return;
    insertRange.collapse(true);

    const chip = document.createElement('span');
    chip.className = 'mention-chip';
    chip.contentEditable = 'false';
    chip.dataset.id = targetNoteId;
    chip.textContent = '@' + targetTitle;

    const space = document.createTextNode('\u00A0');
    const frag = document.createDocumentFragment();
    frag.appendChild(chip);
    frag.appendChild(space);
    insertRange.insertNode(frag);

    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    if (liveSel) {
      liveSel.removeAllRanges();
      liveSel.addRange(newRange);
    }

    setShowMentionList(false);
    handleInput();
  };

  const handleMentionSelect = async (existingNote: Note | null) => {
    if (existingNote) {
      insertMention(existingNote.id, existingNote.title);
    } else {
      const newNoteResult = await onCreateNewNote(mentionQuery); 
      
      const newNoteId = typeof newNoteResult === 'string' ? newNoteResult : (newNoteResult as any)?.id;
      
      if (newNoteId) {
          mentionCreatedIdsRef.current.add(newNoteId);
          insertMention(newNoteId, mentionQuery);
      }
    }
  };

  // Di dalam components/Editor.tsx

const handleEditorClick = (e: React.MouseEvent) => {
    // 1. Cek blocker (mencegah klik hantu saat baru dibuat)
    if (isIgnoringClick.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    const target = e.target as HTMLElement;

    // --- PERBAIKAN UTAMA DI SINI ---
    // Jangan cuma cek elemen yang diklik (target), tapi cek juga bapak-nya (parent).
    // .closest() akan mencari elemen '.mention-chip' terdekat dari titik klik ke atas.
    const chip = target.closest('.mention-chip') as HTMLElement;

    if (chip) {
        const id = chip.dataset.id;
        if (id) {
            // PENTING: Mencegah browser menaruh kursor teks di dalam chip
            e.preventDefault(); 
            e.stopPropagation();
            
            // Jalankan navigasi
            onLinkClick(id);
            return; // Stop, jangan jalankan kode di bawah
        }
    }
    // -------------------------------

    // Logic standar editor (jika yang diklik BUKAN chip)
    
    // 2. Cek apakah yang diklik adalah GAMBAR
    if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        setSelectedImage(img);
        
        // Ambil width saat ini (dari style atau attribute)
        let currentWidth = 100;
        if (img.style.width) {
            currentWidth = parseInt(img.style.width);
        }
        setImageWidth(isNaN(currentWidth) ? 100 : currentWidth);
        
        setActiveMenu('IMAGE');
        e.stopPropagation(); // Stop agar tidak menutup menu image seketika
        return;
    } else {
        // Jika klik tempat lain, reset seleksi gambar
        setSelectedImage(null);
    }

    checkSelectionContext();
    setActiveMenu('NONE');
};

  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
     const target = e.target as HTMLElement;
     if (target.classList.contains('mention-chip')) {
        const id = target.dataset.id;
        if (id) {
            touchTimer.current = setTimeout(() => {
                onLinkLongPress(id);
            }, 600);
        }
     }
  };

  const handleTouchEnd = () => {
      if (touchTimer.current) {
          clearTimeout(touchTimer.current);
          touchTimer.current = null;
      }
  };

  // --- COMMANDS ---

  // Pilih range yang valid di dalam editor (anti range nyasar/detached)
  const resolveEditorRange = (restoreSelection: boolean): Range | null => {
    const editorEl = editorRef.current;
    if (!editorEl) return null;

    // 1. Seleksi simpanan, hanya jika diminta dan masih valid di dalam editor
    if (restoreSelection && savedSelection.current && editorEl.contains(savedSelection.current.startContainer)) {
        return savedSelection.current;
    }

    // 2. Seleksi aktif jika masih berada di dalam editor
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) {
        return sel.getRangeAt(0);
    }

    // 3. Fallback terakhir: kursor di akhir editor
    const fallback = document.createRange();
    fallback.selectNodeContents(editorEl);
    fallback.collapse(false);
    return fallback;
  };

  const execCmd = (command: string, value: string = '', restoreSelection: boolean = false) => {
    const editorEl = editorRef.current;
    if (!editorEl) return; // Mode Preview/Kode: editor tidak ter-render

    // 1. Fokuskan editor PALING DULU agar editing-host yang dipakai benar
    editorEl.focus();

    // 2. Pulihkan seleksi simpanan jika diminta (khusus dropdown size / dialog)
    if (restoreSelection) {
        const sel = window.getSelection();
        const range = resolveEditorRange(true);
        if (sel && range) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    document.execCommand(command, false, value);
    handleInput();
    setActiveMenu('NONE');
    savedSelection.current = null; // Bersihkan setelah digunakan
  };

  // --- SISIPKAN HTML LANGSUNG KE EDITOR (TIDAK BERGANTUNG execCommand) ---
  // Mengatasi gambar tidak muncul: setelah dialog pilih file, editor kehilangan
  // fokus/seleksi sehingga execCommand('insertHTML') menyisipkan di tempat salah
  // atau membuangnya. Helper ini fokuskan editor dulu lalu sisipkan via DOM.
  const insertHtmlAtCaret = (html: string, restoreSelection: boolean = true) => {
    const editorEl = editorRef.current;
    if (!editorEl) return; // Mode Preview/Kode: editor tidak ter-render

    // 1. Fokuskan editor PALING DULU sebelum menyisipkan
    editorEl.focus();

    const sel = window.getSelection();
    const range = resolveEditorRange(restoreSelection);
    if (!range) return;

    sel?.removeAllRanges();
    sel?.addRange(range);

    // 2. Sisipkan node langsung via DOM
    range.deleteContents();
    const frag = range.createContextualFragment(html);
    const lastNode = frag.lastChild;
    range.insertNode(frag);

    // 3. Pindahkan kursor setelah node yang disisipkan
    if (lastNode) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastNode);
        newRange.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(newRange);
    }

    savedSelection.current = null;
    handleInput();
    setActiveMenu('NONE');
  };

  // --- KONVERSI TIPE DAFTAR (BULLET/NUMBER/TODO) BERDASARKAN SELEKSI ---
  // Mengumpulkan blok (li/p/todo-item) yang bersinggungan dengan seleksi.
  const getSelectedListBlocks = (): HTMLElement[] => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    if (range.collapsed) return [];

    const isBlock = (el: HTMLElement) =>
      el.tagName === 'LI' || el.tagName === 'P' || el.classList.contains('todo-item');

    const blocks: HTMLElement[] = [];
    const walk = (node: HTMLElement) => {
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        Array.from(node.children).forEach(child => {
          if (child.tagName === 'LI' && range.intersectsNode(child)) {
            blocks.push(child as HTMLElement);
          }
        });
        return;
      }
      if (isBlock(node)) {
        if (range.intersectsNode(node)) blocks.push(node);
        return; // jangan masuk ke dalam blok lagi
      }
      Array.from(node.children).forEach(child => walk(child as HTMLElement));
    };
    walk(editorRef.current!);
    return blocks;
  };

  const createTodoItem = (innerHtml: string | null): HTMLElement => {
    const div = document.createElement('div');
    div.className = 'todo-item';
    div.contentEditable = 'true';
    const input = document.createElement('input');
    input.type = 'checkbox';
    const span = document.createElement('span');
    span.style.outline = 'none';
    span.innerHTML = (innerHtml && innerHtml.trim()) ? innerHtml : '\u00A0';
    div.append(input, span);
    return div;
  };

  const cleanupEmptyLists = () => {
    if (!editorRef.current) return;
    editorRef.current.querySelectorAll('ul, ol').forEach(list => {
      if (!list.querySelector('li')) list.remove();
    });
  };

  // Ubah seluruh daftar (ul/ol) menjadi deretan todo-item.
  // Item yang TIDAK diseleksi tetap dibungkus ul/ol baru (jenis daftar dipertahankan).
  const replaceListWithTodos = (list: HTMLElement, group: HTMLElement[], listTag: string): HTMLElement | null => {
    const selected = new Set(group);
    const frag = document.createDocumentFragment();
    let currentList: HTMLElement | null = null;
    let lastTodo: HTMLElement | null = null;
    const lis = Array.from(list.children) as HTMLElement[];

    const startList = () => {
      if (!currentList) {
        currentList = document.createElement(listTag);
        frag.appendChild(currentList);
      }
      return currentList;
    };

    lis.forEach(li => {
      if (selected.has(li)) {
        currentList = null;
        const todo = createTodoItem(li.innerHTML);
        frag.appendChild(todo);
        lastTodo = todo;
      } else {
        startList().appendChild(li);
      }
    });

    list.replaceWith(frag);
    return lastTodo;
  };

  // Ubah blok terpilih (li/p) menjadi todo-item. Mengembalikan elemen terakhir.
  const convertBlocksToTodo = (blocks: HTMLElement[]): HTMLElement | null => {
    let last: HTMLElement | null = null;

    const byParent = new Map<Element, HTMLElement[]>();
    blocks.forEach(b => {
      const key = b.parentElement;
      if (!key) return;
      const arr = byParent.get(key) || [];
      arr.push(b);
      byParent.set(key, arr);
    });

    byParent.forEach((group, parent) => {
      if (parent.tagName === 'UL' || parent.tagName === 'OL') {
        const converted = replaceListWithTodos(parent as HTMLElement, group, parent.tagName);
        if (converted) last = converted;
      } else {
        group.forEach(b => {
          if (b.classList.contains('todo-item')) return; // sudah checkbox, biarkan
          const todo = createTodoItem(b.innerHTML);
          b.replaceWith(todo);
          last = todo;
        });
      }
    });

    cleanupEmptyLists();
    return last;
  };

  // Ubah todo-item terpilih menjadi daftar biasa (ul/ol).
  const convertTodoToSimpleList = (blocks: HTMLElement[], tag: 'ul' | 'ol'): HTMLElement => {
    const list = document.createElement(tag);
    blocks.forEach(todo => {
      const span = todo.querySelector('span');
      const li = document.createElement('li');
      const inner = span ? span.innerHTML : '';
      li.innerHTML = inner && inner.trim() ? inner : '\u00A0';
      list.appendChild(li);
    });
    blocks[0].replaceWith(list);
    blocks.slice(1).forEach(t => t.remove());
    return list;
  };

  const placeCaretAfter = (node: HTMLElement | null) => {
    if (!node || !editorRef.current) return;
    try {
      const range = document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch (e) {
      // abaikan error seleksi
    }
  };

  // Tombol Bullet / 123 / Todo:
  // - Seleksi non-kosong → konversi daftar antar tipe.
  // - Tanpa seleksi → perilaku lama (insert checkbox / buat daftar).
  const handleListToolbar = (listType: 'bullet' | 'number' | 'todo') => {
    if (isCodeView || isPreviewMode) return;
    if (!editorRef.current) return;
    editorRef.current.focus();

    let sel = window.getSelection();
    const hasLiveSelection = !!sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed;

    // Seleksi sering hilang/di-collapse saat mengetuk tombol toolbar (terutama touch).
    // Pulihkan dari simpanan: drag terakhir (lastSelectionRef) lalu dari menu (savedSelection).
    const restoreRange = (range: Range | null): boolean => {
      if (!range || range.collapsed) return false;
      if (!editorRef.current?.contains(range.startContainer)) return false;
      if (sel) {
        sel.removeAllRanges();
        try {
          sel.addRange(range);
          return true;
        } catch (e) {
          return false;
        }
      }
      return false;
    };

    if (!hasLiveSelection) {
      if (!restoreRange(lastSelectionRef.current)) {
        restoreRange(savedSelection.current);
      }
      sel = window.getSelection();
    }

    const collapsed = !sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed;
    const execCommandFor = (cmd: string) => {

      execCmd(cmd, '', false);
      setActiveMenu('NONE');
    };

    if (collapsed) {
      if (listType === 'todo') insertCheckbox();
      else execCommandFor(listType === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList');
      return;
    }

    const blocks = getSelectedListBlocks();
    const allTodo = blocks.length > 0 && blocks.every(b => b.classList.contains('todo-item'));

    // --- TODO: ubah bullet/number/paragraf terpilih menjadi checkbox ---
    if (listType === 'todo') {
      if (blocks.length === 0) {
        insertCheckbox();
        setActiveMenu('NONE');
        return;
      }
      if (allTodo) return; // sudah checkbox semua
      // Abaikan paragraf kosong (mis. "<p><br></p>" di akhir editor) dan todo-item lama
      const toConvert = blocks.filter(b => {
        if (b.classList.contains('todo-item')) return false;
        if (b.tagName === 'P' && !(b.textContent || '').replace(/[\u00A0\s]/g, '')) return false;
        return true;
      });
      if (toConvert.length === 0) {
        insertCheckbox();
        setActiveMenu('NONE');
        return;
      }
      const last = convertBlocksToTodo(toConvert);
      addCheckboxListeners();
      handleInput();
      setActiveMenu('NONE');
      lastSelectionRef.current = null;
      savedSelection.current = null;
      placeCaretAfter(last);
      return;
    }

    // --- BULLET / NUMBER: ubah checkbox terpilih menjadi daftar biasa ---
    if (allTodo) {
      const tag = listType === 'bullet' ? 'ul' : 'ol';
      const list = convertTodoToSimpleList(blocks, tag);
      addCheckboxListeners();
      handleInput();
      setActiveMenu('NONE');
      lastSelectionRef.current = null;
      savedSelection.current = null;
      placeCaretAfter(list);
      return;
    }

    // Bukan checkbox: biarkan browser menangani konversinya (native)
    execCommandFor(listType === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList');
  };

  // Ubah fungsi insertCheckbox yang lama menjadi ini:
  const insertCheckbox = () => {
      // Simpan posisi kursor saat ini agar tidak hilang saat dialog muncul
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
          savedSelection.current = sel.getRangeAt(0).cloneRange();
      }
      setShowCheckboxDialog(true); // Buka Dialog
  };

  // Fungsi BARU untuk eksekusi final (Dipanggil dari Dialog)
  const confirmInsertCheckbox = (isRecurring: boolean) => {
      // Kembalikan posisi kursor
      if (savedSelection.current) {
          const sel = window.getSelection();
          if (sel) {
              sel.removeAllRanges();
              sel.addRange(savedSelection.current);
          }
      }

      const days = isRecurring ? parseInt(checkboxInterval) : 0;
      
      // Buat HTML Checkbox
      // Jika recurring, kita tambah class 'recurring' dan atribut 'data-days'
      const html = `<div class="todo-item ${isRecurring ? 'recurring' : ''}" contentEditable="true">
          <input type="checkbox" ${isRecurring ? `data-days="${days}"` : ''}>
          <span>\u00A0</span>
      </div>`;

      execCmd('insertHTML', html);
      addCheckboxListeners();
      
      // Reset & Tutup Dialog
      setShowCheckboxDialog(false);
      setCheckboxInterval('1');
      setActiveMenu('NONE');
  };

  const insertTable = () => {
    const html = `<table class="min-w-full border-collapse border border-gray-300"><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></tbody></table><p><br/></p>`;
    execCmd('insertHTML', html);
  };

  // --- INSERT IMAGE (RESPONSIVE) ---
  // Tambahkan parameter default 'restore = false'
  const insertResponsiveImage = (url: string, restore: boolean = false) => {
      const imgHtml = `<img src="${url}" class="max-w-full h-auto rounded-lg shadow-sm my-2 cursor-pointer border-2 border-transparent hover:border-blue-400 transition-all" style="width: 100%;" />`;
      // Gunakan sisipan DOM langsung agar tahan terhadap hilangnya fokus editor
      insertHtmlAtCaret(imgHtml, restore);
  };

  const insertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Mode Preview/Kode tidak punya area visual editor; jangan sisipkan
    if (isPreviewMode || isCodeView) return;
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
          if (event.target?.result) {
              // PENTING: Pass 'true' sebagai parameter kedua untuk mengembalikan kursor
              insertResponsiveImage(event.target.result as string, true);
          }
      };
      reader.readAsDataURL(file);
    }
    // PENTING: Reset value agar user bisa memilih gambar yang sama jika sebelumnya dihapus
    e.target.value = '';
  };

  // --- PASTE HANDLER (Menangani Ctrl+V Gambar) ---
  // --- LOCK ENFORCEMENT: DRAG & DROP ---
  const wrapperLockTokens = (el: Element | null): Set<string> => {
      const wrapper = el?.closest?.('uneditable');
      if (!wrapper) return new Set<string>();
      return new Set((wrapper.getAttribute('data-lock') || '').split(' ').filter(Boolean));
  };

  const handleEditorDragStart = (e: React.DragEvent<HTMLDivElement>) => {
      const root = editorRef.current;
      if (!root) return;

      // Menyeret elemen wrapper terkunci itu sendiri.
      const tokens = wrapperLockTokens(e.target as Element | null);
      if (tokens.size > 0) {
          e.preventDefault();
          notifyLocked('both');
          return;
      }

      // Menyeret seleksi teks yang menyentuh area terkunci.
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer)) return;
      if (rangeHasCopyLock(range, root) || rangeHasDeleteLock(range, root)) {
          e.preventDefault();
          notifyLocked('both');
      }
  };

  const handleEditorDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      // Area delete-locked tidak boleh menjadi target drop.
      if (wrapperLockTokens(e.target as Element | null).has('delete') && e.dataTransfer) {
          e.dataTransfer.dropEffect = 'none';
      }
  };

  const handleEditorDrop = (e: React.DragEvent<HTMLDivElement>) => {
      if (wrapperLockTokens(e.target as Element | null).has('delete')) {
          e.preventDefault();
          notifyLocked('delete');
      }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
      // LOCK ENFORCEMENT: paste tidak boleh menimpa/menyisip ke area delete-locked.
      if (isDeleteLockedInput('insertFromPaste')) {
          e.preventDefault();
          notifyLocked('delete');
          return;
      }

      const items = e.clipboardData.items;
      let hasImage = false;

      for (const item of items) {
          if (item.type.indexOf('image') === 0) {
              e.preventDefault(); // Mencegah paste default browser
              hasImage = true;
              const blob = item.getAsFile();
              if (blob) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                      if (event.target?.result) {
                          insertResponsiveImage(event.target.result as string);
                      }
                  };
                  reader.readAsDataURL(blob);
              }
          }
      }
      // Jika bukan gambar, biarkan default behavior (teks)
  };

  const handleTableAction = (action: string) => {
      const selection = window.getSelection();
      
      if (!selection || selection.rangeCount === 0) return;
      
      let node = selection.anchorNode as HTMLElement | null;
      
      while(node && node.nodeName !== 'TD' && node.nodeName !== 'TH' && node !== editorRef.current && node.nodeName !== 'BODY') {
          node = node.parentElement;
      }
      
      if (!node || (node.nodeName !== 'TD' && node.nodeName !== 'TH')) return;
      
      const cell = node as HTMLTableCellElement;
      const row = cell.parentElement as HTMLTableRowElement;
      const table = row?.parentElement?.parentElement as HTMLTableElement;

      if (!row || !table) return;

      switch(action) {
          case 'addRow':
            const newRow = row.cloneNode(true) as HTMLTableRowElement;
            Array.from(newRow.cells).forEach(c => c.innerHTML = '<br>');
            row.after(newRow);
            break;
          case 'addCol':
            const cellIndex = cell.cellIndex;
            Array.from(table.rows).forEach(r => {
                const newCell = r.insertCell(cellIndex + 1);
                newCell.innerHTML = '<br>';
                newCell.style.border = '1px solid #d1d5db';
                newCell.style.padding = '8px';
            });
            break;
          case 'delRow':
            row.remove();
            break;
          case 'delCol':
            const idx = cell.cellIndex;
            Array.from(table.rows).forEach(r => {
                if(r.cells[idx]) r.deleteCell(idx);
            });
            break;
          case 'delTable':
            table.remove();
            setIsTableContext(false);
            break;
      }
      handleInput();
      setActiveMenu('NONE');
  };
  
  // --- LOCK / UNLOCK ACTIONS ---
  // Satu sumber kebenaran: daftar wrapper <uneditable> yang terdampak oleh range.
  const getAffectedUneditables = (range: Range, root: HTMLElement): HTMLElement[] => {
      if (range.collapsed) {
          // Kursor collapsed: ambil wrapper terdekat dari posisi kursor.
          const sc = range.startContainer;
          const el: Element | null = sc.nodeType === Node.ELEMENT_NODE ? (sc as Element) : sc.parentElement;
          const u = el?.closest('uneditable') as HTMLElement | null;
          return u && root.contains(u) ? [u] : [];
      }
      // Seleksi: ambil seluruh wrapper yang beririsan dengan seleksi.
      return Array.from(root.querySelectorAll<HTMLElement>('uneditable'))
          .filter(u => range.intersectsNode(u));
  };

  // Cek lock gabungan "delete + copy" berbasis token (urutan token & spasi berlebih aman).
  const isDeleteCopyLock = (u: HTMLElement): boolean => {
      const parts = new Set((u.getAttribute('data-lock') || '').split(' ').filter(Boolean));
      return parts.size === 2 && parts.has('delete') && parts.has('copy');
  };

  // --- LOCK ENFORCEMENT: DETEKSI & NOTIFIKASI ---
  // Token lock pada satu node/elemen, selalu berbasis set (bukan string mentah).
  const getLockFlagAt = (node: Node | null, flag: 'delete' | 'copy'): boolean => {
      if (!node) return false;
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const u = el?.closest('uneditable');
      if (!u) return false;
      return (u.getAttribute('data-lock') || '').split(' ').filter(Boolean).includes(flag);
  };

  // Apakah ada DELETE LOCK pada wrapper yang beririsan dengan range.
  // `extraText` dipakai untuk memeriksa karakter yang akan terhapus pada caret collapsed.
  const rangeHasDeleteLock = (range: Range, root: HTMLElement, extraText?: Text | null): boolean => {
      const flagged = getAffectedUneditables(range, root)
          .some(u => (u.getAttribute('data-lock') || '').split(' ').filter(Boolean).includes('delete'));
      if (flagged) return true;
      return !!(extraText && getLockFlagAt(extraText, 'delete'));
  };

  // Apakah ada COPY LOCK pada wrapper yang beririsan dengan range.
  const rangeHasCopyLock = (range: Range, root: HTMLElement): boolean => {
      return getAffectedUneditables(range, root)
          .some(u => (u.getAttribute('data-lock') || '').split(' ').filter(Boolean).includes('copy'));
  };

  // Apakah HTML (string) mengandung wrapper lock tertentu — untuk jalur yang bekerja
  // di luar DOM editor (mode kode / clipboard API).
  const htmlHasLock = (html: string, flag: 'delete' | 'copy'): boolean => {
      if (!html) return false;
      const holder = document.createElement('div');
      holder.innerHTML = html;
      return Array.from(holder.querySelectorAll('uneditable')).some(u =>
          (u.getAttribute('data-lock') || '').split(' ').filter(Boolean).includes(flag));
  };

  const notifyLocked = (kind: 'delete' | 'copy' | 'both') => {
      const msg = kind === 'copy' ? 'Teks terkunci tidak dapat disalin'
          : kind === 'both' ? 'Teks terkunci tidak dapat dipotong atau dipindahkan'
          : 'Teks terkunci tidak dapat dihapus atau diubah';
      setLockToastMsg(msg);
      if (lockToastTimer.current) clearTimeout(lockToastTimer.current);
      lockToastTimer.current = setTimeout(() => setLockToastMsg(null), 2000);
  };

  const handleApplyLock = (action: LockAction) => {
      const range = resolveEditorRange(true);
      const root = editorRef.current;
      if (!range || !root || range.collapsed) return;
      applyLock(range, root, action);
      handleInput(); // Jalankan History & Autosave
      setActiveMenu('NONE');
  };

  const handleRemoveLock = (action: LockAction) => {
      const range = resolveEditorRange(true);
      const root = editorRef.current;
      if (!range || !root) return;

      let target = range;

      if (range.collapsed) {
          // removeLock() mengabaikan range collapsed, jadi perluas ke isi wrapper.
          const [wrapper] = getAffectedUneditables(range, root);
          if (!wrapper) return;

          target = document.createRange();
          target.selectNodeContents(wrapper);
          if (target.collapsed) return;
      }

      removeLock(target, root, action);
      handleInput(); // Jalankan History & Autosave
      setActiveMenu('NONE');
      savedSelection.current = null;
  };

  // Mengevaluasi status tombol saat Popover LOCK dirender
  const getLockMenuState = () => {
      const range = resolveEditorRange(true);
      const root = editorRef.current;
      if (!range || !root) return { canLock: false, locks: new Set<string>(), singleDeleteCopy: false };

      const affected = getAffectedUneditables(range, root);
      const locks = new Set<string>();
      affected.forEach(u => {
          (u.getAttribute('data-lock') || '').split(' ').filter(Boolean).forEach(l => locks.add(l));
      });

      const canLock = !range.collapsed;
      const singleDeleteCopy = affected.length === 1 && isDeleteCopyLock(affected[0]);

      return { canLock, locks, singleDeleteCopy };
  };
  // -----------------------------

  const toggleMenu = (menu: ToolbarMenu) => {
    // Jika membuka menu baru, simpan seleksi teks saat ini
    if (menu !== 'NONE' && menu !== activeMenu) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedSelection.current = sel.getRangeAt(0).cloneRange();
        }
    }
    setActiveMenu(prev => prev === menu ? 'NONE' : menu);
  };

  const filteredNotes = allNotes.filter(n => 
    (n.title.toLowerCase().includes(mentionQuery.toLowerCase()) || 
     mentionCreatedIdsRef.current.has(n.id)) && 
    n.id !== note.id // Mencegah catatan nge-link ke dirinya sendiri
  );

  const preventFocusLoss = (e: React.MouseEvent) => {
      e.preventDefault();
  };

  // Mind map visual helpers
  const isMindMap = note.type === 'mindmap';

  // --- FUNGSI COPY CONTENT (PERBAIKAN: Sync status checkbox & Clean Code) ---
  const handleCopyContent = async () => {
    // --- TAMBAHAN BARU: Jika sedang di Mode Kode, bersihkan HTML sebelum disalin ---
    if (isCodeView) {
        let cleanHtml = note.content
            // 1. Hapus ratusan style bawaan (--tw-scale, shadow, dll)
            .replace(/ style="[^"]*"/gi, '') 
            // 2. Hapus status contenteditable bawaan editor
            .replace(/ contenteditable="[^"]*"/gi, '') 
            // 3. Hapus atribut data sementara (kecuali data-days, data-checked-time, data-id yang penting)
            .replace(/ data-(?!days|checked-time|id)[a-zA-Z\-]+="[^"]*"/gi, '') 
            // 4. Hapus karakter gaib / kosong penyita spasi (seperti ‎)
            .replace(/[\u200B-\u200D\uFEFF\u200E]/g, '') 
            // 5. Rapikan tag pembuka dan penutup agar menurun (Pretty Print dasar)
            .replace(/></g, '>\n<');

        // Salin hanya sebagai teks murni (Teks Kode HTML Bersih)
        const copied = await writeToClipboard(cleanHtml);
        if (copied) {
            setShowCopyToast(true);
            setTimeout(() => setShowCopyToast(false), 2000);
        } else {
            setShowClipboardFailToast(true);
            setTimeout(() => setShowClipboardFailToast(false), 3000);
        }
        return; // Hentikan fungsi di sini agar tidak menjalankan copy visual
    }

    // --- LOGIKA NORMAL JIKA DI MODE VISUAL ---
    if (editorRef.current) {
        // LOCK ENFORCEMENT: salin seluruh catatan tidak boleh membawa konten copy-locked.
        if (htmlHasLock(editorRef.current.innerHTML, 'copy')) {
            notifyLocked('copy');
            return;
        }
        // 1. SYNC CHECKBOX STATE KE ATTRIBUTE
        // Browser tidak otomatis menyalin status 'checked' input ke HTML string.
        // Kita harus memaksanya manual.
        const checkboxes = editorRef.current.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((cb) => {
            const input = cb as HTMLInputElement;
            if (input.checked) {
                input.setAttribute('checked', 'true');
            } else {
                input.removeAttribute('checked');
            }
        });

        // 2. Ambil HTML lengkap dan teks polos dengan serialisasi baris yang konsisten
        const htmlContent = editorRef.current.innerHTML;
        const textContent = htmlKeTeksPolos(htmlContent);

        const copied = await writeToClipboard(textContent, htmlContent);
        if (copied) {
            setShowCopyToast(true);
            setTimeout(() => setShowCopyToast(false), 2000);
        } else {
            setShowClipboardFailToast(true);
            setTimeout(() => setShowClipboardFailToast(false), 3000);
        }
    }
  };

  // --- FUNGSI UNDUH KODE HTML ---
  const handleDownloadHTML = () => {
    const rawTitle = (note.title || '').trim() || 'Untitled';
    const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '-');
    const fileName = `${safeTitle}.html`;

    const blob = new Blob([note.content || ''], { type: 'text/html;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  // --- FUNGSI IMPOR FILE TEKS ---
  const handleImportFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text !== null && text !== undefined) {
        onUpdate({ ...note, content: text });
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // --- FUNGSI AUTO-RESIZE JUDUL (LETAKKAN DI SINI) ---
  const adjustTitleHeight = () => {
    if (titleRef.current) {
        titleRef.current.style.height = 'auto';
        titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
    }
  };

  // Jalankan saat judul berubah (agar tinggi menyesuaikan saat load)
  useLayoutEffect(() => {
      adjustTitleHeight();
  }, [note.title]);

  // --- EFEK BARU: Update Judul Tab Browser (Revisi) ---
  useEffect(() => {
    // 1. Ambil judul & bersihkan spasi di awal/akhir
    const cleanTitle = (note.title || "").trim();
    
    // 2. Ambil 25 karakter pertama
    const truncatedTitle = cleanTitle.substring(0, 25);
    
    // 3. Tentukan judul final (gunakan 'Untitled' jika kosong)
    const displayTitle = truncatedTitle || "Untitled";
    
    // 4. Set judul tab dengan format "Nex : [Judul]"
    document.title = `Nex : ${displayTitle}`;

    // Cleanup: Kembalikan ke default saat keluar
    return () => {
      document.title = "Nexus Notes";
    };
  }, [note.title]);

  // --- IMAGE ACTIONS ---
  const handleImageResize = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value);
      setImageWidth(val);
      if (selectedImage) {
          selectedImage.style.width = `${val}%`;
          handleInput(); // Simpan perubahan ke note
      }
  };

  const handleCopyImage = async () => {
      if (selectedImage) {
          try {
             const src = selectedImage.src;
             // Cek apakah base64
             if (src.startsWith('data:image')) {
                 const type = src.split(';')[0].split(':')[1];
                 const blob = b64toBlob(src, type);
                 await navigator.clipboard.write([
                     new ClipboardItem({ [type]: blob })
                 ]);
             } else {
                 // Jika URL biasa (bukan base64), copy URL-nya saja atau fetch blob (opsional)
                 await navigator.clipboard.writeText(src);
             }
             setShowCopyToast(true);
             setTimeout(() => setShowCopyToast(false), 2000);
          } catch (err) {
              console.error('Failed to copy image', err);
          }
      }
  };

  const handleCutImage = async () => {
      await handleCopyImage(); // Copy dulu
      if (selectedImage) {
          selectedImage.remove(); // Lalu hapus
          setSelectedImage(null);
          setActiveMenu('NONE');
          handleInput();
          
          setShowCutToast(true);
          setTimeout(() => setShowCutToast(false), 2000);
      }
  };

  const handleDeleteImage = () => {
      if (selectedImage) {
          selectedImage.remove();
          setSelectedImage(null);
          setActiveMenu('NONE');
          handleInput();
      }
  };

  return (
    <div className="flex flex-col h-full relative">
        
        {/* --- UI PENCARIAN MENGAMBANG --- */}
        {showSearch && (
            <div className="absolute top-4 left-4 right-4 bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 rounded-xl p-2 z-50 animate-in slide-in-from-top-2">
                {/* Baris 1: Cari */}
                <div className="flex items-center gap-2">
                    <Search size={18} className="text-gray-400 shrink-0" />
                    <input
                        type="text"
                        placeholder="Cari... (Coba: kata1 kata2)"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            performSearch(e.target.value);
                        }}
                        // PERBAIKAN: Enter hanya menyetujui/menggulir ke hasil, TIDAK mengganti teks
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                confirmSearchMatch();
                            }
                        }}
                        className="flex-1 bg-transparent outline-none text-sm dark:text-white min-w-0"
                        autoFocus
                    />
                    <span className="text-xs text-gray-400 font-mono shrink-0">
                        {searchResults.length > 0 ? currentSearchIndex + 1 : 0}/{searchResults.length}
                    </span>
                    <button onMouseDown={preventFocusLoss} onClick={() => navigateSearch('prev')} disabled={searchResults.length === 0} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 text-gray-600 dark:text-gray-300">
                        <ChevronUp size={18} />
                    </button>
                    <button onMouseDown={preventFocusLoss} onClick={() => navigateSearch('next')} disabled={searchResults.length === 0} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 text-gray-600 dark:text-gray-300">
                        <ChevronDown size={18} />
                    </button>
                    <div className="w-[1px] h-4 bg-gray-300 dark:bg-gray-600 mx-1 shrink-0"></div>
                    {/* Toggle baris Ganti */}
                    <button
                        onMouseDown={preventFocusLoss}
                        onClick={() => setShowReplace(!showReplace)}
                        title="Ganti (Replace)"
                        className={`p-1 rounded shrink-0 ${showReplace ? 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                    >
                        <Replace size={18} />
                    </button>
                    <button onMouseDown={preventFocusLoss} onClick={() => {
                        setShowSearch(false);
                        setShowReplace(false);
                        setReplaceQuery('');
                        setSearchQuery('');
                        setSearchResults([]);
                        window.getSelection()?.removeAllRanges(); // Bersihkan blok
                    }} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-500 rounded text-gray-600 dark:text-gray-300">
                        <X size={18} />
                    </button>
                </div>
                {/* Baris 2: Ganti */}
                {showReplace && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <Replace size={18} className="text-amber-500 shrink-0" />
                        <input
                            type="text"
                            placeholder="Ganti dengan..."
                            value={replaceQuery}
                            onChange={(e) => setReplaceQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    replaceCurrentMatch();
                                }
                            }}
                            className="flex-1 bg-transparent outline-none text-sm dark:text-white min-w-0"
                        />
                        <button onMouseDown={preventFocusLoss} onClick={replaceCurrentMatch} disabled={searchResults.length === 0} className="px-2 py-1 text-xs rounded bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50 shrink-0">
                            Ganti
                        </button>
                        <button onMouseDown={preventFocusLoss} onClick={replaceAllMatches} disabled={searchResults.length === 0} className="px-2 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 shrink-0 flex items-center gap-1">
                            <ReplaceAll size={14} />
                            Semua
                        </button>
                    </div>
                )}
            </div>
        )}

        {/* PERBAIKAN: Tambah 'flex flex-col' dan kurangi padding bawah (pb-32 ke pb-24) */}
        <div className={`flex-1 overflow-y-auto no-scrollbar flex flex-col ${isImmersive ? 'p-0 mt-0 pb-0' : 'p-4 mt-2 pb-24'}`}>
            
            {/* Hanya tampilkan judul jika TIDAK sedang layar penuh */}
            {!isImmersive && (
                <div className="flex items-center gap-2 mb-4 shrink-0">
                    {isMindMap && <Network className="text-indigo-500" size={28} />}
                    <textarea
                        ref={titleRef}
                        rows={1}
                        value={note.title}
                        onChange={(e) => {
                            onUpdate({...note, title: e.target.value});
                            adjustTitleHeight(); // Resize saat mengetik
                        }}
                        placeholder={isMindMap ? "Konsep Utama" : "Judul Halaman"}
                        className={`text-2xl font-bold w-full bg-transparent border-none outline-none resize-none overflow-hidden placeholder-gray-300 dark:placeholder-gray-700 dark:text-gray-100 ${isMindMap ? 'text-indigo-900 dark:text-indigo-200' : ''}`}
                        style={{ minHeight: '40px' }}
                    />
                </div>
            )}
            
            {/* TAMPILAN KODE (HTML), VISUAL, ATAU LIVE PREVIEW BROWSER */}
            {isPreviewMode ? (
                // PERBAIKAN: Ganti 'h-[65vh]' menjadi 'flex-1 min-h-[75vh]'
                <div className={`w-full bg-white relative shadow-inner flex-1 ${isImmersive ? 'h-screen mt-0 rounded-none border-0' : 'min-h-[75vh] mt-2 rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden'}`}>
                    <iframe
                        ref={iframeRef}
                        srcDoc={previewContent}
                        title="Live Preview"
                        className="w-full h-full border-0"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                    />
                </div>
            ) : isCodeView ? (
                // PERBAIKAN: Tambahkan 'flex-1' dan 'min-h-[75vh]' pada textarea mode kode juga
                <textarea
                    ref={codeEditorRef} 
                    className="w-full flex-1 min-h-[75vh] p-4 mt-2 font-mono text-sm bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-700 rounded-lg outline-none resize-y custom-scrollbar"
                    value={codeDraft ?? note.content ?? ''}
                    onChange={(e) => {
                        const newCodeContent = e.target.value;
                        codeDraftDirtyRef.current = true;
                        setCodeDraft(newCodeContent);
                        recordHistory(newCodeContent);
                    }}
                    placeholder="Tulis kode HTML lengkap (termasuk <script> dan <style>) di sini..."
                />
            ) : (
                <div 
                    ref={editorRef}
                    className={`editor-content outline-none text-lg min-h-[50vh] leading-relaxed dark:text-gray-200 ${isMindMap ? 'mindmap-mode' : ''}`}
                    contentEditable
                    onInput={handleInput}
                    onPaste={handlePaste} 
                    onCopy={handleCopyEvent}
                    onCut={handleCutEvent}
                    onBeforeInput={handleBeforeInput}
                    onKeyDown={handleKeyDown}
                    onDragStart={handleEditorDragStart}
                    onDragOver={handleEditorDragOver}
                    onDrop={handleEditorDrop}
                    onClick={handleEditorClick}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    data-placeholder={isMindMap ? "Mulai dengan poin utama..." : "Mulai mengetik..."}
                />
            )}
        </div>

        {/* Mention Popover */}
        {showMentionList && (
            <div 
                className="fixed bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-700 z-50 w-64 max-h-48 overflow-y-auto"
                style={{ 
                    top: Math.max(10, mentionPosition.top - 200),
                    left: Math.min(window.innerWidth - 270, mentionPosition.left)
                }}
            >
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-3 py-1">
                    Select a page
                </div>
                {filteredNotes.map(n => (
                    <div 
                        key={n.id}
                        onClick={() => handleMentionSelect(n)}
                        className="px-4 py-2 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer text-sm truncate text-gray-800 dark:text-gray-200"
                    >
                        {n.title}
                    </div>
                ))}
                <div 
                    onClick={() => handleMentionSelect(null)}
                    className="px-4 py-2 hover:bg-green-50 dark:hover:bg-green-900 text-green-700 dark:text-green-400 cursor-pointer text-sm font-medium border-t dark:border-gray-700"
                >
                    + Create new "{mentionQuery}"
                </div>
            </div>
        )}

      {/* --- TOAST NOTIFICATION (COPY) --- */}
        {showCopyToast && (
            <div className="fixed bottom-52 left-1/2 transform -translate-x-1/2 bg-black/80 dark:bg-white/90 text-white dark:text-gray-900 px-4 py-2 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Check size={16} className="text-green-400 dark:text-green-600" />
                <span className="text-sm font-semibold">Berhasil disalin!</span>
            </div>
        )}

      {/* --- TOAST NOTIFICATION (CUT) - TAMBAHKAN INI --- */}
        {showCutToast && (
            <div className="fixed bottom-52 left-1/2 transform -translate-x-1/2 bg-black/80 dark:bg-white/90 text-white dark:text-gray-900 px-4 py-2 rounded-full shadow-2xl z-50 flex items-center gap-2 animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Scissors size={16} className="text-red-400 dark:text-red-600" />
                <span className="text-sm font-semibold">Berhasil dipotong!</span>
            </div>
        )}

      {/* --- TOAST NOTIFICATION (COPY/CUT GAGAL - SEMUA SALURAN CLIPBOARD DITOLAK) --- */}
        {showClipboardFailToast && (
            <div className="fixed bottom-52 left-1/2 transform -translate-x-1/2 bg-black/90 dark:bg-white/95 text-white dark:text-gray-900 px-4 py-2 rounded-full shadow-2xl z-[70] flex items-center gap-2 animate-in fade-in zoom-in duration-200 pointer-events-none">
                <AlertTriangle size={16} className="text-amber-400 dark:text-amber-600" />
                <span className="text-sm font-semibold">Gagal mengakses clipboard</span>
            </div>
        )}

      {/* --- TOAST NOTIFICATION (PASTE CLIPBOARD KOSONG) --- */}
        {showPasteEmptyToast && (
            <div className="fixed bottom-52 left-1/2 transform -translate-x-1/2 bg-black/80 dark:bg-white/90 text-white dark:text-gray-900 px-4 py-2 rounded-full shadow-2xl z-[60] flex items-center gap-2 animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Clipboard size={16} className="text-amber-400 dark:text-amber-600" />
                <span className="text-sm font-semibold">Clipboard kosong</span>
            </div>
        )}

      {/* --- TOAST NOTIFICATION (KONTEN TERKUNCI) --- */}
        {lockToastMsg && (
            <div className="fixed bottom-56 left-1/2 transform -translate-x-1/2 bg-black/90 dark:bg-white/95 text-white dark:text-gray-900 px-4 py-2 rounded-full shadow-2xl z-[70] flex items-center gap-2 animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Lock size={16} className="text-amber-400 dark:text-amber-600" />
                <span className="text-sm font-semibold">{lockToastMsg}</span>
            </div>
        )}

      {/* --- TOAST INSTRUKSI PASTE NATIVE (FALLBACK SAAT IZIN DITOLAK) --- */}
        {showPastePromptToast && (
            <div className="fixed bottom-56 left-1/2 transform -translate-x-1/2 bg-black/90 dark:bg-white/95 text-white dark:text-gray-900 px-4 py-2 rounded-full shadow-2xl z-[70] flex items-center gap-2 animate-in fade-in zoom-in duration-200 pointer-events-none">
                <Clipboard size={16} className="text-amber-400 dark:text-amber-600" />
                <span className="text-sm font-semibold">Tekan lama / Ctrl+V lalu pilih Paste</span>
            </div>
        )}

      {/* --- TOMBOL FLOATING IMMERSIVE (MODE BROWSER) --- */}
      {isPreviewMode && isImmersive && (
          <button
              onClick={() => {
                  if (floatingBtnPrimed) {
                      // Klik kedua (dalam waktu 2 detik): Keluar dari layar penuh sementara
                      setIsImmersive(false);
                      setFloatingBtnPrimed(false);
                      if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current);
                  } else {
                      // Klik pertama: Siagakan tombol selama 2 detik (menjadi solid/tidak transparan)
                      setFloatingBtnPrimed(true);
                      if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current);
                      floatingTimerRef.current = setTimeout(() => {
                          setFloatingBtnPrimed(false);
                      }, 2000);
                  }
              }}
              className={`fixed bottom-10 right-6 w-12 h-12 rounded-full shadow-2xl flex items-center justify-center z-[100] transition-all duration-300 ease-out ${
                  floatingBtnPrimed 
                  ? 'opacity-100 scale-110 bg-indigo-600 text-white' 
                  : 'opacity-15 bg-gray-500 text-white hover:opacity-50'
              }`}
              title="Tampilkan Menu (Klik 2x)"
          >
              <Eye size={24} />
          </button>
      )}

      {/* --- WRAPPER SEMUA MENU BAWAH (HANYA TAMPIL JIKA TIDAK IMMERSIVE) --- */}
      {!isImmersive && (
          <>
      {/* --- Tumpukan Tombol Opsi (Mode Lanjutan) --- */}
        {showOptionMenu && (
            <>
              {/* Atas: Tempel (Paste) */}
              <button
                  data-option-btn
                  onClick={() => { closeOptionMenu(); void handlePasteFromClipboard(); }}
                  className="fixed bottom-52 right-4 w-12 h-12 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center z-[60] opacity-100"
                  title="Tempel (Paste)"
              >
                  <Clipboard size={20} />
              </button>

              {/* Tengah: Hapus seluruh catatan */}
              <button
                  data-option-btn
                  onClick={() => { closeOptionMenu(); void handleDeleteAllContent(); }}
                  className="fixed bottom-36 right-4 w-12 h-12 rounded-full bg-red-700 text-white shadow-lg flex items-center justify-center z-[60] opacity-100"
                  title="Hapus Seluruh Isi"
              >
                  <Trash2 size={20} />
              </button>

              {/* Bawah: Pilih Semua */}
              <button
                  data-option-btn
                  onClick={() => { closeOptionMenu(); handleSelectAll(); }}
                  className="fixed bottom-20 right-4 w-12 h-12 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center z-[60] opacity-100"
                  title="Pilih Semua"
              >
                  <Scan size={20} />
              </button>
            </>
        )}

        {/* --- TOMBOL UTAMA MODE AWAL (SAMA UNTUK SEMUA CATATAN) --- */}
        {!showOptionMenu && (
            <> 
              {/* Atas: Salin seluruh catatan */}
              <button
                  data-main-btn
                  onClick={() => {
                      activateMainBtnSolid();
                      void handleCopyContent();
                  }}
                  className={`fixed bottom-52 right-4 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center z-[60] transition-opacity duration-300 ${mainBtnSolid ? 'opacity-100' : 'opacity-25'}`}
                  title="Salin Seluruh Catatan"
              >
                  <Copy size={20} />
              </button>

              {/* Tengah: Potong seluruh catatan */}
              <button
                  data-main-btn
                  onClick={() => {
                      activateMainBtnSolid();
                      void handleCutContent();
                  }}
                  className={`fixed bottom-36 right-4 w-12 h-12 rounded-full bg-red-600 text-white shadow-lg flex items-center justify-center z-[60] transition-opacity duration-300 ${mainBtnSolid ? 'opacity-100' : 'opacity-25'}`}
                  title="Potong Seluruh Catatan"
              >
                  <Scissors size={20} />
              </button>

              {/* Bawah: Titik Tiga (buka mode lanjutan) */}
              <button
                  data-main-btn
                  onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      activateMainBtnSolid();
                      setShowOptionMenu(true);
                  }}
                  className={`fixed bottom-20 right-4 w-12 h-12 rounded-full bg-gray-800 dark:bg-gray-700 text-white shadow-lg flex items-center justify-center z-[60] transition-opacity duration-300 ${mainBtnSolid ? 'opacity-100' : 'opacity-25'}`}
                  title="Alat Lainnya"
              >
                  <MoreVertical size={20} />
              </button>
            </>
        )}

        {/* --- Toolbar Menus (Popups) --- */}
        {activeMenu === 'FORMAT' && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-2 z-40 flex flex-wrap gap-2 animate-in slide-in-from-bottom-5 fade-in">
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('bold')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Bold size={18} /></button>
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('italic')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Italic size={18} /></button>
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('underline')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Underline size={18} /></button>
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('strikeThrough')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Strikethrough size={18} /></button>
                <div className="w-full flex gap-2 mt-1">
                     <select onChange={(e) => execCmd('fontSize', e.target.value, true)} className="bg-gray-100 dark:bg-gray-700 dark:text-white p-2 rounded text-sm flex-1">
                         <option value="3">Normal Size</option>
                         <option value="1">Small</option>
                         <option value="5">Large</option>
                         <option value="7">Huge</option>
                      </select>
                </div>
            </div>
        )}

        {activeMenu === 'LIST' && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-2 z-40 flex flex-wrap gap-2 animate-in slide-in-from-bottom-5 fade-in">
<button onMouseDown={preventFocusLoss} onClick={() => handleListToolbar('bullet')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><List size={18} /> Bullet</button>
                <button onMouseDown={preventFocusLoss} onClick={() => handleListToolbar('number')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><ListOrdered size={18} /> 123</button>
                <button onMouseDown={preventFocusLoss} onClick={() => handleListToolbar('todo')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><CheckSquare size={18} /> Todo</button>
            </div>
        )}

        {activeMenu === 'TABLE' && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 z-40 grid grid-cols-2 gap-2 animate-in slide-in-from-bottom-5 fade-in">
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('addRow')} className="p-2 text-sm bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-100 rounded flex items-center gap-2"><Plus size={16}/> Row</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('addCol')} className="p-2 text-sm bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-100 rounded flex items-center gap-2"><Plus size={16}/> Col</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('delRow')} className="p-2 text-sm bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-100 rounded flex items-center gap-2"><Trash2 size={16}/> Row</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('delCol')} className="p-2 text-sm bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-100 rounded flex items-center gap-2"><Trash2 size={16}/> Col</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('delTable')} className="col-span-2 p-2 text-sm bg-red-100 dark:bg-red-900 font-bold text-red-700 dark:text-red-100 rounded flex justify-center items-center gap-2"><Trash2 size={16}/> Delete Entire Table</button>
            </div>
        )}

        {/* --- IMAGE MENU --- */}
        {activeMenu === 'IMAGE' && selectedImage && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4 z-40 animate-in slide-in-from-bottom-5 fade-in">
                
                {/* Resize Slider */}
                <div className="flex items-center gap-3 mb-4">
                    <Sliders size={18} className="text-gray-500" />
                    <input 
                        type="range" 
                        min="10" 
                        max="100" 
                        value={imageWidth} 
                        onChange={handleImageResize}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                    />
                    <span className="text-sm font-mono text-gray-500 w-12 text-right">{imageWidth}%</span>
                </div>

                {/* Actions Grid */}
                <div className="flex justify-between gap-2">
                     <button onMouseDown={preventFocusLoss} onClick={handleCopyImage} className="flex-1 p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm flex flex-col items-center gap-1 hover:bg-gray-200 dark:hover:bg-gray-600">
                        <Copy size={18} /> 
                        <span>Salin</span>
                     </button>
                     <button onMouseDown={preventFocusLoss} onClick={handleCutImage} className="flex-1 p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm flex flex-col items-center gap-1 hover:bg-gray-200 dark:hover:bg-gray-600">
                        <Scissors size={18} /> 
                        <span>Potong</span>
                     </button>
                     <button onMouseDown={preventFocusLoss} onClick={handleDeleteImage} className="flex-1 p-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm flex flex-col items-center gap-1 hover:bg-red-100 dark:hover:bg-red-900/50">
                        <Trash2 size={18} /> 
                        <span>Hapus</span>
                     </button>
                </div>
            </div>
        )}
		
		{/* --- LOCK MENU --- */}
        {activeMenu === 'LOCK' && (() => {
            const { canLock, locks, singleDeleteCopy } = getLockMenuState();
            return (
                <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-2 z-40 flex flex-col gap-2 animate-in slide-in-from-bottom-5 fade-in">
                    
                    {/* 1. LOCK ACTIONS (Hanya aktif jika ada seleksi) */}
                    <div className="w-full flex gap-2">
                         <button onMouseDown={preventFocusLoss} onClick={() => handleApplyLock('delete')} disabled={!canLock} className="flex-1 p-2 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-40 rounded flex flex-col items-center text-xs gap-1">
                             <Lock size={16} /> Lock Delete
                         </button>
                         <button onMouseDown={preventFocusLoss} onClick={() => handleApplyLock('copy')} disabled={!canLock} className="flex-1 p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-40 rounded flex flex-col items-center text-xs gap-1">
                             <Lock size={16} /> Lock Copy
                         </button>
                         <button onMouseDown={preventFocusLoss} onClick={() => handleApplyLock('delete copy')} disabled={!canLock} className="flex-1 p-2 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-40 rounded flex flex-col items-center text-xs gap-1">
                             <Lock size={16} /> Lock Delete+Copy
                         </button>
                    </div>

                    {/* 2. UNLOCK ACTIONS (Dinamis sesuai temuan LockManager) */}
                    {(locks.size > 0) && (
                        <div className="w-full flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            {locks.has('delete') && !singleDeleteCopy && (
                                <button onMouseDown={preventFocusLoss} onClick={() => handleRemoveLock('delete')} className="flex-1 p-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center items-center text-xs gap-1 transition-colors">
                                    <Unlock size={14} /> Unlock Delete
                                </button>
                            )}
                            {locks.has('copy') && !singleDeleteCopy && (
                                <button onMouseDown={preventFocusLoss} onClick={() => handleRemoveLock('copy')} className="flex-1 p-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex justify-center items-center text-xs gap-1 transition-colors">
                                    <Unlock size={14} /> Unlock Copy
                                </button>
                            )}
                            {singleDeleteCopy && (
                                <button onMouseDown={preventFocusLoss} onClick={() => handleRemoveLock('all')} className="flex-1 p-2 bg-gray-200 dark:bg-gray-600 font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-500 rounded flex justify-center items-center text-xs gap-1 transition-colors">
                                    <Unlock size={14} /> Unlock All
                                </button>
                            )}
                        </div>
                    )}

                    {/* 3. EMPTY STATE (Jika cuma klik tanpa kursor valid & tanpa menyorot lock) */}
                    {!canLock && locks.size === 0 && !singleDeleteCopy && (
                        <div className="w-full text-center text-xs text-gray-500 py-1">
                            Seleksi teks terlebih dahulu untuk mengunci.
                        </div>
                    )}
                </div>
            );
        })()}

        {/* --- Main Sticky Toolbar --- */}
        <div className="h-14 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between px-2 shadow-lg sticky bottom-0 w-full z-40">
            <div className="flex space-x-1 overflow-x-auto no-scrollbar w-full items-center">
                
                <button onMouseDown={preventFocusLoss} onClick={() => toggleMenu('FORMAT')} className={`p-2 rounded min-w-[40px] flex justify-center ${activeMenu === 'FORMAT' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                    <Bold size={20} />
                </button>

               <button onMouseDown={preventFocusLoss} onClick={() => toggleMenu('LIST')} className={`p-2 rounded min-w-[40px] flex justify-center ${activeMenu === 'LIST' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                    <List size={20} />
                </button>

                {/* --- TOMBOL PENCARIAN (BARU) --- */}
                <button onMouseDown={preventFocusLoss} onClick={() => setShowSearch(!showSearch)} className={`p-2 rounded min-w-[40px] flex justify-center ${showSearch ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`} title="Cari di Catatan">
                    <Search size={20} />
                </button>

                {/* --- TOMBOL IMPOR FILE TEKS --- */}
                <button onMouseDown={preventFocusLoss} onClick={handleImportFile} className="p-2 rounded min-w-[40px] flex justify-center hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300" title="Impor File Teks">
                    <Upload size={20} />
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.html,.htm,.py,.js,.ts,.jsx,.tsx,.css,.json,.xml,.md,.csv,.log,.yaml,.yml,.svg,.java,.c,.cpp,.rb,.php,.go,.rs,.swift,.kt,.sql,.sh,.bat,.ps1,.r,.lua,.pl,.ex,.exs,.hs,.clj"
                    className="hidden"
                    onChange={handleFileSelected}
                />

                <button onMouseDown={preventFocusLoss} onClick={toggleModeKode} className={`p-2 rounded min-w-[40px] flex justify-center ${isCodeView && !isPreviewMode ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`} title="Tampilkan Kode HTML">
                    <Code size={20} />
                </button>

                {/* --- TOMBOL LIVE PREVIEW BROWSER --- */}
                <button onMouseDown={preventFocusLoss} onClick={() => {
                    if (!isPreviewMode && isCodeView && !bolehKeluarModeKode()) return;
                    setIsPreviewMode(!isPreviewMode);
                    if (!isPreviewMode) {
                        setIsCodeView(false); // Matikan textarea jika masuk mode preview
                        setCodeDraft(null);
                        pendingCodeSelectionRef.current = null;
                        codeRemoteBaseRef.current = '';
                        codeDraftDirtyRef.current = false;
                    }
                }} className={`p-2 rounded min-w-[40px] flex justify-center ${isPreviewMode ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`} title="Jalankan sebagai Halaman Web (Live Preview)">
                    <Play size={20} />
                </button>

                {/* --- TOMBOL UNDUH KODE HTML --- */}
                <button onMouseDown={preventFocusLoss} onClick={handleDownloadHTML} className="p-2 rounded min-w-[40px] flex justify-center hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300" title="Unduh Kode HTML">
                    <Download size={20} />
                </button>

                {/* --- TOMBOL SEMENTARA: EKSPOR JARINGAN --- */}
                <button onMouseDown={preventFocusLoss} onClick={() => exportNetworkAsJSON(note, allNotes)} className="p-2 rounded min-w-[40px] flex justify-center hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300" title="Ekspor Jaringan Catatan">
                    <Network size={20} />
                </button>

                <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg mx-1">
                    <button onMouseDown={preventFocusLoss} onClick={() => execCmd('indent')} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-l"><Indent size={18} /></button>
                    <div className="w-[1px] bg-gray-300 dark:bg-gray-600"></div>
                    <button onMouseDown={preventFocusLoss} onClick={() => execCmd('outdent')} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-r"><Outdent size={18} /></button>
                </div>

                <div className="w-[1px] h-6 bg-gray-300 dark:bg-gray-700 mx-1"></div>

                {/* --- TOMBOL UNDO & REDO BARU (Mobile Friendly) --- */}
                {/* Dipindahkan ke sini, SEBELUM tombol @ */}
                <button onMouseDown={preventFocusLoss} onClick={performUndo} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[40px] flex justify-center text-gray-700 dark:text-gray-300" title="Undo">
                    <Undo size={18} />
                </button>
                <button onMouseDown={preventFocusLoss} onClick={performRedo} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[40px] flex justify-center text-gray-700 dark:text-gray-300" title="Redo">
                    <Redo size={18} />
                </button>
                <button onMouseDown={preventFocusLoss} onClick={() => setShowHistoryModal(true)} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[40px] flex justify-center text-indigo-600 dark:text-indigo-400" title="Lihat Riwayat Ketikan">
                    <History size={18} />
                </button>

                <button onMouseDown={preventFocusLoss} onClick={() => {
                   const text = document.createTextNode('@');
                   const sel = window.getSelection();
                   if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        range.insertNode(text);
                        range.collapse(false);
                        handleInput();
                        editorRef.current?.focus();
                   }
                }} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[40px] flex justify-center text-blue-600 dark:text-blue-400"><AtSign size={18} /></button>

				{/* --- TOMBOL LOCK (BARU) --- */}
                <button 
                    onMouseDown={(e) => {
                        if (isPreviewMode || isCodeView) { e.preventDefault(); return; }
                        preventFocusLoss(e);
                    }} 
                    onClick={() => {
                        if (isPreviewMode || isCodeView) return;
                        toggleMenu('LOCK');
                    }}
                    className={`p-2 rounded min-w-[40px] flex justify-center transition-colors ${isPreviewMode || isCodeView ? 'opacity-40 text-gray-400 dark:text-gray-500 cursor-not-allowed' : (activeMenu === 'LOCK' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300')}`}
                    title="Kunci Sebagian Teks"
                >
                    <Lock size={18} />
                </button>	

                <label 
                    className={`p-2 rounded min-w-[40px] flex justify-center cursor-pointer transition-colors ${isPreviewMode || isCodeView ? 'opacity-40 text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    title={isPreviewMode || isCodeView ? "Mode gambar hanya tersedia saat mode visual aktif" : "Tambah Gambar"}
                    // PERBAIKAN: Gunakan onMouseDown pada LABEL, bukan onClick pada INPUT
                    onMouseDown={(e) => {
                        if (isPreviewMode || isCodeView) {
                            e.preventDefault(); // Cegah dialog file saat mode Preview/Kode
                            return;
                        }
                        e.preventDefault(); // 1. Mencegah editor kehilangan fokus (blur)
                        const sel = window.getSelection();
                        // 2. Simpan posisi kursor yang BENAR sebelum dialog muncul
                        if (sel && sel.rangeCount > 0) {
                            savedSelection.current = sel.getRangeAt(0).cloneRange();
                        }
                    }}
                >
                    <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        // onClick pada input dihapus karena sudah ditangani di onMouseDown label
                        onChange={insertImage} 
                    />
                    <ImageIcon size={18} />
                </label>

                <button onMouseDown={preventFocusLoss} onClick={() => {
                    if (isTableContext) {
                        toggleMenu('TABLE');
                    } else {
                        insertTable();
                    }
                }} className={`p-2 rounded min-w-[40px] flex justify-center ${activeMenu === 'TABLE' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                    {isTableContext ? <MoreHorizontal size={18} className="text-blue-500" /> : <Table size={18} />}
                </button>
            </div>
        </div>
        </>
      )}
      {/* --- DIALOG PILIHAN CHECKBOX --- */}
      {showCheckboxDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-bold mb-4 dark:text-white text-center">Pilih Tipe Tugas</h3>
                
                <div className="space-y-3">
                    <button 
                        onClick={() => confirmInsertCheckbox(false)}
                        className="w-full p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-3 transition-all"
                    >
                        <div className="w-5 h-5 border-2 border-gray-400 rounded-sm"></div>
                        <div className="text-left">
                            <div className="font-bold text-gray-800 dark:text-gray-200">Permanen</div>
                            <div className="text-xs text-gray-500">Tetap dicentang selamanya</div>
                        </div>
                    </button>

                    <div className="p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/10">
                        <button 
                            onClick={() => confirmInsertCheckbox(true)}
                            className="w-full flex items-center gap-3 mb-3 text-left"
                        >
                            <div className="w-5 h-5 border-2 border-indigo-500 rounded-sm flex items-center justify-center text-[10px] font-bold text-indigo-600">
                                {checkboxInterval}
                            </div>
                            <div>
                                <div className="font-bold text-indigo-900 dark:text-indigo-200">Berjangka (Rutin)</div>
                                <div className="text-xs text-indigo-600 dark:text-indigo-400">Reset otomatis setiap:</div>
                            </div>
                        </button>
                        
                        <div className="flex items-center gap-2 mt-2 bg-white dark:bg-gray-800 p-2 rounded-lg border border-indigo-100 dark:border-indigo-700">
                            <input 
                                type="number" 
                                min="1" 
                                max="365"
                                value={checkboxInterval}
                                onChange={(e) => setCheckboxInterval(e.target.value)}
                                className="w-16 p-1 text-center font-bold border rounded dark:bg-gray-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-medium dark:text-gray-300">Hari Sekali</span>
                        </div>
                    </div>
                </div>

                <button 
                    onClick={() => setShowCheckboxDialog(false)}
                    className="mt-4 w-full py-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white text-sm font-medium"
                >
                    Batal
                </button>
            </div>
        </div>
      )}

      {/* --- DIALOG RIWAYAT UNDO / REDO (MESIN WAKTU) --- */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-4 animate-in fade-in">
            <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
                <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                    <div className="flex items-center gap-2">
                        <History size={20} className="text-indigo-600 dark:text-indigo-400" />
                        <h3 className="font-bold text-lg dark:text-white">Riwayat Mesin Waktu</h3>
                    </div>
                    <button onClick={() => setShowHistoryModal(false)} className="text-gray-400 hover:text-red-500 bg-gray-200 dark:bg-gray-700 p-1 rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>
                
                <div className="p-4 overflow-y-auto flex-1 space-y-3 bg-gray-50 dark:bg-gray-900/20">
                    {history.length === 0 ? (
                        <div className="text-center text-gray-500 py-8 text-sm">
                            {hydrated ? 'Belum ada riwayat perubahan.' : 'Memuat riwayat...'}
                        </div>
                    ) : (
                        /* Kita balik urutannya (reverse) agar versi TERBARU muncul paling atas */
                        [...history].reverse().map((histItem, reverseIdx) => {
                            // Hitung nomor indeks aslinya
                            const originalIdx = (history.length - 1) - reverseIdx;
                            const isCurrent = originalIdx === historyIndex;
                            const isExpanded = expandedHistoryIdx === originalIdx;
                            
                            // 1. HELPER WAKTU: Format Jam, Menit, Detik, Milidetik
                            const formatTimeWithMs = (ts: number) => {
                                if (!ts) return '';
                                const d = new Date(ts);
                                const h = d.getHours().toString().padStart(2, '0');
                                const m = d.getMinutes().toString().padStart(2, '0');
                                const s = d.getSeconds().toString().padStart(2, '0');
                                const ms = d.getMilliseconds().toString().padStart(3, '0');
                                return `${h}:${m}:${s}.${ms}`;
                            };

// 2. PREVIEW & DIFF (sudah dihitung saat merekam / lazy-cache saat modal dibuka)
                            const addedWords = histItem.wordDiff?.added.join(' ') ?? '';
                            const removedWords = histItem.wordDiff?.removed.join(' ') ?? '';
                            const previewText = histItem.preview || "(Kosong)";

                            return (
                                <div 
                                    key={originalIdx}
                                    className={`w-full text-left rounded-xl border-2 transition-all flex flex-col overflow-hidden ${
                                        isCurrent 
                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' 
                                        : 'border-transparent bg-white dark:bg-gray-800 shadow-sm'
                                    }`}
                                >
                                    {/* HEADER KARTU: Tekan untuk Buka/Tutup Detail */}
                                    <button 
                                        onClick={() => setExpandedHistoryIdx(isExpanded ? null : originalIdx)}
                                        className="w-full p-4 flex flex-col gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                                    >
                                        <div className="flex justify-between items-center w-full">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-bold text-sm ${isCurrent ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-200'}`}>
                                                    Versi {originalIdx + 1}
                                                </span>
                                                <span className="text-[10px] font-mono bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-md">
                                                    {formatTimeWithMs(histItem.time)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isCurrent && (
                                                    <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                                        Saat Ini
                                                    </span>
                                                )}
                                                <ChevronDown size={16} className={`text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 italic text-left">
                                            {previewText}
                                        </div>
                                    </button>

                                    {/* RINCIAN PERUBAHAN & TOMBOL PULIHKAN (Muncul jika Header ditekan) */}
                                    {isExpanded && (
                                        <div className="p-4 pt-0 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 animate-in slide-in-from-top-2">
                                            {(addedWords || removedWords) ? (
                                                <div className="text-[11px] font-medium mt-3 mb-4 flex flex-col gap-1.5 bg-white dark:bg-gray-900 p-3 rounded-lg border dark:border-gray-700">
                                                    {addedWords && (
                                                        <span className="text-green-600 dark:text-green-400">
                                                            + Ditambah: {addedWords}
                                                        </span>
                                                    )}
                                                    {removedWords && (
                                                        <span className="text-red-600 dark:text-red-400">
                                                            - Dihapus: {removedWords}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-[11px] text-gray-400 mt-3 mb-4 italic text-center">
                                                    Tidak ada perubahan kata (hanya spasi atau Enter).
                                                </div>
                                            )}

                                            <button
                                                onClick={() => {
                                                    const entries = historyContentRef.current;
                                                    const target = entries[originalIdx];
                                                    if (!target) return;
                                                    historyIndexRef.current = originalIdx;
                                                    setHistoryIndex(originalIdx);
                                                    onUpdate({ ...note, content: target.content });
                                                    persistChain(entries, originalIdx);
                                                    setShowHistoryModal(false);
                                                    setExpandedHistoryIdx(null);
                                                    
                                                    // Fokuskan kursor otomatis
                                                    if (isCodeView && codeEditorRef.current) codeEditorRef.current.focus();
                                                    else if (!isCodeView && editorRef.current) editorRef.current.focus();
                                                }}
                                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm active:scale-95"
                                            >
                                                Pulihkan ke Versi Ini
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
});
