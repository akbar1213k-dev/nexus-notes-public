import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Trash2, ArrowLeft, Plus } from 'lucide-react';
import { Note, MindmapNode, MindmapConnection } from '../types';

interface MindmapEditorProps {
  note: Note;
  onUpdate: (note: Note) => void;
  onGoHome: () => void;
  isDarkMode: boolean;
}

const LEVEL_COLORS = [
  { fill: '#4f46e5', stroke: '#3730a3', text: '#ffffff' },  // indigo (root)
  { fill: '#10b981', stroke: '#059669', text: '#ffffff' },  // emerald
  { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },  // teal
  { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },  // cyan
  { fill: '#0ea5e9', stroke: '#0284c7', text: '#ffffff' },  // sky
];

function getDepth(nodeId: string, connections: MindmapConnection[], rootId: string): number {
  if (nodeId === rootId) return 0;
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  visited.add(rootId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === nodeId) return current.depth;
    for (const conn of connections) {
      let neighbor: string | null = null;
      if (conn.from === current.id && !visited.has(conn.to)) neighbor = conn.to;
      if (conn.to === current.id && !visited.has(conn.from)) neighbor = conn.from;
      if (neighbor) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: current.depth + 1 });
      }
    }
  }
  return 4;
}

function getColor(depth: number) {
  return LEVEL_COLORS[Math.min(depth, LEVEL_COLORS.length - 1)];
}

