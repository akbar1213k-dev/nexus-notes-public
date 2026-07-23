import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import { Note, EditorHandle } from '../types';
import { 
  Image as ImageIcon, Table, AtSign, 
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, CheckSquare, 
  Indent, Outdent, MoreHorizontal,
  Plus, Trash2, Home, Network, Copy, Check,
  Scissors, Scan, MoreVertical,
  Undo, Redo, Sliders, Code, ArrowLeft,
  Search, X, ChevronUp, ChevronDown, History // <--- Icon History
} from 'lucide-react';
interface EditorProps {
  note: Note;
  allNotes: Note[];
  onUpdate: (updatedNote: Note) => void;
  onCreateNewNote: (title: string) => Promise<string>;
  onLinkClick: (noteId: string) => void;
  onLinkLongPress: (noteId: string) => void;
  onGoHome: () => void;
}

type ToolbarMenu = 'NONE' | 'FORMAT' | 'LIST' | 'TABLE' | 'IMAGE';

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

export const Editor = forwardRef<EditorHandle, EditorProps>(({ 
  note, 
  allNotes, 
  onUpdate, 
  onCreateNewNote,
  onLinkClick,
  onLinkLongPress,
  onGoHome
}, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const savedSelection = useRef<Range | null>(null); // Menyimpan posisi seleksi teks
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [cursorRange, setCursorRange] = useState<Range | null>(null);
  // --- STATE BARU UNTUK NOTIFIKASI COPY & CUT ---
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showCutToast, setShowCutToast] = useState(false);
  // --- STATE BARU: Dialog Checkbox ---
  const [showCheckboxDialog, setShowCheckboxDialog] = useState(false);
  const [checkboxInterval, setCheckboxInterval] = useState<string>('1');
  // --- STATE BARU UNTUK TOOLS ---
  const [showTools, setShowTools] = useState(false);
  // --- STATE BARU: Mode Kode (HTML) ---
  const [isCodeView, setIsCodeView] = useState(false);

  // --- STATE BARU: Tampilkan Modal Riwayat Mesin Waktu ---
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // --- STATE PENCARIAN (PROXIMITY SEARCH) ---
  type SearchMatch = { isCode: false, range: Range } | { isCode: true, start: number, end: number };
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  
  const codeEditorRef = useRef<HTMLTextAreaElement>(null); // Referensi untuk textarea mode HTML

  // --- STATE BARU: MESIN WAKTU (HISTORY MANAGER 24 JAM) ---
  const [history, setHistory] = useState<any[]>([]); 
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [expandedHistoryIdx, setExpandedHistoryIdx] = useState<number | null>(null); // State untuk buka/tutup rincian
  const isTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Fungsi untuk Memuat History dari Brankas Lokal saat Catatan Dibuka
  useEffect(() => {
      const loadHistory = () => {
          const storageKey = `nexus_history_${note.id}`;
          const savedData = localStorage.getItem(storageKey);
          
          if (savedData) {
              try {
                  const { timestamp, pastVersions } = JSON.parse(savedData);
                  // Cek apakah usianya belum 24 Jam (24 * 60 * 60 * 1000 milidetik)
                  if (Date.now() - timestamp < 86400000) {
                      // Migrasi otomatis jika data lama masih berupa string (Teks biasa)
                      const formattedVersions = typeof pastVersions[0] === 'string' 
                          ? pastVersions.map((v: string) => ({ content: v, timestamp: timestamp }))
                          : pastVersions;

                      setHistory(formattedVersions);
                      setHistoryIndex(formattedVersions.length - 1);
                      return; // Berhasil dimuat
                  } else {
                      // Sudah basi (lebih 24 jam), buang!
                      localStorage.removeItem(storageKey);
                  }
              } catch (e) {
                  console.error("Gagal membaca history", e);
              }
          }
          
          // Jika tidak ada history (atau sudah basi), jadikan konten saat ini sebagai titik awal
          setHistory([{ content: note.content, timestamp: Date.now() }]);
          setHistoryIndex(0);
      };
      
      loadHistory();
  }, [note.id]); // Berjalan tiap kali kamu ganti/buka catatan

  // --- FUNGSI CUT (PERBAIKAN: Salin HTML sebelum dihapus) ---
  const handleCutContent = async () => {
    if (editorRef.current) {
        try {
            // 1. LOGIKA COPY (Sama persis dengan handleCopyContent yang baru)
            const htmlContent = editorRef.current.innerHTML;
            const textContent = editorRef.current.innerText;

            const clipboardItem = new ClipboardItem({
                "text/html": new Blob([htmlContent], { type: "text/html" }),
                "text/plain": new Blob([textContent], { type: "text/plain" })
            });

            await navigator.clipboard.write([clipboardItem]);

            // 2. LOGIKA DELETE (Hapus isi konten setelah berhasil dicopy)
            editorRef.current.innerHTML = '<p><br/></p>'; // Reset ke paragraf kosong
            
            // 3. Simpan perubahan (Update note)
            onUpdate({ ...note, content: '<p><br/></p>' });
            
            // 4. Notifikasi / Feedback
            setShowTools(false); // Tutup menu
            
            // Tampilkan notifikasi toast
            setShowCutToast(true);
            setTimeout(() => {
                setShowCutToast(false);
            }, 2000);

        } catch (err) {
            console.error("Gagal memotong:", err);
            
            // Fallback: Coba cara lama (text only) jika HTML gagal, lalu hapus
            try {
                await navigator.clipboard.writeText(editorRef.current.innerText);
                
                // Tetap lakukan penghapusan walau fallback
                editorRef.current.innerHTML = '<p><br/></p>';
                onUpdate({ ...note, content: '<p><br/></p>' });
                
                setShowTools(false);
                setShowCutToast(true);
                setTimeout(() => setShowCutToast(false), 2000);
            } catch (fallbackErr) {
                 console.error("Fallback cut juga gagal:", fallbackErr);
            }
        }
    }
  };

  // --- FUNGSI SELECT ALL (PILIH SEMUA) ---
  const handleSelectAll = () => {
    if (editorRef.current) {
        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
        setShowTools(false); // Tutup menu
    }
  };

  // --- ALGORITMA PROXIMITY SEARCH (JARAK 45 KARAKTER) & DUKUNGAN HTML MODE ---
  const performSearch = (query: string) => {
      if (!query.trim() || (!isCodeView && !editorRef.current) || (isCodeView && !codeEditorRef.current)) {
          setSearchResults([]);
          setCurrentSearchIndex(0);
          return;
      }

      let text = '';
      const nodes: { node: Node; start: number; end: number }[] = [];

      if (isCodeView) {
          // Ambil teks langsung dari textarea jika di mode kode
          text = codeEditorRef.current!.value;
      } else {
          // Ambil dari teks DOM Editor jika di mode visual
          const walker = document.createTreeWalker(editorRef.current!, NodeFilter.SHOW_TEXT, null, false);
          let node: Node | null;
          while ((node = walker.nextNode())) {
              if (node.nodeValue) {
                  nodes.push({ node, start: text.length, end: text.length + node.nodeValue.length });
                  text += node.nodeValue;
              }
          }
      }

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
              let seen = new Set([allFound[i].word]);
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

      const results: SearchMatch[] = [];

      if (isCodeView) {
          // Format penyimpanan untuk Textarea
          matches.forEach(match => {
              results.push({ isCode: true, start: match.start, end: match.end });
          });
      } else {
          // Format penyimpanan untuk DOM HTML (Visual)
          matches.forEach(match => {
              const range = document.createRange();
              let startSet = false;
              let endSet = false;

              for (let i = 0; i < nodes.length; i++) {
                  const n = nodes[i];
                  if (!startSet && match.start >= n.start && match.start < n.end) {
                      range.setStart(n.node, match.start - n.start);
                      startSet = true;
                  }
                  if (!endSet && match.end > n.start && match.end <= n.end) {
                      range.setEnd(n.node, match.end - n.start);
                      endSet = true;
                  }
                  if (startSet && endSet) break;
              }
              if (startSet && endSet) results.push({ isCode: false, range });
          });
      }

      setSearchResults(results);
      
      if (results.length > 0) {
          setCurrentSearchIndex(0);
          if (!isCodeView && !results[0].isCode && results[0].range.startContainer.parentElement) {
              results[0].range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  };

  const focusMatchRange = (match: SearchMatch) => {
      if (match.isCode) {
          if (codeEditorRef.current) {
              codeEditorRef.current.focus();
              codeEditorRef.current.setSelectionRange(match.start, match.end);
              
              // Hitung garis (baris ke berapa) untuk scroll otomatis pada textarea
              const textBeforeMatch = codeEditorRef.current.value.substring(0, match.start);
              const lines = textBeforeMatch.split('\n').length;
              const lineHeight = 20; // Perkiraan tinggi teks 20px per baris
              codeEditorRef.current.scrollTop = (lines - 1) * lineHeight - (codeEditorRef.current.clientHeight / 2);
          }
      } else {
          const sel = window.getSelection();
          if (sel) {
              sel.removeAllRanges();
              sel.addRange(match.range);
          }
          if (match.range.startContainer.parentElement) {
              match.range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  };

  const navigateSearch = (direction: 'next' | 'prev') => {
      if (searchResults.length === 0) return;
      let newIndex = currentSearchIndex + (direction === 'next' ? 1 : -1);
      if (newIndex < 0) newIndex = searchResults.length - 1;
      if (newIndex >= searchResults.length) newIndex = 0;
      
      setCurrentSearchIndex(newIndex);
      focusMatchRange(searchResults[newIndex]);
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
      if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          const restoredContent = history[newIndex].content; // <-- PANGGIL KONTEN SAJA
          setHistoryIndex(newIndex);
          onUpdate({ ...note, content: restoredContent });
          
          // Fokuskan kembali kursor agar user tidak bingung
          if (isCodeView && codeEditorRef.current) codeEditorRef.current.focus();
          else if (!isCodeView && editorRef.current) editorRef.current.focus();
      }
  };

  const performRedo = () => {
      if (historyIndex < history.length - 1) {
          const newIndex = historyIndex + 1;
          const restoredContent = history[newIndex].content; // <-- PANGGIL KONTEN SAJA
          setHistoryIndex(newIndex);
          onUpdate({ ...note, content: restoredContent });
          
          // Fokuskan kembali kursor
          if (isCodeView && codeEditorRef.current) codeEditorRef.current.focus();
          else if (!isCodeView && editorRef.current) editorRef.current.focus();
      }
  };
  

  // Expose undo/redo to parent via Ref
  useImperativeHandle(ref, () => ({
    undo: performUndo,
    redo: performRedo
  }));

  // Sync content awal perubahan
  useEffect(() => {
    // Cek apakah konten berbeda
    if (editorRef.current && editorRef.current.innerHTML !== note.content) {
      
      // --- PERUBAHAN DI SINI ---
      // Kita HAPUS pengecekan 'document.activeElement'
      // Agar perubahan dari HP langsung muncul di Laptop walau sedang dibuka
      const isFocused = document.activeElement === editorRef.current;
      
      editorRef.current.innerHTML = note.content;

      // Opsional: Jika sedang fokus, kembalikan kursor ke akhir teks
      // agar tidak hilang total saat update masuk
      if (isFocused) {
          try {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(editorRef.current);
            range.collapse(false); // Pindahkan kursor ke paling akhir
            sel?.removeAllRanges();
            sel?.addRange(range);
          } catch (e) {
                // Abaikan error seleksi jika terjadi
              }
          }
        }
        addCheckboxListeners();
      }, [note.id, note.content, isCodeView]); // <--- PERBAIKAN: Tambahkan isCodeView di dalam kurung siku ini

      // akhir perubahan

  const addCheckboxListeners = () => {
    if (!editorRef.current) return;
    const checkboxes = editorRef.current.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const target = cb as HTMLInputElement;
        const parent = target.closest('.todo-item') as HTMLElement;
        
        if (parent) {
            // --- FIX KURSOR LOMPAT KE KIRI ---
            // 1. Matikan edit di container utama (agar kursor tidak bisa ke kiri checkbox)
            parent.contentEditable = 'false';
            
            // 2. Hidupkan edit HANYA pada teks (span)
            let span = parent.querySelector('span');
            if (span) {
                span.contentEditable = 'true';
                span.style.outline = 'none'; // Hilangkan garis biru fokus
            }
        }

        // Event Listener Klik Checkbox
        target.onclick = (e) => {
            const el = e.target as HTMLInputElement;
            const p = el.closest('.todo-item');
            
            if (p) {
                if (el.checked) {
                    el.setAttribute('checked', 'checked');
                    p.classList.add('completed');
                    
                    // --- LOGIKA BARU: Simpan Waktu Centang (Khusus Berjangka) ---
                    if (el.dataset.days) {
                        el.setAttribute('data-checked-time', Date.now().toString());
                    }
                } else {
                    el.removeAttribute('checked');
                    p.classList.remove('completed');
                    
                    // Hapus waktu jika di-uncheck manual
                    el.removeAttribute('data-checked-time');
                }
                handleInput(); 
            }
        }
    });
  };

  // Di dalam komponen Editor, sejajar dengan ref lain:
  const isIgnoringClick = useRef(false); // Tambahan untuk mencegah klik tidak sengaja
  
    // --- KEYBOARD HANDLING (FULL FIX) ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
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

    // 3. HANDLE TODO ITEMS (CHECKBOX)
    const todoItem = (node as HTMLElement).closest('.todo-item');
    if (todoItem) {
        const currentItem = todoItem as HTMLElement;
        const currentSpan = currentItem.querySelector('span');
        
        // Cek apakah kursor ada di AWAL baris (offset 0)
        const range = selection.getRangeAt(0);
        // Kita perlu memastikan range benar-benar di start dari SPAN, bukan wrapper
        const isAtStart = range.startOffset === 0 && range.collapsed; 

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

        // --- B. ENTER: SPLIT LINE (Potong Teks ke Bawah) ---
        if (e.key === 'Enter') {
            e.preventDefault();
            
            // Buat elemen baru
            const newItem = document.createElement('div');
            newItem.className = 'todo-item';
            newItem.contentEditable = 'false';
            
            const newCheckbox = document.createElement('input');
            newCheckbox.type = 'checkbox';
            
            const newSpan = document.createElement('span');
            newSpan.contentEditable = 'true';
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

      const handleInput = () => {
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
    const content = editorRef.current.innerHTML;
    onUpdate({ ...note, content });
    recordHistory(content); // Rekam perubahan ke dalam Mesin Waktu
  };

  // --- FUNGSI BARU: Perekam Mesin Waktu (Debounced) ---
  const recordHistory = (newContent: string) => {
      // Tunggu user berhenti mengetik 1 detik sebelum merekam, agar history tidak dipenuhi per huruf
      if (isTypingTimer.current) clearTimeout(isTypingTimer.current);
      
      isTypingTimer.current = setTimeout(() => {
          setHistory(prev => {
              // Jika kita habis melakukan Undo (misal dari C ke B), lalu mengetik hal baru (D)
              // Maka masa depan (C) harus dibuang, jadinya A -> B -> D
              const currentHistory = prev.slice(0, historyIndex + 1);
              
              // Cek agar tidak merekam hal yang sama persis dua kali berturut-turut
              if (currentHistory.length > 0 && currentHistory[currentHistory.length - 1].content === newContent) return prev;
              
              // TAMBAHAN: Kita rekam teks BERSAMAAN dengan waktu persis ia diketik (hingga milidetik)
              const newVersions = [...currentHistory, { content: newContent, timestamp: Date.now() }];
              
              // Batasi maksimal 50 versi agar memori lokal tidak jebol
              if (newVersions.length > 50) newVersions.shift();
              
              setHistoryIndex(newVersions.length - 1);
              
              // Simpan ke Brankas Lokal dengan Stempel Waktu (24 Jam)
              localStorage.setItem(`nexus_history_${note.id}`, JSON.stringify({
                  timestamp: Date.now(),
                  pastVersions: newVersions
              }));
              
              return newVersions;
          });
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

    // 2. Ganti DOM Manipulation manual dengan execCommand
    // Metode ini mencegah HTML pecah/berantakan saat kita menyisipkan elemen
    // ke dalam tag yang sudah kompleks seperti baris checkbox (todo-item).
    const chipHtml = `<span class="mention-chip" contenteditable="false" data-id="${targetNoteId}">@${targetTitle}</span>&nbsp;`;
    document.execCommand('insertHTML', false, chipHtml);

    setShowMentionList(false);
    handleInput();
  };

  const handleMentionSelect = async (existingNote: Note | null) => {
    if (existingNote) {
      insertMention(existingNote.id, existingNote.title);
    } else {
      // Perubahan: onCreateNewNote sekarang bisa mengembalikan object Note lengkap atau ID string
      // Kita asumsikan implementasi di App.tsx mengembalikan ID (string)
      const newNoteResult = await onCreateNewNote(mentionQuery); 
      
      // Jika hasil kembalian adalah string (ID), gunakan langsung
      // Jika hasil kembalian object Note, ambil .id-nya
      const newNoteId = typeof newNoteResult === 'string' ? newNoteResult : (newNoteResult as any).id;
      
      if (newNoteId) {
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

  const execCmd = (command: string, value: string = '', restoreSelection: boolean = false) => {
    // Kembalikan seleksi jika diinstruksikan (khusus dropdown size)
    if (restoreSelection && savedSelection.current) {
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(savedSelection.current);
        }
    }
    
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
    setActiveMenu('NONE');
    savedSelection.current = null; // Bersihkan setelah digunakan
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
      const html = `<div class="todo-item ${isRecurring ? 'recurring' : ''}" contentEditable="false">
          <input type="checkbox" ${isRecurring ? `data-days="${days}"` : ''}>
          <span contentEditable="true">\u00A0</span>
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
      // Oper parameter restore ke execCmd
      execCmd('insertHTML', imgHtml, restore);
  };

  const insertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
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
  const handlePaste = (e: React.ClipboardEvent) => {
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
    n.title.toLowerCase().includes(mentionQuery.toLowerCase()) && 
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
        try {
            let cleanHtml = note.content
                // 1. Hapus ratusan style bawaan (--tw-scale, shadow, dll)
                .replace(/ style="[^"]*"/gi, '') 
                // 2. Hapus status contenteditable bawaan editor
                .replace(/ contenteditable="[^"]*"/gi, '') 
                // 3. Hapus atribut data sementara (opsional untuk kebersihan)
                .replace(/ data-[a-zA-Z\-]+="[^"]*"/gi, '') 
                // 4. Hapus karakter gaib / kosong penyita spasi (seperti ‎)
                .replace(/[\u200B-\u200D\uFEFF\u200E]/g, '') 
                // 5. Rapikan tag pembuka dan penutup agar menurun (Pretty Print dasar)
                .replace(/></g, '>\n<');

            // Salin hanya sebagai teks murni (Teks Kode HTML Bersih)
            await navigator.clipboard.writeText(cleanHtml);
            
            setShowCopyToast(true);
            setTimeout(() => setShowCopyToast(false), 2000);
        } catch (err) {
            console.error("Gagal menyalin kode:", err);
        }
        return; // Hentikan fungsi di sini agar tidak menjalankan copy visual
    }

    // --- LOGIKA NORMAL JIKA DI MODE VISUAL ---
    if (editorRef.current) {
        try {
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

            // 2. Ambil HTML lengkap
            const htmlContent = editorRef.current.innerHTML;
            
            // 3. Buat Blob
            const textContent = editorRef.current.innerText;
            const clipboardItem = new ClipboardItem({
                "text/html": new Blob([htmlContent], { type: "text/html" }),
                "text/plain": new Blob([textContent], { type: "text/plain" })
            });

            await navigator.clipboard.write([clipboardItem]);
            
            setShowCopyToast(true);
            setTimeout(() => {
                setShowCopyToast(false);
            }, 2000);

        } catch (err) {
            console.error("Gagal menyalin:", err);
            // Fallback
            try {
                await navigator.clipboard.writeText(editorRef.current.innerText);
                 setShowCopyToast(true);
                 setTimeout(() => setShowCopyToast(false), 2000);
            } catch (fallbackErr) { console.error(fallbackErr); }
        }
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
            <div className="absolute top-4 left-4 right-4 bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 rounded-xl p-2 z-50 flex items-center gap-2 animate-in slide-in-from-top-2">
                <Search size={18} className="text-gray-400 shrink-0" />
                <input
                    type="text"
                    placeholder="Cari... (Coba: kata1 kata2)"
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        performSearch(e.target.value);
                    }}
                    // PERBAIKAN: Gunakan tombol Enter untuk menyetujui pemblokiran teks
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            if (searchResults.length > 0) {
                                focusMatchRange(searchResults[currentSearchIndex]);
                            }
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
                <button onMouseDown={preventFocusLoss} onClick={() => {
                    setShowSearch(false);
                    setSearchQuery('');
                    setSearchResults([]);
                    window.getSelection()?.removeAllRanges(); // Bersihkan blok
                }} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-500 rounded text-gray-600 dark:text-gray-300">
                    <X size={18} />
                </button>
            </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-32 mt-2">
            <div className="flex items-center gap-2 mb-4">
                {isMindMap && <Network className="text-indigo-500" size={28} />}
                {/* PERBAIKAN: Menggunakan Textarea agar judul bisa multi-baris dan font lebih kecil */}
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
            
            {/* TAMPILAN KODE (HTML) ATAU VISUAL */}
            {isCodeView ? (
                <textarea
                    ref={codeEditorRef} // <--- TAMBAHKAN REF INI
                    className="w-full min-h-[50vh] p-4 mt-2 font-mono text-sm bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-700 rounded-lg outline-none resize-y"
                    value={note.content}
                    onChange={(e) => {
                        const newCodeContent = e.target.value;
                        onUpdate({ ...note, content: newCodeContent });
                        recordHistory(newCodeContent); // Panggil alat rekam kita di Mode Kode!
                    }}
                    placeholder="Tulis kode HTML di sini..."
                />
            ) : (
                <div 
                    ref={editorRef}
                    className={`editor-content outline-none text-lg min-h-[50vh] leading-relaxed dark:text-gray-200 ${isMindMap ? 'mindmap-mode' : ''}`}
                    contentEditable
                    onInput={handleInput}
                    onPaste={handlePaste} // <--- Tambahkan baris ini
                    onKeyDown={handleKeyDown}
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

      {/* --- MENU TOOLS (CUT & SELECT ALL) --- */}
        
        {/* Sub-tombol: Select All (Paling Atas) */}
        {showTools && (
            <button 
                onClick={handleSelectAll}
                // HAPUS 'bottom-84', GANTI DENGAN style={{ bottom: '21rem' }}
                className="fixed right-4 w-12 h-12 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-700 z-30 animate-in slide-in-from-bottom-4 fade-in duration-200"
                style={{ bottom: '21rem' }} 
                title="Pilih Semua"
            >
                <Scan size={20} />
            </button>
        )}

        {/* Sub-tombol: Cut (Di tengah antara Tools dan Select All) */}
        {showTools && (
            <button 
                onClick={handleCutContent}
                // HAPUS 'bottom-68', GANTI DENGAN style={{ bottom: '17rem' }}
                className="fixed right-4 w-12 h-12 bg-red-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-red-700 z-30 animate-in slide-in-from-bottom-2 fade-in duration-200"
                style={{ bottom: '17rem' }}
                title="Potong (Cut)"
            >
                <Scissors size={20} />
            </button>
        )}

        {/* Tombol Utama Tools (Posisi di atas tombol Copy - bottom-52 tetap aman karena standar) */}
        <button 
            onClick={() => setShowTools(!showTools)}
            className={`fixed bottom-52 right-4 w-12 h-12 rounded-full shadow-lg flex items-center justify-center z-30 transition-all duration-300 ${showTools ? 'bg-gray-600 text-white rotate-90' : 'bg-gray-800 dark:bg-gray-700 text-white hover:bg-black'}`}
            title="Alat Lainnya"
        >
            <MoreVertical size={20} />
        </button>

      {/* Tombol Copy (Posisi di atas tombol Home - bottom-36) */}
        <button 
            onClick={handleCopyContent}
            className="fixed bottom-36 right-4 w-12 h-12 bg-gray-800 dark:bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-black z-30 opacity-90 transition-opacity"
            title="Salin Isi Catatan"
        >
            <Copy size={20} />
        </button>

        <button 
            onClick={onGoHome}
            className="fixed bottom-20 right-4 w-12 h-12 bg-gray-800 dark:bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-black z-30 opacity-90 transition-opacity"
            title="Kembali ke Sebelumnya"
        >
            <ArrowLeft size={20} />
        </button>

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
                 <button onMouseDown={preventFocusLoss} onClick={() => execCmd('insertUnorderedList')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><List size={18} /> Bullet</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => execCmd('insertOrderedList')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><ListOrdered size={18} /> 123</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => { insertCheckbox(); setActiveMenu('NONE'); }} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><CheckSquare size={18} /> Todo</button>
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

                <button onMouseDown={preventFocusLoss} onClick={() => {
                    if (!isCodeView) {
                        // Jalankan pembersih dan perapi sebelum masuk ke mode kode
                        const cleanedHTML = formatAndCleanHTML(note.content);
                        onUpdate({ ...note, content: cleanedHTML });
                    }
                    setIsCodeView(!isCodeView);
                    
                    // --- RESET PENCARIAN SAAT GANTI MODE ---
                    setSearchQuery('');
                    setSearchResults([]);
                }} className={`p-2 rounded min-w-[40px] flex justify-center ${isCodeView ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`} title="Tampilkan Kode HTML">
                    <Code size={20} />
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

                <label 
                    className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[40px] flex justify-center cursor-pointer text-gray-700 dark:text-gray-300"
                    // PERBAIKAN: Gunakan onMouseDown pada LABEL, bukan onClick pada INPUT
                    onMouseDown={(e) => {
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
                        <div className="text-center text-gray-500 py-8 text-sm">Belum ada riwayat perubahan.</div>
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

                            // 2. HELPER PEMBERSIH KODE: Menghapus &nbsp;, <br>, dan memfilter tag HTML
                            const getCleanText = (htmlStr: string) => {
                                const temp = document.createElement('div');
                                // Ubah tag ganti baris menjadi spasi biasa agar teks tidak menempel
                                temp.innerHTML = htmlStr.replace(/<br\s*[\/]?>/gi, ' ').replace(/<\/p>/gi, ' </p>'); 
                                // textContent akan secara ajaib memusnahkan &nbsp; menjadi spasi biasa
                                return (temp.textContent || temp.innerText || "").replace(/\s+/g, ' ').trim();
                            };

                            const currentText = getCleanText(histItem.content);
                            const prevSnapshot = originalIdx > 0 ? history[originalIdx - 1].content : "";
                            const prevText = getCleanText(prevSnapshot);
                            
                            const currentWords = currentText.split(/\s+/).filter(w => w);
                            const prevWords = prevText.split(/\s+/).filter(w => w);
                            
                            const addedWords = currentWords.filter(w => !prevWords.includes(w)).join(' ');
                            const removedWords = prevWords.filter(w => !currentWords.includes(w)).join(' ');

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
                                                    {formatTimeWithMs(histItem.timestamp)}
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
                                            {currentText.substring(0, 100) || "(Kosong)"}
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
                                                    setHistoryIndex(originalIdx);
                                                    onUpdate({ ...note, content: histItem.content });
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
