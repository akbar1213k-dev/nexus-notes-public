import React, { useState, useEffect, useRef } from 'react';
import { Note, ViewMode, EditorHandle } from './types';
import { getNotes, saveNotes } from './services/storage';
import { Editor } from './components/Editor';
import { GraphView } from './components/GraphView';
import { TopBar } from './components/TopBar';
import { HomeView } from './components/HomeView';
import { PreviewSheet } from './components/PreviewSheet';

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNoteId, setCurrentNoteId] = useState<string>(''); 
  const [viewMode, setViewMode] = useState<ViewMode>('HOME');
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  
  // Editor Ref for undo/redo
  const editorRef = useRef<EditorHandle>(null);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('nexus_theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    const loaded = getNotes();
    setNotes(loaded);
  }, []);

  useEffect(() => {
    if (notes.length > 0) {
      saveNotes(notes);
    }
  }, [notes]);

  // Apply Theme
  useEffect(() => {
    if (isDarkMode) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('nexus_theme', 'dark');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('nexus_theme', 'light');
    }
  }, [isDarkMode]);

  const currentNote = notes.find(n => n.id === currentNoteId);

  const handleUpdateNote = (updated: Note) => {
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  };

  const handleUndo = () => {
    editorRef.current?.undo();
  };

  const handleRedo = () => {
    editorRef.current?.redo();
  };

  const handleCreateNote = async (title: string, type: 'note' | 'mindmap' = 'note'): Promise<string> => {
    const newNote: Note = {
      id: Date.now().toString(),
      title: title || (type === 'mindmap' ? 'Konsep Baru' : 'Untitled'),
      content: type === 'mindmap' ? '<ul><li>Ide Utama</li></ul>' : '', // Default tree structure for mindmap
      updatedAt: Date.now(),
      type: type
    };
    setNotes(prev => [...prev, newNote]);
    return newNote.id;
  };

  const handleDeleteNotes = (ids: string[]) => {
      setNotes(prev => prev.filter(n => !ids.includes(n.id)));
  };

  const handleFabCreate = async (type: 'note' | 'mindmap') => {
    const id = await handleCreateNote('', type);
    setCurrentNoteId(id);
    setViewMode('EDITOR');
  };

  const navigateToNote = (id: string) => {
    if (currentNoteId && currentNoteId !== id) {
        setHistory(prev => [...prev, currentNoteId]);
    }
    setCurrentNoteId(id);
    setViewMode('EDITOR');
    setPreviewNoteId(null);
  };

  const handleBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(prevHist => prevHist.slice(0, -1));
      setCurrentNoteId(prev);
    } else {
        setViewMode('HOME');
        setCurrentNoteId('');
    }
  };

  const handleGoHome = () => {
    setHistory([]);
    setCurrentNoteId('');
    setViewMode('HOME');
  };

  const handleLinkClick = (id: string) => {
    navigateToNote(id);
  };

  const handleLinkLongPress = (id: string) => {
    if (navigator.vibrate) navigator.vibrate(50);
    setPreviewNoteId(id);
  };

  const previewNote = notes.find(n => n.id === previewNoteId) || null;

  const renderContent = () => {
    if (viewMode === 'HOME') {
        return (
            <HomeView 
                notes={notes} 
                onNoteClick={navigateToNote} 
                onCreateNew={handleFabCreate}
                onDeleteNotes={handleDeleteNotes}
            />
        );
    }

    if (viewMode === 'GRAPH') {
        return (
             <GraphView 
                notes={notes}
                onNodeClick={navigateToNote}
                isDarkMode={isDarkMode}
            />
        );
    }

    if (!currentNote) return <div className="p-10 text-center dark:text-white">Note not found</div>;
    
    return (
        <Editor 
            ref={editorRef}
            note={currentNote}
            allNotes={notes}
            onUpdate={handleUpdateNote}
            onCreateNewNote={(title) => handleCreateNote(title, 'note')} // Default recursive creation to note
            onLinkClick={handleLinkClick}
            onLinkLongPress={handleLinkLongPress}
            onGoHome={handleGoHome}
        />
    );
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 transition-colors">
      <TopBar 
        mode={viewMode}
        onToggleMode={() => setViewMode(prev => prev === 'EDITOR' ? 'GRAPH' : 'EDITOR')}
        canGoBack={history.length > 0 || viewMode === 'EDITOR' || viewMode === 'GRAPH'}
        onBack={handleBack}
        onGoHome={handleGoHome}
        title={viewMode === 'EDITOR' ? currentNote?.title : 'Graph View'}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(prev => !prev)}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col">
        {renderContent()}
      </div>

      <PreviewSheet 
        note={previewNote}
        onClose={() => setPreviewNoteId(null)}
        onOpenFull={() => previewNoteId && navigateToNote(previewNoteId)}
      />
    </div>
  );
}