/**
 * dsh-session-files — browser half.
 *
 * A read-only, single-session file pointer for the dsh web GUI. It registers a
 * "列出当前会话文件" item into the dsh-session-context-menu extension protocol
 * (so it appears on BOTH the session-row and workspace-row context menus), and
 * binds Alt+W as a stable shortcut. Invoking it opens a docked panel on the
 * RIGHT side of the main page (position:fixed, right edge) listing the current
 * session's cwd: folders + files of the FIRST level by default, drillable one
 * level at a time, sorted by file type (folders first, then files grouped by
 * extension category), each row carrying a colored SVG icon. Clicking a file
 * shows a read-only preview (line numbering, path bar, size). The panel never
 * auto-closes: clicking outside/backdrop does nothing — only Esc or the close
 * button hides it.
 *
 * Failure policy: every DOM / runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-files',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const inject = ['sessions', 'workspaces'];

    const NS = 'dsh-session-files';
    const EXTENSION_ID = 'session-files.list';
    const SHORTCUT_KEY = 'w';

    // ---------------- single-instance claim ----------------
    const MOUNTED = Symbol.for('dsh-session-files.mounted');
    function claim() {
      if (globalThis[MOUNTED]) return false;
      globalThis[MOUNTED] = true;
      return true;
    }

    // ---------------- language ----------------
    let zh = true;
    function syncLang() {
      zh = (document.documentElement.lang || '').toLowerCase().startsWith('zh');
    }
    function t(key) {
      const d = zh
        ? {
            action: '列出当前会话文件',
            panelTitle: '当前会话文件',
            empty: '当前会话没有可用的工作目录',
            loading: '正在加载目录…',
            error: '无法读取目录',
            emptyDir: '此目录为空',
            truncated: '条目过多，仅显示前 1000 项',
            close: '关闭',
            cwd: '工作目录',
            cwdCopy: '复制',
            copied: '已复制',
            copyFailed: '复制失败',
            openFailed: '打开失败',
            copyDirPath: '复制目录路径',
            copyDirName: '复制目录文件名',
            openDir: '在资源管理器中打开目录',
            copyFilePath: '复制文件路径',
            copyFileName: '复制文件名',
            openContainingDir: '在资源管理器中打开所在目录',
            viewerTitle: '文件内容',
            viewerClose: '关闭内容窗口',
            viewerHint: 'Shift+Esc 关闭内容窗口 · Esc 关闭全部',
          }
        : {
            action: 'List current session files',
            panelTitle: 'Current session files',
            empty: 'The current session has no usable working directory',
            loading: 'Loading directory…',
            error: 'Cannot read directory',
            emptyDir: 'This directory is empty',
            truncated: 'Too many entries; only the first 1000 shown',
            close: 'Close',
            cwd: 'Working directory',
            cwdCopy: 'Copy',
            copied: 'Copied',
            copyFailed: 'Copy failed',
            openFailed: 'Open failed',
            copyDirPath: 'Copy directory path',
            copyDirName: 'Copy directory name',
            openDir: 'Open directory in Explorer',
            copyFilePath: 'Copy file path',
            copyFileName: 'Copy file name',
            openContainingDir: 'Open containing directory',
            viewerTitle: 'File content',
            viewerClose: 'Close content window',
            viewerHint: 'Shift+Esc closes viewer · Esc closes all',
          };
      return d[key] || key;
    }

    // ---------------- file API (host half) ----------------
    async function apiList(path, signal) {
      const query = new URLSearchParams({ includeFiles: '1' });
      if (path !== undefined) query.set('path', path);
      const response = await fetch(`/session-files-api/list?${query.toString()}`, { signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data && data.message ? data.message : `HTTP ${response.status}`);
      return data;
    }
    async function apiRead(path) {
      const query = new URLSearchParams({ path });
      const response = await fetch(`/session-files-api/read?${query.toString()}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data && data.message ? data.message : `HTTP ${response.status}`);
      return data;
    }

    // ---------------- file-type vocabulary ----------------
    // Category rank (低 → 高) drives "sort by file type": folders first, then
    // files grouped by extension category, then by name within a group.
    const CATEGORY_RANK = {
      folder: 0,
      code: 10,
      config: 20,
      data: 30,
      doc: 40,
      image: 50,
      media: 60,
      archive: 70,
      binary: 80,
      other: 90,
    };
    const EXT_CATEGORY = {
      // code
      py: 'code', js: 'code', mjs: 'code', cjs: 'code', jsx: 'code', ts: 'code', tsx: 'code',
      vue: 'code', go: 'code', rs: 'code', c: 'code', h: 'code', cpp: 'code', cc: 'code',
      cxx: 'code', java: 'code', php: 'code', rb: 'code', swift: 'code', kt: 'code',
      // config
      json: 'config', yml: 'config', yaml: 'config', toml: 'config', ini: 'config',
      env: 'config', xml: 'config', html: 'config', htm: 'config', css: 'config',
      scss: 'config', less: 'config', sh: 'config', bash: 'config', zsh: 'config',
      ps1: 'config', bat: 'config', cmd: 'config', dockerfile: 'config',
      // data
      sql: 'data', csv: 'data', tsv: 'data', db: 'data', sqlite: 'data', parquet: 'data',
      // doc
      md: 'doc', markdown: 'doc', txt: 'doc', pdf: 'doc', docx: 'doc', doc: 'doc',
      xlsx: 'doc', xls: 'doc', pptx: 'doc', ppt: 'doc', rtf: 'doc',
      // image
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
      bmp: 'image', ico: 'image', svg: 'image', tiff: 'image',
      // media
      mp3: 'media', wav: 'media', ogg: 'media', flac: 'media', mp4: 'media',
      mov: 'media', mkv: 'media', avi: 'media', webm: 'media',
      // archive
      zip: 'archive', '7z': 'archive', rar: 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
      // binary
      exe: 'binary', dll: 'binary', bin: 'binary', iso: 'binary', class: 'binary', jar: 'binary',
    };
    const SPECIAL_FILE = {
      dockerfile: 'config', makefile: 'config', '.gitignore': 'config', '.gitattributes': 'config', '.env': 'config',
    };

    function categoryOf(entry) {
      if (entry.isDirectory) return 'folder';
      const lower = entry.name.toLowerCase();
      if (SPECIAL_FILE[lower] !== undefined) return SPECIAL_FILE[lower];
      const dot = lower.lastIndexOf('.');
      if (dot > 0) return EXT_CATEGORY[lower.slice(dot + 1)] || 'other';
      return 'other';
    }

    // ---------------- inline SVG icons ----------------
    const ICON = {
      folder: '<path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      folderOpen: '<path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18"/>',
      code: '<path d="M8 6 2 12l6 6M16 6l6 6-6 6"/>',
      braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
      db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
      doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3-3a2 2 0 0 0-3 0L6 21"/>',
      media: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>',
      archive: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M10 12v2M14 12v2M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/>',
      binary: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h2v2H9zM13 13h2v2h-2z"/>',
      other: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    };
    const CATEGORY_COLOR = {
      folder: '#4facfe',
      code: '#d19a66',
      config: '#9aa5b1',
      data: '#e0af68',
      doc: '#519aba',
      image: '#c678dd',
      media: '#e06c75',
      archive: '#cc9a3f',
      binary: '#7f7f7f',
      other: '#9aa5b1',
    };

    function iconSvg(category, open) {
      const color = CATEGORY_COLOR[category] || '#9aa5b1';
      const path = category === 'folder' && open ? ICON.folderOpen : ICON[category] || ICON.other;
      return (
        `<svg class="dsf-glyph" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${color}" ` +
        `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
      );
    }

    // ---------------- panel DOM ----------------
    const CSS = `
[data-dsf-panel] {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483640;
  width: min(460px, 42vw);
  min-width: 320px;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-2, #1e1e1e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  border-left: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0,0,0,0.4));
  font: 13px/20px system-ui, sans-serif;
  transform: translateX(100%);
  opacity: 0;
  transition: transform .18s ease, opacity .18s ease;
}
[data-dsf-panel].dsf-open { transform: translateX(0); opacity: 1; }
[data-dsf-panel][hidden] { display: none; }
/* Drag handle on the panel's left edge: resizes the file list width; the
   file-content viewer follows via ResizeObserver on [data-dsf-panel]. */
