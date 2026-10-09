import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import ignore = require('ignore');

type ResourceNode = {
  uri: string;
  name: string;
  isDirectory: boolean;
  isWorkspaceRoot: boolean;
  isJavaSourceRoot: boolean;
  isRustModuleDirectory: boolean;
  isRustCargoSourceRoot: boolean;
  isBuildTargetDirectory: boolean;
  isGitIgnored: boolean;
};

type Message = {
  command: 'ready' | 'loadChildren' | 'setContext' | 'open' | 'newFile' | 'newFolder' | 'rename' | 'delete' | 'refresh';
  uri?: string;
};

type CargoMetadata = {
  packages?: Array<{ targets?: Array<{ src_path?: string }> }>;
  target_directory?: string;
};

type RustCargoInfo = {
  sourceRoots: Set<string>;
  buildTargetDirectories: Set<string>;
};

type JavaSourceInfo = {
  sourceRoots: Set<string>;
  highlightedDirectories: Set<string>;
};

const execFileAsync = promisify(execFile);

class ProjectViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private isReady = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingFolders = new Set<string>();
  private languageSourceRoots = new Set<string>();
  private javaPackageSourceRoots = new Set<string>();
  private javaPackageDirectories = new Set<string>();
  private readonly javaPackageDirectoryCache = new Map<string, Promise<Set<string>>>();
  private projectDescriptorDirectories = new Set<string>();
  private projectDescriptorDirectoryCache: Promise<Set<string>> | undefined;
  private readonly rustModuleDirectoryCache = new Map<string, boolean>();
  private readonly gitignoreMatchers = new Map<string, Promise<ReturnType<typeof ignore>>>();
  private contextUri: vscode.Uri | undefined;
  private rustCargoSourceRoots = new Set<string>();
  private buildTargetDirectories = new Set<string>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private languageRootsTimer: ReturnType<typeof setTimeout> | undefined;
  private javaImportRetryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onCommand: (message: Message) => Promise<void>,
    private readonly output: vscode.OutputChannel,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      watcher,
      watcher.onDidCreate(uri => this.handleFileSystemChange(uri, true)),
      watcher.onDidDelete(uri => this.handleFileSystemChange(uri, true)),
      watcher.onDidChange(uri => {
        if (uri.path.split('/').pop() === '.gitignore') {
          this.gitignoreMatchers.clear();
          this.scheduleFolderRefresh(parentUri(uri));
        }
        if (isProjectModelFile(uri)) this.invalidateProjectDescriptorDirectories();
        this.handleJavaPackageChange(uri, false);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.gitignoreMatchers.clear();
        void this.sendRoots();
        void this.refreshLanguageSourceRoots();
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('customResourceExplorer.showHiddenFiles')) void this.sendRoots();
        if (event.affectsConfiguration('customResourceExplorer.fontWeight')) {
          this.post({
            type: 'fontWeight',
            fontWeight: vscode.workspace.getConfiguration('customResourceExplorer').get<string>('fontWeight', '400'),
          });
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.isReady = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = getWebviewHtml(view.webview, this.extensionUri);
    this.disposables.push(view.webview.onDidReceiveMessage(message => void this.receive(message as Message)));
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.languageRootsTimer) clearTimeout(this.languageRootsTimer);
    if (this.javaImportRetryTimer) clearTimeout(this.javaImportRetryTimer);
    this.disposables.forEach(disposable => disposable.dispose());
  }

  async sendRoots(): Promise<void> {
    const roots: ResourceNode[] = (vscode.workspace.workspaceFolders ?? []).map(folder => ({
      uri: folder.uri.toString(),
      name: folder.name,
      isDirectory: true,
      isWorkspaceRoot: true,
      isJavaSourceRoot: this.isJavaSourceRoot(folder.uri),
      isJavaPackageDirectory: this.isJavaPackageDirectory(folder.uri),
      isProjectDescriptorDirectory: this.isProjectDescriptorDirectory(folder.uri),
      isRustModuleDirectory: false,
      isRustCargoSourceRoot: this.isRustCargoSourceRoot(folder.uri),
      isBuildTargetDirectory: this.isBuildTargetDirectory(folder.uri),
      isGitIgnored: false,
    }));
    this.post({
      type: 'roots',
      roots,
      fontWeight: vscode.workspace.getConfiguration('customResourceExplorer').get<string>('fontWeight', '400'),
    });
  }

  async refreshFolder(uri: vscode.Uri): Promise<void> {
    await this.sendChildren(uri);
  }

  getContextUri(): vscode.Uri | undefined {
    return this.contextUri;
  }

  async refreshLanguageSourceRoots(): Promise<void> {
    const javaLanguageServerReady = await this.activateJavaTooling();
    const [javaLanguageServerInfo, javaConventionInfo, rustCargoInfo, javaBuildTargetDirectories, projectDescriptorDirectories] = await Promise.all([
      javaLanguageServerReady ? discoverJavaSourceRoots(this.output) : Promise.resolve(emptyJavaSourceInfo()),
      discoverJavaConventionRoots(this.output),
      discoverRustCargoInfo(this.output),
      discoverJavaBuildTargetDirectories(this.output),
      this.getProjectDescriptorDirectories(),
    ]);
    const javaRoots = new Set([
      ...javaLanguageServerInfo.highlightedDirectories,
      ...javaConventionInfo.highlightedDirectories,
    ]);
    const javaPackageSourceRoots = new Set([
      ...javaLanguageServerInfo.sourceRoots,
      ...javaConventionInfo.sourceRoots,
    ]);
    const javaPackageDirectories = await this.getJavaPackageDirectories(javaPackageSourceRoots);
    this.languageSourceRoots = javaRoots;
    this.javaPackageSourceRoots = javaPackageSourceRoots;
    this.javaPackageDirectories = javaPackageDirectories;
    this.projectDescriptorDirectories = projectDescriptorDirectories;
    this.rustCargoSourceRoots = rustCargoInfo.sourceRoots;
    this.buildTargetDirectories = new Set([...rustCargoInfo.buildTargetDirectories, ...javaBuildTargetDirectories]);
    this.output.appendLine(
      '[PROJECT] Identified ' + javaRoots.size + ' Java source, ' + javaPackageDirectories.size + ' Java package, ' + rustCargoInfo.sourceRoots.size + ' Cargo source, and ' + this.buildTargetDirectories.size + ' build target directorie(s).',
    );
    this.post({
      type: 'languageRoots',
      roots: [...javaRoots],
      javaPackageDirectories: [...javaPackageDirectories],
      projectDescriptorDirectories: [...projectDescriptorDirectories],
      rustCargoRoots: [...rustCargoInfo.sourceRoots],
      buildTargetDirectories: [...this.buildTargetDirectories],
    });
  }

  private async receive(message: Message): Promise<void> {
    if (message.command === 'ready') {
      this.isReady = true;
      await this.sendRoots();
      void this.refreshLanguageSourceRoots();
      this.scheduleLanguageRootsRefresh(3000);
      if (this.javaImportRetryTimer) clearTimeout(this.javaImportRetryTimer);
      this.javaImportRetryTimer = setTimeout(() => {
        this.javaImportRetryTimer = undefined;
        void this.refreshLanguageSourceRoots();
      }, 10000);
      return;
    }
    if (message.command === 'loadChildren' && message.uri) {
      const uri = getWorkspaceUri(message.uri);
      if (uri) await this.sendChildren(uri);
      return;
    }
    if (message.command === 'setContext') {
      this.contextUri = getWorkspaceUri(message.uri);
      return;
    }
    await this.onCommand(message);
  }

  private async sendChildren(uri: vscode.Uri): Promise<void> {
    try {
      const showHidden = vscode.workspace.getConfiguration('customResourceExplorer').get<boolean>('showHiddenFiles', true);
      const children: ResourceNode[] = (await Promise.all((await vscode.workspace.fs.readDirectory(uri))
        .filter(([name]) => name !== '.git' && (showHidden || !name.startsWith('.')))
        .map(async ([name, type]) => {
          const childUri = vscode.Uri.joinPath(uri, name);
          const isDirectory = type === vscode.FileType.Directory;
          const [isRustModuleDirectory, isGitIgnored] = await Promise.all([
            isDirectory ? this.isRustModuleDirectory(childUri) : false,
            this.isGitIgnored(childUri, isDirectory),
          ]);
          return {
            uri: childUri.toString(),
            name,
            isDirectory,
            isWorkspaceRoot: false,
            isJavaSourceRoot: this.isJavaSourceRoot(childUri),
            isJavaPackageDirectory: this.isJavaPackageDirectory(childUri),
            isProjectDescriptorDirectory: this.isProjectDescriptorDirectory(childUri),
            isRustModuleDirectory,
            isRustCargoSourceRoot: isDirectory && !isRustModuleDirectory && this.isRustCargoSourceRoot(childUri),
            isBuildTargetDirectory: isDirectory && this.isBuildTargetDirectory(childUri),
            isGitIgnored,
          };
        })))
        .sort((a, b) => a.isDirectory === b.isDirectory
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          : a.isDirectory ? -1 : 1);
      this.post({ type: 'children', parent: uri.toString(), children });
    } catch (error) {
      // A watched folder may be deleted (e.g. build cleanup) between the file event and the
      // debounced refresh; the parent refresh drops the stale node, so this needs no warning.
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return;
      void vscode.window.showWarningMessage('无法读取资源：' + errorMessage(error));
    }
  }

  private scheduleFolderRefresh(uri: vscode.Uri): void {
    if (!vscode.workspace.getWorkspaceFolder(uri)) return;
    this.pendingFolders.add(uri.toString());
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      const folders = [...this.pendingFolders]
        .map(value => getWorkspaceUri(value))
        .filter((folder): folder is vscode.Uri => Boolean(folder));
      this.pendingFolders.clear();
      void Promise.all(folders.map(folder => this.sendChildren(folder)));
    }, 150);
  }

  private handleFileSystemChange(uri: vscode.Uri, isCreateOrDelete = false): void {
    this.rustModuleDirectoryCache.clear();
    if (uri.path.split('/').pop() === '.gitignore') this.gitignoreMatchers.clear();
    this.scheduleFolderRefresh(parentUri(uri));
    if (isProjectModelFile(uri)) this.invalidateProjectDescriptorDirectories();
    this.handleJavaPackageChange(uri, isCreateOrDelete);
  }

  private scheduleLanguageRootsRefresh(delay = 800): void {
    if (this.languageRootsTimer) clearTimeout(this.languageRootsTimer);
    this.languageRootsTimer = setTimeout(() => void this.refreshLanguageSourceRoots(), delay);
  }

  private isJavaSourceRoot(uri: vscode.Uri): boolean {
    return this.languageSourceRoots.has(uriKey(uri));
  }

  private isJavaPackageDirectory(uri: vscode.Uri): boolean {
    return this.javaPackageDirectories.has(uriKey(uri));
  }

  private isProjectDescriptorDirectory(uri: vscode.Uri): boolean {
    return this.projectDescriptorDirectories.has(uriKey(uri));
  }

  private invalidateProjectDescriptorDirectories(): void {
    this.projectDescriptorDirectoryCache = undefined;
    this.scheduleLanguageRootsRefresh();
  }

  private getProjectDescriptorDirectories(): Promise<Set<string>> {
    this.projectDescriptorDirectoryCache ??= discoverProjectDescriptorDirectories(this.output);
    return this.projectDescriptorDirectoryCache;
  }

  private handleJavaPackageChange(uri: vscode.Uri, isCreateOrDelete: boolean): void {
    if (!isCreateOrDelete && !uri.path.endsWith('.java')) return;
    const root = [...this.javaPackageSourceRoots].find(value => isUriInside(uri, getWorkspaceUri(value)));
    if (!root) return;
    this.javaPackageDirectoryCache.delete(root);
    this.scheduleLanguageRootsRefresh(300);
  }

  private async getJavaPackageDirectories(sourceRoots: Set<string>): Promise<Set<string>> {
    for (const cachedRoot of this.javaPackageDirectoryCache.keys()) {
      if (!sourceRoots.has(cachedRoot)) this.javaPackageDirectoryCache.delete(cachedRoot);
    }
    const packages = await Promise.all([...sourceRoots].map(async sourceRoot => {
      let scan = this.javaPackageDirectoryCache.get(sourceRoot);
      if (!scan) {
        const uri = getWorkspaceUri(sourceRoot);
        scan = uri ? discoverJavaPackageDirectories(uri, this.output) : Promise.resolve(new Set<string>());
        this.javaPackageDirectoryCache.set(sourceRoot, scan);
      }
      return scan;
    }));
    return new Set(packages.flatMap(paths => [...paths]));
  }

  private async activateJavaTooling(): Promise<boolean> {
    const extensionIds = ['redhat.java', 'vscjava.vscode-maven', 'vscjava.vscode-gradle'];
    await Promise.all(extensionIds.map(async id => {
      try {
        await vscode.extensions.getExtension(id)?.activate();
      } catch (error) {
        this.output.appendLine('[Java] Could not activate ' + id + ': ' + errorMessage(error));
      }
    }));
    if (!await waitForCommand('java.project.listSourcePaths', 15000)) {
      this.output.appendLine('[Java] JDT LS commands are not registered yet; source-path query will retry automatically.');
      return false;
    }
    return true;
  }

  private isRustCargoSourceRoot(uri: vscode.Uri): boolean {
    return this.rustCargoSourceRoots.has(uriKey(uri));
  }

  private isBuildTargetDirectory(uri: vscode.Uri): boolean {
    return this.buildTargetDirectories.has(uriKey(uri));
  }

  private async isRustModuleDirectory(uri: vscode.Uri): Promise<boolean> {
    const key = uriKey(uri);
    const cached = this.rustModuleDirectoryCache.get(key);
    if (cached !== undefined) return cached;
    const name = uri.path.split('/').pop() ?? '';
    const candidates = [
      vscode.Uri.joinPath(uri, 'mod.rs'),
      vscode.Uri.joinPath(uri, 'lib.rs'),
      vscode.Uri.joinPath(uri, 'main.rs'),
      vscode.Uri.joinPath(parentUri(uri), name + '.rs'),
    ];
    const found = await Promise.all(candidates.map(async candidate => {
      try {
        const stat = await vscode.workspace.fs.stat(candidate);
        return stat.type === vscode.FileType.File;
      } catch {
        return false;
      }
    }));
    const isModuleDirectory = found.some(Boolean);
    this.rustModuleDirectoryCache.set(key, isModuleDirectory);
    return isModuleDirectory;
  }

  private async isGitIgnored(uri: vscode.Uri, isDirectory: boolean): Promise<boolean> {
    const workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspace) return false;
    const relativePath = workspaceRelativePath(workspace.uri, uri);
    if (!relativePath) return false;
    const matcher = await this.getGitignoreMatcher(workspace.uri);
    return matcher.ignores(isDirectory ? relativePath + '/' : relativePath);
  }

  private getGitignoreMatcher(workspaceRoot: vscode.Uri): Promise<ReturnType<typeof ignore>> {
    const key = uriKey(workspaceRoot);
    let matcher = this.gitignoreMatchers.get(key);
    if (!matcher) {
      matcher = this.loadGitignoreMatcher(workspaceRoot);
      this.gitignoreMatchers.set(key, matcher);
    }
    return matcher;
  }

  private async loadGitignoreMatcher(workspaceRoot: vscode.Uri): Promise<ReturnType<typeof ignore>> {
    const matcher = ignore();
    try {
      const rootGitignore = vscode.Uri.joinPath(workspaceRoot, '.gitignore');
      const nestedGitignores = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceRoot, '**/.gitignore'),
        '**/{.git,node_modules}/**',
      );
      const files = [rootGitignore, ...nestedGitignores]
        .filter((file, index, all) => all.findIndex(candidate => uriKey(candidate) === uriKey(file)) === index)
        .sort((a, b) => a.path.length - b.path.length);
      for (const file of files) {
        try {
          const contents = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8');
          const basePath = workspaceRelativePath(workspaceRoot, parentUri(file)) ?? '';
          matcher.add(contents.split(/\r?\n/).map(pattern => scopeGitignorePattern(pattern, basePath)));
        } catch {
          // A workspace may not have a root .gitignore, or it may disappear during refresh.
        }
      }
    } catch (error) {
      this.output.appendLine('[PROJECT] Could not load .gitignore rules: ' + errorMessage(error));
    }
    return matcher;
  }

  private post(message: unknown): void {
    if (this.isReady) void this.view?.webview.postMessage(message);
  }
}

