
import { ElkNode, ElkPort, ElkEdge } from '../types';

export type ConnectionKind = string;

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

const normalizeType = (value?: string | null): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'unknown';
};

const resolveConnectionType = (
  connectionKind: string | null,
  startInterfaceType?: string,
  endInterfaceType?: string
): string => {
  const startType = normalizeType(startInterfaceType);
  const endType = normalizeType(endInterfaceType);

  if (startType !== 'unknown' && endType !== 'unknown') {
    if (startType.toLowerCase() === endType.toLowerCase()) {
      return startType;
    }
    return `${startType} -> ${endType}`;
  }

  if (startType !== 'unknown') return startType;
  if (endType !== 'unknown') return endType;
  return normalizeType(connectionKind);
};

const parseAddressNumber = (value?: string | null): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = trimmed.toLowerCase().startsWith('0x')
    ? Number.parseInt(trimmed, 16)
    : Number.parseInt(trimmed, 10);

  return Number.isFinite(parsed) ? parsed : null;
};

const formatHex = (value: number): string => `0x${value.toString(16)}`;

const getInterfaceAddrWidth = (
  moduleParams: Map<string, string> | undefined,
  interfaceName: string
): number | null => {
  if (!moduleParams) return null;

  const key = interfaceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const candidates = [
    `${key}_ADDR_WIDTH`,
    `${key}_ADDRESS_WIDTH`,
    `C_${key}_AXI_ADDR_WIDTH`,
    `C_${key}_ADDR_WIDTH`,
    `${key}ADDR_WIDTH`,
  ];

  for (const candidate of candidates) {
    const value = moduleParams.get(candidate);
    if (!value) continue;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 52) {
      return parsed;
    }
  }

  return null;
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
  const interfaces = xmlDoc.getElementsByTagName('interface');
  const moduleMap = new Map<string, ElkNode>();
  const moduleParamMap = new Map<string, Map<string, string>>();
  const interfaceTypeMap = new Map<string, string>();
  const connectedPortIds = new Set<string>();
  const unconnectedInterfacePorts: Array<{ portId: string; label: string; kind: ConnectionKind; color: string; dir: string }> = [];

  Array.from(interfaces).forEach((intf) => {
    const internal = intf.getAttribute('internal');
    if (!internal) return;
    interfaceTypeMap.set(internal, normalizeType(intf.getAttribute('type')));
  });

  // 1. Process Modules
  Array.from(modules).forEach((mod) => {
    const name = mod.getAttribute('name') || 'unknown';
    const kind = mod.getAttribute('kind') || 'component';
    
    const params: {name: string, value: string}[] = [];
    const paramMap = new Map<string, string>();
    const paramTags = mod.getElementsByTagName('parameter');
    Array.from(paramTags).forEach(p => {
      const pName = p.getAttribute('name');
      const pValue = p.getAttribute('value');
      if (pName && pValue) {
        params.push({ name: pName, value: pValue });
        paramMap.set(pName.toUpperCase(), pValue);
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
    moduleParamMap.set(name, paramMap);
    rootNode.children?.push(node);
  });

  // 2. Process Connections
  Array.from(connections).forEach((conn, index) => {
    const startStr = conn.getAttribute('start') || '';
    const endStr = conn.getAttribute('end') || '';
    const qsysKind = normalizeType(conn.getAttribute('kind'));
    const resolvedType = resolveConnectionType(
      conn.getAttribute('kind'),
      interfaceTypeMap.get(startStr),
      interfaceTypeMap.get(endStr)
    );
    const color = getKindColor(resolvedType);

    const [startMod, startIntf] = startStr.split('.');
    const [endMod, endIntf] = endStr.split('.');

    if (!startMod || !endMod) return;

    const sourceNode = moduleMap.get(startMod);
    const targetNode = moduleMap.get(endMod);

    if (sourceNode && targetNode) {
      const connectionParams = new Map<string, string>();
      Array.from(conn.getElementsByTagName('parameter')).forEach((p) => {
        const name = p.getAttribute('name');
        const value = p.getAttribute('value');
        if (name && value) {
          connectionParams.set(name, value);
        }
      });

      const baseValue = connectionParams.get('baseAddress') || connectionParams.get('base');
      const explicitEndValue = connectionParams.get('endAddress') || connectionParams.get('end');
      const baseAddress = parseAddressNumber(baseValue);
      const explicitEndAddress = parseAddressNumber(explicitEndValue);

      const targetParams = moduleParamMap.get(endMod);
      const inferredAddrWidth = getInterfaceAddrWidth(targetParams, endIntf || '');
      const inferredEndAddress =
        baseAddress !== null && inferredAddrWidth !== null
          ? baseAddress + Math.pow(2, inferredAddrWidth) - 1
          : null;
      const endAddress = explicitEndAddress ?? inferredEndAddress;

      const addressRange =
        baseAddress !== null && endAddress !== null
          ? `${formatHex(baseAddress)} - ${formatHex(endAddress)}`
          : null;

      const sourcePortId = `${startMod}.${startIntf}`;
      const targetPortId = `${endMod}.${endIntf}`;
      connectedPortIds.add(sourcePortId);
      connectedPortIds.add(targetPortId);

      if (!sourceNode.ports?.find(p => p.id === sourcePortId)) {
        sourceNode.ports?.push({
          id: sourcePortId,
          width: 22, // Scaled 15 * 1.5
          height: 22, // Scaled 15 * 1.5
          properties: { 'org.eclipse.elk.port.side': 'EAST' },
          meta: {
            'label': startIntf,
            'interface.color': color, 
            'internalKind': resolvedType 
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
            'internalKind': resolvedType 
          }
        });
      }

      rootNode.edges?.push({
        id: `edge_${index}`,
        sources: [sourcePortId],
        targets: [targetPortId],
        isVector: qsysKind.toLowerCase().includes('avalon') || resolvedType.toLowerCase().includes('axi'),
        labels: [{ text: resolvedType }],
        meta: {
          'edge.color': color,
          'edge.type': resolvedType,
          'connection.kind': qsysKind,
          'connection.start': startStr,
          'connection.end': endStr,
          'address.base': baseAddress !== null ? formatHex(baseAddress) : null,
          'address.end': endAddress !== null ? formatHex(endAddress) : null,
          'address.range': addressRange
        }
      });
    }
  });

  // 3. Process Interfaces to catch any ports not defined by connections
  Array.from(interfaces).forEach((intf) => {
    const internal = intf.getAttribute('internal') || '';
    const qsysKind = normalizeType(intf.getAttribute('type'));
    const dir = intf.getAttribute('dir') || 'end';
    const internalKind = qsysKind;
    const color = getKindColor(qsysKind);
    
    const [modName, intfName] = internal.split('.');
    if (!modName || !intfName) return;

    const node = moduleMap.get(modName);
    if (node) {
      const portId = internal;
      if (!node.ports?.find(p => p.id === portId)) {
        node.ports?.push({
          id: portId,
          width: 22,
          height: 22,
          properties: { 'org.eclipse.elk.port.side': dir === 'start' ? 'EAST' : 'WEST' },
          meta: {
            'label': intfName,
            'interface.color': color,
            'internalKind': internalKind,
          }
        });
      }

      if (!connectedPortIds.has(portId)) {
        unconnectedInterfacePorts.push({
          portId,
          label: intfName,
          kind: internalKind,
          color,
          dir,
        });
      }
    }
  });

  if (unconnectedInterfacePorts.length > 0) {
    const externalInputs = unconnectedInterfacePorts.filter(intf => intf.dir !== 'start');
    const externalOutputs = unconnectedInterfacePorts.filter(intf => intf.dir === 'start');

    const makeExternalNode = (id: string, label: string, portCount: number): ElkNode => ({
      id,
      width: 300,
      height: Math.max(150, portCount * 30 + 80),
      labels: [{ text: label }],
      ports: [],
      properties: {
        'org.eclipse.elk.portConstraints': 'FIXED_SIDE',
        'org.eclipse.elk.spacing.portPort': '24'
      },
      meta: {
        kind: 'external'
      }
    });

    const externalInputNode = externalInputs.length > 0
      ? makeExternalNode('__external_input__', 'External Inputs', externalInputs.length)
      : null;
    const externalOutputNode = externalOutputs.length > 0
      ? makeExternalNode('__external_output__', 'External Outputs', externalOutputs.length)
      : null;

    externalInputs.forEach((intf, index) => {
      if (!externalInputNode) return;
      const externalPortId = `__external_input__.${intf.portId}`;
      externalInputNode.ports?.push({
        id: externalPortId,
        width: 18,
        height: 18,
        properties: { 'org.eclipse.elk.port.side': 'EAST' },
        meta: {
          label: intf.label,
          'interface.color': intf.color,
          internalKind: intf.kind,
        }
      });

      rootNode.edges?.push({
        id: `ext_in_edge_${index}`,
        sources: [externalPortId],
        targets: [intf.portId],
        labels: [{ text: 'external' }],
        meta: {
          'edge.color': intf.color,
          'edge.type': intf.kind
        }
      });
    });

    externalOutputs.forEach((intf, index) => {
      if (!externalOutputNode) return;
      const externalPortId = `__external_output__.${intf.portId}`;
      externalOutputNode.ports?.push({
        id: externalPortId,
        width: 18,
        height: 18,
        properties: { 'org.eclipse.elk.port.side': 'WEST' },
        meta: {
          label: intf.label,
          'interface.color': intf.color,
          internalKind: intf.kind,
        }
      });

      rootNode.edges?.push({
        id: `ext_out_edge_${index}`,
        sources: [intf.portId],
        targets: [externalPortId],
        labels: [{ text: 'external' }],
        meta: {
          'edge.color': intf.color,
          'edge.type': intf.kind
        }
      });
    });

    if (externalInputNode) rootNode.children?.push(externalInputNode);
    if (externalOutputNode) rootNode.children?.push(externalOutputNode);
  }

  rootNode.children?.forEach(node => {
    const portCount = node.ports?.length || 0;
    node.height = Math.max(150, portCount * 45 + 90); // Scaled 100, 30, 60 * 1.5
  });
  return rootNode;
}
