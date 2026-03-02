
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ElkNode, LayoutAlgorithm, LayoutDirection, LayoutOptions } from './types';
import { convertQsysToElk, getKindColor } from './services/qsysConverter';
import ElkRenderer from './components/ElkRenderer';

declare const ELK: any;

type PortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'AUTO';

const App: React.FC = () => {
  const buildVisibilityMap = useCallback((graph: ElkNode, previous?: Record<string, boolean>) => {
    const kinds = Array.from(new Set((graph.edges || []).map(edge => String(edge.meta?.['edge.type'] || edge.labels?.[0]?.text || 'unknown'))));
    const next: Record<string, boolean> = {};
    kinds.forEach(kind => {
      next[kind] = previous?.[kind] ?? true;
    });
    return next;
  }, []);

  const [originalGraph, setOriginalGraph] = useState<ElkNode | null>(null);
  const [layoutedGraph, setLayoutedGraph] = useState<ElkNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParameters, setShowParameters] = useState(false);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isVsCode, setIsVsCode] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [addressMapVisible, setAddressMapVisible] = useState(false);
  
  const [portOverrides, setPortOverrides] = useState<Record<string, PortSide>>({});

  const [options, setOptions] = useState<LayoutOptions>({
    algorithm: 'layered',
    direction: 'RIGHT',
    routing: 'ORTHOGONAL'
  });

  const [visibleKinds, setVisibleKinds] = useState<Record<string, boolean>>({});

  const elk = useMemo(() => new ELK(), []);
  const vscodeApi = useMemo(() => {
    const api = (window as any).acquireVsCodeApi;
    return typeof api === 'function' ? api() : null;
  }, []);

  const runLayout = useCallback(async (
    graph: ElkNode,
    opt: LayoutOptions,
    visibility: Record<string, boolean>,
    showParams: boolean,
    hiddenIds: Set<string>,
    overrides: Record<string, PortSide>
  ) => {
    setLoading(true);
    setError(null);
    try {
      const g: ElkNode = JSON.parse(JSON.stringify(graph));

      if (g.children) {
        g.children = g.children.filter(node => !hiddenIds.has(node.id));
      }

      if (g.edges) {
        g.edges = g.edges.filter(edge => {
          const edgeType = String(edge.meta?.['edge.type'] || edge.labels?.[0]?.text || 'unknown');
          const isKindVisible = visibility[edgeType] ?? true;
          if (!isKindVisible) return false;
          const sourceNodeId = edge.sources[0].split('.')[0];
          const targetNodeId = edge.targets[0].split('.')[0];
          return !hiddenIds.has(sourceNodeId) && !hiddenIds.has(targetNodeId);
        });
      }

      const activePortIds = new Set<string>();
      g.edges?.forEach(edge => {
        edge.sources.forEach(s => activePortIds.add(s));
        edge.targets.forEach(t => activePortIds.add(t));
      });

      if (g.children) {
        g.children.forEach(node => {
          if (node.ports) {
            if (activePortIds.size > 0) {
              node.ports = node.ports.filter(port => activePortIds.has(port.id));
            }
            let hasAnyAutoPort = false;
            node.ports.forEach(port => {
              const override = overrides[port.id];
              if (override === 'AUTO') {
                hasAnyAutoPort = true;
                if (port.properties) {
                  delete port.properties['org.eclipse.elk.port.side'];
                }
              } else if (override) {
                if (!port.properties) port.properties = {};
                port.properties['org.eclipse.elk.port.side'] = override;
              }
            });

            if (!node.properties) node.properties = {};
            node.properties['org.eclipse.elk.portConstraints'] = hasAnyAutoPort ? 'FREE' : 'FIXED_SIDE';

            const portCount = node.ports.length;
            if (showParams && node.meta?.parameters) {
              const paramCount = Math.min(15, node.meta.parameters.length);
              node.height = Math.max(210, portCount * 45 + paramCount * 21 + 90);
              node.width = 450;
            } else {
              node.height = Math.max(150, portCount * 45 + 75);
              node.width = 360;
            }
          }
        });
      }

      const applyOptions = (node: ElkNode) => {
        if (!node.properties) node.properties = {};
        node.properties['org.eclipse.elk.algorithm'] = opt.algorithm;
        node.properties['org.eclipse.elk.direction'] = opt.direction;
        node.properties['org.eclipse.elk.edgeRouting'] = opt.routing;
        node.properties['org.eclipse.elk.spacing.nodeNode'] = '260';
        node.properties['org.eclipse.elk.spacing.nodeNodeBetweenLayers'] = '260';
        node.properties['org.eclipse.elk.spacing.edgeEdge'] = '48';
        node.properties['org.eclipse.elk.spacing.edgeNode'] = '100';
        node.properties['org.eclipse.elk.separateConnectedComponents'] = 'true';
        node.properties['org.eclipse.elk.componentSpacing'] = '260';

        if (opt.algorithm === 'layered') {
          node.properties['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers'] = '260';
          node.properties['org.eclipse.elk.layered.spacing.nodeNode'] = '260';
          node.properties['org.eclipse.elk.layered.unnecessaryBends'] = 'true';
          node.properties['org.eclipse.elk.layered.crossingMinimization.strategy'] = 'LAYER_SWEEP';
          node.properties['org.eclipse.elk.layered.layering.strategy'] = 'NETWORK_SIMPLEX';
          node.properties['org.eclipse.elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF';
          node.properties['org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment'] = 'BALANCED';
          node.properties['org.eclipse.elk.layered.orthogonal'] = opt.routing === 'ORTHOGONAL' ? 'true' : 'false';
        }
        node.children?.forEach(applyOptions);
      };

      applyOptions(g);
      const result = await elk.layout(g);
      setLayoutedGraph(result);
    } catch (err: any) {
      console.error(err);
      setError("Layout failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [elk]);

  // VS Code Message Listener
  useEffect(() => {
    if (vscodeApi) {
      vscodeApi.postMessage({ type: 'ready' });
    }
  }, [vscodeApi]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSidebarVisible(false);
    }, 2800);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'update') {
        setIsVsCode(true);
        if (!message.text || !message.text.trim()) {
          setOriginalGraph(null);
          setLayoutedGraph(null);
          setError(null);
          return;
        }
        try {
          const graph = convertQsysToElk(message.text);
          const nextVisibility = buildVisibilityMap(graph, visibleKinds);
          setOriginalGraph(graph);
          setVisibleKinds(nextVisibility);
          setHiddenNodeIds(new Set());
          setPortOverrides({});
          runLayout(graph, options, nextVisibility, showParameters, new Set(), {});
        } catch (err: any) {
          setError("Failed to parse VS Code document: " + err.message);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [options, visibleKinds, showParameters, runLayout, buildVisibilityMap]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        try {
          let graph: ElkNode;
          if (file.name.endsWith('.qsys')) {
            graph = convertQsysToElk(content);
          } else {
            graph = JSON.parse(content);
          }
          const nextVisibility = buildVisibilityMap(graph, visibleKinds);
          setOriginalGraph(graph);
          setVisibleKinds(nextVisibility);
          setHiddenNodeIds(new Set());
          setPortOverrides({});
          runLayout(graph, options, nextVisibility, showParameters, new Set(), {});
        } catch (err: any) {
          alert("Error parsing file: " + err.message);
        }
      };
      reader.readAsText(file);
    };

  const handleNodeMove = useCallback((id: string, dx: number, dy: number) => {
    setLayoutedGraph(prev => {
      if (!prev || !prev.children) return prev;
      const next = { ...prev };
      next.children = next.children!.map(node => {
        if (node.id === id) {
          return { ...node, x: (node.x || 0) + dx, y: (node.y || 0) + dy };
        }
        return node;
      });
      if (next.edges) {
        next.edges = next.edges.map(edge => ({ ...edge, sections: undefined }));
      }
      return next;
    });
  }, []);

  const exportToDrawIo = () => {
    if (!layoutedGraph) return;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="Electron" modified="${new Date().toISOString()}" agent="qsysViz" version="20.0.0">
  <diagram id="diag_1" name="Qsys Design">
    <mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />`;

    layoutedGraph.children?.forEach((node) => {
      const label = node.labels?.[0]?.text || node.id;
      const x = (node.x || 0) + 100;
      const y = (node.y || 0) + 100;
      const w = node.width || 360;
      const h = node.height || 150;
      xml += `
        <mxCell id="${node.id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fontStyle=1;fontSize=18;strokeWidth=2;fillColor=#ffffff;strokeColor=#94a3b8;verticalAlign=top;spacingTop=12;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />
        </mxCell>`;

      node.ports?.forEach((port) => {
        const px = port.x || 0;
        const py = port.y || 0;
        const pw = port.width || 22;
        const ph = port.height || 22;
        const pLabel = port.meta?.label || '';
        const color = port.meta?.['interface.color'] || '#94a3b8';
        const side = port.properties?.['org.eclipse.elk.port.side'] || 'WEST';
        
        let labelAlign = 'left';
        if (side === 'EAST') labelAlign = 'right';

        xml += `
        <mxCell id="${port.id}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=#1e293b;" vertex="1" parent="${node.id}">
          <mxGeometry x="${px}" y="${py}" width="${pw}" height="${ph}" as="geometry" />
        </mxCell>`;

        xml += `
        <mxCell id="label_${port.id}" value="${pLabel}" style="text;html=1;strokeColor=none;fillColor=none;align=${labelAlign};verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=15;fontColor=#000000;fontStyle=1;" vertex="1" parent="${node.id}">
          <mxGeometry x="${px + (side === 'WEST' ? 30 : -210)}" y="${py}" width="180" height="${ph}" as="geometry" />
        </mxCell>`;
      });
    });

    layoutedGraph.edges?.forEach((edge, i) => {
      const sourceId = edge.sources[0];
      const targetId = edge.targets[0];
      const color = edge.meta?.['edge.color'] || '#475569';
      const strokeWidth = edge.isVector ? 5 : 2.5;
      xml += `
        <mxCell id="edge_${i}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${color};strokeWidth=${strokeWidth};endArrow=block;endFill=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>`;
    });

    xml += `</root></mxGraphModel></diagram></mxfile>`;

    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qsys_design_${Date.now()}.drawio`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setPortSide = (portId: string, side: PortSide) => {
    const next = { ...portOverrides, [portId]: side };
    setPortOverrides(next);
    if (originalGraph) runLayout(originalGraph, options, visibleKinds, showParameters, hiddenNodeIds, next);
  };

  const updateOptions = (updates: Partial<LayoutOptions>) => {
    const newOptions = { ...options, ...updates };
    setOptions(newOptions);
    if (originalGraph) runLayout(originalGraph, newOptions, visibleKinds, showParameters, hiddenNodeIds, portOverrides);
  };

  const triggerReroute = () => {
    if (originalGraph) runLayout(originalGraph, options, visibleKinds, showParameters, hiddenNodeIds, portOverrides);
  };

  const toggleVisibility = (kind: string) => {
    const newVisibility = { ...visibleKinds, [kind]: !visibleKinds[kind] };
    setVisibleKinds(newVisibility);
    if (originalGraph) runLayout(originalGraph, options, newVisibility, showParameters, hiddenNodeIds, portOverrides);
  };

  const visibleKindList = useMemo(() => Object.keys(visibleKinds).sort((a, b) => a.localeCompare(b)), [visibleKinds]);

  const addressMap = useMemo(() => {
    if (!originalGraph?.edges) {
      return { masters: [] as string[], slaves: [] as string[], matrix: {} as Record<string, Record<string, string>> };
    }

    const addressEdges = originalGraph.edges.filter((edge) => {
      const kind = String(edge.meta?.['connection.kind'] || '').toLowerCase();
      const type = String(edge.meta?.['edge.type'] || '').toLowerCase();
      const hasAddress = Boolean(edge.meta?.['address.base'] || edge.meta?.['address.range']);
      return hasAddress && (kind.includes('avalon') || type.includes('axi') || type.includes('avalon'));
    });

    const masters = Array.from(new Set(addressEdges.map((edge) => String(edge.meta?.['connection.start'] || edge.sources?.[0] || ''))))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const slaves = Array.from(new Set(addressEdges.map((edge) => String(edge.meta?.['connection.end'] || edge.targets?.[0] || ''))))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const matrix: Record<string, Record<string, string>> = {};
    slaves.forEach(slave => {
      matrix[slave] = {};
    });

    addressEdges.forEach((edge) => {
      const master = String(edge.meta?.['connection.start'] || edge.sources?.[0] || '');
      const slave = String(edge.meta?.['connection.end'] || edge.targets?.[0] || '');
      if (!master || !slave) return;
      const value = String(edge.meta?.['address.range'] || edge.meta?.['address.base'] || '-');
      if (!matrix[slave]) matrix[slave] = {};
      matrix[slave][master] = value;
    });

    return { masters, slaves, matrix };
  }, [originalGraph]);

  const exportAddressMapCsv = useCallback(() => {
    if (addressMap.masters.length === 0 || addressMap.slaves.length === 0) return;

    const escapeCsv = (value: string) => `"${String(value).replace(/"/g, '""')}"`;

    const header = ['Slave / Master', ...addressMap.masters].map(escapeCsv).join(',');
    const rows = addressMap.slaves.map((slave) => {
      const cells = [
        slave,
        ...addressMap.masters.map((master) => addressMap.matrix[slave]?.[master] || '')
      ];
      return cells.map(escapeCsv).join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `address_map_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [addressMap]);

  const toggleParameters = () => {
    const next = !showParameters;
    setShowParameters(next);
    if (originalGraph) runLayout(originalGraph, options, visibleKinds, next, hiddenNodeIds, portOverrides);
  };

  const handleDeleteNode = useCallback((id: string) => {
    const next = new Set(hiddenNodeIds);
    next.add(id);
    setHiddenNodeIds(next);
    if (originalGraph) runLayout(originalGraph, options, visibleKinds, showParameters, next, portOverrides);
  }, [originalGraph, options, visibleKinds, showParameters, hiddenNodeIds, portOverrides, runLayout]);

  const restoreAllNodes = () => {
    const emptySet = new Set<string>();
    setHiddenNodeIds(emptySet);
    if (originalGraph) runLayout(originalGraph, options, visibleKinds, showParameters, emptySet, portOverrides);
  };

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !layoutedGraph) return null;
    return layoutedGraph.children?.find(n => n.id === selectedNodeId);
  }, [selectedNodeId, layoutedGraph]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId || !layoutedGraph) return null;
    return layoutedGraph.edges?.find(e => e.id === selectedEdgeId) || null;
  }, [selectedEdgeId, layoutedGraph]);

  useEffect(() => {
    if (!selectedNodeId && !selectedEdgeId) return;

    const timeoutId = window.setTimeout(() => {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [selectedNodeId, selectedEdgeId]);

  const resolvePortLabel = useCallback((portId: string) => {
    const nodeId = portId.split('.')[0];
    const node = layoutedGraph?.children?.find(n => n.id === nodeId);
    const port = node?.ports?.find(p => p.id === portId);
    return {
      nodeName: node?.labels?.[0]?.text || nodeId,
      portLabel: port?.meta?.label || portId
    };
  }, [layoutedGraph]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100 font-sans">
      <header className="no-print bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-end shadow-sm z-10">

        <div className="flex items-center gap-2">
          {!isVsCode && (
            <>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-4 py-2 rounded-lg cursor-pointer transition-all active:scale-95">
                Import Qsys
                <input type="file" className="hidden" accept=".json,.qsys" onChange={handleFileUpload} />
              </label>
            </>
          )}
          <button onClick={exportToDrawIo} disabled={!layoutedGraph} className="flex items-center gap-2 text-sm font-bold text-slate-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg shadow-sm transition-all active:scale-95">
            Export Draw.io
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Hover trigger zone */}
        <div 
          className="absolute left-0 top-0 w-4 h-full z-40"
          onMouseEnter={() => setSidebarVisible(true)}
        />
        <div className="no-print absolute left-0 top-1/2 -translate-y-1/2 z-30 pointer-events-none transition-opacity duration-200">
          <div className={`border border-l-0 rounded-r-md px-2 py-2 shadow-sm ${sidebarVisible ? 'bg-slate-100/80 border-slate-200 opacity-40' : 'bg-indigo-100 border-indigo-300 opacity-95'}`}>
            <div className="flex items-center text-slate-600">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </div>
          </div>
        </div>
        {/* Left Sidebar */}
        <aside 
          className={`no-print w-80 bg-white border-r border-slate-200 p-4 flex flex-col gap-4 shadow-lg overflow-y-auto absolute left-0 top-0 h-full z-50 transition-transform duration-300 ease-in-out ${sidebarVisible ? 'translate-x-0' : '-translate-x-full'}`}
          onMouseLeave={() => setSidebarVisible(false)}
        >
          <section>
            <h3 className="text-[13px] font-black text-slate-400 uppercase tracking-widest mb-3">Layout Options</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-bold text-slate-500 mb-1.5 block">Algorithm</label>
                <select value={options.algorithm} onChange={(e) => updateOptions({ algorithm: e.target.value as LayoutAlgorithm })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="layered">Layered (Standard)</option>
                  <option value="mrtree">Mr. Tree</option>
                  <option value="force">Force Directed</option>
                  <option value="radial">Radial</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-bold text-slate-500 mb-1.5 block">Direction</label>
                <select value={options.direction} onChange={(e) => updateOptions({ direction: e.target.value as LayoutDirection })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="DOWN">Top to Bottom</option>
                  <option value="RIGHT">Left to Right</option>
                  <option value="UP">Bottom to Top</option>
                  <option value="LEFT">Right to Left</option>
                </select>
              </div>
              
              <button 
                onClick={triggerReroute}
                disabled={!originalGraph}
                className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-black rounded-lg transition-colors flex items-center justify-center gap-2 border border-indigo-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Auto-Reroute Nets
              </button>

              <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-all">
                <input
                  type="checkbox"
                  checked={showParameters}
                  onChange={toggleParameters}
                  className="w-5 h-5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-sm font-black text-slate-700 uppercase tracking-tight">Show Parameters</span>
              </label>
            </div>
          </section>

          <section className="flex-1">
            <h3 className="text-[13px] font-black text-slate-400 uppercase tracking-widest mb-3">Legend & Filters</h3>
            <div className="space-y-2">
              {visibleKindList.map((label) => (
                <label key={label} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={visibleKinds[label]}
                    onChange={() => toggleVisibility(label)}
                    className="w-5 h-5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                  />
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: getKindColor(label) }}></div>
                  <span className={`text-sm font-bold ${visibleKinds[label] ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{label}</span>
                </label>
              ))}
              {visibleKindList.length === 0 && (
                <div className="text-sm text-slate-400 font-bold">No connection types detected yet.</div>
              )}
            </div>
          </section>

          {hiddenNodeIds.size > 0 && (
            <section className="bg-red-50 p-4 rounded-xl border border-red-100">
              <button 
                onClick={restoreAllNodes}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg transition-colors"
              >
                Restore {hiddenNodeIds.size} Hidden Blocks
              </button>
            </section>
          )}
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 relative bg-slate-50 overflow-hidden flex">
          <div className="flex-1 h-full p-8">
            <div className="w-full h-full bg-white border border-slate-200 overflow-hidden">
              <ElkRenderer 
                graph={layoutedGraph} 
                showParameters={showParameters} 
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onDeleteNode={handleDeleteNode}
                onNodeMove={handleNodeMove}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  if (id) setSelectedEdgeId(null);
                }}
                onSelectEdge={(id) => {
                  setSelectedEdgeId(id);
                  if (id) setSelectedNodeId(null);
                }}
              />
            </div>
          </div>

          {/* Right Inspector Panel */}
          {selectedNode && (
            <aside className="w-[280px] bg-white border-l border-slate-200 flex flex-col shadow-xl z-20 animate-in slide-in-from-right duration-300">
              <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="overflow-hidden">
                  <h3 className="text-base font-black text-slate-800 truncate">{selectedNode.labels?.[0]?.text}</h3>
                  <p className="text-xs text-slate-500 font-bold uppercase truncate">{selectedNode.meta?.kind}</p>
                </div>
                <button onClick={() => setSelectedNodeId(null)} className="p-1.5 hover:bg-slate-200 rounded-md text-slate-400">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                <section>
                  <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                    Interface Locations
                  </h4>
                  <div className="space-y-2">
                    {selectedNode.ports?.map(port => (
                      <div key={port.id} className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-slate-700 truncate mr-2" title={port.meta?.label}>
                            {port.meta?.label}
                          </span>
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: port.meta?.['interface.color'] }}></div>
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {['AUTO', 'NORTH', 'SOUTH', 'WEST', 'EAST'].map((side) => {
                            const currentSide = portOverrides[port.id] || (port.properties?.['org.eclipse.elk.port.side'] ?? 'AUTO');
                            const isSelected = currentSide === side;
                            return (
                              <button
                                key={side}
                                onClick={() => setPortSide(port.id, side as PortSide)}
                                className={`text-xs font-black py-1.5 rounded-md transition-all border ${
                                  isSelected 
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                                    : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                                }`}
                              >
                                {side === 'AUTO' ? 'A' : side[0]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                
                {selectedNode.meta?.parameters && (
                  <section>
                    <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-3">Parameters</h4>
                    <div className="space-y-1">
                      {(selectedNode.meta.parameters as any[]).map((p, i) => (
                        <div key={i} className="flex flex-col gap-1 pb-1.5 border-b border-slate-50">
                          <span className="text-xs font-bold text-slate-400 truncate">{p.name}</span>
                          <span className="text-xs font-mono font-medium text-slate-700 truncate bg-slate-50 p-1.5 rounded leading-tight">{p.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </aside>
          )}

          {selectedEdge && !selectedNode && (
            <aside className="w-[280px] bg-white border-l border-slate-200 flex flex-col shadow-xl z-20 animate-in slide-in-from-right duration-300">
              <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="overflow-hidden">
                  <h3 className="text-base font-black text-slate-800 truncate">Net Details</h3>
                  <p className="text-xs text-slate-500 font-bold uppercase truncate">{selectedEdge.meta?.['edge.type'] || selectedEdge.labels?.[0]?.text || 'Net'}</p>
                </div>
                <button onClick={() => setSelectedEdgeId(null)} className="p-1.5 hover:bg-slate-200 rounded-md text-slate-400">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <section className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-2">Type</h4>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedEdge.meta?.['edge.color'] || '#475569' }}></div>
                    <span className="text-xs font-black text-slate-700">{selectedEdge.meta?.['edge.type'] || selectedEdge.labels?.[0]?.text || 'Unknown'}</span>
                  </div>
                </section>

                <section className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-2">Endpoints</h4>
                  <div className="space-y-4">
                    {(() => {
                      const src = resolvePortLabel(selectedEdge.sources[0]);
                      const dst = resolvePortLabel(selectedEdge.targets[0]);
                      return (
                        <>
                          <div>
                            <div className="text-xs font-bold text-slate-400 uppercase">Source</div>
                            <div className="text-xs font-black text-slate-700">{src.nodeName}</div>
                            <div className="text-xs text-slate-500">{src.portLabel}</div>
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-400 uppercase">Destination</div>
                            <div className="text-xs font-black text-slate-700">{dst.nodeName}</div>
                            <div className="text-xs text-slate-500">{dst.portLabel}</div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </section>

                <section className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-2">Data Width</h4>
                  <div className="text-xs font-black text-slate-700">
                    {selectedEdge.meta?.['data.width'] || selectedEdge.meta?.['width'] || selectedEdge.meta?.['edge.width'] || 'Unknown'}
                  </div>
                </section>
              </div>
            </aside>
          )}

          {loading && (
             <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center z-30">
                <div className="animate-pulse flex flex-col items-center gap-4">
                  <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-lg font-black text-indigo-700 tracking-tighter uppercase">Rerouting...</span>
                </div>
             </div>
          )}

          <button
            onClick={() => setAddressMapVisible(v => !v)}
            className="no-print absolute left-4 bottom-4 z-40 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black px-3 py-2 rounded-lg shadow-lg border border-indigo-700"
          >
            {addressMapVisible ? 'Hide Address Map' : 'Address Map'}
          </button>

          {addressMapVisible && (
            <section className="no-print absolute left-4 bottom-16 z-50 w-[min(980px,calc(100%-2rem))] max-h-[45vh] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Address Map</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportAddressMapCsv}
                    disabled={addressMap.masters.length === 0 || addressMap.slaves.length === 0}
                    className="text-xs font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={() => setAddressMapVisible(false)}
                    className="text-xs font-black text-slate-500 hover:text-slate-700 px-2 py-1 rounded"
                  >
                    Close
                  </button>
                </div>
              </div>

              {addressMap.masters.length > 0 && addressMap.slaves.length > 0 ? (
                <div className="overflow-auto max-h-[calc(45vh-44px)]">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-black text-slate-500 border-b border-slate-200 sticky left-0 bg-slate-50">Slave \ Master</th>
                        {addressMap.masters.map(master => (
                          <th key={master} className="text-left px-3 py-2 font-black text-slate-500 border-b border-slate-200 whitespace-nowrap">{master}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {addressMap.slaves.map(slave => (
                        <tr key={slave} className="odd:bg-white even:bg-slate-50/40">
                          <td className="px-3 py-2 font-bold text-slate-700 border-b border-slate-100 sticky left-0 bg-inherit whitespace-nowrap">{slave}</td>
                          {addressMap.masters.map(master => (
                            <td key={`${slave}:${master}`} className="px-3 py-2 text-slate-600 border-b border-slate-100 whitespace-nowrap">
                              {addressMap.matrix[slave]?.[master] || ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-3 text-sm text-slate-400 font-bold">No address map entries detected.</div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