function isProjectModelFile(uri: vscode.Uri): boolean {
  const name = uri.path.split('/').pop()?.toLowerCase() ?? '';
  return name.endsWith('.toml') || name.endsWith('.gradle') || name.endsWith('.gradle.kts') || name === 'pom.xml';
}

function uriKey(uri: vscode.Uri): string {
  const path = uri.path.length > 1 ? uri.path.replace(/\/+$/, '') : uri.path;
  return uri.with({ path }).toString();
}

function workspaceRelativePath(workspaceRoot: vscode.Uri, uri: vscode.Uri): string | undefined {
  const rootPath = workspaceRoot.path.replace(/\/+$/, '');
  const targetPath = uri.path.replace(/\/+$/, '');
  if (!targetPath.startsWith(rootPath + '/')) return undefined;
  return targetPath.slice(rootPath.length + 1);
}

function isUriInside(uri: vscode.Uri, parent: vscode.Uri | undefined): boolean {
  if (!parent || uri.scheme !== parent.scheme) return false;
  const parentPath = parent.path.replace(/\/+$/, '');
  return uri.path === parentPath || uri.path.startsWith(parentPath + '/');
}

function scopeGitignorePattern(pattern: string, basePath: string): string {
  if (!basePath || !pattern || pattern.startsWith('#') || pattern.startsWith('\\#') || pattern.startsWith('\\!')) {
    return pattern;
  }
  const negated = pattern.startsWith('!');
  const source = (negated ? pattern.slice(1) : pattern).replace(/^\//, '');
  const hasPathSeparator = source.replace(/\/$/, '').includes('/');
  const scoped = hasPathSeparator ? basePath + '/' + source : basePath + '/**/' + source;
  return (negated ? '!' : '') + scoped;
}

function emptyJavaSourceInfo(): JavaSourceInfo {
  return { sourceRoots: new Set<string>(), highlightedDirectories: new Set<string>() };
}

async function discoverJavaSourceRoots(output: vscode.OutputChannel): Promise<JavaSourceInfo> {
  const info = emptyJavaSourceInfo();
  await addJavaSourceRoots(info, output);
  return info;
}

async function discoverJavaConventionRoots(output: vscode.OutputChannel): Promise<JavaSourceInfo> {
  const info = emptyJavaSourceInfo();
  try {
    const buildFiles = await vscode.workspace.findFiles(
      '**/{pom.xml,build.gradle,build.gradle.kts}',
      '**/{.git,node_modules,target,build}/**',
      64,
    );
    for (const buildFile of buildFiles) {
      const sourceContainer = vscode.Uri.joinPath(parentUri(buildFile), 'src');
      const candidates = [
        vscode.Uri.joinPath(sourceContainer, 'main', 'java'),
        vscode.Uri.joinPath(sourceContainer, 'test', 'java'),
      ];
      const sourceSets = await Promise.all(candidates.map(uri => isDirectory(uri)));
      if (sourceSets.some(Boolean)) {
        info.highlightedDirectories.add(uriKey(sourceContainer));
        candidates.forEach((uri, index) => {
          if (sourceSets[index]) addJavaSourceRootWithContainers(info, uri);
        });
      }
    }
    output.appendLine('[Java] Standard Maven/Gradle layout added ' + info.highlightedDirectories.size + ' source directorie(s).');
  } catch (error) {
    output.appendLine('[Java] Standard source layout discovery unavailable: ' + errorMessage(error));
  }
  return info;
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

async function waitForCommand(command: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await vscode.commands.getCommands(true)).includes(command)) return true;
    await new Promise<void>(resolve => setTimeout(resolve, 400));
  }
  return (await vscode.commands.getCommands(true)).includes(command);
}

