import { ElkNode, ElkPort } from '../types';

// Lightweight hw.tcl parser adapted from bsf-visualizer's hwTclParser.
// It extracts interfaces and ports and returns a single ElkNode representing
// the module with Elk ports suitable for visualization in the existing GUI.

function tclWords(line: string): string[] {
  const words: string[] = [];
  let i = 0;
  const n = line.length;
  const skipWs = () => { while (i < n && (line[i] === ' ' || line[i] === '\t')) i++; };
  while (i < n) {
    skipWs();
    if (i >= n || line[i] === '#') break;
    if (line[i] === '{') {
      let depth = 0, start = i;
      while (i < n) {
        if (line[i] === '{') depth++;
        else if (line[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      words.push(line.slice(start + 1, i - 1));
    } else if (line[i] === '"') {
      const start = ++i;
      while (i < n && line[i] !== '"') i++;
      words.push(line.slice(start, i++));
    } else if (line[i] === '[') {
      let depth = 0, start = i;
      while (i < n) {
        if (line[i] === '[') depth++;
        else if (line[i] === ']') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      words.push(line.slice(start, i));
    } else {
      const start = i;
      while (i < n && line[i] !== ' ' && line[i] !== '\t') i++;
      words.push(line.slice(start, i));
    }
  }
  return words;
}

function subst(text: string, env: Map<string, number | string>): string {
  return text
    .replace(/\$\{([^}]+)\}/g, (_, v) => String(env.get(v) ?? `\${v}`))
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, v) => String(env.get(v) ?? `$${v}`));
}

function evalExpr(expr: string, env: Map<string, number | string>): number {
  let s = subst(expr.trim(), env);
  s = s.replace(/^\[expr\s+/, '').replace(/\]$/, '').trim();
  s = s.replace(/\bint\s*\(/g, 'Math.trunc(');
  s = s.replace(/\bceil\s*\(/g, 'Math.ceil(');
  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + s + ')')();
    if (typeof result === 'number' && isFinite(result)) return Math.round(result);
  } catch (_) {}
  return 1;
}

function resolveWidth(token: string, env: Map<string, number | string>): number {
  if (!token) return 1;
  const simple = parseInt(subst(token, env), 10);
  if (!isNaN(simple)) return simple;
  return evalExpr(token, env);
}

function executeTclBody(
  body: string,
  env: Map<string, number | string>,
  ifaces: any[],
  ports: any[],
): void {
  const lines = body.split('\n').reduce<string[]>((acc, line) => {
    const trimmed = line.trim();
    if (acc.length > 0 && acc[acc.length - 1].endsWith('\\')) {
      acc[acc.length - 1] = acc[acc.length - 1].slice(0, -1) + ' ' + trimmed;
    } else acc.push(trimmed);
    return acc;
  }, []);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim(); i++;
    if (!line || line.startsWith('#')) continue;
    const words = tclWords(line);
    if (words.length === 0) continue;
    const cmd = words[0];
    if (cmd === 'set' && words.length >= 3) {
      const varName = words[1]; const valToken = words[2];
      if (valToken.startsWith('[expr')) env.set(varName, evalExpr(valToken, env));
      else {
        const num = parseFloat(subst(valToken, env));
        env.set(varName, isNaN(num) ? subst(valToken, env) : num);
      }
      continue;
    }
    if (cmd === 'for' && words.length >= 5) {
      const initPart = words[1]; const condPart = words[2]; const bodyPart = words[4] ?? words[3];
      const initWords = tclWords(initPart); const loopVar = initWords[1] ?? 'i'; const loopStart = parseInt(String(initWords[2] ?? '0'), 10);
      const condStr = subst(condPart, env);
      const ltMatch = condStr.match(/\$\w+\s*<\s*(\S+)/);
      const leMatch = condStr.match(/\$\w+\s*<=\s*(\S+)/);
      let loopEnd = 0;
      if (ltMatch) loopEnd = evalExpr(ltMatch[1], env) - 1;
      else if (leMatch) loopEnd = evalExpr(leMatch[1], env);
      else loopEnd = loopStart;
      for (let v = loopStart; v <= loopEnd; v++) {
        const loopEnv = new Map(env); loopEnv.set(loopVar, v); executeTclBody(bodyPart, loopEnv, ifaces, ports);
      }
      continue;
    }
    if (cmd === 'if' && words.length >= 3) {
      executeTclBody(words[2], env, ifaces, ports);
      if (words[3] === 'else' && words[4]) executeTclBody(words[4], env, ifaces, ports);
      else if (words[3] === 'elseif' && words.length >= 6) executeTclBody(words[5], env, ifaces, ports);
      continue;
    }
    if (cmd === 'add_interface' && words.length >= 4) {
      const name = subst(words[1], env); const ifType = subst(words[2], env); const dirStr = subst(words[3], env).toLowerCase();
      const dir = dirStr === 'start' ? 'start' : dirStr === 'end' ? 'end' : dirStr === 'master' ? 'master' : dirStr === 'slave' ? 'slave' : 'none';
      if (!ifaces.some(f => f.name === name)) ifaces.push({ name, ifType, direction: dir });
      continue;
    }
    if (cmd === 'add_interface_port' && words.length >= 6) {
      const intfName = subst(words[1], env); const hdlPort = subst(words[2], env); const role = subst(words[3], env);
      const dirStr = subst(words[4], env).toLowerCase(); const direction: 'input'|'output' = dirStr === 'output' ? 'output' : 'input';
      const width = resolveWidth(words[5], env);
      if (!ports.some(p => p.hdlPort === hdlPort)) ports.push({ intfName, hdlPort, role, direction, width });
      continue;
    }
  }
}

