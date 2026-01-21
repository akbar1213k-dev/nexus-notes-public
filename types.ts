import * as d3 from 'd3';

export interface Note {
  id: string;
  title: string;
  content: string; // HTML content
  updatedAt: number;
}

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  group: number;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export type ViewMode = 'HOME' | 'EDITOR' | 'GRAPH';