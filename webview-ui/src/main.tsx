import { CSSProperties, MouseEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VscCollapseAll, VscNewFile, VscNewFolder, VscRefresh } from 'react-icons/vsc';
import { IconButton } from './components/IconButton';
import { TreeRow } from './components/TreeRow';
import { IncomingMessage, ResourceNode } from './types';
import './styles.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

function App() {
  const [nodes, setNodes] = useState<Record<string, ResourceNode>>({});
  const [roots, setRoots] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [fontWeight, setFontWeight] = useState('400');

  useEffect(() => {
    const receive = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      if (message.type === 'fontWeight') return setFontWeight(message.fontWeight);
      if (message.type === 'languageRoots') {
        const javaRoots = new Set(message.roots);
        const rustCargoRoots = new Set(message.rustCargoRoots);
        const buildTargetDirectories = new Set(message.buildTargetDirectories);
        return setNodes(previous => Object.fromEntries(Object.entries(previous).map(([uri, node]) => [uri, {
          ...node,
          isJavaSourceRoot: javaRoots.has(uri),
          isRustCargoSourceRoot: !node.isRustModuleDirectory && rustCargoRoots.has(uri),
          isBuildTargetDirectory: buildTargetDirectories.has(uri),
        }])));
      }
      if (message.type === 'roots') {
        const rootNodes = Object.fromEntries(message.roots.map(node => [node.uri, {
          ...node, open: true, loaded: false, children: [],
        }]));
        setNodes(rootNodes);
        setRoots(message.roots.map(node => node.uri));
        setFontWeight(message.fontWeight);
        message.roots.forEach(node => vscode.postMessage({ command: 'loadChildren', uri: node.uri }));
        return;
      }
      if (message.type === 'children') {
        const onlyChildDirectory = message.children.length === 1 && message.children[0].isDirectory;
        const compactChildUri = onlyChildDirectory ? message.children[0].uri : undefined;
        setNodes(previous => {
          const parent = previous[message.parent];
          if (!parent) return previous;
          const next = { ...previous };
          message.children.forEach(child => {
            next[child.uri] = {
              ...child,
              open: child.uri === compactChildUri,
              loaded: false,
              children: [],
            };
          });
          next[parent.uri] = { ...parent, loaded: true, children: message.children.map(child => child.uri) };
          return next;
        });
        if (compactChildUri) vscode.postMessage({ command: 'loadChildren', uri: compactChildUri });
      }
    };
    window.addEventListener('message', receive);
    vscode.postMessage({ command: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, []);

  const toggleFolder = (node: ResourceNode) => {
    setNodes(previous => ({ ...previous, [node.uri]: { ...node, open: !node.open } }));
    if (!node.open && !node.loaded) vscode.postMessage({ command: 'loadChildren', uri: node.uri });
  };
  const selectNode = (node: ResourceNode) => {
    setSelected(node.uri);
    if (node.isDirectory) toggleFolder(node);
  };
  const openNode = (node: ResourceNode) => vscode.postMessage({ command: 'open', uri: node.uri });
  const showMenu = (event: MouseEvent, node: ResourceNode) => {
    setSelected(node.uri);
    vscode.postMessage({ command: 'setContext', uri: node.uri });
  };
  const run = (command: string, uri?: string) => vscode.postMessage({ command, uri });
  const renderNode = (uri: string, depth: number): JSX.Element | null => {
    const node = nodes[uri];
    if (!node) return null;
    const compact = compactDirectoryChain(node, nodes);
    return (
      <div key={uri}>
        <TreeRow node={node} label={compact.label} depth={depth} selected={selected === uri} onSelect={selectNode} onOpen={openNode} onContextMenu={showMenu} />
        {node.isDirectory && node.open && compact.tail.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const singleRoot = roots.length === 1 ? nodes[roots[0]] : undefined;
  const rootStyle: CSSProperties = { width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', fontWeight };

  return (
    <div style={rootStyle}>
      <header aria-label="PROJECT 工具栏" style={{ height: 35, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, padding: 0, borderBottom: '1px solid var(--vscode-sideBarSectionHeader-border)' }}>
        {singleRoot && <TreeRow node={singleRoot} depth={0} root selected={selected === singleRoot.uri} onSelect={selectNode} onOpen={openNode} onContextMenu={showMenu} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton title="新建文件" onClick={() => run('newFile', selected || undefined)}><VscNewFile size={17} /></IconButton>
          <IconButton title="新建文件夹" onClick={() => run('newFolder', selected || undefined)}><VscNewFolder size={17} /></IconButton>
          <IconButton title="刷新" onClick={() => run('refresh')}><VscRefresh size={17} /></IconButton>
          <IconButton title="全部折叠" onClick={() => setNodes(previous => Object.fromEntries(Object.entries(previous).map(([uri, node]) => [uri, node.isWorkspaceRoot ? node : { ...node, open: false }])))}><VscCollapseAll size={17} /></IconButton>
        </div>
      </header>
      <main role="tree" style={{ height: 'calc(100vh - 35px)', overflow: 'auto', padding: 0 }}>
        {roots.length ? roots.map(uri => {
          const root = nodes[uri];
          return singleRoot?.uri === uri ? root.open ? root.children.map(child => renderNode(child, 0)) : null : renderNode(uri, 0);
        }) : <div style={{ padding: 18, color: 'var(--vscode-descriptionForeground)', fontWeight: 400 }}>尚未打开文件夹。</div>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

function compactDirectoryChain(first: ResourceNode, nodes: Record<string, ResourceNode>): { label: string; tail: ResourceNode } {
  let tail = first;
  const names = [first.name];
  while (tail.isDirectory && tail.loaded && tail.open && tail.children.length === 1) {
    const child = nodes[tail.children[0]];
    if (!child?.isDirectory) break;
    names.push(child.name);
    tail = child;
  }
  return { label: names.join('.'), tail };
}
