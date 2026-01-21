import React, { useState, useEffect } from 'react';
import { Note, ViewMode } from './types';
import { getNotes, saveNotes } from './services/storage';
import { Editor } from './components/Editor';
import { GraphView } from './components/GraphView';
import { TopBar } from './components/TopBar';
import { HomeView } from './components/HomeView';
import { PreviewSheet } from './components/PreviewSheet';

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  // Initially start at Home, so currentNoteId can be null, but we'll manage it via viewMode
  const [currentNoteId, setCurrentNoteId] = useState<string>(''); 
  const [viewMode, setViewMode] = useState<ViewMode>('HOME');
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  
  // Navigation stack for tracking drill-down navigation (e.g. Note A -> Note B)
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const loaded = getNotes();
    setNotes(loaded);
  }, []);

  useEffect(() => {
    if (notes.length > 0) {
      saveNotes(notes);
    }
  }, [notes]);

  const currentNote = notes.find(n => n.id === currentNoteId);

  const handleUpdateNote = (updated: Note) => {
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  };

  const handleCreateNote = async (title: string): Promise<string> => {
    const newNote: Note = {
      id: Date.now().toString(),
      title: title || 'Untitled',
      content: '',
      updatedAt: Date.now()
    };
    setNotes(prev => [...prev, newNote]);
    return newNote.id;
  };

  const handleFabCreate = async () => {
    const id = await handleCreateNote('');
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
        // If no history, go home
        setViewMode('HOME');
        setCurrentNoteId('');
    }
  };

  const handleGoHome = () => {
    setHistory([]);
    setCurrentNoteId('');
    setViewMode('HOME');
  };

  // Preview Logic
  const handleLinkClick = (id: string) => {
    navigateToNote(id);
  };

  const handleLinkLongPress = (id: string) => {
    if (navigator.vibrate) navigator.vibrate(50);
    setPreviewNoteId(id);
  };

  const previewNote = notes.find(n => n.id === previewNoteId) || null;

  // Render logic based on ViewMode
  const renderContent = () => {
    if (viewMode === 'HOME') {
        return (
            <HomeView 
                notes={notes} 
                onNoteClick={navigateToNote} 
                onCreateNew={handleFabCreate}
            />
        );
    }

    if (viewMode === 'GRAPH') {
        return (
             <GraphView 
                notes={notes}
                onNodeClick={navigateToNote}
            />
        );
    }

    // EDITOR mode
    if (!currentNote) return <div className="p-10 text-center">Note not found</div>;
    
    return (
        <Editor 
            note={currentNote}
            allNotes={notes}
            onUpdate={handleUpdateNote}
            onCreateNewNote={handleCreateNote}
            onLinkClick={handleLinkClick}
            onLinkLongPress={handleLinkLongPress}
        />
    );
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <TopBar 
        mode={viewMode}
        onToggleMode={() => setViewMode(prev => prev === 'EDITOR' ? 'GRAPH' : 'EDITOR')}
        canGoBack={history.length > 0 || viewMode === 'EDITOR' || viewMode === 'GRAPH'}
        onBack={handleBack}
        onGoHome={handleGoHome}
        title={viewMode === 'EDITOR' ? currentNote?.title : 'Graph View'}
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