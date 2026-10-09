import { ResourceNode } from './types';

export const solidFolderColor = 'var(--project-folder-fill)';
export const solidFolderOutlineColor = 'var(--project-folder-outline)';
export const highlightedFolderColor = 'var(--project-source-folder-fill)';
export const highlightedFolderOutlineColor = 'var(--project-source-folder-outline)';
export const buildTargetBorderColor = 'var(--project-build-folder-outline)';
export const buildTargetFillColor = 'var(--project-build-folder-fill)';

export const iconColors: Record<string, string> = {
  js: 'var(--project-icon-js)',
  ts: 'var(--project-icon-ts)',
  html: 'var(--project-icon-html)',
  css: 'var(--project-icon-css)',
  json: 'var(--project-icon-json)',
  md: 'var(--project-icon-md)',
  rust: 'var(--project-icon-rust)',
  java: 'var(--project-icon-java)',
  gradle: 'var(--project-icon-gradle)',
  yaml: 'var(--project-icon-yaml)',
  image: 'var(--project-icon-image)',
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

export function isHighlightedDirectory(node: ResourceNode): boolean {
  return node.isJavaSourceRoot || node.isJavaPackageDirectory || node.isProjectDescriptorDirectory || node.isRustModuleDirectory || node.isRustCargoSourceRoot;
}
