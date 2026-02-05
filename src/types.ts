export interface ElkLabel { text: string; x?: number; y?: number; width?: number; height?: number; }
export interface ElkPort { id: string; width: number; height: number; x?: number; y?: number; labels?: ElkLabel[]; properties?: Record<string, any>; meta?: Record<string, any>; }
export interface ElkEdge { id: string; sources: string[]; targets: string[]; sections?: any[]; labels?: ElkLabel[]; isVector?: boolean; properties?: Record<string, any>; meta?: Record<string, any>; }
export interface ElkNode { id: string; width?: number; height?: number; x?: number; y?: number; labels?: ElkLabel[]; ports?: ElkPort[]; children?: ElkNode[]; edges?: ElkEdge[]; properties?: Record<string, any>; meta?: Record<string, any>; }
export type LayoutAlgorithm = 'layered' | 'mrtree' | 'force' | 'box' | 'disco' | 'radial' | 'random';
export type LayoutDirection = 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
export type RoutingStyle = 'ORTHOGONAL' | 'SPLINES' | 'POLYLINE';
export interface LayoutOptions { algorithm: LayoutAlgorithm; direction: LayoutDirection; routing: RoutingStyle; }