import { describe, expect, it } from 'vitest';
import { buildServiceGraph } from '../graph.js';

describe('静态服务图', () => {
  it('拓扑序、缺提供方、builtin 跟在后面', () => {
    const g = buildServiceGraph([
      { id: 'minds', service: 'minds', consumes: ['journal', 'brains'] },
      { id: 'brains', service: 'brains', consumes: ['procs'] },
      { id: 'journal', service: 'journal', consumes: [] },
      { id: 'procs', service: 'procs', consumes: [] },
      { id: 'brain-x', consumes: ['procs', 'memory'] },
    ]);
    expect(g.order.indexOf('journal')).toBeLessThan(g.order.indexOf('minds'));
    expect(g.order.indexOf('procs')).toBeLessThan(g.order.indexOf('brains'));
    expect(g.order.indexOf('brains')).toBeLessThan(g.order.indexOf('minds'));
    expect(g.missing).toEqual([{ service: 'memory', wantedBy: 'brain-x' }]);
    expect(g.cycles).toEqual([]);
  });
  it('成环与重复提供都点名', () => {
    const g = buildServiceGraph([
      { id: 'a', service: 'journal', consumes: ['guard'] },
      { id: 'b', service: 'guard', consumes: ['journal'] },
      { id: 'c', service: 'guard', consumes: [] },
    ]);
    expect(g.cycles.length).toBeGreaterThan(0);
    expect(g.cycles.flat().join(' ')).toMatch(/重复提供 guard/);
  });
});
