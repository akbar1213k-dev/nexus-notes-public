import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Note } from '../types';
import { Camera, Image as ImageIcon, Table, Hash, List, ListOrdered, AtSign } from 'lucide-react';

interface EditorProps {
  note: Note;
  allNotes: Note[];
  onUpdate: (updatedNote: Note) => void;
  onCreateNewNote: (title: string) => Promise<string>; // Returns new ID
  onLinkClick: (noteId: string) => void;
  onLinkLongPress: (noteId: string) => void;
}

export const Editor: React.FC<EditorProps> = ({ 
  note, 
  allNotes, 
  onUpdate, 
  onCreateNewNote,
  onLinkClick,
  onLinkLongPress
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [cursorRange, setCursorRange] = useState<Range | null>(null);

  // Sync content initially or when note changes externally
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== note.content) {
      editorRef.current.innerHTML = note.content;
    }
  }, [note.id]);

  const handleInput = () => {
    if (!editorRef.current) return;
    
    // Save Content
    const content = editorRef.current.innerHTML;
    onUpdate({ ...note, content });

    // Handle Mention Trigger logic
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
      const textBeforeCursor = textNode.textContent.slice(0, range.startOffset);
      const atIndex = textBeforeCursor.lastIndexOf('@');
      
      // If we found an @ and it's either at the start or preceded by whitespace
      if (atIndex !== -1 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
        const query = textBeforeCursor.slice(atIndex + 1);
        // Only trigger if no spaces in query yet (simple version)
        if (!/\s/.test(query)) {
          const rect = range.getBoundingClientRect();
          setMentionPosition({ top: rect.top - 40, left: rect.left }); // -40 to show above
          setMentionQuery(query);
          setShowMentionList(true);
          setCursorRange(range);
          return;
        }
      }
    }
    
    setShowMentionList(false);
  };

  const insertMention = async (targetNoteId: string, targetTitle: string) => {
    if (!cursorRange || !editorRef.current) return;

    // Restore selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(cursorRange);
    }

    // Delete the @query part
    const textNode = cursorRange.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
        const text = textNode.textContent;
        const atIndex = text.lastIndexOf('@', cursorRange.startOffset - 1);
        if (atIndex >= 0) {
            cursorRange.setStart(textNode, atIndex);
            cursorRange.deleteContents();
        }
    }

    // Create chip
    const chip = document.createElement('span');
    chip.className = 'mention-chip';
    chip.contentEditable = 'false';
    chip.dataset.id = targetNoteId;
    chip.textContent = `@${targetTitle}`;
    
    // Insert
    cursorRange.insertNode(chip);
    
    // Move cursor after chip
    cursorRange.setStartAfter(chip);
    cursorRange.setEndAfter(chip);
    
    // Insert a space after for convenience
    const space = document.createTextNode('\u00A0');
    cursorRange.insertNode(space);
    cursorRange.setStartAfter(space);
    cursorRange.setEndAfter(space);
    
    selection?.removeAllRanges();
    selection?.addRange(cursorRange);

    setShowMentionList(false);
    handleInput(); // Save state
  };

  const handleMentionSelect = async (existingNote: Note | null) => {
    if (existingNote) {
      insertMention(existingNote.id, existingNote.title);
    } else {
      // Create new
      const newId = await onCreateNewNote(mentionQuery);
      insertMention(newId, mentionQuery);
    }
  };

  // Click handling for chips (Delegation)
  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('mention-chip')) {
        const id = target.dataset.id;
        if (id) onLinkClick(id);
    }
  };

  // Long press logic
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleTouchStart = (e: React.TouchEvent) => {
     const target = e.target as HTMLElement;
     if (target.classList.contains('mention-chip')) {
        const id = target.dataset.id;
        if (id) {
            touchTimer.current = setTimeout(() => {
                onLinkLongPress(id);
            }, 600); // 600ms for long press
        }
     }
  };

  const handleTouchEnd = () => {
      if (touchTimer.current) {
          clearTimeout(touchTimer.current);
          touchTimer.current = null;
      }
  };

  // --- Toolbar Handlers ---
  const execCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  const insertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      // For demo, we just use the blob URL. In real app, upload to server.
      execCmd('insertImage', url);
    }
  };

  const insertTable = () => {
    const html = `<div class="overflow-x-auto my-2"><table class="min-w-full border-collapse border border-gray-300"><tbody><tr><td class="border border-gray-300 p-2">Cell 1</td><td class="border border-gray-300 p-2">Cell 2</td></tr></tbody></table></div><p><br/></p>`;
    execCmd('insertHTML', html);
  };

  // Filter notes for mention list
  const filteredNotes = allNotes.filter(n => 
    n.title.toLowerCase().includes(mentionQuery.toLowerCase()) && n.id !== note.id
  );

  return (
    <div className="flex flex-col h-full relative">
        {/* Editor Area */}
        <div className="flex-1 overflow-y-auto p-4 no-scrollbar pb-20">
            <input 
                value={note.title}
                onChange={(e) => onUpdate({...note, title: e.target.value})}
                placeholder="Page Title"
                className="text-3xl font-bold mb-4 w-full bg-transparent border-none outline-none placeholder-gray-300"
            />
            <div 
                ref={editorRef}
                className="editor-content outline-none text-lg min-h-[50vh] leading-relaxed"
                contentEditable
                onInput={handleInput}
                onClick={handleEditorClick}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                data-placeholder="Start typing..."
            />
        </div>

        {/* Mention Popover */}
        {showMentionList && (
            <div 
                className="fixed bg-white shadow-xl rounded-lg border border-gray-200 z-50 w-64 max-h-48 overflow-y-auto"
                style={{ 
                    top: Math.max(10, mentionPosition.top - 200), // Ensure it stays on screen, biased to top
                    left: Math.min(window.innerWidth - 270, mentionPosition.left) // Prevent right overflow
                }}
            >
                <div className="text-xs font-semibold text-gray-500 bg-gray-50 px-3 py-1">
                    Select a page
                </div>
                {filteredNotes.map(n => (
                    <div 
                        key={n.id}
                        onClick={() => handleMentionSelect(n)}
                        className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm truncate"
                    >
                        {n.title}
                    </div>
                ))}
                <div 
                    onClick={() => handleMentionSelect(null)}
                    className="px-4 py-2 hover:bg-green-50 text-green-700 cursor-pointer text-sm font-medium border-t"
                >
                    + Create new "{mentionQuery}"
                </div>
            </div>
        )}

        {/* Sticky Toolbar */}
        <div className="h-14 bg-white border-t border-gray-200 flex items-center justify-between px-2 shadow-lg sticky bottom-0 w-full z-40">
            <div className="flex space-x-1 overflow-x-auto no-scrollbar w-full items-center">
                {/* Text Formatting */}
                <button onClick={() => execCmd('formatBlock', 'H2')} className="p-2 rounded hover:bg-gray-100 min-w-[40px] flex justify-center"><Hash size={18} /></button>
                <button onClick={() => execCmd('insertUnorderedList')} className="p-2 rounded hover:bg-gray-100 min-w-[40px] flex justify-center"><List size={18} /></button>
                <button onClick={() => execCmd('insertOrderedList')} className="p-2 rounded hover:bg-gray-100 min-w-[40px] flex justify-center"><ListOrdered size={18} /></button>
                
                <div className="w-[1px] h-6 bg-gray-300 mx-1"></div>

                {/* Insertions */}
                <button onClick={() => {
                   const text = document.createTextNode('@');
                   const sel = window.getSelection();
                   if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        range.insertNode(text);
                        range.collapse(false);
                        handleInput(); // Trigger detection
                        editorRef.current?.focus();
                   }
                }} className="p-2 rounded hover:bg-gray-100 min-w-[40px] flex justify-center text-blue-600"><AtSign size={18} /></button>

                <label className="p-2 rounded hover:bg-gray-100 min-w-[40px] flex justify-center cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={insertImage} />
                    <ImageIcon size={18} />
                </label>

                <button onClick={insertTable} className="p-2 rounded hover:bg-gray-100 min-w-[40px] flex justify-center"><Table size={18} /></button>
            </div>
        </div>
    </div>
  );
};