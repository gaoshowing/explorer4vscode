"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
const client_1 = require("react-dom/client");
require("./styles.css");
const vscode = acquireVsCodeApi();
function svgPath(kind) {
    if (kind === 'folder')
        return '<path d="M1.2 4.2h5l1.3-1.7h3.1l1.1 1.7h3.1v8.4H1.2z"/>';
    return '<path d="M3 1.5h6L13 5.5v9H3zM9 1.5v4h4"/><path d="M5 8h6M5 10.5h6M5 13h4" fill="none" stroke="currentColor" stroke-width="1.2"/>';
}
function iconKind(node) {
    if (node.isDirectory)
        return 'folder';
    const extension = node.name.split('.').pop()?.toLowerCase() ?? '';
    const iconTypes = {
        js: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', html: 'html', htm: 'html',
        css: 'css', scss: 'css', json: 'json', md: 'md', png: 'image',
        jpg: 'image', jpeg: 'image', svg: 'image', gif: 'image',
    };
    return iconTypes[extension] ?? 'file';
}
function Icon({ node }) {
    const kind = iconKind(node);
    return (<span className={'icon ' + kind} aria-hidden="true">
      <svg viewBox="0 0 16 16" dangerouslySetInnerHTML={{ __html: svgPath(kind) }}/>
    </span>);
}
function ToolbarIcon({ children }) {
    return <svg viewBox="0 0 16 16" dangerouslySetInnerHTML={{ __html: children }}/>;
}
function App() {
    const [nodes, setNodes] = (0, react_1.useState)({});
    const [roots, setRoots] = (0, react_1.useState)([]);
    const [selected, setSelected] = (0, react_1.useState)('');
    const [fontWeight, setFontWeight] = (0, react_1.useState)('500');
    const [menu, setMenu] = (0, react_1.useState)();
    (0, react_1.useEffect)(() => {
        const receive = (event) => {
            const message = event.data;
            if (message.type === 'fontWeight') {
                setFontWeight(message.fontWeight);
                return;
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
                setNodes(previous => {
                    const parent = previous[message.parent];
                    if (!parent)
                        return previous;
                    const next = { ...previous };
                    for (const child of message.children) {
                        next[child.uri] = { ...child, open: false, loaded: false, children: [] };
                    }
                    next[parent.uri] = { ...parent, loaded: true, children: message.children.map(child => child.uri) };
                    return next;
                });
            }
        };
        window.addEventListener('message', receive);
        vscode.postMessage({ command: 'ready' });
        return () => window.removeEventListener('message', receive);
    }, []);
    const rootStyle = (0, react_1.useMemo)(() => ({ '--resource-font-weight': fontWeight }), [fontWeight]);
    const toggleFolder = (node) => {
        setNodes(previous => ({ ...previous, [node.uri]: { ...node, open: !node.open } }));
        if (!node.open && !node.loaded)
            vscode.postMessage({ command: 'loadChildren', uri: node.uri });
    };
    const select = (node) => {
        setSelected(node.uri);
        if (node.isDirectory)
            toggleFolder(node);
    };
    const onContextMenu = (event, node) => {
        event.preventDefault();
        setSelected(node.uri);
        setMenu({ node, x: event.clientX, y: event.clientY });
    };
    const run = (command, uri) => {
        setMenu(undefined);
        vscode.postMessage({ command, uri });
    };
    const renderNode = (uri, depth) => {
        const node = nodes[uri];
        if (!node)
            return null;
        return (<div key={uri}>
        <div className={'row' + (selected === uri ? ' selected' : '')} style={{ paddingLeft: 8 + depth * 16 }} role="treeitem" tabIndex={0} onClick={() => select(node)} onDoubleClick={() => !node.isDirectory && run('open', node.uri)} onContextMenu={event => onContextMenu(event, node)}>
          <span className="caret">{node.isDirectory ? (node.open ? '⌄' : '›') : ''}</span>
          <Icon node={node}/>
          <span className="label">{node.name}</span>
        </div>
        {node.isDirectory && node.open && node.children.map(child => renderNode(child, depth + 1))}
      </div>);
    };
    const contextActions = menu?.node.isDirectory
        ? [['newFile', '新建文件'], ['newFolder', '新建文件夹']]
        : [['open', '打开']];
    if (menu && !menu.node.isWorkspaceRoot)
        contextActions?.push(['rename', '重命名'], ['delete', '删除']);
    return (<div className="project-root" style={rootStyle} onClick={() => menu && setMenu(undefined)}>
      <header className="toolbar" aria-label="PROJECT 工具栏">
        <button title="新建文件" onClick={() => run('newFile', selected || undefined)}>
          <ToolbarIcon>{'<path d="M3 1.5h6L13 5.5v9H3zM9 1.5v4h4"/>'}</ToolbarIcon>
        </button>
        <button title="新建文件夹" onClick={() => run('newFolder', selected || undefined)}>
          <ToolbarIcon>{'<path fill="currentColor" stroke="none" d="M1.2 4.2h5l1.3-1.7h3.1l1.1 1.7h3.1v8.4H1.2z"/>'}</ToolbarIcon>
        </button>
        <button title="刷新" onClick={() => run('refresh')}>
          <ToolbarIcon>{'<path d="M13 7a5 5 0 1 1-1.4-3.5M13 2.5v4H9"/>'}</ToolbarIcon>
        </button>
        <button title="全部折叠" onClick={() => setNodes(previous => Object.fromEntries(Object.entries(previous).map(([uri, node]) => [uri, node.isWorkspaceRoot ? node : { ...node, open: false }])))}>
          <ToolbarIcon>{'<path d="m3 10 5-5 5 5"/>'}</ToolbarIcon>
        </button>
      </header>
      <main className="tree" role="tree">
        {roots.length ? roots.map(uri => renderNode(uri, 0)) : <div className="empty">尚未打开文件夹。</div>}
      </main>
      {menu && (<div className="menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}>
          {contextActions?.map(([command, label]) => (<button key={command} onClick={() => run(command, menu.node.uri)}>{label}</button>))}
        </div>)}
    </div>);
}
(0, client_1.createRoot)(document.getElementById('root')).render(<App />);
//# sourceMappingURL=main.js.map