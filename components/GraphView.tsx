import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Note } from '../types';

// Tambahkan activeNoteId ke props
interface GraphViewProps {
  notes: Note[];
  onNodeClick: (noteId: string) => void;
  isDarkMode: boolean;
  activeNoteId?: string; // New: ID untuk auto-focus
}

// Interface Node D3 yang diperluas untuk mendukung width/height dinamis
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  group: number;
  width?: number;
  height?: number;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
}

export const GraphView: React.FC<GraphViewProps> = ({ notes, onNodeClick, isDarkMode, activeNoteId }) => {
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

    // Mapping data ke format D3Node
    const nodes: D3Node[] = notes.map(n => ({
      id: n.id,
      title: n.title || "Untitled",
      group: 1
    }));

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
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(150)) // Jarak diperlebar untuk kotak
      .force("charge", d3.forceManyBody().strength(-500)) // Tolakan diperkuat
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(80).iterations(2)); // Radius diperbesar untuk menghindari tumpang tindih kotak

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto;");

    // --- Definisi Marker Panah (Arrowhead) ---
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 38) // Offset agar panah tidak tertutup node (sesuaikan dengan ukuran node)
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
       .on("dblclick.zoom", null); // Disable double click zoom

    const link = g.append("g")
      .attr("stroke", isDarkMode ? "#555" : "#999")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrowhead)"); // Tambahkan panah di ujung garis

    // --- Perubahan: Node menggunakan Group (g) berisi Rect dan Text ---
    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<SVGGElement, D3Node>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    // Render Kotak (Card) sebagai pengganti Circle
    node.append("rect")
      .attr("rx", 8) // Sudut membulat
      .attr("ry", 8)
      // Warna berbeda untuk node aktif
      .attr("fill", d => d.id === activeNoteId 
          ? (isDarkMode ? "#3730a3" : "#e0e7ff") // Warna Active (Indigo)
          : (isDarkMode ? "#1f2937" : "#ffffff")) // Warna Default
      .attr("stroke", d => d.id === activeNoteId 
          ? (isDarkMode ? "#818cf8" : "#4338ca") 
          : (isDarkMode ? "#374151" : "#e2e8f0"))
      .attr("stroke-width", d => d.id === activeNoteId ? 3 : 1) // Border lebih tebal untuk active
      .attr("filter", isDarkMode ? "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" : "drop-shadow(0 4px 6px rgba(0,0,0,0.1))");

    // Render Teks Label
    const text = node.append("text")
      .text(d => d.title.length > 25 ? d.title.substring(0, 25) + '...' : d.title)
      .attr("text-anchor", "middle")
      .attr("dy", ".35em")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .attr("fill", d => d.id === activeNoteId 
          ? (isDarkMode ? "#e0e7ff" : "#3730a3") 
          : (isDarkMode ? "#e5e7eb" : "#1f2937"))
      .style("pointer-events", "none");
    
    // Dynamic sizing of the rect based on text
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

    // --- Logika Auto-Focus ke Node Aktif ---
    if (activeNoteId) {
        // Delay sedikit agar simulasi force layout stabil dulu
        setTimeout(() => {
            const targetNode = nodes.find(n => n.id === activeNoteId);
            if (targetNode && targetNode.x !== undefined && targetNode.y !== undefined) {
                const scale = 1.2; // Zoom level yang nyaman
                const translateX = width / 2 - scale * targetNode.x;
                const translateY = height / 2 - scale * targetNode.y;

                svg.transition()
                    .duration(1000) // Animasi halus selama 1 detik
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
      <div className="absolute top-4 left-4 bg-white/80 dark:bg-gray-800/80 p-3 rounded-lg text-xs text-gray-500 dark:text-gray-400 pointer-events-none z-10 backdrop-blur border dark:border-gray-700 flex flex-col gap-1 shadow-sm">
        <span className="font-bold">Mode Peta Konsep</span>
        <span>• Geser node untuk merapikan</span>
        <span>• Cubit/Scroll untuk zoom</span>
        {activeNoteId && <span className="text-blue-500 mt-1">• Fokus pada catatan aktif</span>}
      </div>
      <svg ref={svgRef} className="w-full h-full touch-none" />
    </div>
  );
};
