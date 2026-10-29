// 静态服务图：提供方、消费方、拓扑序、缺失与成环（docs/architecture/modules/00-plugin-kernel.md §5 第 1 阶段）
import type { ServiceGraph, ServiceKey } from '@liwa/contracts';

export interface GraphNode {
  id: string;
  service?: ServiceKey;
  consumes: readonly ServiceKey[];
}

export function buildServiceGraph(nodes: readonly GraphNode[]): ServiceGraph {
  const providers: Partial<Record<ServiceKey, string>> = {};
  const duplicates: string[] = [];
  for (const node of nodes) {
    if (!node.service) continue;
    const existing = providers[node.service];
    if (existing && existing !== node.id) duplicates.push(`${node.service}:${existing}+${node.id}`);
    else providers[node.service] = node.id;
  }
  const missing: ServiceGraph['missing'] = [];
  const edges = new Map<string, Set<string>>();
  for (const node of nodes) {
    const deps = new Set<string>();
    for (const key of node.consumes) {
      const provider = providers[key];
      if (!provider) missing.push({ service: key, wantedBy: node.id });
      else if (provider !== node.id) deps.add(provider);
    }
    edges.set(node.id, deps);
  }
  // 拓扑序（Kahn）：只对 required（提供服务的节点）排序，builtin 跟在后面按原顺序
  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node.id, 0);
  for (const [, deps] of edges) for (const d of deps) indegree.set(d, indegree.get(d) ?? 0);
  const dependents = new Map<string, string[]>();
  for (const [id, deps] of edges) {
    for (const d of deps) {
      dependents.set(d, [...(dependents.get(d) ?? []), id]);
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const left = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, left);
      if (left === 0) queue.push(dep);
    }
  }
  const cycles: string[][] = [];
  const inCycle = nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
  if (inCycle.length > 0) cycles.push(inCycle);
  if (duplicates.length > 0) cycles.push(duplicates.map((d) => `重复提供 ${d}`));
  return { providers, order, missing, cycles };
}
