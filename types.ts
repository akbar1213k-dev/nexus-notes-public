import * as d3 from 'd3';

// View Mode: Menambahkan 'SETTINGS' sesuai permintaan fitur sebelumnya
export type ViewMode = 'HOME' | 'EDITOR' | 'GRAPH' | 'SETTINGS' | 'TRACT';

export interface Activity {
  id: string;
  name: string;
  type: string;
  timestamp: number;
  description: string;
  userId?: string;
}

export interface MindmapNode {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface MindmapConnection {
  from: string;
  to: string;
}

export interface MindmapData {
  nodes: MindmapNode[];
  connections: MindmapConnection[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  lastOpenedAt?: number; // <--- Tambahkan baris ini
  userId?: string;
  type: 'note' | 'mindmap';
  folderId?: string;
  deletedAt?: number | null; // Penanda waktu dihapus
  mindmapData?: MindmapData;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  deletedAt?: number | null; // Penanda waktu dihapus
  userId?: string;
  parentId?: string | null; // <--- Tambahkan baris ini
}

// Interface untuk D3 Graph
export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  group: number;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

// Editor Handle: Menambahkan getContent untuk keperluan sync manual
export interface EditorHandle {
  undo: () => void;
  redo: () => void;
  getContent: () => string; 
}
