
import { ElkNode, ElkPort, ElkEdge } from '../types';

export const CONNECTION_KINDS = {
  MM: 'Avalon-MM',
  ST: 'Avalon-ST',
  CLOCK: 'Clock',
  RESET: 'Reset',
  CONDUIT: 'Conduit',
  INTR: 'Interrupt',
  OTHER: 'Other'
} as const;

export type ConnectionKind = typeof CONNECTION_KINDS[keyof typeof CONNECTION_KINDS];

export const getKindColor = (kind: string): string => {
  const k = kind.toLowerCase();
  if (k.includes('avalon_streaming') || k.includes('st')) return '#22c55e'; // Green
  if (k.includes('avalon') || k.includes('mm')) return '#f59e0b'; // Amber/Orange
  if (k.includes('clock')) return '#ef4444'; // Red
  if (k.includes('reset')) return '#a855f7'; // Purple
  if (k.includes('conduit')) return '#64748b'; // Slate
  if (k.includes('interrupt')) return '#ec4899'; // Pink
  return '#475569';
};

export const mapQsysKindToInternal = (kind: string): ConnectionKind => {
  const k = kind.toLowerCase();
  if (k.includes('avalon_streaming') || k.includes('st')) return CONNECTION_KINDS.ST;
  if (k.includes('avalon') || k.includes('mm')) return CONNECTION_KINDS.MM;
  if (k.includes('clock')) return CONNECTION_KINDS.CLOCK;
  if (k.includes('reset')) return CONNECTION_KINDS.RESET;
  if (k.includes('conduit')) return CONNECTION_KINDS.CONDUIT;
  if (k.includes('interrupt')) return CONNECTION_KINDS.INTR;
  return CONNECTION_KINDS.OTHER;
};

export function convertQsysToElk(xmlString: string): ElkNode {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  
  const rootNode: ElkNode = {
    id: 'root',
    children: [],
    edges: [],
    properties: {
      'org.eclipse.elk.direction': 'RIGHT',
      'org.eclipse.elk.spacing.nodeNode': '180', // Scaled 120 * 1.5
      'org.eclipse.elk.edgeRouting': 'ORTHOGONAL'
    }
  };

  const modules = xmlDoc.getElementsByTagName('module');
  const connections = xmlDoc.getElementsByTagName('connection');
  const moduleMap = new Map<string, ElkNode>();

  // 1. Process Modules
  Array.from(modules).forEach((mod) => {
    const name = mod.getAttribute('name') || 'unknown';
    const kind = mod.getAttribute('kind') || 'component';
    
    const params: {name: string, value: string}[] = [];
    const paramTags = mod.getElementsByTagName('parameter');
    Array.from(paramTags).forEach(p => {
      const pName = p.getAttribute('name');
      const pValue = p.getAttribute('value');
      if (pName && pValue) {
        params.push({ name: pName, value: pValue });
      }
    });

    const node: ElkNode = {
      id: name,
      width: 360, // Scaled 240 * 1.5
      height: 120, // Scaled 80 * 1.5
      labels: [{ text: name }],
      ports: [],
      properties: {
        'org.eclipse.elk.portConstraints': 'FIXED_SIDE', 
        'org.eclipse.elk.spacing.portPort': '38' // Scaled 25 * 1.5
      },
      meta: {
        'kind': kind,
        'parameters': params
      }
    };
    moduleMap.set(name, node);
    rootNode.children?.push(node);
  });

  // 2. Process Connections
  Array.from(connections).forEach((conn, index) => {
    const startStr = conn.getAttribute('start') || '';
    const endStr = conn.getAttribute('end') || '';
    const qsysKind = conn.getAttribute('kind') || 'unknown';
    const internalKind = mapQsysKindToInternal(qsysKind);
    const color = getKindColor(qsysKind);

    const [startMod, startIntf] = startStr.split('.');
    const [endMod, endIntf] = endStr.split('.');

    if (!startMod || !endMod) return;

    const sourceNode = moduleMap.get(startMod);
    const targetNode = moduleMap.get(endMod);

    if (sourceNode && targetNode) {
      const sourcePortId = `${startMod}.${startIntf}`;
      const targetPortId = `${endMod}.${endIntf}`;

      if (!sourceNode.ports?.find(p => p.id === sourcePortId)) {
        sourceNode.ports?.push({
          id: sourcePortId,
          width: 22, // Scaled 15 * 1.5
          height: 22, // Scaled 15 * 1.5
          properties: { 'org.eclipse.elk.port.side': 'EAST' },
          meta: {
            'label': startIntf,
            'interface.color': color, 
            'internalKind': internalKind 
          }
        });
      }

      if (!targetNode.ports?.find(p => p.id === targetPortId)) {
        targetNode.ports?.push({
          id: targetPortId,
          width: 22, // Scaled 15 * 1.5
          height: 22, // Scaled 15 * 1.5
          properties: { 'org.eclipse.elk.port.side': 'WEST' },
          meta: {
            'label': endIntf,
            'interface.color': color, 
            'internalKind': internalKind 
          }
        });
      }

      rootNode.edges?.push({
        id: `edge_${index}`,
        sources: [sourcePortId],
        targets: [targetPortId],
        isVector: qsysKind.toLowerCase().includes('avalon'),
        labels: [{ text: qsysKind }],
        meta: {
          'edge.color': color,
          'edge.type': internalKind
        }
      });
    }
  });

  rootNode.children?.forEach(node => {
    const portCount = node.ports?.length || 0;
    node.height = Math.max(150, portCount * 45 + 90); // Scaled 100, 30, 60 * 1.5
  });

  return rootNode;
}
