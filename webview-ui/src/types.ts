export type ResourceNode = {
  uri: string;
  name: string;
  isDirectory: boolean;
  isWorkspaceRoot: boolean;
  isJavaSourceRoot: boolean;
  isRustModuleDirectory: boolean;
  isRustCargoSourceRoot: boolean;
  isBuildTargetDirectory: boolean;
  isGitIgnored: boolean;
  open: boolean;
  loaded: boolean;
  children: string[];
};

export type IncomingMessage =
  | { type: 'roots'; roots: Omit<ResourceNode, 'open' | 'loaded' | 'children'>[]; fontWeight: string }
  | { type: 'children'; parent: string; children: Omit<ResourceNode, 'open' | 'loaded' | 'children'>[] }
  | { type: 'fontWeight'; fontWeight: string }
  | { type: 'languageRoots'; roots: string[]; rustCargoRoots: string[]; buildTargetDirectories: string[] };