async function discoverRustCargoInfo(output: vscode.OutputChannel): Promise<RustCargoInfo> {
  const sourceRoots = new Set<string>();
  const buildTargetDirectories = new Set<string>();
  if (!vscode.workspace.isTrusted) {
    output.appendLine('[Rust] Skipped cargo metadata because the workspace is not trusted.');
    return { sourceRoots, buildTargetDirectories };
  }
  const manifests = await vscode.workspace.findFiles('**/Cargo.toml', '**/{.git,node_modules,target}/**', 32);
  output.appendLine('[Rust] Found ' + manifests.length + ' Cargo manifest(s).');
  for (const manifest of manifests) {
    if (manifest.scheme !== 'file') continue;
    try {
      const { stdout } = await execFileAsync(
        'cargo',
        ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest.fsPath],
        { timeout: 6000, maxBuffer: 1024 * 1024 },
      );
      const metadata = JSON.parse(stdout) as CargoMetadata;
      let targets = 0;
      for (const target of metadata.packages?.flatMap(entry => entry.targets ?? []) ?? []) {
        if (target.src_path) {
          sourceRoots.add(uriKey(vscode.Uri.file(dirname(target.src_path))));
          targets += 1;
        }
      }
      if (metadata.target_directory) buildTargetDirectories.add(uriKey(vscode.Uri.file(metadata.target_directory)));
      output.appendLine('[Rust] ' + manifest.fsPath + ': ' + targets + ' target source path(s).');
    } catch (error) {
      output.appendLine('[Rust] Failed to inspect ' + manifest.fsPath + ': ' + errorMessage(error));
    }
  }
  return { sourceRoots, buildTargetDirectories };
}

