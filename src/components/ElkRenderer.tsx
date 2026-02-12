
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ElkNode, ElkEdge, ElkPort } from '../types';

interface ElkRendererProps {
  graph: ElkNode | null;
  showParameters: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onDeleteNode: (id: string) => void;
  onNodeMove: (id: string, dx: number, dy: number) => void;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
}

declare const svgPanZoom: any;

const ElkRenderer: React.FC<ElkRendererProps> = ({ 
  graph, 
  showParameters, 
  selectedNodeId,
  selectedEdgeId,
  onDeleteNode, 
  onNodeMove,
  onSelectNode,
  onSelectEdge
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const panZoomRef = useRef<any>(null);
  
  const [dragState, setDragState] = useState<{
    nodeId: string;
    lastX: number;
    lastY: number;
    hasMoved: boolean;
  } | null>(null);

  // Track graph id/timestamp to detect layout changes
  const lastGraphRef = useRef<string | null>(null);

  useEffect(() => {
    if (svgRef.current && graph) {
      // Create a simple hash to detect if graph structure changed
      const graphKey = `${graph.width}-${graph.height}-${graph.children?.length}`;
      const graphChanged = lastGraphRef.current !== graphKey;
      lastGraphRef.current = graphKey;

      if (graphChanged && panZoomRef.current) {
        // Destroy existing instance when graph layout changes
        panZoomRef.current.destroy();
        panZoomRef.current = null;
      }

      if (!panZoomRef.current) {
        // Small delay to ensure SVG is fully rendered with new viewBox
        setTimeout(() => {
          if (svgRef.current) {
            panZoomRef.current = svgPanZoom(svgRef.current, {
              zoomEnabled: true,
              controlIconsEnabled: true,
              fit: true,
              center: true,
              minZoom: 0.01,
              maxZoom: 100,
              mouseWheelZoomEnabled: true,
              viewportSelector: '.svg-pan-zoom_viewport'
            });
          }
        }, 50);
      }
    }

    return () => {
      // Cleanup on unmount
      if (panZoomRef.current) {
        panZoomRef.current.destroy();
        panZoomRef.current = null;
      }
    };
  }, [graph]);

  const getSVGCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!svgRef.current || !viewportRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transformed = pt.matrixTransform(viewport.getScreenCTM()!.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const handleMouseDown = (e: React.MouseEvent, node: ElkNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const coords = getSVGCoords(e);
    
    setDragState({
      nodeId: node.id,
      lastX: coords.x,
      lastY: coords.y,
      hasMoved: false
    });

    if (panZoomRef.current) {
      panZoomRef.current.disablePan();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState) return;
    
    const coords = getSVGCoords(e);
    const dx = coords.x - dragState.lastX;
    const dy = coords.y - dragState.lastY;

    if (dx !== 0 || dy !== 0) {
      onNodeMove(dragState.nodeId, dx, dy);
      setDragState({
        ...dragState,
        lastX: coords.x,
        lastY: coords.y,
        hasMoved: true
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragState) {
      if (!dragState.hasMoved) {
        onSelectNode(dragState.nodeId);
      }
      setDragState(null);
      if (panZoomRef.current) {
        panZoomRef.current.enablePan();
      }
    }
  };

  const handleSvgClick = (e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      onSelectNode(null);
      onSelectEdge(null);
    }
  };

  // Build a map of all port positions for junction detection
  const portPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; side: string; w: number; h: number }>();
    graph?.children?.forEach(node => {
      const nodeX = node.x || 0;
      const nodeY = node.y || 0;
      const nodeW = node.width || 0;
      const nodeH = node.height || 0;
      
      // Group ports by side
      const portsBySide = { WEST: [] as ElkPort[], EAST: [] as ElkPort[], NORTH: [] as ElkPort[], SOUTH: [] as ElkPort[] };
      node.ports?.forEach(port => {
        const side = (port.properties?.['org.eclipse.elk.port.side'] || 'EAST') as keyof typeof portsBySide;
        portsBySide[side].push(port);
      });

      // Calculate positions for each port based on its side
      Object.entries(portsBySide).forEach(([side, ports]) => {
        ports.forEach((port, index) => {
          const pw = port.width || 0;
          const ph = port.height || 0;
          const inset = 2;
          let adjustedX = 0;
          let adjustedY = 0;

          if (side === "WEST") {
            adjustedX = inset;
            const portSpacing = ports.length > 1 ? (nodeH - 20) / (ports.length + 1) : nodeH / 2;
            adjustedY = (index + 1) * portSpacing - ph / 2;
          } else if (side === "EAST") {
            adjustedX = Math.max(inset, nodeW - pw - inset);
            const portSpacing = ports.length > 1 ? (nodeH - 20) / (ports.length + 1) : nodeH / 2;
            adjustedY = (index + 1) * portSpacing - ph / 2;
          } else if (side === "NORTH") {
            adjustedY = inset;
            const portSpacing = ports.length > 1 ? (nodeW - 20) / (ports.length + 1) : nodeW / 2;
            adjustedX = (index + 1) * portSpacing - pw / 2;
          } else if (side === "SOUTH") {
            adjustedY = Math.max(inset, nodeH - ph - inset);
            const portSpacing = ports.length > 1 ? (nodeW - 20) / (ports.length + 1) : nodeW / 2;
            adjustedX = (index + 1) * portSpacing - pw / 2;
          }

          // Clamp to bounds
          adjustedX = Math.max(inset, Math.min(adjustedX, nodeW - pw - inset));
          adjustedY = Math.max(inset, Math.min(adjustedY, nodeH - ph - inset));

          positions.set(port.id, {
            x: nodeX + adjustedX + pw / 2,
            y: nodeY + adjustedY + ph / 2,
            side,
            w: pw,
            h: ph
          });
        });
      });
    });
    return positions;
  }, [graph]);

  // Group edges by source port to detect fan-out (one source to multiple targets)
  const edgesBySource = useMemo(() => {
    const groups = new Map<string, ElkEdge[]>();
    graph?.edges?.forEach(edge => {
      const sourceId = edge.sources[0];
      if (!groups.has(sourceId)) {
        groups.set(sourceId, []);
      }
      groups.get(sourceId)!.push(edge);
    });
    return groups;
  }, [graph]);

  // Calculate wire channels (vertical routing lanes) to avoid overlaps
  const wireChannels = useMemo(() => {
    const channels = new Map<string, number>();
    let channelOffset = 0;
    const channelSpacing = 15;
    
    graph?.edges?.forEach(edge => {
      const sourcePos = portPositions.get(edge.sources[0]);
      const targetPos = portPositions.get(edge.targets[0]);
      if (sourcePos && targetPos) {
        // Assign unique channel for each edge to avoid overlaps
        channels.set(edge.id, channelOffset);
        channelOffset = (channelOffset + channelSpacing) % 60;
      }
    });
    return channels;
  }, [graph, portPositions]);

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-slate-300">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          <p className="font-black text-2xl">No Design Loaded</p>
          <p className="text-lg">Import a .qsys or .json file to begin visualization</p>
        </div>
      </div>
    );
  }

  const padding = 100;
  const viewBox = `0 0 ${(graph.width || 800) + 2 * padding} ${(graph.height || 600) + 2 * padding}`;

  const renderPort = (port: ElkPort, node: ElkNode) => {
    const side = port.properties?.['org.eclipse.elk.port.side'] || 'WEST';
    const color = port.meta?.['interface.color'] || '#94a3b8';
    const labelText = port.meta?.label || port.id;
    const pw = port.width || 0;
    const ph = port.height || 0;
    
    // Use the same computed center used by edge routing so ports and nets always align.
    const pos = portPositions.get(port.id);
    let adjustedX = (port.x || 0);
    let adjustedY = (port.y || 0);
    if (pos) {
      adjustedX = pos.x - (node.x || 0) - pw / 2;
      adjustedY = pos.y - (node.y || 0) - ph / 2;
    }
    
    // Position text labels closer to the port
    let tx = adjustedX + pw / 2;
    let ty = adjustedY + ph / 2;
    let anchor: "start" | "middle" | "end" = "middle";

    if (side === "WEST") {
      tx = adjustedX + pw + 6;
      anchor = "start";
    } else if (side === "EAST") {
      tx = adjustedX - 6;
      anchor = "end";
    } else if (side === "NORTH") {
      tx = adjustedX + pw / 2;
      ty = adjustedY + ph + 14;
      anchor = "middle";
    } else if (side === "SOUTH") {
      tx = adjustedX + pw / 2;
      ty = adjustedY - 6;
      anchor = "middle";
    }

    return (
      <g key={port.id}>
        <rect
          x={adjustedX}
          y={adjustedY}
          width={pw}
          height={ph}
          fill={color}
          stroke="#ffffff"
          strokeWidth="2"
          rx="2"
        />
        <text
          x={tx}
          y={ty}
          textAnchor={anchor}
          dominantBaseline="middle"
          fill="#1e293b"
          pointerEvents="none"
          style={{ fontSize: '13px', fontWeight: '700', fontFamily: 'Inter, sans-serif' }}
        >
          {labelText}
        </text>
      </g>
    );
  };

  const renderNode = (node: ElkNode) => {
    const params = (node.meta?.parameters || []) as {name: string, value: string}[];
    const displayParams = showParameters && params.length > 0 && (node.height || 0) > 180; 
    const isDragging = dragState?.nodeId === node.id;
    const isSelected = selectedNodeId === node.id;

    return (
      <g 
        key={node.id} 
        transform={`translate(${node.x || 0}, ${node.y || 0})`}
        onMouseDown={(e) => handleMouseDown(e, node)}
        className="select-none"
      >
        <rect
          width={node.width}
          height={node.height}
          rx="12"
          fill="white"
          stroke={isSelected ? "#4f46e5" : isDragging ? "#818cf8" : "#cbd5e1"}
          strokeWidth={isSelected || isDragging ? "4" : "3"}
          style={isSelected ? { filter: 'drop-shadow(0 0 12px rgba(79, 70, 229, 0.4))' } : {}}
          className={`transition-all ${isDragging ? 'opacity-90' : 'shadow-md'} cursor-grab active:cursor-grabbing hover:stroke-slate-400`}
        />
        
        {node.labels?.[0] && (
          <text
            x={node.width! / 2}
            y={28}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#0f172a"
            pointerEvents="none"
            style={{ fontSize: '18px', fontWeight: '900', fontFamily: 'Inter, sans-serif' }}
          >
            {node.labels[0].text}
          </text>
        )}

        {node.meta?.kind && (
            <text
              x={node.width! / 2}
              y={46}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#94a3b8"
              pointerEvents="none"
              style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {node.meta.kind}
            </text>
        )}

        {displayParams && (
          <g transform="translate(22, 75)" pointerEvents="none">
            {params.slice(0, 10).map((p, i) => (
              <text
                key={i}
                x={0}
                y={i * 18}
                fill="#64748b"
                style={{ fontSize: '12px', fontWeight: '600', fontFamily: 'monospace' }}
              >
                <tspan fill="#94a3b8">{p.name}:</tspan> {p.value}
              </text>
            ))}
          </g>
        )}

        <g 
          className="cursor-pointer group/del" 
          onClick={(e) => {
            e.stopPropagation();
            onDeleteNode(node.id);
          }}
          transform={`translate(${node.width! - 36}, 12)`}
        >
          <circle r="13" cx="13" cy="13" fill="#fee2e2" className="group-hover/del:fill-red-500 transition-colors" />
          <path 
            d="M8 8L18 18M18 8L8 18" 
            stroke="#ef4444" 
            strokeWidth="2" 
            strokeLinecap="round" 
            className="group-hover/del:stroke-white transition-colors"
          />
        </g>

        {node.ports?.map(port => renderPort(port, node))}
        {node.children?.map(renderNode)}
      </g>
    );
  };

  const renderEdge = (edge: ElkEdge) => {
    const edgeColor = edge.meta?.['edge.color'] || '#475569';
    const markerId = `arrow-${edge.id}`;
    
    const sourcePos = portPositions.get(edge.sources[0]);
    const targetPos = portPositions.get(edge.targets[0]);

    const getAnchor = (p: { x: number; y: number; side: string; w: number; h: number }) => {
      return { x: p.x, y: p.y, side: p.side };
    };
    
    // Check if this source has multiple distinct targets (fan-out)
    const siblingEdges = edgesBySource.get(edge.sources[0]) || [];
    const uniqueTargets = new Set(siblingEdges.map(e => e.targets[0]));
    const hasFanOut = uniqueTargets.size > 1;
    const edgeIndex = siblingEdges.indexOf(edge);
    
    // Get channel offset for this edge
    const channelOffset = wireChannels.get(edge.id) || 0;
    
    // Generate schematic-style orthogonal path with proper routing
    const createSchematicPath = (
      src: { x: number; y: number; side: string },
      tgt: { x: number; y: number; side: string }
    ): { path: string; junctions: { x: number; y: number }[] } => {
      const baseOffset = 40;
      const junctions: { x: number; y: number }[] = [];
      
      // Calculate exit point from source
      let sx = src.x, sy = src.y;
      if (src.side === 'EAST') sx += baseOffset;
      else if (src.side === 'WEST') sx -= baseOffset;
      else if (src.side === 'NORTH') sy -= baseOffset;
      else if (src.side === 'SOUTH') sy += baseOffset;
      
      // Calculate entry point to target
      let tx = tgt.x, ty = tgt.y;
      if (tgt.side === 'EAST') tx += baseOffset;
      else if (tgt.side === 'WEST') tx -= baseOffset;
      else if (tgt.side === 'NORTH') ty -= baseOffset;
      else if (tgt.side === 'SOUTH') ty += baseOffset;
      
      let path = `M ${src.x} ${src.y} L ${sx} ${sy}`;
      
      // Add junction at the first bend point if fan-out exists
      if (hasFanOut && edgeIndex === 0) {
        junctions.push({ x: sx, y: sy });
      }
      
      // Smart routing based on relative positions
      const dx = tx - sx;
      const dy = ty - sy;
      
      if (src.side === 'EAST' && tgt.side === 'WEST') {
        // Standard left-to-right connection
        if (dx > 0) {
          // Direct path with single vertical segment
          const midX = sx + dx / 2 + channelOffset;
          path += ` L ${midX} ${sy}`;
          path += ` L ${midX} ${ty}`;
          // Add junction if lines would cross
          if (hasFanOut) {
            junctions.push({ x: midX, y: sy });
          }
        } else {
          // Need to go around - source is to the right of target
          const loopOffset = 60 + channelOffset;
          path += ` L ${sx + loopOffset} ${sy}`;
          const midY = (sy + ty) / 2;
          path += ` L ${sx + loopOffset} ${midY}`;
          path += ` L ${tx - loopOffset} ${midY}`;
          path += ` L ${tx - loopOffset} ${ty}`;
        }
      } else if (src.side === 'WEST' && tgt.side === 'EAST') {
        // Right-to-left connection
        const midX = sx + dx / 2 - channelOffset;
        path += ` L ${midX} ${sy}`;
        path += ` L ${midX} ${ty}`;
      } else if (src.side === 'SOUTH' && tgt.side === 'NORTH') {
        // Top-to-bottom connection
        const midY = sy + dy / 2 + channelOffset;
        path += ` L ${sx} ${midY}`;
        path += ` L ${tx} ${midY}`;
      } else if (src.side === 'NORTH' && tgt.side === 'SOUTH') {
        // Bottom-to-top connection
        const midY = sy + dy / 2 - channelOffset;
        path += ` L ${sx} ${midY}`;
        path += ` L ${tx} ${midY}`;
      } else {
        // Mixed sides - use L-shaped or Z-shaped routing
        if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal dominant
          const midX = sx + dx / 2 + channelOffset;
          path += ` L ${midX} ${sy}`;
          path += ` L ${midX} ${ty}`;
        } else {
          // Vertical dominant
          const midY = sy + dy / 2 + channelOffset;
          path += ` L ${sx} ${midY}`;
          path += ` L ${tx} ${midY}`;
        }
      }
      
      path += ` L ${tx} ${ty}`;
      path += ` L ${tgt.x} ${tgt.y}`;
      
      return { path, junctions };
    };
    
    if (!sourcePos || !targetPos) {
      // Fallback to original sections if ports not found
      return (
        <g key={edge.id} pointerEvents="none">
          <defs>
            <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={edgeColor} />
            </marker>
          </defs>
          {edge.sections?.map((section, idx) => {
            let d = `M ${section.startPoint.x} ${section.startPoint.y}`;
            section.bendPoints?.forEach((bp: any) => {
              d += ` L ${bp.x} ${bp.y}`;
            });
            d += ` L ${section.endPoint.x} ${section.endPoint.y}`;
            return (
              <path
                key={idx}
                d={d}
                fill="none"
                stroke={edgeColor}
                strokeWidth={edge.isVector ? "3.5" : "2"}
                markerEnd={`url(#${markerId})`}
              />
            );
          })}
        </g>
      );
    }
    
    const sourceAnchor = getAnchor(sourcePos);
    const targetAnchor = getAnchor(targetPos);
    const { path, junctions } = createSchematicPath(sourceAnchor, targetAnchor);
    
    const isSelected = selectedEdgeId === edge.id;

    return (
      <g key={edge.id}>
        <defs>
          <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={edgeColor} />
          </marker>
        </defs>
        {/* Main wire path */}
        <path
          d={path}
          fill="none"
          stroke={edgeColor}
          strokeWidth={edge.isVector ? "3.5" : "2"}
          markerEnd={`url(#${markerId})`}
          strokeLinejoin="round"
          opacity={isSelected ? 1 : 0.9}
        />
        {/* Hit area for selection */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={edge.isVector ? "12" : "10"}
          onClick={(e) => {
            e.stopPropagation();
            onSelectEdge(edge.id);
          }}
        />
        {isSelected && (
          <path
            d={path}
            fill="none"
            stroke="#2563eb"
            strokeWidth={edge.isVector ? "4.5" : "3"}
            strokeLinejoin="round"
            opacity={0.7}
          />
        )}
        {/* Junction points (filled circles where wires branch) */}
        {junctions.map((j, idx) => (
          <circle
            key={`junction-${idx}`}
            cx={j.x}
            cy={j.y}
            r={edge.isVector ? 5 : 4}
            fill={edgeColor}
          />
        ))}
      </g>
    );
  };

  return (
    <svg
      id="main-elk-svg"
      ref={svgRef}
      className={`w-full h-full bg-white ${dragState ? 'cursor-grabbing' : ''}`}
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleSvgClick}
    >
      <g className="svg-pan-zoom_viewport" ref={viewportRef}>
        <g transform={`translate(${padding}, ${padding})`}>
          {graph.children?.map(renderNode)}
          {graph.edges?.map(renderEdge)}
        </g>
      </g>
    </svg>
  );
};

export default ElkRenderer;
