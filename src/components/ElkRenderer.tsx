
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
              // Make mouse-wheel zoom coarser / faster
              zoomScaleSensitivity: 2,
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key.toLowerCase() !== 'f') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
          return;
        }
      }

      if (panZoomRef.current) {
        event.preventDefault();
        panZoomRef.current.fit();
        panZoomRef.current.center();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
          const hasElkCoords = typeof port.x === 'number' && typeof port.y === 'number';

          if (hasElkCoords) {
            positions.set(port.id, {
              x: nodeX + (port.x || 0) + pw / 2,
              y: nodeY + (port.y || 0) + ph / 2,
              side,
              w: pw,
              h: ph
            });
            return;
          }

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

  // Calculate per-edge lateral offset so parallel edges between the same
  // node-pair are visually separated (each net type gets its own lane).
  // We group by SOURCE-NODE + TARGET-NODE (not port positions) because all
  // ports on the same node share the same node-X, making naive Y-band
  // grouping produce all-zero offsets → completely overlapping wires.
  const wireChannels = useMemo(() => {
    const channels = new Map<string, number>();
    const channelSpacing = 30; // px between adjacent parallel nets (pair-level)
    const fanoutSpacing = 14;  // small local spread for fan-out at source

    // 1) Pair-level grouping (inter-node corridor lanes)
    const pairGroups = new Map<string, ElkEdge[]>();
    graph?.edges?.forEach(edge => {
      const srcNode = edge.sources[0].split('.')[0];
      const tgtNode = edge.targets[0].split('.')[0];
      const pairKey = [srcNode, tgtNode].sort().join('||');
      if (!pairGroups.has(pairKey)) pairGroups.set(pairKey, []);
      pairGroups.get(pairKey)!.push(edge);
    });

    const pairOffsets = new Map<string, number>();
    pairGroups.forEach((edges, pairKey) => {
      const count = edges.length;
      const sorted = [...edges].sort((a, b) => {
        const ya = portPositions.get(a.sources[0])?.y ?? 0;
        const yb = portPositions.get(b.sources[0])?.y ?? 0;
        return ya - yb;
      });
      sorted.forEach((edge, i) => {
        const offset = (i - (count - 1) / 2) * channelSpacing;
        pairOffsets.set(edge.id, offset);
      });
    });

    // 2) Fan-out grouping at source port to separate siblings near the node
    const fanoutGroups = new Map<string, ElkEdge[]>();
    graph?.edges?.forEach(edge => {
      const sourcePort = edge.sources[0];
      if (!fanoutGroups.has(sourcePort)) fanoutGroups.set(sourcePort, []);
      fanoutGroups.get(sourcePort)!.push(edge);
    });

    const fanoutOffsets = new Map<string, number>();
    fanoutGroups.forEach(edges => {
      const count = edges.length;
      if (count <= 1) return;
      const sorted = [...edges].sort((a, b) => {
        const ta = portPositions.get(a.targets[0])?.y ?? 0;
        const tb = portPositions.get(b.targets[0])?.y ?? 0;
        return ta - tb;
      });
      sorted.forEach((edge, i) => {
        const offset = (i - (count - 1) / 2) * fanoutSpacing;
        fanoutOffsets.set(edge.id, offset);
      });
    });

    // Combine pair and fanout offsets for final channel offset
    graph?.edges?.forEach(edge => {
      const p = pairOffsets.get(edge.id) ?? 0;
      const f = fanoutOffsets.get(edge.id) ?? 0;
      channels.set(edge.id, p + f);
    });

    return channels;
  }, [graph, portPositions]);

  // Node bounding-box obstacles (with margin) used by the fallback router
  const nodeObstacles = useMemo(() => {
    const margin = 14;
    return (graph?.children || []).map(node => ({
      x1: (node.x || 0) - margin,
      y1: (node.y || 0) - margin,
      x2: (node.x || 0) + (node.width  || 0) + margin,
      y2: (node.y || 0) + (node.height || 0) + margin,
    }));
  }, [graph]);

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
    const nodeKind = String(node.meta?.kind || '');

    let nodeFill = 'gray';
    if (node.id === '__external_input__') {
      nodeFill = '#dbeafe';
    } else if (node.id === '__external_output__') {
      nodeFill = '#ffedd5';
    } else if (nodeKind.startsWith('altera_')) {
      nodeFill = '#dbeafe';
    }

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
          fill={nodeFill}
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
    const selectedMarkerId = `arrow-selected-${edge.id}`;
    const hasSections = !!(edge.sections && edge.sections.length > 0);
    
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
    
    // Generate schematic-style orthogonal path with obstacle avoidance and
    // per-edge lane separation.
    //
    // Every independent edge between the same source→target node pair receives
    // a unique channelOffset (computed in wireChannels).  That offset is used
    // as the BASE for the routing search, so parallel nets always land in
    // different columns/rows of the inter-node corridor.
    //
    // Search order:
    //   1. H-V-H  with midX = midpoint + channelOffset  (+ small sweep if blocked)
    //   2. V-H-V  with midY = midpoint + channelOffset
    //   3. Wide box-detour for retrograde / feedback edges
    //   4. Unchecked fallback
    const createSchematicPath = (
      src: { x: number; y: number; side: string },
      tgt: { x: number; y: number; side: string }
    ): { path: string; junctions: { x: number; y: number }[] } => {
      const baseOffset = 40;
      const junctions: { x: number; y: number }[] = [];

      // Exit stub from source
      let sx = src.x, sy = src.y;
      if      (src.side === 'EAST')  sx += baseOffset;
      else if (src.side === 'WEST')  sx -= baseOffset;
      else if (src.side === 'NORTH') sy -= baseOffset;
      else if (src.side === 'SOUTH') sy += baseOffset;

      // Entry stub to target
      let tx = tgt.x, ty = tgt.y;
      if      (tgt.side === 'EAST')  tx += baseOffset;
      else if (tgt.side === 'WEST')  tx -= baseOffset;
      else if (tgt.side === 'NORTH') ty -= baseOffset;
      else if (tgt.side === 'SOUTH') ty += baseOffset;

      if (hasFanOut && edgeIndex === 0) {
        junctions.push({ x: sx, y: sy });
      }

      // ── Obstacle helpers ─────────────────────────────────────────────────
      const segIntersectsRect = (
        v: {x:number;y:number}, w: {x:number;y:number},
        r: {x1:number;y1:number;x2:number;y2:number}
      ): boolean => {
        if (v.x >= r.x1 && v.x <= r.x2 && v.y >= r.y1 && v.y <= r.y2) return true;
        if (w.x >= r.x1 && w.x <= r.x2 && w.y >= r.y1 && w.y <= r.y2) return true;
        const cross = (p1:any,p2:any,p3:any,p4:any) => {
          const o = (a:any,b:any,c:any) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
          return o(p1,p2,p3)*o(p1,p2,p4)<0 && o(p3,p4,p1)*o(p3,p4,p2)<0;
        };
        const {x1,y1,x2,y2} = r;
        return cross(v,w,{x:x1,y:y1},{x:x2,y:y1})
            || cross(v,w,{x:x2,y:y1},{x:x2,y:y2})
            || cross(v,w,{x:x2,y:y2},{x:x1,y:y2})
            || cross(v,w,{x:x1,y:y2},{x:x1,y:y1});
      };

      const A = {x: sx, y: sy};
      const B = {x: tx, y: ty};

      const is3SegClear = (m1: {x:number;y:number}, m2: {x:number;y:number}) =>
        !nodeObstacles.some(r =>
          segIntersectsRect(A, m1, r) || segIntersectsRect(m1, m2, r) || segIntersectsRect(m2, B, r)
        );

      // ── Routing search ────────────────────────────────────────────────────
      // Fine search offsets around the preferred column (step = 20 px).
      // The first candidate IS the channelOffset itself, followed by small
      // perturbations in case that column is blocked by a node.
      const step = 20;
      const fineShifts = [0, 1,-1, 2,-2, 3,-3, 5,-5, 8,-8, 12,-12, 18,-18, 25,-25, 35,-35];

      // 1. H-V-H: preferred midX = (sx+tx)/2 + channelOffset
      //    Each edge in a group has a distinct channelOffset → distinct column.
      const baseMidX = (sx + tx) / 2 + channelOffset;
      for (const s of fineShifts) {
        const midX = baseMidX + s * step;
        if (is3SegClear({x: midX, y: sy}, {x: midX, y: ty})) {
          return {
            path: `M ${src.x} ${src.y} L ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty} L ${tgt.x} ${tgt.y}`,
            junctions,
          };
        }
      }

      // 2. V-H-V: preferred midY = (sy+ty)/2 + channelOffset
      const baseMidY = (sy + ty) / 2 + channelOffset;
      for (const s of fineShifts) {
        const midY = baseMidY + s * step;
        if (is3SegClear({x: sx, y: midY}, {x: tx, y: midY})) {
          return {
            path: `M ${src.x} ${src.y} L ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty} L ${tgt.x} ${tgt.y}`,
            junctions,
          };
        }
      }

      // 3. Wide box-detour for EAST→WEST feedback (source right of target)
      if (src.side === 'EAST' && tgt.side === 'WEST' && tx <= sx) {
        const detour = 80 + Math.abs(channelOffset);
        const midY   = (sy + ty) / 2 + channelOffset;
        return {
          path: `M ${src.x} ${src.y} L ${sx} ${sy} L ${sx + detour} ${sy} L ${sx + detour} ${midY} L ${tx - detour} ${midY} L ${tx - detour} ${ty} L ${tx} ${ty} L ${tgt.x} ${tgt.y}`,
          junctions,
        };
      }

      // 4. Last resort: forced H-V-H at the preferred column (ignores obstacles)
      return {
        path: `M ${src.x} ${src.y} L ${sx} ${sy} L ${baseMidX} ${sy} L ${baseMidX} ${ty} L ${tx} ${ty} L ${tgt.x} ${tgt.y}`,
        junctions,
      };
    };

    if (hasSections) {
      const sectionPath = edge.sections!
        .map((section) => {
          let d = `M ${section.startPoint.x} ${section.startPoint.y}`;
          section.bendPoints?.forEach((bp: any) => {
            d += ` L ${bp.x} ${bp.y}`;
          });
          d += ` L ${section.endPoint.x} ${section.endPoint.y}`;
          return d;
        })
        .join(' ');

      const isSelected = selectedEdgeId === edge.id;

      return (
        <g key={edge.id}>
          <defs>
            <marker id={markerId} markerWidth="14" markerHeight="14" refX="12" refY="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L14,7 L0,14 Z" fill={edgeColor} />
            </marker>
            <marker id={selectedMarkerId} markerWidth="14" markerHeight="14" refX="12" refY="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L14,7 L0,14 Z" fill="#2563eb" />
            </marker>
          </defs>
          <path
            d={sectionPath}
            fill="none"
            stroke={edgeColor}
            strokeWidth={edge.isVector ? "3.5" : "2"}
            markerEnd={`url(#${markerId})`}
            strokeLinejoin="round"
            opacity={isSelected ? 1 : 0.55}
          />
          <path
            d={sectionPath}
            fill="none"
            stroke="transparent"
            strokeWidth={edge.isVector ? "12" : "10"}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEdge(edge.id);
            }}
          />
          {isSelected && (
            <>
              <path
                d={sectionPath}
                fill="none"
                stroke="#ffffff"
                strokeWidth={edge.isVector ? "9" : "7"}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.95}
              />
              <path
                d={sectionPath}
                fill="none"
                stroke="#2563eb"
                strokeWidth={edge.isVector ? "6" : "4.5"}
                markerEnd={`url(#${selectedMarkerId})`}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={1}
              />
            </>
          )}
        </g>
      );
    }

    if (!sourcePos || !targetPos) return null;
    
    const sourceAnchor = getAnchor(sourcePos);
    const targetAnchor = getAnchor(targetPos);
    const { path, junctions } = createSchematicPath(sourceAnchor, targetAnchor);
    
    const isSelected = selectedEdgeId === edge.id;

    return (
      <g key={edge.id}>
        <defs>
          <marker id={markerId} markerWidth="14" markerHeight="14" refX="12" refY="7" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0 L14,7 L0,14 Z" fill={edgeColor} />
          </marker>
          <marker id={selectedMarkerId} markerWidth="14" markerHeight="14" refX="12" refY="7" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0 L14,7 L0,14 Z" fill="#2563eb" />
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
          opacity={isSelected ? 1 : 0.55}
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
          <>
            <path
              d={path}
              fill="none"
              stroke="#ffffff"
              strokeWidth={edge.isVector ? "9" : "7"}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.95}
            />
            <path
              d={path}
              fill="none"
              stroke="#2563eb"
              strokeWidth={edge.isVector ? "6" : "4.5"}
              markerEnd={`url(#${selectedMarkerId})`}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={1}
            />
          </>
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