async function discoverJavaBuildTargetDirectories(output: vscode.OutputChannel): Promise<Set<string>> {
  const roots = new Set<string>();
  const exclude = '**/{.git,node_modules,target,build}/**';
  try {
    const [gradleFiles, mavenFiles] = await Promise.all([
      vscode.workspace.findFiles('**/{build.gradle,build.gradle.kts}', exclude, 64),
      vscode.workspace.findFiles('**/pom.xml', exclude, 64),
    ]);
    gradleFiles.forEach(file => roots.add(uriKey(vscode.Uri.joinPath(parentUri(file), 'build'))));
    mavenFiles.forEach(file => roots.add(uriKey(vscode.Uri.joinPath(parentUri(file), 'target'))));
    output.appendLine('[Java] Found ' + gradleFiles.length + ' Gradle and ' + mavenFiles.length + ' Maven build target(s).');
  } catch (error) {
    output.appendLine('[Java] Build target discovery unavailable: ' + errorMessage(error));
  }
  return roots;
}

async function addJavaSourceRoots(info: JavaSourceInfo, output: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.extensions.getExtension('redhat.java')?.activate();
    const listedPaths = toUris(await vscode.commands.executeCommand<unknown>('java.project.listSourcePaths'));
    for (const uri of listedPaths) addJavaSourceRootWithContainers(info, uri);
    output.appendLine('[Java] listSourcePaths returned ' + listedPaths.length + ' source path(s).');
    output.appendLine('[Java] listSourcePaths: ' + formatUris(listedPaths));

    // Some JDT LS versions return no result for listSourcePaths until project import
    // finishes. Query every imported Java project directly as a reliable fallback.
    const projectUris = toUris(await vscode.commands.executeCommand<unknown>('java.project.getAll'));
    output.appendLine('[Java] getAll projects: ' + formatUris(projectUris));
    let settingsPaths = 0;
    for (const projectUri of projectUris) {
      const settings = await vscode.commands.executeCommand<unknown>(
        'java.project.getSettings',
        projectUri.toString(),
        ['org.eclipse.jdt.ls.core.sourcePaths'],
      );
      const sourcePaths = toUris(javaSettingValue(settings, 'org.eclipse.jdt.ls.core.sourcePaths'));
      for (const uri of sourcePaths) addJavaSourceRootWithContainers(info, uri);
      settingsPaths += sourcePaths.length;
      output.appendLine('[Java] getSettings ' + uriDisplay(projectUri) + ': ' + formatUris(sourcePaths));
    }
    output.appendLine('[Java] getSettings returned ' + settingsPaths + ' source path(s) across ' + projectUris.length + ' project(s).');
  } catch (error) {
    output.appendLine('[Java] Source paths unavailable: ' + errorMessage(error));
  }
}

