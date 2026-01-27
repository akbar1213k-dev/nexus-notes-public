import { Note, Folder } from '../types';

const NOTES_KEY = 'nexus_notes_data';
const FOLDERS_KEY = 'nexus_folders_data';

const DEFAULT_NOTES: Note[] = [
  {
    id: '1',
    title: 'Welcome to Nexus',
    content: '<h1>Welcome!</h1><p>Type <b>@</b> to link to other notes.</p><p>Try linking to <span class="mention-chip" data-id="2" contenteditable="false">@Project Alpha</span> to see the graph connection.</p>',
    updatedAt: Date.now(),
    type: 'note',
  },
  {
    id: '2',
    title: 'Project Alpha',
    content: '<h2>Ideas</h2><ul><li>Mobile first design</li><li>Graph visualization</li></ul>',
    updatedAt: Date.now(),
    type: 'note',
  }
];

export const getNotes = (): Note[] => {
  try {
    const stored = localStorage.getItem(NOTES_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_NOTES;
  } catch (e) {
    return DEFAULT_NOTES;
  }
};

export const saveNotes = (notes: Note[]) => {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
};

export const getFolders = (): Folder[] => {
  try {
    const stored = localStorage.getItem(FOLDERS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
};

export const saveFolders = (folders: Folder[]) => {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
};