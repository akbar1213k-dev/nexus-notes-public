import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import { Note, EditorHandle } from '../types';
import { 
  Image as ImageIcon, Table, AtSign, 
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, CheckSquare, 
  Indent, Outdent, MoreHorizontal,
  Plus, Trash2, Home, Network, Copy, Check,
  Scissors, Scan, MoreVertical,
  Undo, Redo, Sliders // <--- Tambahkan Sliders
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
  const [showCutToast, setShowCutToast] = useState(false); // <--- Tambahkan ini

  // --- STATE BARU UNTUK TOOLS ---
  const [showTools, setShowTools] = useState(false);

  // --- FUNGSI CUT (POTONG) ---
  const handleCutContent = async () => {
    if (editorRef.current) {
        try {
            // 1. Copy isi ke clipboard
            const textToCopy = editorRef.current.innerText;
            await navigator.clipboard.writeText(textToCopy);

            // 2. Hapus isi konten
            editorRef.current.innerHTML = '<p><br/></p>'; // Reset ke paragraf kosong
            
            // 3. Simpan perubahan (Update note)
            onUpdate({ ...note, content: '<p><br/></p>' });
            
            // 4. Notifikasi / Feedback (YANG DIUBAH)
            setShowTools(false); // Tutup menu
            
            // Tampilkan notifikasi toast
            setShowCutToast(true);
            setTimeout(() => {
                setShowCutToast(false);
            }, 2000);

        } catch (err) {
            console.error("Gagal memotong:", err);
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

  // --- PERBAIKAN LOGIKA UNDO/REDO ---
  // Fungsi dipisahkan agar bisa dipanggil oleh tombol TopBar (via ref) 
  // DAN tombol Toolbar Bawah (onClick)
  const performUndo = () => {
      if (editorRef.current) {
          editorRef.current.focus(); // Pastikan fokus kembali ke editor (Fix Desktop)
          document.execCommand('undo');
          handleInput();
      }
  };

  const performRedo = () => {
      if (editorRef.current) {
          editorRef.current.focus(); // Pastikan fokus kembali ke editor (Fix Desktop)
          document.execCommand('redo');
          handleInput();
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
  }, [note.id, note.content]);

  // akhir perubahan

  const addCheckboxListeners = () => {
    if (!editorRef.current) return;
    const checkboxes = editorRef.current.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        (cb as HTMLInputElement).onclick = (e) => {
            const target = e.target as HTMLInputElement;
            const parent = target.closest('.todo-item');
            if (parent) {
                if (target.checked) {
                    target.setAttribute('checked', 'checked');
                    parent.classList.add('completed');
                } else {
                    target.removeAttribute('checked');
                    parent.classList.remove('completed');
                }
                handleInput(); 
            }
        }
    });
  };

  // Di dalam komponen Editor, sejajar dengan ref lain:
  const isIgnoringClick = useRef(false); // Tambahan untuk mencegah klik tidak sengaja
  
    // --- KEYBOARD HANDLING ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // [LOGIKA BARU] Handle Enter saat Mention List terbuka
    if (showMentionList) {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Filter catatan secara manual karena variabel filteredNotes ada di bawah
            const currentFiltered = allNotes.filter(n => 
                n.title.toLowerCase().includes(mentionQuery.toLowerCase()) && 
                n.id !== note.id 
            );
            // Pilih item pertama atau buat baru (null)
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
    
    let node: Node | null = selection.anchorNode;
    if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentNode;
    }

    // 1. Handle List Outdent on Enter/Backspace for empty items (Bullet/Numbering)
    const li = (node as HTMLElement).closest('li');
    if (li && (e.key === 'Enter' || e.key === 'Backspace')) {
        const isEmpty = li.textContent?.trim() === '';
        if (isEmpty) {
             document.execCommand('outdent');
             e.preventDefault(); 
             return;
        }
    }

    // 2. Handle Todo Items (LOGIKA BARU)
    const todoItem = (node as HTMLElement).closest('.todo-item');
    if (todoItem) {
        const textContent = todoItem.textContent?.trim() || '';
        // Cek apakah baris benar-benar kosong
        const isEmpty = textContent === '';

        // A. BACKSPACE pada Todo Kosong -> Hapus Checkbox (Jadi teks biasa)
        if (e.key === 'Backspace' && isEmpty) {
            e.preventDefault();
            // Ganti dengan div standar
            const newDiv = document.createElement('div');
            newDiv.innerHTML = '<br>'; // Placeholder agar baris tidak hilang
            if (todoItem.parentNode) {
                todoItem.parentNode.replaceChild(newDiv, todoItem);
                
                // Pindahkan fokus ke baris teks baru
                const range = document.createRange();
                range.setStart(newDiv, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
            handleInput();
            return;
        }

        // B. ENTER pada Todo Kosong -> Hapus Checkbox (Keluar dari mode Todo)
        if (e.key === 'Enter' && isEmpty) {
            e.preventDefault();
            const newDiv = document.createElement('div');
            newDiv.innerHTML = '<br>';
            if (todoItem.parentNode) {
                todoItem.parentNode.replaceChild(newDiv, todoItem);
                
                // Pindahkan fokus ke baris teks baru
                const range = document.createRange();
                range.setStart(newDiv, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
            handleInput();
            return;
        }

        // C. ENTER pada Todo yang ADA ISINYA -> Buat Todo Baru di Bawahnya
        if (e.key === 'Enter' && !isEmpty) {
            e.preventDefault(); 
            
            const currentItem = todoItem as HTMLElement;
            const newItem = document.createElement('div');
            newItem.className = 'todo-item';
            newItem.innerHTML = '<input type="checkbox"><span>\u00A0</span>'; 
            
            if (currentItem.nextSibling) {
                currentItem.parentNode?.insertBefore(newItem, currentItem.nextSibling);
            } else {
                currentItem.parentNode?.appendChild(newItem);
            }

            const newSpan = newItem.querySelector('span');
            if (newSpan) {
                const range = document.createRange();
                range.setStart(newSpan, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
            
            setTimeout(addCheckboxListeners, 0);
            handleInput(); 
            return;
        }
    }
  };

    const handleInput = () => {
    if (!editorRef.current) return;
    checkSelectionContext();

    const content = editorRef.current.innerHTML;
    onUpdate({ ...note, content });

      
    // Mention logic (NEW: Trigger with @. and allow spaces)
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
      const textBeforeCursor = textNode.textContent.slice(0, range.startOffset);
      
      // 1. KONDISI TRIGGER: Jika menu BELUM terbuka
      if (!showMentionList) {
         // Cek apakah user mengetik "@." (at + titik)
         if (textBeforeCursor.endsWith('@.')) {
             const atIndex = textBeforeCursor.lastIndexOf('@');
             
             // --- HAPUS TITIK (.) DENGAN RANGE API (Agar kursor tidak lompat) ---
             // Menggunakan deleteContents() jauh lebih aman untuk Checkbox/Nested Elements
             // daripada mengganti textContent secara manual yang merusak fokus.
             try {
                const deleteRange = document.createRange();
                if (range.startOffset > 0) {
                    deleteRange.setStart(textNode,TbCc range.startOffset - 1); // Targetkan titik sebelum kursor
                    deleteRange.setEnd(textNode, range.startOffset);
                    deleteRange.deleteContents(); // Hapus titiknya saja
                }

                // --- PERBAIKI POSISI KURSOR ---
                // Pastikan range baru ada tepat setelah '@'
                const newRange = document.createRange();
                // Validasi agar tidak error jika index di luar batas
                if (atIndex + 1 <= textNode.textContent.length) {
                    newRange.setStart(textNode, atIndex + 1);
                } else {
                    newRange.setStart(textNode, textNode.textContent.length);
                }
                newRange.collapse(true);
                
                selection.removeAllRanges();
                selection.addRange(newRange);
                
                // Simpan range ini agar insertMention tahu di mana harus menempel
                setCursorRange(newRange);
             } catch (err) {
                console.error("Error adjusting cursor:",RP err);
             }
             
             // --- BUKA MENU ---
             const rect = newRange.getBoundingClientRect();
             setMentionPosition({ top: rect.top - 40, left: rect.left });
             setMentionQuery(''); // Query awal kosong
             setShowMentionList(true);
             return;
         }
      } 
      
      // 2. KONDISI UPDATE: Jika menu SUDAH terbuka
      else {
          const atIndex = textBeforeCursor.lastIndexOf('@');
          if (atIndex !== -1) {
              // Ambil semua teks setelah @ (IZINKAN SPASI)
              const query = textBeforeCursor.slice(atIndex + 1);
              setMentionQuery(query);
              setCursorRange(range); // Update range terus menerus saat mengetik
              return;
          } else {
              // Jika tanda @ terhapus, tutup menu
              setShowMentionList(false);
          }
      }
    }
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

    // Buat elemen Chip
    const chip = document.createElement('span');
    chip.className = 'mention-chip';
    chip.contentEditable = 'false';
    chip.dataset.id = targetNoteId; // ID catatan tujuan disimpan di sini
    chip.textContent = `@${targetTitle}`;
    
    cursorRange.insertNode(chip);
    cursorRange.setStartAfter(chip);
    cursorRange.setEndAfter(chip);
    
    // Tambahkan spasi setelah chip agar tidak "terjebak"
    const space = document.createTextNode('\u00A0');
    cursorRange.insertNode(space);
    cursorRange.setStartAfter(space);
    cursorRange.setEndAfter(space);
    
    selection?.removeAllRanges();
    selection?.addRange(cursorRange);

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

  const insertCheckbox = () => {
    const selection = window.getSelection();
    
    // 1. Cek apakah ada teks yang diblok (Selected)
    if (selection && !selection.isCollapsed) {
        const text = selection.toString();
        
        // Pecah teks berdasarkan baris baru (Enter)
        // Regex /\r?\n/ menangani enter di Windows/Mac/Linux
        const lines = text.split(/\r?\n/);
        
        // Buat HTML untuk setiap baris menjadi checkbox terpisah
        const html = lines.map(line => {
            // Jika baris kosong, isi dengan spasi non-breaking agar baris tetap muncul
            const content = line.trim() === '' ? '\u00A0' : line; 
            return `<div class="todo-item"><input type="checkbox"><span>${content}</span></div>`;
        }).join('');
        
        // Masukkan HTML baru menggantikan teks yang diblok
        execCmd('insertHTML', html);
        addCheckboxListeners();
    } else {
        // 2. Perilaku Lama: Jika tidak ada blok (hanya kursor), buat 1 checkbox kosong
        const html = `<div class="todo-item"><input type="checkbox"><span>\u00A0</span></div>`;
        execCmd('insertHTML', html);
        addCheckboxListeners();
    }
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

  // --- FUNGSI COPY CONTENT ---
  const handleCopyContent = async () => {
    if (editorRef.current) {
        try {
            const textToCopy = editorRef.current.innerText;
            await navigator.clipboard.writeText(textToCopy);
            
            // Tampilkan notifikasi
            setShowCopyToast(true);
            
            // Sembunyikan otomatis setelah 2 detik
            setTimeout(() => {
                setShowCopyToast(false);
            }, 2000);

        } catch (err) {
            console.error("Gagal menyalin:", err);
            // Opsional: Anda bisa buat state error jika mau, tapi biasanya silent fail cukup
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
        <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-32">
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
        >
            <Home size={20} />
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
    </div>
  );
});