function javaSettingValue(value: unknown, key: string): unknown {
  if (value && typeof value === 'object' && key in value) return (value as Record<string, unknown>)[key];
  return undefined;
}

function formatUris(uris: vscode.Uri[]): string {
  return uris.length ? uris.map(uriDisplay).join(', ') : '(empty)';
}

function uriDisplay(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

function addJavaSourceRootWithContainers(info: JavaSourceInfo, uri: vscode.Uri): void {
  info.sourceRoots.add(uriKey(uri));
  info.highlightedDirectories.add(uriKey(uri));
  const segments = uri.path.split('/');
  const srcIndex = segments.lastIndexOf('src');
  if (srcIndex < 0 || srcIndex + 2 >= segments.length) return;
  const sourceLanguage = segments[srcIndex + 2];
  if (!['java', 'resources', 'kotlin', 'groovy'].includes(sourceLanguage)) return;
  info.highlightedDirectories.add(uriKey(uri.with({ path: segments.slice(0, srcIndex + 1).join('/') || '/' })));
  info.highlightedDirectories.add(uriKey(uri.with({ path: segments.slice(0, srcIndex + 2).join('/') })));
}

async function discoverJavaPackageDirectories(sourceRoot: vscode.Uri, output: vscode.OutputChannel): Promise<Set<string>> {
  const packages = new Set<string>();
  try {
    const javaFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(sourceRoot, '**/*.java'),
      '**/{.git,node_modules,target,build}/**',
    );
    for (const javaFile of javaFiles) {
      let directory = parentUri(javaFile);
      while (isUriInside(directory, sourceRoot) && uriKey(directory) !== uriKey(sourceRoot)) {
        packages.add(uriKey(directory));
        directory = parentUri(directory);
      }
    }
    output.appendLine('[Java] Scanned ' + javaFiles.length + ' Java file(s) under ' + uriDisplay(sourceRoot) + '; found ' + packages.size + ' package directorie(s).');
  } catch (error) {
    output.appendLine('[Java] Package scan unavailable for ' + uriDisplay(sourceRoot) + ': ' + errorMessage(error));
  }
  return packages;
}