const INTF_COLOR: Record<string,string> = {
  clock: '#f59e0b', reset: '#ef4444', avalon: '#3b82f6', avalon_mm: '#3b82f6', avalon_streaming: '#10b981', conduit: '#8b5cf6', interrupt: '#f97316'
};
function interfaceColor(ifType: string) { return INTF_COLOR[ifType?.toLowerCase?.() ?? ''] ?? '#6b7280'; }

export function parseHwTclToElk(content: string, fileName?: string): ElkNode | null {
  try {
    let moduleName = fileName?.replace(/_hw\.tcl$/i, '') ?? 'hw_module';
    let displayName = moduleName;
    for (const line of content.split('\n')) {
      const w = tclWords(line.trim()); if (w[0] === 'set_module_property') { if (w[1] === 'NAME') moduleName = w[2] ?? moduleName; if (w[1] === 'DISPLAY_NAME') displayName = w[2] ?? displayName; }
    }

    const paramDefaults = new Map<string, number | string>();
    for (const line of content.split('\n')) {
      const w = tclWords(line.trim());
      if (w[0] === 'add_parameter' && w.length >= 4) {
        const pname = w[1]; const rawVal = w[3] ?? '0'; const num = parseFloat(rawVal); paramDefaults.set(pname, isNaN(num) ? rawVal : num);
      }
      if (w[0] === 'set_parameter_property' && w[2] === 'DEFAULT_VALUE') { const pname = w[1]; const rawVal = w[3] ?? '0'; const num = parseFloat(rawVal); paramDefaults.set(pname, isNaN(num) ? rawVal : num); }
    }

    const globalEnv = new Map<string, number | string>(paramDefaults);
    const staticIfaces: any[] = []; const staticPorts: any[] = [];
    const stripProcs = (src: string) => src.replace(/\bproc\s+\S+\s+\{[^}]*\}\s*\{/g, (m) => m + '}');
    const staticBody = stripProcs(content);
    executeTclBody(staticBody, globalEnv, staticIfaces, staticPorts);

    // simple elab extraction conservative approach
    const elabBodyMatch = content.match(/proc\s+elaboration_callback[\s\S]*?\{/);
    let elabIfaces: any[] = []; let elabPorts: any[] = [];
    if (elabBodyMatch) {
      const elabBody = (content.match(/proc\s+elaboration_callback\s+\{[^}]*\}\s*\{([\s\S]*?)\n\}/) ?? [])[1] ?? null;
      if (elabBody) { const elabEnv = new Map(globalEnv); executeTclBody(elabBody, elabEnv, elabIfaces, elabPorts); }
    }

    const ifaceMap = new Map<string, any>(); for (const f of [...staticIfaces, ...elabIfaces]) ifaceMap.set(f.name, f);
    const allIfaces = Array.from(ifaceMap.values());
    const portMap = new Map<string, any>(); for (const p of [...staticPorts, ...elabPorts]) portMap.set(p.hdlPort, p);
    const allPorts = Array.from(portMap.values());
    if (allIfaces.length === 0 && allPorts.length === 0) return null;

    // Show one visual port per interface (not every individual HDL pin).
    const LEFT = ['end','slave','none'];
    const ports: ElkPort[] = [];
    let leftY = 40; let rightY = 40; const PORT_STEP = 34;
    const ifaceByName = new Map(allIfaces.map((f:any)=>[f.name,f]));
    // create one port per interface, label with interface name and count of signals
    for (const intf of allIfaces) {
      const intfPorts = allPorts.filter((p:any) => p.intfName === intf.name);
      const count = intfPorts.length;
      const isLeft = LEFT.includes(intf.direction) || intf.ifType === 'clock' || intf.ifType === 'reset';
      const portId = `${moduleName}.${intf.name}`;
      const side = isLeft ? 'WEST' : 'EAST';
      const loc = { x: isLeft ? 0 : 360, y: isLeft ? leftY : rightY };
      if (isLeft) leftY += PORT_STEP; else rightY += PORT_STEP;
      const label = count > 1 ? `${intf.name} (${count})` : intf.name;
      ports.push({ id: portId, width: 28, height: 24, x: loc.x, y: loc.y, properties: { 'org.eclipse.elk.port.side': side }, meta: { label, 'interface.color': interfaceColor(intf?.ifType ?? ''), 'internalKind': intf?.ifType ?? 'hw_tcl' } });
    }

    const nodeWidth = 360; const nodeHeight = Math.max(120, Math.max(leftY, rightY) + 20);
    const node: ElkNode = { id: moduleName, labels: [{ text: displayName }], width: nodeWidth, height: nodeHeight, ports, properties: { 'org.eclipse.elk.portConstraints': 'FIXED_SIDE' }, meta: { kind: 'hw_tcl' } };
    const root: ElkNode = { id: 'root', children: [node], edges: [], properties: { 'org.eclipse.elk.direction': 'RIGHT' } };
    return root;
  } catch (err) {
    console.error('[parseHwTclToElk] error', err);
    return null;
  }
}

export default parseHwTclToElk;
