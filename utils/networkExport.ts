import { Note } from '../types';

export interface ConnectionEdge {
  from: string;
  to: string;
  fromTitle: string;
  toTitle: string;
}

export interface TreeNode {
  note: Note;
  depth: number;
  children: TreeNode[];
}

export interface NetworkExport {
  exportMetadata: {
    rootNoteId: string;
    rootNoteTitle: string;
    exportedAt: string;
    totalNotes: number;
    maxDepth: number;
  };
  notes: Note[];
  connections: ConnectionEdge[];
  tree: TreeNode;
}

export const htmlToPlainText = (htmlContent: string): string => {
  if (!htmlContent) return '';
  try {
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    doc.querySelectorAll('img, script, style, iframe, video, audio, canvas, svg').forEach(el => el.remove());
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
};

export const extractMentionIds = (htmlContent: string): string[] => {
  if (!htmlContent) return [];
  const ids: string[] = [];
  try {
    const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
    const mentions = doc.querySelectorAll('.mention-chip');
    mentions.forEach(el => {
      const id = el.getAttribute('data-id');
      if (id && !ids.includes(id)) ids.push(id);
    });
  } catch {
    const regex = /class="[^"]*mention-chip[^"]*"[^>]*data-id="([^"]+)"/g;
    let match;
    while ((match = regex.exec(htmlContent)) !== null) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
  }
  return ids;
};

export const buildNoteNetwork = (
  rootNoteId: string,
  allNotes: Note[]
): { notes: Note[]; connections: ConnectionEdge[]; tree: TreeNode; maxDepth: number } => {
  const noteMap = new Map<string, Note>();
  allNotes.forEach(n => noteMap.set(n.id, n));

  const visited = new Set<string>();
  const collectedNotes: Note[] = [];
  const connections: ConnectionEdge[] = [];
  let maxDepth = 0;

  const traverse = (noteId: string, depth: number, parentNode: TreeNode): TreeNode | null => {
    if (visited.has(noteId)) return null;
    const note = noteMap.get(noteId);
    if (!note) return null;

    visited.add(noteId);
    collectedNotes.push(note);
    if (depth > maxDepth) maxDepth = depth;

    const currentNode: TreeNode = { note, depth, children: [] };
    parentNode.children.push(currentNode);

    const mentionIds = extractMentionIds(note.content);
    mentionIds.forEach(targetId => {
      const targetNote = noteMap.get(targetId);
      if (targetNote) {
        connections.push({
          from: noteId,
          to: targetId,
          fromTitle: note.title || 'Untitled',
          toTitle: targetNote.title || 'Untitled',
        });
        traverse(targetId, depth + 1, currentNode);
      }
    });

    return currentNode;
  };

  const rootNote = noteMap.get(rootNoteId);
  if (!rootNote) {
    return { notes: [], connections: connections, tree: { note: {} as Note, depth: 0, children: [] }, maxDepth: 0 };
  }

  const tree: TreeNode = { note: rootNote, depth: 0, children: [] };
  visited.add(rootNoteId);
  collectedNotes.push(rootNote);

  const rootMentionIds = extractMentionIds(rootNote.content);
  rootMentionIds.forEach(targetId => {
    const targetNote = noteMap.get(targetId);
    if (targetNote) {
      connections.push({
        from: rootNoteId,
        to: targetId,
        fromTitle: rootNote.title || 'Untitled',
        toTitle: targetNote.title || 'Untitled',
      });
      traverse(targetId, 1, tree);
    }
  });

  return { notes: collectedNotes, connections, tree, maxDepth };
};

export const exportNetworkAsJSON = (rootNote: Note, allNotes: Note[]): void => {
  const { notes, connections, tree, maxDepth } = buildNoteNetwork(rootNote.id, allNotes);

  const plainTextNotes = notes.map(n => ({
    ...n,
    content: htmlToPlainText(n.content),
  }));

  const plainTextTree = (node: TreeNode): TreeNode => ({
    ...node,
    note: { ...node.note, content: htmlToPlainText(node.note.content) },
    children: node.children.map(plainTextTree),
  });

  const exportData: NetworkExport = {
    exportMetadata: {
      rootNoteId: rootNote.id,
      rootNoteTitle: rootNote.title || 'Untitled',
      exportedAt: new Date().toISOString(),
      totalNotes: notes.length,
      maxDepth,
    },
    notes: plainTextNotes,
    connections,
    tree: plainTextTree(tree),
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeTitle = (rootNote.title || 'Untitled').replace(/[^a-zA-Z0-9]/g, '_');
  link.download = `NexusNotes_Network_${safeTitle}_${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
};