async function discoverProjectDescriptorDirectories(output: vscode.OutputChannel): Promise<Set<string>> {
  const directories = new Set<string>();
  try {
    const descriptors = await vscode.workspace.findFiles(
      '**/*.{toml,gradle,gradle.kts}',
      '**/{.git,node_modules,target,build}/**',
    );
    descriptors.forEach(file => directories.add(uriKey(parentUri(file))));
    output.appendLine('[PROJECT] Found ' + directories.size + ' directory/directories containing TOML or Gradle descriptor file(s).');
  } catch (error) {
    output.appendLine('[PROJECT] Descriptor directory scan unavailable: ' + errorMessage(error));
  }
  return directories;
}

function toUris(value: unknown): vscode.Uri[] {
  if (Array.isArray(value)) return value.flatMap(toUris);
  if (value instanceof vscode.Uri) return [value];
  if (typeof value === 'string') {
    try {
      const uri = vscode.Uri.parse(value);
      return uri.scheme ? [uri] : [vscode.Uri.file(value)];
    } catch {
      return [vscode.Uri.file(value)];
    }
  }
  if (value && typeof value === 'object' && 'uri' in value) {
    return toUris((value as { uri: unknown }).uri);
  }
  return [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getWorkspaceUri(value?: string): vscode.Uri | undefined {
  if (!value) return undefined;
  try {
    const uri = vscode.Uri.parse(value);
    return vscode.workspace.getWorkspaceFolder(uri) ? uri : undefined;
  } catch {
    return undefined;
  }
}

function parentUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf('/')) || '/' });
}

