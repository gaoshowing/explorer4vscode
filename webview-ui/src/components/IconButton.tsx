import { ReactNode, useState } from 'react';

export function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return <button title={title} onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ width: 27, height: 27, border: 0, borderRadius: 3, cursor: 'pointer', color: 'var(--vscode-icon-foreground)', background: hovered ? 'var(--vscode-toolbar-hoverBackground)' : 'transparent', lineHeight: 1, display: 'grid', placeItems: 'center' }}>{children}</button>;
}
