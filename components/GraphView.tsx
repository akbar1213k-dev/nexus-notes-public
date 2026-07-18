import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Note, Folder } from '../types'; 
import { Trash2, FolderInput, X } from 'lucide-react'; // <--- Tambahkan Icon ini

interface GraphViewProps {
  notes: Note[];
  folders: Folder[];
  onNodeClick: (noteId: string) => void;
  isDarkMode: boolean;
  activeNoteId?: string;
  // --- TAMBAHAN BARU ---
  onDeleteItems: (noteIds: string[]) => void;
  onMoveItems: (noteIds: string[], targetFolderId?: string) => void;
}

// Update Interface: Menambahkan properti folder
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  group: number;
  folder?: string; 
  width?: number;
  height?: number;
  depth?: number; 
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
}

export const GraphView: React.FC<GraphViewProps> = ({ notes, folders, onNodeClick, isDarkMode, activeNoteId }) => { // <--- Terima folders di sini
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  // --- STATE SELEKSI & AKSI ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const selectionModeRef = useRef(false); // Ref agar terbaca di dalam D3
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  // Sync Ref dengan State (Penting untuk D3)
  useEffect(() => {
      selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const toggleSelection = (id: string) => {
      setSelectedNodeIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  const cancelSelection = () => {
      setSelectionMode(false);
      setSelectedNodeIds(new Set());
  };

  const handleBulkDelete = () => {
      if (confirm(`Hapus ${selectedNodeIds.size} catatan terpilih?`)) {
          onDeleteItems(Array.from(selectedNodeIds));
          cancelSelection();
      }
  };

  const handleMoveAction = (targetId: string | undefined) => {
      onMoveItems(Array.from(selectedNodeIds), targetId);
      setShowMoveDialog(false);
      cancelSelection();
  };

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!svgRef.current || !notes.length) return;

    // Mapping data: Cari nama folder berdasarkan ID
    const nodes: D3Node[] = notes.map(n => {
      // PERBAIKAN: Prioritas cek apakah note ada di sampah (memiliki deletedAt)
      if (n.deletedAt) {
        return {
          id: n.id,
          title: n.title || "Untitled",
          group: 1,
          folder: "Sampah" // Kita paksa namanya "Sampah" agar logika warna merah berjalan
        };
      }

      // Jika tidak di sampah, cari folder aslinya
      const matchedFolder = folders.find(f => f.id === n.folderId);
      return {
        id: n.id,
        title: n.title || "Untitled",
        group: 1,
        // Jika ketemu, pakai namanya. Jika tidak, kosongkan.
        folder: matchedFolder ? matchedFolder.name : "" 
      };
    });

    const links: D3Link[] = [];
    
    notes.forEach(sourceNote => {
      const doc = new DOMParser().parseFromString(sourceNote.content, 'text/html');
      const mentions = doc.querySelectorAll('.mention-chip');
      mentions.forEach(el => {
        const targetId = el.getAttribute('data-id');
       if (targetId && notes.find(n => n.id === targetId)) {
          links.push({
            source: sourceNote.id,
            target: targetId
          });
        }
      });
    });

    // 1. MENGHITUNG JUMLAH CABANG (DEGREE) SETIAP NODE
    const nodeDegrees: Record<string, number> = {};
    // Inisialisasi semua node dengan nilai 0
    nodes.forEach(n => { nodeDegrees[n.id] = 0; });
    // Hitung setiap kali node muncul sebagai sumber atau target dari sebuah garis
    links.forEach(l => {
      nodeDegrees[l.source as string] = (nodeDegrees[l.source as string] || 0) + 1;
      nodeDegrees[l.target as string] = (nodeDegrees[l.target as string] || 0) + 1;
    });

    // --- ALGORITMA BARU: MENGHITUNG LAPISAN (KEDALAMAN) NODE ---
    // A. Buat daftar tetangga (Undirected Graph) untuk pelacakan jarak
    const adjList: Record<string, string[]> = {};
    nodes.forEach(n => adjList[n.id] = []);
    links.forEach(l => {
        const s = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const t = typeof l.target === 'object' ? (l.target as any).id : l.target;
        if(adjList[s]) adjList[s].push(t);
        if(adjList[t]) adjList[t].push(s); 
    });

    // B. Tentukan Titik Awal (Root/Akar)
    const queue: {id: string, depth: number}[] = [];
    const visited = new Set<string>();
    
    if (activeNoteId) {
        // Jika dibuka dari Catatan spesifik, jadikan catatan itu pusatnya
        queue.push({id: activeNoteId, depth: 0});
        visited.add(activeNoteId);
    } else {
        // Jika dibuka dari Home (Global), jadikan folder "Lainnya / Root" sebagai pusat (Akar)
        const rootNodes = nodes.filter(n => n.folder !== "Keterhubungan" && n.folder !== "Sampah");
        rootNodes.forEach(rn => {
            queue.push({id: rn.id, depth: 0});
            visited.add(rn.id);
        });

        // Fallback: Jika tidak ada Root sama sekali, cari node yg tidak pernah ditunjuk
        if (queue.length === 0) {
            const incoming: Record<string, number> = {};
            nodes.forEach(n => incoming[n.id] = 0);
            links.forEach(l => {
                const t = typeof l.target === 'object' ? (l.target as any).id : l.target;
                if (incoming[t] !== undefined) incoming[t]++;
            });
            nodes.forEach(n => {
                if (incoming[n.id] === 0) {
                    queue.push({id: n.id, depth: 0});
                    visited.add(n.id);
                }
            });
        }
    }

    // C. Melacak jarak seperti riak air (BFS)
    const nodeDepths: Record<string, number> = {};
    while(queue.length > 0) {
        const current = queue.shift()!;
        nodeDepths[current.id] = current.depth;
        
        if(adjList[current.id]) {
            adjList[current.id].forEach(neighbor => {
                if(!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({id: neighbor, depth: current.depth + 1});
                }
            });
        }
    }

    // D. Simpan data kedalaman ke dalam node
    nodes.forEach(n => {
        n.depth = nodeDepths[n.id];
    });

    d3.select(svgRef.current).selectAll("*").remove();
    
    const width = dimensions.width;
    const height = dimensions.height;

    // Simulation Setup
    const simulation = d3.forceSimulation(nodes)
      // 2. MENGATUR JARAK GARIS SECARA DINAMIS BERDASARKAN JUMLAH CABANG (DIPANGKAS 50%)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance((link: any) => {
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;
          
          const sourceDegree = nodeDegrees[sourceId] || 1;
          const targetDegree = nodeDegrees[targetId] || 1;
          
          const maxBranches = Math.max(sourceDegree, targetDegree);
          
          // RUMUS PANJANG GARIS BARU (Dipotong 50% dari sebelumnya):
          // Jarak minimum 60, lalu ditambah 20 piksel untuk setiap 1 cabang tambahan.
          return 60 + (maxBranches * 20);
      }))
      .force("charge", d3.forceManyBody().strength(-2500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(100).iterations(3))
      .alphaDecay(0.08); // Mempercepat waktu berhenti simulasi agar tidak terus melayang di angkasa

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto;");

   // --- Definisi Marker Panah ---
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 65) // Diperbesar agar ujung panah berada di luar area kotak
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", isDarkMode ? "#6b7280" : "#9ca3af");

    const g = svg.append("g");
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    svg.call(zoom)
       .on("dblclick.zoom", null);

    const link = g.append("g")
      .attr("stroke", isDarkMode ? "#555" : "#999")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrowhead)");

    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer");

    // --- INTERAKSI BARU (LONG PRESS & SELECT) ---
    let pressTimer: any;

    node.on("mousedown touchstart", function(event, d) {
        // Timer untuk Long Press (Masuk mode seleksi)
        pressTimer = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            setSelectionMode(true); 
            toggleSelection(d.id);
        }, 600);
    })
    .on("mouseup touchend", function(event, d) {
        clearTimeout(pressTimer); // Batalkan jika dilepas cepat
    })
    .on("click", (event, d) => {
        // Cek apakah sedang mode seleksi?
        if (selectionModeRef.current) {
            event.preventDefault();
            event.stopPropagation();
            toggleSelection(d.id);
        } else {
            // Mode normal: Buka Editor
            if (navigator.vibrate) navigator.vibrate(10);
            onNodeClick(d.id);
        }
    })
    .call(d3.drag<SVGGElement, D3Node>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

   // --- LOGIKA WARNA & STYLE ---
    // Helper untuk menentukan warna background
    const getFillColor = (d: D3Node) => {
      if (d.folder === "Sampah") return isDarkMode ? "#450a0a" : "#fef2f2"; 
      
      // Lapisan Warna untuk Folder Keterhubungan
      if (d.folder === "Keterhubungan") {
        if (d.depth === undefined) return isDarkMode ? "#064e3b" : "#d1fae5"; // Default (Tidak nyambung)
        // Gradasi warna yang LEBIH MENCOLOK perbedaannya
        if (d.depth <= 1) return isDarkMode ? "#065f46" : "#6ee7b7"; // Lapisan 1: Emerald (Hijau Kuat)
        if (d.depth === 2) return isDarkMode ? "#115e59" : "#99f6e4"; // Lapisan 2: Teal (Hijau Kebiruan)
        if (d.depth === 3) return isDarkMode ? "#164e63" : "#a5f3fc"; // Lapisan 3: Cyan (Biru Muda Terang)
        return isDarkMode ? "#0c4a6e" : "#bae6fd"; // Lapisan 4+: Sky (Biru Langit)
      }
      return isDarkMode ? "#1f2937" : "#e2e8f0";
    };

    // Helper untuk menentukan warna border (Stroke)
    const getStrokeColor = (d: D3Node) => {
      if (d.id === activeNoteId) return isDarkMode ? "#818cf8" : "#4338ca"; 
      if (d.folder === "Sampah") return isDarkMode ? "#f87171" : "#ef4444"; 
      
      if (d.folder === "Keterhubungan") {
        if (d.depth === undefined) return isDarkMode ? "#34d399" : "#059669"; 
        if (d.depth <= 1) return isDarkMode ? "#10b981" : "#047857"; // Border Lapisan 1
        if (d.depth === 2) return isDarkMode ? "#14b8a6" : "#0f766e"; // Border Lapisan 2
        if (d.depth === 3) return isDarkMode ? "#06b6d4" : "#0e7490"; // Border Lapisan 3
        return isDarkMode ? "#0ea5e9" : "#0369a1"; // Border Lapisan 4+
      }
      return isDarkMode ? "#374151" : "#94a3b8";
    };
    
    // Helper untuk ketebalan border
    const getStrokeWidth = (d: D3Node) => {
      if (d.id === activeNoteId) return 3; // Paling tebal untuk yang aktif
      if (d.folder === "Keterhubungan" || d.folder === "Sampah") return 2; // Folder khusus sedikit lebih tebal
      return 1; 
    };

    node.append("rect")
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("fill", d => getFillColor(d))
      .attr("stroke", d => getStrokeColor(d))
      .attr("stroke-width", d => getStrokeWidth(d))
      .attr("filter", isDarkMode ? "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" : "drop-shadow(0 4px 6px rgba(0,0,0,0.1))");

    // Teks Label
    node.append("text")
      .text(d => d.title.length > 25 ? d.title.substring(0, 25) + '...' : d.title)
      .attr("text-anchor", "middle")
      .attr("dy", ".35em")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      // Warna teks menyesuaikan background folder agar kontras
      // Warna teks menyesuaikan background folder agar kontras
      .attr("fill", d => {
         // Teks mengikuti kontras folder
         if (d.folder === "Sampah") return isDarkMode ? "#fca5a5" : "#991b1b"; // Text Red Light : Red Dark
         if (d.folder === "Keterhubungan") return isDarkMode ? "#d1fae5" : "#065f46";
         return isDarkMode ? "#e5e7eb" : "#1f2937";
      })
      .style("pointer-events", "none");
    
    // Dynamic sizing
    node.each(function(d) {
        const textElement = d3.select(this).select("text").node() as SVGTextElement;
        const bbox = textElement.getBBox();
        const paddingHb = 20; 
        const paddingVt = 12; 
        
        d.width = bbox.width + paddingHb * 2;
        d.height = bbox.height + paddingVt * 2;

        d3.select(this).select("rect")
          .attr("width", d.width)
          .attr("height", d.height)
          .attr("x", -d.width / 2)
          .attr("y", -d.height / 2);
    });

    // Memperbarui radius tabrakan (collide) secara dinamis menggunakan jarak diagonal
    // Ini memastikan seluruh sudut persegi panjang terlindungi dari tumpang tindih
    simulation.force("collide", d3.forceCollide().radius((d: any) => Math.sqrt(Math.pow(d.width, 2) + Math.pow(d.height, 2)) / 2 + 15).iterations(5));

    node.on("click", (event, d) => {
        if (navigator.vibrate) navigator.vibrate(10);
        onNodeClick(d.id);
    });

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    // Auto-Focus
    if (activeNoteId) {
        setTimeout(() => {
            const targetNode = nodes.find(n => n.id === activeNoteId);
            if (targetNode && targetNode.x !== undefined && targetNode.y !== undefined) {
                const scale = 1.2;
                const translateX = width / 2 - scale * targetNode.x;
                const translateY = height / 2 - scale * targetNode.y;

                svg.transition()
                    .duration(1000)
                    .call(
                        zoom.transform, 
                        d3.zoomIdentity.translate(translateX, translateY).scale(scale)
                    );
            }
        }, 500);
    }

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => {
      simulation.stop();
    };
  }, [notes, dimensions, onNodeClick, isDarkMode, activeNoteId]);

  // --- EFEK VISUAL: Update Warna Seleksi Tanpa Reload Grafik ---
  useEffect(() => {
      if (!svgRef.current) return;
      const svg = d3.select(svgRef.current);
      
      // Update stroke (garis pinggir)
      svg.selectAll<SVGRectElement, D3Node>("rect")
         .attr("stroke", (d) => {
             // Jika dipilih, beri warna biru terang
             if (selectedNodeIds.has(d.id)) return "#3b82f6"; 
             
             // Fallback ke warna asli (sesuai dengan warna lapisan)
             if (d.id === activeNoteId) return isDarkMode ? "#818cf8" : "#4338ca"; 
             if (d.folder === "Sampah") return isDarkMode ? "#f87171" : "#ef4444";
             if (d.folder === "Keterhubungan") {
                 if (d.depth === undefined) return isDarkMode ? "#34d399" : "#059669"; 
                 if (d.depth <= 1) return isDarkMode ? "#10b981" : "#047857"; 
                 if (d.depth === 2) return isDarkMode ? "#14b8a6" : "#0f766e"; 
                 if (d.depth === 3) return isDarkMode ? "#06b6d4" : "#0e7490"; 
                 return isDarkMode ? "#0ea5e9" : "#0369a1"; 
             }
             return isDarkMode ? "#374151" : "#94a3b8";
         })
         .attr("stroke-width", (d) => {
             if (selectedNodeIds.has(d.id)) return 4; // Lebih tebal jika dipilih
             if (d.id === activeNoteId) return 3;
             if (d.folder === "Keterhubungan" || d.folder === "Sampah") return 2;
             return 1;
         });

  }, [selectedNodeIds, isDarkMode, activeNoteId]);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-50 dark:bg-gray-950 relative overflow-hidden transition-colors">
      <div className="absolute top-4 left-4 bg-white/80 dark:bg-gray-800/80 p-3 rounded-lg text-xs text-gray-500 dark:text-gray-400 pointer-events-none z-10 backdrop-blur border dark:border-gray-700 flex flex-col gap-2 shadow-sm">
        <span className="font-bold border-b pb-1 mb-1 block">Legenda Peta Konsep</span>
        <div className="flex items-center gap-2">
           <span className="w-3 h-3 rounded-sm bg-indigo-100 border border-indigo-700 dark:bg-indigo-900 dark:border-indigo-400 block"></span>
           <span>Catatan Aktif (Fokus)</span>
        </div>
        <div className="flex items-center gap-2">
           <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-600 dark:bg-emerald-900 dark:border-emerald-400 block"></span>
           <span>Folder Keterhubungan</span>
        </div>
        <div className="flex items-center gap-2">
           <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-600 dark:bg-red-900 dark:border-red-400 block"></span>
           <span>Folder Sampah</span>
        </div>
        
        {/* UPDATE BAGIAN INI: Lainnya / Root */}            
          <div className="flex items-center gap-2">            
            <span className="w-3 h-3 rounded-sm bg-slate-200 border border-slate-400 dark:bg-gray-800 dark:border-gray-500 block"></span>            
            <span>Lainnya / Root</span>            
          </div>            
        </div>
      <svg ref={svgRef} className="w-full h-full touch-none" />

      {/* --- ACTION BAR (Muncul Saat Seleksi) --- */}
      {selectionMode && (
        <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t dark:border-gray-800 p-4 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-30 animate-in slide-in-from-bottom-5">
           <div className="flex gap-6 mx-auto">
              <button onClick={handleBulkDelete} className="flex flex-col items-center gap-1 text-gray-500 hover:text-red-600 transition-colors">
                  <Trash2 size={20} /> <span className="text-[10px] font-medium">Delete</span>
              </button>
              <button onClick={() => setShowMoveDialog(true)} className="flex flex-col items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors">
                  <FolderInput size={20} /> <span className="text-[10px] font-medium">Move</span>
              </button>
              <button onClick={cancelSelection} className="flex flex-col items-center gap-1 text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">
                  <X size={20} /> <span className="text-[10px] font-medium">Cancel</span>
              </button>
           </div>
           <div className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-blue-600 dark:text-blue-400 text-sm">
               {selectedNodeIds.size} Selected
           </div>
        </div>
      )}

      {/* --- DIALOG MOVE --- */}
      {showMoveDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="bg-white dark:bg-gray-800 w-full max-w-sm rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
              <h3 className="font-bold text-lg dark:text-white">Pindahkan ke...</h3>
              <button onClick={() => setShowMoveDialog(false)}><X size={20} className="text-gray-500"/></button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
               <button onClick={() => handleMoveAction(undefined)} className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200">
                 <FolderInput size={20} className="text-gray-400" /> Home (Root)
               </button>
               {folders.filter(f => !f.deletedAt).map(f => (
                 <button key={f.id} onClick={() => handleMoveAction(f.id)} className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3 text-gray-700 dark:text-gray-200">
                   <FolderInput size={20} className="text-amber-500" />
                   {f.name}
                 </button>
               ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
