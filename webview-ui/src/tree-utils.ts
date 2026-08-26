import { ResourceNode } from './types';

export const solidFolderColor = '#c8c8c8';
export const highlightedFolderColor = '#a9a9a9';
export const buildTargetBorderColor = 'var(--vscode-terminal-ansiBrightYellow, #d7ba7d)';
export const buildTargetFillColor = '#f5e7bf';

export const iconColors: Record<string, string> = {
  js: '#f7df1e',
  ts: '#3178c6',
  html: '#e44d26',
  css: '#42a5f5',
  json: '#c2a568',
  md: '#61aeee',
  rust: '#dea584',
  java: '#e76f00',
  gradle: '#23a6b6',
  yaml: '#cb171e',
  image: '#c586c0',
};

export function iconKind(node: ResourceNode): string {
  if (node.isDirectory) return 'folder';
  const extension = node.name.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    js: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', html: 'html', htm: 'html', css: 'css', scss: 'css',
    json: 'json', md: 'md', rs: 'rust', java: 'java', gradle: 'gradle', kts: 'gradle', yaml: 'yaml', yml: 'yaml', png: 'image', jpg: 'image', jpeg: 'image', svg: 'image', gif: 'image',
  };
  return types[extension] ?? 'file';
}

export function isLanguageSourceRoot(node: ResourceNode): boolean {
  return node.isJavaSourceRoot || node.isRustModuleDirectory || node.isRustCargoSourceRoot;
}
