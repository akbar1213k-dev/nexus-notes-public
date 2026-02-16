import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Note, Folder } from '../types'; // <--- Tambah Import Folder

interface GraphViewProps {
  notes: Note[];
  folders: Folder[]; // <--- Tambah Props folders
  onNodeClick: (noteId: string) => void;
  isDarkMode: boolean;
  activeNoteId?: string;
}

// Update Interface: Menambahkan properti folder
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  group: number;
  folder?: string; 
  width?: number;
  height?: number;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
}

export const GraphView: React.FC<GraphViewProps> = ({ notes, folders, onNodeClick, isDarkMode, activeNoteId }) => { // <--- Terima folders di sini
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

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
      // Cari folder yang ID-nya cocok dengan n.folderId
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

    d3.select(svgRef.current).selectAll("*").remove();

    const width = dimensions.width;
    const height = dimensions.height;

    // Simulation Setup
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(80).iterations(2));

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto;");

    // --- Definisi Marker Panah ---
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 38)
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
      .attr("cursor", "pointer")
      .call(d3.drag<SVGGElement, D3Node>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    // --- LOGIKA WARNA & STYLE ---
    // Helper untuk menentukan warna background
    const getFillColor = (d: D3Node) => {
      // 1. Folder Sampah (Merah)
      if (d.folder === "Sampah") {
        return isDarkMode ? "#450a0a" : "#fef2f2"; // Red-950 : Red-50
      }
      // 2. Folder Keterhubungan (Hijau/Emerald)
      if (d.folder === "Keterhubungan") {
        return isDarkMode ? "#064e3b" : "#d1fae5";
      }
      // 3. Default/Root (Abu/Putih)
      return isDarkMode ? "#1f2937" : "#e2e8f0";
    };

    // Helper untuk menentukan warna border (Stroke)
    const getStrokeColor = (d: D3Node) => {
      // 1. Active - Prioritas Utama (Biru/Indigo)
      if (d.id === activeNoteId) {
        return isDarkMode ? "#818cf8" : "#4338ca"; 
      }
      // 2. Folder Sampah (Merah)
      if (d.folder === "Sampah") {
        return isDarkMode ? "#f87171" : "#ef4444"; // Red-400 : Red-500
      }
      // 3. Folder Keterhubungan (Hijau)
      if (d.folder === "Keterhubungan") {
        return isDarkMode ? "#34d399" : "#059669";
      }
      // 4. Default (Abu)
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
    </div>
  );
};