function isRoot(uri: vscode.Uri): boolean {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === uri.toString();
}

function validName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

async function askForName(kind: string, value = ''): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: value ? '重命名' + kind : '新建' + kind,
    value,
    validateInput: input => validName(input.trim()) ? undefined : '名称不能为空、不能包含路径分隔符，且不能为 . 或 ..。',
  });
}

export function activate(context: vscode.ExtensionContext): void {
  let provider: ProjectViewProvider;
  const output = vscode.window.createOutputChannel('PROJECT Language Roots');

  const createResource = async (kind: 'file' | 'folder', folderValue?: string) => {
    let folder = getWorkspaceUri(folderValue) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (folder) {
      try {
        const stat = await vscode.workspace.fs.stat(folder);
        if (stat.type !== vscode.FileType.Directory) folder = parentUri(folder);
      } catch {
        folder = undefined;
      }
    }
    if (!folder) {
      void vscode.window.showInformationMessage('请先打开一个工作区文件夹。');
      return;
    }
    const name = await askForName(kind === 'file' ? '文件' : '文件夹');
    if (!name) return;
    const target = vscode.Uri.joinPath(folder, name.trim());
    try {
      if (kind === 'file') {
        try {
          await vscode.workspace.fs.stat(target);
          void vscode.window.showErrorMessage('同名资源已存在。');
          return;
        } catch (error) {
          if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
        }
        await vscode.workspace.fs.writeFile(target, new Uint8Array());
        await vscode.window.showTextDocument(target, { preview: false });
      } else {
        await vscode.workspace.fs.createDirectory(target);
      }
      await provider.refreshFolder(folder);
    } catch (error) {
      void vscode.window.showErrorMessage('无法新建资源：' + errorMessage(error));
    }
  };

  const execute = async (message: Message) => {
    const uri = getWorkspaceUri(message.uri);
    if (message.command === 'refresh') {
      await provider.sendRoots();
      void provider.refreshLanguageSourceRoots();
      return;
    }
    if (message.command === 'newFile') return createResource('file', message.uri);
    if (message.command === 'newFolder') return createResource('folder', message.uri);
    if (!uri) return;
    if (message.command === 'open') {
      await vscode.window.showTextDocument(uri, { preview: false });
      return;
    }
    if (isRoot(uri)) return;

    if (message.command === 'rename') {
      const oldName = uri.path.split('/').pop() ?? '';
      const name = await askForName('资源', oldName);
      if (!name || name === oldName) return;
      try {
        await vscode.workspace.fs.rename(uri, vscode.Uri.joinPath(parentUri(uri), name.trim()), { overwrite: false });
        await provider.refreshFolder(parentUri(uri));
      } catch (error) {
        void vscode.window.showErrorMessage('无法重命名资源：' + errorMessage(error));
      }
    }

    if (message.command === 'delete') {
      const action = await vscode.window.showWarningMessage(
        '确定要删除“' + (uri.path.split('/').pop() ?? '') + '”吗？',
        { modal: true, detail: '资源将被移至回收站（若文件系统支持）。' },
        '删除',
      );
      if (action !== '删除') return;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        await vscode.workspace.fs.delete(uri, { recursive: stat.type === vscode.FileType.Directory, useTrash: true });
        await provider.refreshFolder(parentUri(uri));
      } catch (error) {
        void vscode.window.showErrorMessage('无法删除资源：' + errorMessage(error));
      }
    }
  };

  provider = new ProjectViewProvider(context.extensionUri, execute, output);
  context.subscriptions.push(
    provider,
    output,
    vscode.window.registerWebviewViewProvider('customResourceExplorer', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('customResourceExplorer.refresh', () => provider.sendRoots()),
    vscode.commands.registerCommand('customResourceExplorer.newFile', () => createResource('file')),
    vscode.commands.registerCommand('customResourceExplorer.newFolder', () => createResource('folder')),
    vscode.commands.registerCommand('customResourceExplorer.newFileContext', () => createResource('file', provider.getContextUri()?.toString())),
    vscode.commands.registerCommand('customResourceExplorer.newFolderContext', () => createResource('folder', provider.getContextUri()?.toString())),
    vscode.commands.registerCommand('customResourceExplorer.openContext', () => execute({ command: 'open', uri: provider.getContextUri()?.toString() })),
    vscode.commands.registerCommand('customResourceExplorer.renameContext', () => execute({ command: 'rename', uri: provider.getContextUri()?.toString() })),
    vscode.commands.registerCommand('customResourceExplorer.deleteContext', () => execute({ command: 'delete', uri: provider.getContextUri()?.toString() })),
    vscode.commands.registerCommand('customResourceExplorer.refreshLanguageRoots', () => provider.refreshLanguageSourceRoots()),
    vscode.commands.registerCommand('customResourceExplorer.showLanguageRootLog', () => output.show(true)),
  );
}

export function deactivate(): void {}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const resourceVersion = String(Date.now());
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js')).with({ query: 'v=' + resourceVersion });
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css')).with({ query: 'v=' + resourceVersion });
  const nonce = resourceVersion;
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' + webview.cspSource + '; font-src ' + webview.cspSource + '; script-src \'nonce-' + nonce + '\';">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="' + styleUri + '">',
    '</head><body><div id="root"></div><script nonce="' + nonce + '" src="' + scriptUri + '"></script></body></html>',
  ].join('\n');
}
