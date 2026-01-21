import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Note, GraphNode, GraphLink } from '../types';

interface GraphViewProps {
  notes: Note[];
  onNodeClick: (noteId: string) => void;
}

export const GraphView: React.FC<GraphViewProps> = ({ notes, onNodeClick }) => {
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

    // 1. Prepare Data
    const nodes: GraphNode[] = notes.map(n => ({
      id: n.id,
      title: n.title,
      group: 1
    }));

    const links: GraphLink[] = [];
    
    // Parse content to find links (simple regex for the demo, ideal would be parsing DOM)
    // Looking for data-id="..." inside the content
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

    // 2. Clear Previous
    d3.select(svgRef.current).selectAll("*").remove();

    // 3. Setup Simulation
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force("collide", d3.forceCollide().radius(40));

    // 4. Draw
    const svg = d3.select(svgRef.current)
      .attr("width", dimensions.width)
      .attr("height", dimensions.height)
      .attr("viewBox", [0, 0, dimensions.width, dimensions.height])
      .attr("style", "max-width: 100%; height: auto;");

    // Add zoom capability
    const g = svg.append("g");
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    svg.call(zoom);

    // Links
    const link = g.append("g")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 2);

    // Nodes (Circles)
    const node = g.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("g")
      .data(nodes)
      .join("g")
      .call(d3.drag<SVGGElement, GraphNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    node.append("circle")
      .attr("r", 20)
      .attr("fill", "#3b82f6")
      .on("click", (event, d) => {
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(10);
        onNodeClick(d.id);
      });

    // Labels
    node.append("text")
      .attr("x", 25)
      .attr("y", 5)
      .text(d => d.title)
      .clone(true).lower()
      .attr("fill", "none")
      .attr("stroke", "white")
      .attr("stroke-width", 3);
      
    node.append("text")
      .attr("x", 25)
      .attr("y", 5)
      .text(d => d.title)
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .attr("fill", "#1f2937");


    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

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
  }, [notes, dimensions, onNodeClick]);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-50 relative overflow-hidden">
      <div className="absolute top-4 left-4 bg-white/80 p-2 rounded-lg text-xs text-gray-500 pointer-events-none z-10 backdrop-blur">
        Pinch to zoom • Drag to move
      </div>
      <svg ref={svgRef} className="w-full h-full touch-none" />
    </div>
  );
};
