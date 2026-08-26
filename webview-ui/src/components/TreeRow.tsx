import { MouseEvent, useState } from 'react';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { ResourceNode } from '../types';
import { buildTargetBorderColor, isLanguageSourceRoot } from '../tree-utils';
import { ResourceIcon } from './ResourceIcon';

type Props = {
  node: ResourceNode;
  label?: string;
  depth: number;
  selected: boolean;
  root?: boolean;
  onSelect: (node: ResourceNode) => void;
  onOpen: (node: ResourceNode) => void;
  onContextMenu: (event: MouseEvent, node: ResourceNode) => void;
};

export function TreeRow({ node, label = node.name, depth, selected, root = false, onSelect, onOpen, onContextMenu }: Props) {
  const [hovered, setHovered] = useState(false);
  const buildTarget = node.isBuildTargetDirectory;
  const muted = node.isGitIgnored && !selected && !buildTarget;
  const highlighted = selected || hovered;
  const color = selected
    ? buildTarget ? buildTargetBorderColor : 'var(--vscode-list-activeSelectionForeground)'
    : muted ? 'var(--vscode-disabledForeground)'
    : buildTarget ? buildTargetBorderColor : undefined;
  const background = selected ? 'var(--vscode-list-activeSelectionBackground)' : hovered ? 'var(--vscode-list-hoverBackground)' : undefined;
  return (
    <div
      data-vscode-context={JSON.stringify({
        webviewSection: node.isDirectory ? 'projectDirectory' : 'projectFile',
        customResourceExplorerIsDirectory: node.isDirectory,
        customResourceExplorerIsWorkspaceRoot: node.isWorkspaceRoot,
      })}
      style={{ minWidth: 0, minHeight: root ? undefined : 22, height: root ? '100%' : undefined, flex: root ? 1 : undefined, display: 'flex', alignItems: 'center', gap: 4, paddingLeft: root ? 0 : depth === 0 ? 4 : depth * 14, paddingRight: root ? 0 : 0, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: isLanguageSourceRoot(node) ? 700 : undefined, color, background, borderRadius: highlighted ? 4 : undefined }}
      role="treeitem" tabIndex={0} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(node)} onDoubleClick={() => !node.isDirectory && onOpen(node)} onContextMenu={(event) => onContextMenu(event, node)}
    >
      <span aria-hidden="true" style={{ width: 15, flex: '0 0 15px', color: muted || buildTarget ? 'currentColor' : 'var(--vscode-icon-foreground)', fontWeight: 400, textAlign: 'center', lineHeight: 0 }}>
        {node.isDirectory && (node.open ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />)}
      </span>
      <ResourceIcon node={node} muted={muted || buildTarget} buildTarget={buildTarget} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  );
}
