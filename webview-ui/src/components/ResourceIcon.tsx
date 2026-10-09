import { cloneElement } from 'react';
import { FaCss3Alt } from 'react-icons/fa';
import { FaFolder } from 'react-icons/fa6';
import { PiCoffeeDuotone } from 'react-icons/pi';
import { SiGradle, SiHtml5, SiJavascript, SiJson, SiMarkdown, SiRust, SiTypescript } from 'react-icons/si';
import { MdOutlineSettingsEthernet } from 'react-icons/md';
import { VscFile, VscFileMedia } from 'react-icons/vsc';
import { ResourceNode } from '../types';
import { buildTargetBorderColor, buildTargetFillColor, highlightedFolderColor, highlightedFolderOutlineColor, iconColors, iconKind, isHighlightedDirectory, solidFolderColor, solidFolderOutlineColor } from '../tree-utils';

export function ResourceIcon({ node, muted, buildTarget = false }: { node: ResourceNode; muted: boolean; buildTarget?: boolean }) {
  const kind = iconKind(node);
  const isHighlightedFolder = node.isDirectory && isHighlightedDirectory(node);
  let icon: JSX.Element;
  if (node.isDirectory) {
    icon = <FaFolder />;
  } else {
    const extension = node.name.split('.').pop()?.toLowerCase() ?? '';
    const icons: Record<string, JSX.Element> = {
      js: <SiJavascript />, jsx: <SiJavascript />, ts: <SiTypescript />, tsx: <SiTypescript />,
      html: <SiHtml5 />, htm: <SiHtml5 />, css: <FaCss3Alt />, scss: <FaCss3Alt />,
      json: <SiJson />, md: <SiMarkdown />, rs: <SiRust />, java: <PiCoffeeDuotone />,
      gradle: <SiGradle />, kts: <SiGradle />,
      yaml: <MdOutlineSettingsEthernet />, yml: <MdOutlineSettingsEthernet />,
      png: <VscFileMedia />, jpg: <VscFileMedia />, jpeg: <VscFileMedia />, svg: <VscFileMedia />, gif: <VscFileMedia />,
    };
    icon = icons[extension] ?? <VscFile />;
  }
  const renderedIcon = node.isDirectory && (!node.isGitIgnored || buildTarget)
    ? cloneElement(icon, {
      style: {
        stroke: buildTarget ? buildTargetBorderColor : isHighlightedFolder ? highlightedFolderOutlineColor : solidFolderOutlineColor,
        strokeWidth: 42,
        strokeLinejoin: 'round',
        paintOrder: 'fill stroke',
        overflow: 'visible',
      },
    })
    : icon;
  return (
    <span aria-hidden="true" style={{ width: 17, height: 17, flex: '0 0 17px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: kind === 'folder' ? buildTarget ? buildTargetFillColor : isHighlightedFolder ? highlightedFolderColor : solidFolderColor : muted ? 'currentColor' : iconColors[kind] ?? 'var(--vscode-icon-foreground)' }}>
      {renderedIcon}
    </span>
  );
}
