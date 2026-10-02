import type { Condition, FilterNode, Group } from '@/types/filters';

/** Immutable edits on a filter expression tree (used by the custom builder). */

let seq = 0;
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export function emptyGroup(combinator: Group['combinator'] = 'AND'): Group {
  return { kind: 'group', id: newId('g'), combinator, children: [] };
}

export function defaultCondition(): Condition {
  return { kind: 'condition', id: newId('c'), field: 'roe', op: 'gt', value: 15 };
}

export function mapNode(
  root: Group,
  id: string,
  update: (node: FilterNode) => FilterNode | null,
): Group {
  const visit = (node: FilterNode): FilterNode | null => {
    if (node.id === id) return update(node);
    if (node.kind === 'condition') return node;
    let changed = false;
    const children: FilterNode[] = [];
    for (const child of node.children) {
      const next = visit(child);
      if (next !== child) changed = true;
      if (next) children.push(next);
    }
    return changed ? { ...node, children } : node;
  };
  const result = visit(root);
  return (result as Group | null) ?? emptyGroup(root.combinator);
}

export function removeNode(root: Group, id: string): Group {
  return mapNode(root, id, () => null);
}

export function appendChild(root: Group, groupId: string, child: FilterNode): Group {
  return mapNode(root, groupId, node =>
    node.kind === 'group' ? { ...node, children: [...node.children, child] } : node,
  );
}

export function depthOf(root: FilterNode, id: string, depth = 0): number {
  if (root.id === id) return depth;
  if (root.kind === 'condition') return -1;
  for (const child of root.children) {
    const d = depthOf(child, id, depth + 1);
    if (d >= 0) return d;
  }
  return -1;
}
