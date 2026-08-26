import { useState } from 'react';
import { ContextMenuState } from '../types';

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: 'block', width: '100%', padding: '5px 12px', border: 0, cursor: 'pointer', color: hovered ? 'var(--vscode-menu-selectionForeground)' : 'var(--vscode-menu-foreground)', background: hovered ? 'var(--vscode-menu-selectionBackground)' : 'transparent', textAlign: 'left' }}>{label}</button>;
}

export function ContextMenu({ menu, actions, onRun }: { menu: ContextMenuState; actions: string[][]; onRun: (command: string) => void }) {
  return <div style={{ position: 'fixed', zIndex: 10, left: menu.x, top: menu.y, minWidth: 150, padding: '4px 0', background: 'var(--vscode-menu-background)', border: '1px solid var(--vscode-menu-border)', boxShadow: '0 2px 8px rgba(0, 0, 0, .36)' }} onClick={(event) => event.stopPropagation()}>{actions.map(([command, label]) => <MenuItem key={command} label={label} onClick={() => onRun(command)} />)}</div>;
}
