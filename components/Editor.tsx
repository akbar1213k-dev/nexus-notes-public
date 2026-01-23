import React, { useRef, useEffect, useState } from 'react';
import { Note } from '../types';
import { 
  Image as ImageIcon, Table, AtSign, 
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, CheckSquare, 
  Indent, Outdent, ChevronUp, MoreHorizontal,
  Plus, Trash2, Home
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

type ToolbarMenu = 'NONE' | 'FORMAT' | 'LIST' | 'TABLE';

export const Editor: React.FC<EditorProps> = ({ 
  note, 
  allNotes, 
  onUpdate, 
  onCreateNewNote,
  onLinkClick,
  onLinkLongPress,
  onGoHome
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [cursorRange, setCursorRange] = useState<Range | null>(null);
  
  const [activeMenu, setActiveMenu] = useState<ToolbarMenu>('NONE');
  const [isTableContext, setIsTableContext] = useState(false);

  // Sync content
  useEffect(() => {
  if (editorRef.current && editorRef.current.innerHTML !== note.content) {
    editorRef.current.innerHTML = note.content;
  }
  // Pasang kembali listener setiap kali editor dimuat atau konten berubah
  addCheckboxListeners();
}, [note.id, note.content]); // Tambahkan note.content sebagai pemicu

  const addCheckboxListeners = () => {
  if (!editorRef.current) return;
  const checkboxes = editorRef.current.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    const checkbox = cb as HTMLInputElement;
    checkbox.onclick = (e) => {
      const target = e.target as HTMLInputElement;
      const parent = target.closest('.todo-item');
      
      // Update atribut checked secara manual agar tersimpan di innerHTML
      if (target.checked) {
        target.setAttribute('checked', 'checked');
        if (parent) parent.classList.add('completed');
      } else {
        target.removeAttribute('checked');
        if (parent) parent.classList.remove('completed');
      }
      handleInput(); // Simpan perubahan ke database
    };
  });
};

  // --- KEYBOARD HANDLING FOR LISTS ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Backspace') {
        const selection = window.getSelection();
        if (!selection?.anchorNode) return;
        
        let node: Node | null = selection.anchorNode;
        // If anchor is the text node, get parent
        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
        }
        
        // Find LI
        const li = (node as HTMLElement).closest('li');
        
        if (li) {
            const isEmpty = li.textContent?.trim() === '';
            // If empty LI and Enter/Backspace pressed -> Outdent (Reset to Paragraph)
            if (isEmpty) {
                 // Allow default Backspace to just delete the bullet if it's the first thing?
                 // Or enforce outdent. Outdent usually turns LI into P.
                 document.execCommand('outdent');
                 e.preventDefault(); 
                 return;
            }
        }
    }
  };

  const handleInput = () => {
    if (!editorRef.current) return;
    checkSelectionContext();

    const content = editorRef.current.innerHTML;
    onUpdate({ ...note, content });

    // Mention logic
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
      const textBeforeCursor = textNode.textContent.slice(0, range.startOffset);
      const atIndex = textBeforeCursor.lastIndexOf('@');
      
      if (atIndex !== -1 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
        const query = textBeforeCursor.slice(atIndex + 1);
        if (!/\s/.test(query)) {
          const rect = range.getBoundingClientRect();
          setMentionPosition({ top: rect.top - 40, left: rect.left });
          setMentionQuery(query);
          setShowMentionList(true);
          setCursorRange(range);
          return;
        }
      }
    }
    setShowMentionList(false);
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
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(cursorRange);
    }

    const textNode = cursorRange.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
        const text = textNode.textContent;
        const atIndex = text.lastIndexOf('@', cursorRange.startOffset - 1);
        if (atIndex >= 0) {
            cursorRange.setStart(textNode, atIndex);
            cursorRange.deleteContents();
        }
    }

    const chip = document.createElement('span');
    chip.className = 'mention-chip';
    chip.contentEditable = 'false';
    chip.dataset.id = targetNoteId;
    chip.textContent = `@${targetTitle}`;
    
    cursorRange.insertNode(chip);
    cursorRange.setStartAfter(chip);
    cursorRange.setEndAfter(chip);
    
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
      const newId = await onCreateNewNote(mentionQuery);
      insertMention(newId, mentionQuery);
    }
  };

  const handleEditorClick = (e: React.MouseEvent) => {
    checkSelectionContext();
    setActiveMenu('NONE');

    const target = e.target as HTMLElement;
    if (target.classList.contains('mention-chip')) {
        const id = target.dataset.id;
        if (id) onLinkClick(id);
    }
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

  const execCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
    setActiveMenu('NONE');
  };

  const insertCheckbox = () => {
    const html = `<div class="todo-item"><input type="checkbox"><span>&nbsp;To do</span></div>`;
    execCmd('insertHTML', html);
    addCheckboxListeners();
  };

  const insertTable = () => {
    const html = `<table class="min-w-full border-collapse border border-gray-300"><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></tbody></table><p><br/></p>`;
    execCmd('insertHTML', html);
  };

  const insertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      execCmd('insertImage', url);
    }
  };

  const handleTableAction = (action: string) => {
      // NOTE: We must access selection immediately. 
      // The buttons use onMouseDown.preventDefault() to keep selection in the editor.
      const selection = window.getSelection();
      
      if (!selection || selection.rangeCount === 0) {
          console.log("No selection found for table action");
          return;
      }
      
      let node = selection.anchorNode as HTMLElement | null;
      
      // Traverse up
      while(node && node.nodeName !== 'TD' && node.nodeName !== 'TH' && node !== editorRef.current && node.nodeName !== 'BODY') {
          node = node.parentElement;
      }
      
      // Validation
      if (!node || (node.nodeName !== 'TD' && node.nodeName !== 'TH')) {
          console.log("Not inside a table cell");
          return;
      }
      
      const cell = node as HTMLTableCellElement;
      const row = cell.parentElement as HTMLTableRowElement;
      const table = row?.parentElement?.parentElement as HTMLTableElement; // td -> tr -> tbody -> table

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
    setActiveMenu(prev => prev === menu ? 'NONE' : menu);
  };

  const filteredNotes = allNotes.filter(n => 
    n.title.toLowerCase().includes(mentionQuery.toLowerCase()) && n.id !== note.id
  );

  // Helper for menu buttons to prevent focus loss
  const preventFocusLoss = (e: React.MouseEvent) => {
      e.preventDefault();
  };

  return (
    <div className="flex flex-col h-full relative">
        <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-32">
            <input 
                value={note.title}
                onChange={(e) => onUpdate({...note, title: e.target.value})}
                placeholder="Page Title"
                className="text-3xl font-bold mb-4 w-full bg-transparent border-none outline-none placeholder-gray-300 dark:placeholder-gray-700 dark:text-gray-100"
            />
            <div 
                ref={editorRef}
                className="editor-content outline-none text-lg min-h-[50vh] leading-relaxed dark:text-gray-200"
                contentEditable
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onClick={handleEditorClick}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                data-placeholder="Start typing..."
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

        <button 
            onClick={onGoHome}
            className="fixed bottom-20 right-4 w-12 h-12 bg-gray-800 dark:bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-black z-30 opacity-90 transition-opacity"
        >
            <Home size={20} />
        </button>

        {/* --- Toolbar Menus (Popups) --- */}
        {/* Added onMouseDown={preventFocusLoss} to all action buttons to keep selection in editor */}

        {/* Format Menu */}
        {activeMenu === 'FORMAT' && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-2 z-40 flex flex-wrap gap-2 animate-in slide-in-from-bottom-5 fade-in">
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('bold')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Bold size={18} /></button>
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('italic')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Italic size={18} /></button>
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('underline')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Underline size={18} /></button>
                <button onMouseDown={preventFocusLoss} onClick={() => execCmd('strikeThrough')} className="p-2 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex justify-center"><Strikethrough size={18} /></button>
                <div className="w-full flex gap-2 mt-1">
                     <select onChange={(e) => execCmd('fontSize', e.target.value)} className="bg-gray-100 dark:bg-gray-700 dark:text-white p-2 rounded text-sm flex-1">
                        <option value="3">Normal Size</option>
                        <option value="1">Small</option>
                        <option value="5">Large</option>
                        <option value="7">Huge</option>
                     </select>
                </div>
            </div>
        )}

        {/* List Menu */}
        {activeMenu === 'LIST' && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-2 z-40 flex flex-wrap gap-2 animate-in slide-in-from-bottom-5 fade-in">
                 <button onMouseDown={preventFocusLoss} onClick={() => execCmd('insertUnorderedList')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><List size={18} /> Bullet</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => execCmd('insertOrderedList')} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><ListOrdered size={18} /> 123</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => { insertCheckbox(); setActiveMenu('NONE'); }} className="p-3 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex-1 flex items-center justify-center gap-2"><CheckSquare size={18} /> Todo</button>
            </div>
        )}

        {/* Table Menu */}
        {activeMenu === 'TABLE' && (
            <div className="absolute bottom-16 left-2 right-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 z-40 grid grid-cols-2 gap-2 animate-in slide-in-from-bottom-5 fade-in">
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('addRow')} className="p-2 text-sm bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-100 rounded flex items-center gap-2"><Plus size={16}/> Row</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('addCol')} className="p-2 text-sm bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-100 rounded flex items-center gap-2"><Plus size={16}/> Col</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('delRow')} className="p-2 text-sm bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-100 rounded flex items-center gap-2"><Trash2 size={16}/> Row</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('delCol')} className="p-2 text-sm bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-100 rounded flex items-center gap-2"><Trash2 size={16}/> Col</button>
                 <button onMouseDown={preventFocusLoss} onClick={() => handleTableAction('delTable')} className="col-span-2 p-2 text-sm bg-red-100 dark:bg-red-900 font-bold text-red-700 dark:text-red-100 rounded flex justify-center items-center gap-2"><Trash2 size={16}/> Delete Entire Table</button>
            </div>
        )}

        {/* --- Main Sticky Toolbar --- */}
        <div className="h-14 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between px-2 shadow-lg sticky bottom-0 w-full z-40">
            <div className="flex space-x-1 overflow-x-auto no-scrollbar w-full items-center">
                
                {/* 1. Format Group */}
                <button onMouseDown={preventFocusLoss} onClick={() => toggleMenu('FORMAT')} className={`p-2 rounded min-w-[40px] flex justify-center ${activeMenu === 'FORMAT' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                    <Bold size={20} />
                </button>

                {/* 2. List Group */}
                <button onMouseDown={preventFocusLoss} onClick={() => toggleMenu('LIST')} className={`p-2 rounded min-w-[40px] flex justify-center ${activeMenu === 'LIST' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                    <List size={20} />
                </button>

                {/* 3. Indent Group */}
                <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg mx-1">
                    <button onMouseDown={preventFocusLoss} onClick={() => execCmd('indent')} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-l"><Indent size={18} /></button>
                    <div className="w-[1px] bg-gray-300 dark:bg-gray-600"></div>
                    <button onMouseDown={preventFocusLoss} onClick={() => execCmd('outdent')} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-r"><Outdent size={18} /></button>
                </div>

                <div className="w-[1px] h-6 bg-gray-300 dark:bg-gray-700 mx-1"></div>

                {/* 4. Mentions */}
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

                {/* 5. Image */}
                <label className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[40px] flex justify-center cursor-pointer text-gray-700 dark:text-gray-300">
                    <input type="file" accept="image/*" className="hidden" onChange={insertImage} />
                    <ImageIcon size={18} />
                </label>

                {/* 6. Table */}
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
};