export const MindmapEditor: React.FC<MindmapEditorProps> = ({
  note,
  onUpdate,
  onGoHome,
  isDarkMode,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const data = note.mindmapData || { nodes: [], connections: [] };
  const [nodes, setNodes] = useState<MindmapNode[]>(data.nodes);
  const [connections, setConnections] = useState<MindmapConnection[]>(data.connections);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnIdx, setSelectedConnIdx] = useState<number | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  nodesRef.current = nodes;
  connectionsRef.current = connections;

  const rootId = nodes.length > 0 ? nodes[0].id : '';

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Sync data back to parent
  const saveData = useCallback((newNodes: MindmapNode[], newConns: MindmapConnection[]) => {
    onUpdate({
      ...note,
      mindmapData: { nodes: newNodes, connections: newConns },
      updatedAt: Date.now(),
    });
  }, [note, onUpdate]);

  // Create a new node at (x, y) in canvas coordinates
  const addNodeAt = useCallback((x: number, y: number) => {
    const newId = Date.now().toString();
    const newNode: MindmapNode = { id: newId, text: 'Konsep Baru', x, y };
    const newNodes = [...nodesRef.current, newNode];
    setNodes(newNodes);
    saveData(newNodes, connectionsRef.current);
    setSelectedNodeId(newId);
    setEditingNodeId(newId);
  }, [saveData]);

  // Add a node at the center of the currently visible viewport (works with touch too)
  const addNodeAtViewportCenter = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const transform = d3.zoomTransform(svg);
    const [mx, my] = transform.invert([rect.width / 2, rect.height / 2]);
    addNodeAt(mx, my);
  }, [addNodeAt]);

  // Build depth map
  const depthMap = new Map<string, number>();
  nodes.forEach(n => depthMap.set(n.id, getDepth(n.id, connections, rootId)));

  // --- D3 Render ---
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;
    svg.attr('width', width).attr('height', height).attr('viewBox', [0, 0, width, height]);

    // Defs for drop shadow
    const defs = svg.append('defs');
    const filter = defs.append('filter').attr('id', 'shadow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
    filter.append('feDropShadow')
      .attr('dx', 0).attr('dy', 2).attr('stdDeviation', 3)
      .attr('flood-color', isDarkMode ? '#000' : '#000')
      .attr('flood-opacity', isDarkMode ? 0.5 : 0.15);

    // Zoom container
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom)
      .on('dblclick.zoom', null);

    // --- Render connections ---
    const connsG = g.append('g').attr('class', 'connections');
    const connLineSel = connsG.selectAll('line')
      .data(connections)
      .join('line')
      .attr('stroke', isDarkMode ? '#6b7280' : '#9ca3af')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.5)
      .attr('stroke-dasharray', (d, i) => i === selectedConnIdx ? '6,3' : 'none')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        const idx = connections.indexOf(d);
        setSelectedConnIdx(idx);
        setSelectedNodeId(null);
        setEditingNodeId(null);
      });

    // --- Render nodes ---
    const nodesG = g.append('g').attr('class', 'nodes');
    const nodeGroups = nodesG.selectAll('g')
      .data(nodes, d => (d as MindmapNode).id)
      .join('g')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('cursor', 'grab');

    // Node rects
    nodeGroups.append('rect')
      .attr('width', d => Math.max(d.text.length * 8 + 32, 80))
      .attr('height', 36)
      .attr('rx', d => depthMap.get(d.id) === 0 ? 6 : 18)
      .attr('ry', d => depthMap.get(d.id) === 0 ? 6 : 18)
      .attr('x', d => -Math.max(d.text.length * 8 + 32, 80) / 2)
      .attr('y', -18)
      .attr('fill', d => {
        const depth = depthMap.get(d.id) || 0;
        return getColor(depth).fill;
      })
      .attr('stroke', d => {
        if (d.id === selectedNodeId) return '#facc15';
        const depth = depthMap.get(d.id) || 0;
        return getColor(depth).stroke;
      })
      .attr('stroke-width', d => d.id === selectedNodeId ? 3 : 2)
      .attr('filter', 'url(#shadow)');

    // Node text
    nodeGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .attr('fill', d => {
        const depth = depthMap.get(d.id) || 0;
        return getColor(depth).text;
      })
      .attr('font-size', '13px')
      .attr('font-weight', '600')
      .attr('pointer-events', 'none')
      .text(d => d.text.length > 20 ? d.text.substring(0, 20) + '...' : d.text);

    // --- Click canvas to deselect ---
    svg.on('click', (event) => {
      if (event.target === svgRef.current || event.target === g.node()) {
        setSelectedNodeId(null);
        setSelectedConnIdx(null);
        setEditingNodeId(null);
      }
    });

    // --- Double-click canvas to add node ---
    svg.on('dblclick', (event) => {
      if (event.target !== svgRef.current && event.target !== g.node()) return;
      const rect = svgRef.current!.getBoundingClientRect();
      const transform = d3.zoomTransform(svgRef.current!);
      const [mx, my] = transform.invert([event.clientX - rect.left, event.clientY - rect.top]);
      addNodeAt(mx, my);
    });

    // --- Node drag ---
    const drag = d3.drag<SVGGElement, MindmapNode>()
      .on('start', function (event, d) {
        d3.select(this).style('cursor', 'grabbing');
        event.sourceEvent.stopPropagation();
      })
      .on('drag', (event, d) => {
        const transform = d3.zoomTransform(svgRef.current!);
        const [mx, my] = transform.invert([event.sourceEvent.offsetX, event.sourceEvent.offsetY]);
        d.x = mx;
        d.y = my;
        d3.select(event.sourceEvent.target.closest('g'))
          .attr('transform', `translate(${d.x},${d.y})`);

        // Update connections in real time
        connsG.selectAll('line')
          .attr('x1', c => {
            const n = nodesRef.current.find(nn => nn.id === (c as MindmapConnection).from);
            return n ? n.x : 0;
          })
          .attr('y1', c => {
            const n = nodesRef.current.find(nn => nn.id === (c as MindmapConnection).from);
            return n ? n.y : 0;
          })
          .attr('x2', c => {
            const n = nodesRef.current.find(nn => nn.id === (c as MindmapConnection).to);
            return n ? n.x : 0;
          })
          .attr('y2', c => {
            const n = nodesRef.current.find(nn => nn.id === (c as MindmapConnection).to);
            return n ? n.y : 0;
          });
      })
      .on('end', (event, d) => {
        d3.select(event.sourceEvent.target.closest('g')).style('cursor', 'grab');
        const newNodes = nodesRef.current.map(n => n.id === d.id ? { ...d } : n);
        setNodes(newNodes);
        saveData(newNodes, connectionsRef.current);
      });

    nodeGroups.call(drag);

    // --- Node click: select ---
    nodeGroups.on('click', (event, d) => {
      event.stopPropagation();
      setSelectedNodeId(d.id);
      setSelectedConnIdx(null);
    });

    // --- Node double-click: edit ---
    nodeGroups.on('dblclick', (event, d) => {
      event.stopPropagation();
      setEditingNodeId(d.id);
    });

    // --- Right-click node: start connection ---
    nodeGroups.on('mousedown', (event, d) => {
      // Middle mouse or Shift+click to start connection
      if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        setConnectingFrom(d.id);
      }
    });

    // Initial connection positions
    connsG.selectAll('line')
      .attr('x1', c => nodes.find(n => n.id === (c as MindmapConnection).from)?.x || 0)
      .attr('y1', c => nodes.find(n => n.id === (c as MindmapConnection).from)?.y || 0)
      .attr('x2', c => nodes.find(n => n.id === (c as MindmapConnection).to)?.x || 0)
      .attr('y2', c => nodes.find(n => n.id === (c as MindmapConnection).to)?.y || 0);

    // Cleanup
    return () => { svg.selectAll('*').remove(); };

  }, [nodes, connections, dimensions, isDarkMode, selectedNodeId, selectedConnIdx, depthMap, rootId, saveData, addNodeAt]);

  // --- Keyboard handler ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingNodeId) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingNodeId) {
        if (selectedNodeId && nodes.length > 1) {
          const newNodes = nodes.filter(n => n.id !== selectedNodeId);
          const newConns = connections.filter(c => c.from !== selectedNodeId && c.to !== selectedNodeId);
          setNodes(newNodes);
          setConnections(newConns);
          saveData(newNodes, newConns);
          setSelectedNodeId(null);
        } else if (selectedConnIdx !== null) {
          const newConns = connections.filter((_, i) => i !== selectedConnIdx);
          setConnections(newConns);
          saveData(nodes, newConns);
          setSelectedConnIdx(null);
        }
      }
      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setSelectedConnIdx(null);
        setEditingNodeId(null);
        setConnectingFrom(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, selectedConnIdx, editingNodeId, nodes, connections, saveData]);

  // --- Mouse tracking for connection preview ---
  useEffect(() => {
    if (!connectingFrom) return;
    const handler = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const transform = d3.zoomTransform(svg);
      const [mx, my] = transform.invert([e.clientX - rect.left, e.clientY - rect.top]);
      setMousePos({ x: mx, y: my });

      // Check if mouse is over a node → snap to it
      const target = nodesRef.current.find(n => {
        const halfW = Math.max(n.text.length * 8 + 32, 80) / 2;
        return Math.abs(mx - n.x) < halfW && Math.abs(my - n.y) < 20;
      });
      if (target && target.id !== connectingFrom) {
        setMousePos({ x: target.x, y: target.y });
      }
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [connectingFrom]);

  // --- Mouse up to complete connection ---
  useEffect(() => {
    if (!connectingFrom) return;
    const handler = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const transform = d3.zoomTransform(svg);
      const [mx, my] = transform.invert([e.clientX - rect.left, e.clientY - rect.top]);

      const target = nodesRef.current.find(n => {
        const halfW = Math.max(n.text.length * 8 + 32, 80) / 2;
        return Math.abs(mx - n.x) < halfW && Math.abs(my - n.y) < 20;
      });

      if (target && target.id !== connectingFrom) {
        // Check for duplicate
        const exists = connectionsRef.current.some(
          c => (c.from === connectingFrom && c.to === target.id) || (c.from === target.id && c.to === connectingFrom)
        );
        if (!exists) {
          const newConns = [...connectionsRef.current, { from: connectingFrom, to: target.id }];
          setConnections(newConns);
          saveData(nodesRef.current, newConns);
        }
      }
      setConnectingFrom(null);
    };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, [connectingFrom, saveData]);

  // --- Inline text editing ---
  const handleTextSave = (nodeId: string, newText: string) => {
    const trimmed = newText.trim() || 'Konsep';
    const newNodes = nodes.map(n => n.id === nodeId ? { ...n, text: trimmed } : n);
    setNodes(newNodes);
    saveData(newNodes, connections);
    setEditingNodeId(null);
  };

  const editingNode = editingNodeId ? nodes.find(n => n.id === editingNodeId) : null;

  return (
    <div className="relative h-full w-full bg-slate-50 dark:bg-gray-950 overflow-hidden">
      {/* Header bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 p-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800">
        <button onClick={onGoHome} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <button
          onClick={addNodeAtViewportCenter}
          aria-label="Tambah node"
          title="Tambah node"
          className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow transition-colors flex items-center gap-1"
        >
          <Plus size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-800 dark:text-white truncate">{note.title || 'Peta Konsep'}</h2>
          <p className="text-[10px] text-gray-400">
            {nodes.length} node · {connections.length} koneksi · Tombol + atau double-tap untuk tambah node
          </p>
        </div>
        {connectingFrom && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse">
            Klik node tujuan untuk menghubungkan · ESC untuk batal
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <div ref={containerRef} className="h-full w-full">
        <svg ref={svgRef} className="touch-none" style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Inline text editor for node */}
      {editingNode && (
        <div
          className="absolute z-30"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3 w-64">
            <p className="text-[10px] text-gray-400 mb-2">Edit nama node:</p>
            <input
              autoFocus
              defaultValue={editingNode.text}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSave(editingNodeId!, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingNodeId(null);
              }}
              onBlur={(e) => handleTextSave(editingNodeId!, e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Action bar when node selected */}
      {selectedNodeId && !editingNodeId && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 px-4 py-2">
          <button
            onClick={() => {
              if (nodes.length <= 1) return;
              const newNodes = nodes.filter(n => n.id !== selectedNodeId);
              const newConns = connections.filter(c => c.from !== selectedNodeId && c.to !== selectedNodeId);
              setNodes(newNodes);
              setConnections(newConns);
              saveData(newNodes, newConns);
              setSelectedNodeId(null);
            }}
            disabled={nodes.length <= 1}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-medium disabled:opacity-30 transition-colors"
          >
            <Trash2 size={14} /> Hapus
          </button>
          <button
            onClick={() => setEditingNodeId(selectedNodeId)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-xs font-medium transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => {
              setConnectingFrom(selectedNodeId);
              setSelectedNodeId(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs font-medium transition-colors"
          >
            Hubungkan
          </button>
        </div>
      )}

      {/* Connection preview line while dragging */}
      {connectingFrom && (
        <svg className="absolute inset-0 z-10 pointer-events-none" style={{ width: '100%', height: '100%' }}>
          <ConnectionPreview
            fromNode={nodes.find(n => n.id === connectingFrom)}
            mousePos={mousePos}
            svgRef={svgRef}
          />
        </svg>
      )}

      {/* Legend */}
      <div className="absolute bottom-6 right-6 z-20 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-lg">
        <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-2">Legenda</p>
        <div className="space-y-1.5">
          {LEVEL_COLORS.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.fill }} />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {i === 0 ? 'Root' : `Level ${i}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Small component for connection preview line
const ConnectionPreview: React.FC<{
  fromNode?: MindmapNode;
  mousePos: { x: number; y: number };
  svgRef: React.RefObject<SVGSVGElement | null>;
}> = ({ fromNode, mousePos, svgRef }) => {
  if (!fromNode || !svgRef.current) return null;

  const svg = svgRef.current;
  const rect = svg.getBoundingClientRect();
  const transform = d3.zoomTransform(svg);

  const screenFrom = transform.apply([fromNode.x, fromNode.y]);
  const screenTo = transform.apply([mousePos.x, mousePos.y]);

  return (
    <line
      x1={screenFrom[0]}
      y1={screenFrom[1]}
      x2={screenTo[0]}
      y2={screenTo[1]}
      stroke="#facc15"
      strokeWidth={2}
      strokeDasharray="6,3"
      strokeOpacity={0.8}
    />
  );
};

export default MindmapEditor;