.dsf-resize {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 5;
  touch-action: none;
}
.dsf-resize:hover { background: rgba(255, 255, 255, 0.08); }

.dsf-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
}
.dsf-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  font-size: 12px;
  font-weight: 500;
}
.dsf-close {
  flex: none;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9aa5b1);
  cursor: pointer;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 16px;
  line-height: 1;
}
.dsf-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.3)); }

.dsf-cwd {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
  line-height: 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
}
.dsf-cwd-label { flex: none; color: var(--dsw-alias-label-tertiary, #8a9099); }
.dsf-cwd-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #c0c4cc);
  user-select: all;
  cursor: text;
}
.dsf-cwd-copy {
  flex: none;
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #c0c4cc);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.dsf-cwd-copy:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.3)); }

.dsf-body { flex: 1; min-height: 0; overflow: auto; padding: 6px; }

.dsf-status {
  padding: 10px 8px;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
  line-height: 18px;
}
.dsf-status[hidden] { display: none; }
.dsf-spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  margin-right: 8px;
  vertical-align: -2px;
  border: 2px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-top-color: var(--dsw-static-deepseek-500, #4d6bfe);
  border-radius: 50%;
  animation: dsf-spin .8s linear infinite;
}
@keyframes dsf-spin { to { transform: rotate(360deg); } }

.dsf-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.dsf-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.3)); }
.dsf-row.dsf-selected { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.4)); }
.dsf-row .dsf-glyph { flex: none; }
.dsf-row .dsf-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsf-row .dsf-size {
  flex: none;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
}
.dsf-row .dsf-chev {
  flex: none;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 10px;
  width: 12px;
  text-align: center;
}
.dsf-children { margin-left: 14px; border-left: 1px dashed var(--dsw-alias-border-l2, #3a3a3a); }
.dsf-filecount {
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
  padding: 4px 8px;
}

.dsf-preview {
  flex: none;
  border-top: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  padding: 7px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsf-preview[hidden] { display: none; }
.dsf-preview-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #c0c4cc);
  font-size: 12px;
  user-select: all;
  cursor: text;
}

/* Large file-content window (opened by clicking a file row). It fills the
   middle area between the left sidebar (session list) and the right-docked
   file panel — left/right/top/bottom are set inline by layoutViewer(). */
[data-dsf-viewer] {
  position: fixed;
  z-index: 2147483645;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-2, #1e1e1e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  border-left: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-right: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  box-shadow: var(--dsw-shadow-lv3, 0 18px 60px rgba(0,0,0,0.55));
  font: 13px/20px system-ui, sans-serif;
  overflow: hidden;
}
[data-dsf-viewer][hidden] { display: none; }
.dsf-viewer-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
}
.dsf-viewer-name {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #e6e6e6);
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsf-viewer-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
  user-select: all;
  cursor: text;
}
.dsf-viewer-size {
  flex: none;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
}
.dsf-viewer-close {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9aa5b1);
  cursor: pointer;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 16px;
  line-height: 1;
}
.dsf-viewer-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.3)); }
.dsf-viewer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dsf-viewer-gutter {
  flex: none;
  padding: 10px 10px;
  color: var(--dsw-alias-label-tertiary, #5a5a5a);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--dsw-alias-border-l2, #2c2c2c);
  min-width: 40px;
  background: var(--dsw-alias-bg-layer-1, #171717);
  white-space: pre;
}
.dsf-viewer-text {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  white-space: pre;
  color: var(--dsw-alias-label-secondary, #c0c4cc);
}
.dsf-viewer-hint {
  flex: none;
  padding: 6px 14px;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 11px;
  border-top: 1px solid var(--dsw-alias-border-l2, #2c2c2c);
}

/* Row right-click menu (copy path/name, open in Explorer). */
.dsf-menu {
  position: fixed;
  z-index: 2147483646;
  min-width: 170px;
  max-width: 260px;
  padding: 4px;
  background: var(--dsw-alias-bg-layer-2, #1e1e1e);
  color: var(--dsw-alias-label-primary, #e6e6e6);
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 7px;
  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,0.5));
  font: 13px/18px system-ui, sans-serif;
}
.dsf-menu[hidden] { display: none; }
.dsf-menu button {
  box-sizing: border-box;
  display: block;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  text-align: left;
  white-space: nowrap;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  font: inherit;
}
.dsf-menu button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.3)); }

.dsf-toast {
  position: fixed;
  z-index: 2147483647;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  padding: 7px 12px;
  border-radius: 7px;
  background: #222;
  color: #fff;
  font: 13px/18px system-ui, sans-serif;
  box-shadow: 0 6px 20px rgba(0,0,0,0.2);
}
`;

    function injectStyles() {
      if (document.querySelector(`style[data-plugin-css="${NS}"]`) !== null) return;
      const style = document.createElement('style');
      style.dataset.pluginCss = NS;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // ---------------- helpers ----------------
    function formatBytes(size) {
      if (typeof size !== 'number') return '';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ---------------- clipboard / explorer / toast helpers ----------------
    async function copyText(text) {
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
      }
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      if (!ok) throw new Error(t('copyFailed'));
    }

    async function openInExplorer(path) {
      const response = await fetch('/api/host.openPath', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method: 'host.openPath',
          payload: { path },
        }),
      });
      if (!response.ok) throw new Error(`${t('openFailed')}: HTTP ${response.status}`);
      const full = await response.json();
      if (!full.result?.ok) throw new Error(`${t('openFailed')}: ${full.result?.error?.message || '未知错误'}`);
    }

    function parentDir(path) {
      const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
      return idx > 0 ? path.slice(0, idx) : path;
    }

    function toast(message) {
      document.querySelector('.dsf-toast')?.remove();
      const node = document.createElement('div');
      node.className = 'dsf-toast';
      node.textContent = message;
      document.body.appendChild(node);
      setTimeout(() => node.remove(), 1600);
    }

    // Sort by file type: folders first, then files by category rank, then name.
    function sortEntries(entries) {
      return entries.sort((a, b) => {
        const ca = categoryOf(a);
        const cb = categoryOf(b);
        const ra = CATEGORY_RANK[ca] ?? 90;
        const rb = CATEGORY_RANK[cb] ?? 90;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
    }

    // ---------------- panel controller ----------------
    function createPanel(ctx) {
      const root = document.createElement('div');
      root.setAttribute('data-dsf-panel', '');
      root.hidden = true;
      root.innerHTML =
        `<div class="dsf-header">` +
          `<span class="dsf-title">${t('panelTitle')}</span>` +
          `<button type="button" class="dsf-close" aria-label="${t('close')}">×</button>` +
        `</div>` +
        `<div class="dsf-cwd" title="">` +
          `<span class="dsf-cwd-label">${t('cwd')}</span>` +
          `<span class="dsf-cwd-path"></span>` +
          `<button type="button" class="dsf-cwd-copy">${t('cwdCopy')}</button>` +
        `</div>` +
        `<div class="dsf-body"></div>` +
        `<div class="dsf-preview" hidden><span class="dsf-preview-path"></span></div>` +
        `<div class="dsf-resize" data-dsf-resize aria-hidden="true"></div>`;
      document.body.appendChild(root);

      const bodyEl = root.querySelector('.dsf-body');
      const cwdPathEl = root.querySelector('.dsf-cwd-path');
      const cwdCopyBtn = root.querySelector('.dsf-cwd-copy');
      const closeBtn = root.querySelector('.dsf-close');
      const previewEl = root.querySelector('.dsf-preview');
      const previewPathEl = root.querySelector('.dsf-preview-path');
      const resizeHandle = root.querySelector('.dsf-resize');

      // Drag the left-edge handle to resize the file panel. The viewer follows
      // automatically via the ResizeObserver on root.
      let resizeState = null;
      function onResizePointerDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        resizeState = { startX: e.clientX, startW: root.getBoundingClientRect().width };
        const onMove = (ev) => {
          if (!resizeState) return;
          const w = Math.min(Math.max(resizeState.startW + (resizeState.startX - ev.clientX), 320), innerWidth * 0.85);
          root.style.width = `${w}px`;
        };
        const onUp = () => {
          resizeState = null;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
      resizeHandle.addEventListener('pointerdown', onResizePointerDown);

      // Row right-click menu. Lives OUTSIDE the panel: the panel has a
      // transform, which would otherwise become the fixed-position containing
      // block and break viewport clamping.
      const menu = document.createElement('div');
      menu.className = 'dsf-menu';
      menu.hidden = true;
      menu.innerHTML = `<button type="button"></button><button type="button"></button><button type="button"></button>`;
      document.body.appendChild(menu);
      const menuButtons = [...menu.querySelectorAll('button')];

      // Large file-content viewer (outside the panel for the same reason).
      const viewer = document.createElement('div');
      viewer.setAttribute('data-dsf-viewer', '');
      viewer.hidden = true;
      viewer.innerHTML =
        `<div class="dsf-viewer-head">` +
          `<span class="dsf-viewer-name"></span>` +
          `<span class="dsf-viewer-path"></span>` +
          `<span class="dsf-viewer-size"></span>` +
          `<button type="button" class="dsf-viewer-close" aria-label="${t('viewerClose')}">×</button>` +
        `</div>` +
        `<div class="dsf-viewer-body"><div class="dsf-viewer-gutter"></div><div class="dsf-viewer-text"></div></div>` +
        `<div class="dsf-viewer-hint">${t('viewerHint')}</div>`;
      document.body.appendChild(viewer);
      const viewerNameEl = viewer.querySelector('.dsf-viewer-name');
      const viewerPathEl = viewer.querySelector('.dsf-viewer-path');
      const viewerSizeEl = viewer.querySelector('.dsf-viewer-size');
      const viewerCloseBtn = viewer.querySelector('.dsf-viewer-close');
      const viewerGutterEl = viewer.querySelector('.dsf-viewer-gutter');
      const viewerTextEl = viewer.querySelector('.dsf-viewer-text');

      // Expanded directories (lazy-loaded once), keyed by path.
      const expanded = new Map();
      // In-flight / cached first-level listings per directory path.
      const cache = new Map();
      let rootPath = '';
      let activeFile = null;
      let menuEntry = null;

      // Keep cancellable per-directory loads.
      const controllers = new Map();

      let viewerResizeBound = false;
      let viewerObserver = null;

      // Fill the middle area: from the right edge of the left sidebar (the
      // session list — the conversation scroll starts right after it) to the
      // left edge of the right-docked file panel (or the window edge when the
      // panel is hidden), full height.
      function layoutViewer() {
        const scroll = document.querySelector('[data-conversation-scroll]');
        const left = scroll ? scroll.getBoundingClientRect().left : 56;
        const panelRect = root.hidden ? null : root.getBoundingClientRect();
        const right = panelRect && panelRect.width > 0 ? panelRect.left : innerWidth;
        viewer.style.left = `${Math.max(0, left)}px`;
        viewer.style.right = `${Math.max(0, innerWidth - right)}px`;
        viewer.style.top = '0';
        viewer.style.bottom = '0';
      }
      const onViewerResize = () => { if (!viewer.hidden) layoutViewer(); };

      function closeViewer() {
        viewer.hidden = true;
        activeFile = null;
        if (viewerObserver) viewerObserver.disconnect();
        if (viewerResizeBound) {
          window.removeEventListener('resize', onViewerResize);
          viewerResizeBound = false;
        }
      }

      function hideMenu() {
        menu.hidden = true;
        menuEntry = null;
      }

      function setOpen(next) {
        root.hidden = !next;
        root.classList.toggle('dsf-open', next);
        if (!next) {
          closeViewer();
          hideMenu();
          previewEl.hidden = true;
          activeFile = null;
        }
      }

      function renderList(container, listing) {
        container.replaceChildren();
        const entries = listing.entries || [];
        if (entries.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'dsf-status';
          empty.textContent = t('emptyDir');
          container.appendChild(empty);
          return;
        }
        for (const entry of sortEntries(entries.slice())) {
          container.appendChild(renderRow(entry));
        }
        if (listing.truncated === true) {
          const more = document.createElement('div');
          more.className = 'dsf-status';
          more.textContent = t('truncated');
          container.appendChild(more);
        }
      }

      async function loadDir(path, container) {
        const existing = cache.get(path);
        const status = document.createElement('div');
        status.className = 'dsf-status';
        status.innerHTML = `<span class="dsf-spinner"></span>${escapeHtml(t('loading'))}`;
        container.appendChild(status);

        try {
          const controller = new AbortController();
          controllers.set(path, controller);
          const listing = existing || await apiList(path, controller.signal);
          if (existing === undefined) cache.set(path, listing);
          controllers.delete(path);

          status.remove();
          renderList(container, listing);
        } catch (error) {
          status.remove();
          const err = document.createElement('div');
          err.className = 'dsf-status';
          err.textContent = `${t('error')}: ${error && error.message ? error.message : String(error)}`;
          container.appendChild(err);
        }
      }

      function renderRow(entry) {
        // A wrapper node holds the row plus (for directories) a children slot.
        const wrapper = document.createElement('div');
        wrapper.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          showRowMenu(entry, event.clientX, event.clientY);
        });
        const category = categoryOf(entry);
        if (entry.isDirectory) {
          const noWrapRow = document.createElement('div');
          noWrapRow.className = 'dsf-row';
          noWrapRow.innerHTML =
            `<span class="dsf-chev">${expanded.has(entry.path) ? '▾' : '▸'}</span>` +
            iconSvg('folder', expanded.has(entry.path)) +
            `<span class="dsf-name">${escapeHtml(entry.name)}</span>`;
          const children = document.createElement('div');
          children.className = 'dsf-children';
          children.hidden = !expanded.has(entry.path);

          noWrapRow.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (expanded.has(entry.path)) {
              expanded.delete(entry.path);
              noWrapRow.querySelector('.dsf-chev').textContent = '▸';
              noWrapRow.querySelector('.dsf-glyph').outerHTML = iconSvg('folder', false);
              children.hidden = true;
              return;
            }
            expanded.set(entry.path, true);
            noWrapRow.querySelector('.dsf-chev').textContent = '▾';
            noWrapRow.querySelector('.dsf-glyph').outerHTML = iconSvg('folder', true);
            children.hidden = false;
            if (!cache.has(entry.path)) {
              await loadDir(entry.path, children);
            } else {
              renderList(children, cache.get(entry.path));
            }
          });

          wrapper.appendChild(noWrapRow);
          wrapper.appendChild(children);
          return wrapper;
        }
        // file
        const row = document.createElement('div');
        row.className = 'dsf-row';
        row.innerHTML =
          iconSvg(category) +
          `<span class="dsf-name">${escapeHtml(entry.name)}</span>` +
          `<span class="dsf-size">${formatBytes(entry.size)}</span>`;
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          openFile(entry);
        });
        wrapper.appendChild(row);
        return wrapper;
      }

      function openFile(entry) {
        // Bottom bar shows ONLY the file path; the content lives in the large viewer.
        previewPathEl.textContent = entry.path;
        previewEl.hidden = false;
        openViewer(entry);
      }

      function openViewer(entry) {
        activeFile = entry.path;
        viewerNameEl.textContent = entry.name;
        viewerPathEl.textContent = entry.path;
        viewerPathEl.title = entry.path;
        viewerSizeEl.textContent = formatBytes(entry.size) || '';
        viewerGutterEl.textContent = '';
        viewerTextEl.textContent = '';
        // Track width changes of the left sidebar (via the conversation scroll)
        // and of the file panel, so the viewer follows both as they resize.
        if (!viewerObserver) {
          viewerObserver = new ResizeObserver(() => { if (!viewer.hidden) layoutViewer(); });
        }
        viewerObserver.disconnect();
        const scrollEl = document.querySelector('[data-conversation-scroll]');
        if (scrollEl) viewerObserver.observe(scrollEl);
        viewerObserver.observe(root);
        layoutViewer();
        viewer.hidden = false;
        if (!viewerResizeBound) {
          window.addEventListener('resize', onViewerResize);
          viewerResizeBound = true;
        }
        apiRead(entry.path)
          .then((value) => {
            if (activeFile !== entry.path) return;
            const lines = (value.text || '').split('\n');
            viewerGutterEl.textContent = lines.map((_, i) => String(i + 1)).join('\n');
            viewerTextEl.textContent = value.text || '';
          })
          .catch((error) => {
            if (activeFile !== entry.path) return;
            viewerTextEl.textContent = `${t('error')}: ${error && error.message ? error.message : String(error)}`;
          });
      }

      function showRowMenu(entry, x, y) {
        menuEntry = entry;
        const isDir = !!entry.isDirectory;
        menuButtons[0].textContent = isDir ? t('copyDirPath') : t('copyFilePath');
        menuButtons[1].textContent = isDir ? t('copyDirName') : t('copyFileName');
        menuButtons[2].textContent = isDir ? t('openDir') : t('openContainingDir');
        menu.hidden = false;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(6, Math.min(x, innerWidth - rect.width - 6))}px`;
        menu.style.top = `${Math.max(6, Math.min(y, innerHeight - rect.height - 6))}px`;
      }

      function reset() {
        expanded.clear();
        cache.clear();
        controllers.clear();
        activeFile = null;
        previewEl.hidden = true;
        closeViewer();
        hideMenu();
        bodyEl.replaceChildren();
      }

      function setCwdPath(path) {
        rootPath = path;
        cwdPathEl.textContent = path || '';
        cwdPathEl.title = path || '';
      }

      async function loadRoot() {
        reset();
        if (!rootPath) {
          const empty = document.createElement('div');
          empty.className = 'dsf-status';
          empty.textContent = t('empty');
          bodyEl.appendChild(empty);
          return;
        }
        // First-level: folders + files (includeFiles=1 already sends files).
        await loadDir(rootPath, bodyEl);
      }

      // ---------------- open panel (entry) ----------------
      async function open(entryPayload) {
        syncLang();
        const sessions = ctx.get('sessions');
        // The entry target wins: when opened from a context menu, `cwd` is the
        // RIGHT-CLICKED session's working directory (or the workspace path), so
        // the panel lists THAT session's files — not the active session's. The
        // active session is only the fallback (Alt+W, or a main-window
        // right-click where the displayed session IS the target).
        let cwd = entryPayload && entryPayload.cwd;
        if (!cwd && entryPayload && entryPayload.workspace && entryPayload.workspace.path) {
          cwd = entryPayload.workspace.path;
        }
        if (!cwd && sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
          const state = sessions.list.getSnapshot();
          const currentId = state && state.current;
          if (currentId && state.byId && state.byId[currentId]) {
            cwd = state.byId[currentId].cwd;
          }
        }
        setCwdPath(cwd || '');
        setOpen(true);
        await loadRoot();
      }

      closeBtn.addEventListener('click', () => setOpen(false));
      cwdCopyBtn.addEventListener('click', async () => {
        if (!rootPath) return;
        try { await copyText(rootPath); toast(t('copied')); } catch (error) { toast(error?.message || String(error)); }
      });
      viewerCloseBtn.addEventListener('click', closeViewer);
      menuButtons[0].addEventListener('click', async () => {
        const entry = menuEntry;
        hideMenu();
        if (!entry) return;
        try { await copyText(entry.path); toast(t('copied')); } catch (error) { toast(error?.message || String(error)); }
      });
      menuButtons[1].addEventListener('click', async () => {
        const entry = menuEntry;
        hideMenu();
        if (!entry) return;
        try { await copyText(entry.name); toast(t('copied')); } catch (error) { toast(error?.message || String(error)); }
      });
      menuButtons[2].addEventListener('click', async () => {
        const entry = menuEntry;
        hideMenu();
        if (!entry) return;
        try { await openInExplorer(entry.isDirectory ? entry.path : parentDir(entry.path)); } catch (error) { toast(error?.message || String(error)); }
      });
      const onOutsidePointerDown = (event) => {
        if (!menu.hidden && !menu.contains(event.target)) hideMenu();
      };
      document.addEventListener('pointerdown', onOutsidePointerDown, true);
      document.addEventListener('keydown', onKeydown);

      function onKeydown(event) {
        if (event.key === 'Escape' && !root.hidden) {
          // Row menu first: Esc closes the menu (standard menu UX).
          if (!menu.hidden) { hideMenu(); return; }
          if (event.shiftKey) {
            // Shift+Esc: close ONLY the file-content viewer.
            closeViewer();
          } else {
            // Plain Esc: close the content viewer AND the panel together.
            closeViewer();
            setOpen(false);
          }
          return;
        }
        // Alt+W (works even when the panel is open — toggle).
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === SHORTCUT_KEY || event.key === SHORTCUT_KEY.toUpperCase())) {
          event.preventDefault();
          if (root.hidden) {
            open({}).then(() => {}, (error) => console.error(`[${NS}] open failed:`, error));
          } else {
            setOpen(false);
          }
        }
      }

      function dispose() {
        document.removeEventListener('keydown', onKeydown);
        document.removeEventListener('pointerdown', onOutsidePointerDown, true);
        resizeHandle.removeEventListener('pointerdown', onResizePointerDown);
        if (viewerObserver) viewerObserver.disconnect();
        if (viewerResizeBound) window.removeEventListener('resize', onViewerResize);
        for (const controller of controllers.values()) controller.abort();
        root.remove();
        menu.remove();
        viewer.remove();
        document.querySelector('.dsf-toast')?.remove();
      }

      return { open, dispose, root };
    }

    // ---------------- plugin body ----------------
    function apply(ctx) {
      if (!claim()) return;
      syncLang();
      injectStyles();

      const panel = createPanel(ctx);
      ctx.effect(() => () => panel.dispose(), `${NS}: dispose`);

      // Register into the context-menu extension protocol. This makes the item
      // appear on BOTH the session-row and (after the context-menu plugin's
      // workspace-extension support) the workspace-row menus.
      let unregister = null;
      try {
        const registry = globalThis[Symbol.for('dsh.session-context-menu.extensions')];
        if (registry && typeof registry.register === 'function') {
          unregister = registry.register({
            id: EXTENSION_ID,
            order: 60,
            label: t('action'),
            visible: () => true,
            run: (payload) => {
              const cwd = payload && payload.session ? payload.session.cwd : undefined;
              panel.open({ cwd, workspace: payload && payload.workspace }).catch((error) => {
                console.error(`[${NS}] open failed:`, error);
              });
            },
          });
        } else {
          console.warn(`[${NS}] context-menu extension registry not available; left-click shortcut still works.`);
        }
      } catch (error) {
        console.warn(`[${NS}] failed to register context-menu extension:`, error);
      }
      ctx.effect(
        () => () => {
          if (unregister) {
            try {
              unregister();
            } catch (error) {
              console.error(`[${NS}] unregister failed:`, error);
            }
          }
        },
        `${NS}: context-menu extension`,
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
