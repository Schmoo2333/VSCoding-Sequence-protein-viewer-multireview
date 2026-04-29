"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProteinViewerPanel = void 0;
const path = require("node:path");
const vscode = require("vscode");
class ProteinViewerPanel {
    constructor(panel, extensionUri, accession, clickedFiles, initialFileIndex = 0) {
        this._disposables = [];
        this._panel = panel;
        this._panel.onDidDispose(this.dispose, null, this._disposables);
        this._panel.webview.onDidReceiveMessage((message) => {
            if (message?.type !== "updateTitle") {
                return;
            }
            if (typeof message.fileName !== "string" || typeof message.position !== "number" || typeof message.total !== "number") {
                return;
            }
            this._panel.title = `Protein Viewer MultiReview - ${message.fileName} (${message.position}/${message.total})`;
        }, null, this._disposables);
        if (accession !== undefined) {
            this._panel.webview.html = this._getWebviewContent(panel.webview, extensionUri, accession);
        }
        if (clickedFiles !== undefined) {
            this._panel.webview.html = this._getWebviewContentForFiles(panel.webview, extensionUri, clickedFiles, initialFileIndex);
        }
    }
    static render(extensionUri, accession) {
        const windowName = "Protein Viewer MultiReview - " + accession;
        const panel = vscode.window.createWebviewPanel("protein-viewer-multireview", windowName, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        const loadCommand = accession?.length === 4
            ? `viewer.loadPdb('${accession}');`
            : `viewer.loadAlphaFoldDb('${accession}');`;
        ProteinViewerPanel.currentPanel = new ProteinViewerPanel(panel, extensionUri, loadCommand, undefined);
    }
    static renderFromFiles(extensionUri, clickedFiles, initialFileIndex = 0) {
        const safeIndex = Math.min(Math.max(initialFileIndex, 0), Math.max(clickedFiles.length - 1, 0));
        const activeFile = clickedFiles[safeIndex];
        const fileName = activeFile ? path.basename(activeFile.fsPath) : "Files";
        const windowName = clickedFiles.length > 1
            ? `Protein Viewer MultiReview - ${fileName} (${safeIndex + 1}/${clickedFiles.length})`
            : `Protein Viewer MultiReview - ${fileName}`;
        const panel = vscode.window.createWebviewPanel("protein-viewer-multireview", windowName, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        ProteinViewerPanel.currentPanel = new ProteinViewerPanel(panel, extensionUri, undefined, clickedFiles, safeIndex);
    }
    dispose() {
        ProteinViewerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
    _getWebviewContent(webview, extensionUri, accession) {
        return this._wrapWebviewHtml(webview, extensionUri, "", `
      const viewer = await createViewer();

      var snapshotId = getParam('snapshot-id', '[^&]+').trim();
      if (snapshotId) viewer.setRemoteSnapshot(snapshotId);

      var snapshotUrl = getParam('snapshot-url', '[^&]+').trim();
      var snapshotUrlType = getParam('snapshot-url-type', '[^&]+').toLowerCase().trim() || 'molj';
      if (snapshotUrl && snapshotUrlType) viewer.loadSnapshotFromUrl(snapshotUrl, snapshotUrlType);

      var structureUrl = getParam('structure-url', '[^&]+').trim();
      var structureUrlFormat = getParam('structure-url-format', '[a-z]+').toLowerCase().trim();
      var structureUrlIsBinary = getParam('structure-url-is-binary', '[^&]+').trim() === '1';
      if (structureUrl) viewer.loadStructureFromUrl(structureUrl, structureUrlFormat, structureUrlIsBinary);

      var pdb = getParam('pdb', '[^&]+').trim();
      if (pdb) viewer.loadPdb(pdb);

      var pdbDev = getParam('pdb-dev', '[^&]+').trim();
      if (pdbDev) viewer.loadPdbDev(pdbDev);

      var emdb = getParam('emdb', '[^&]+').trim();
      if (emdb) viewer.loadEmdb(emdb);

      ${accession}

      var modelArchive = getParam('model-archive', '[^&]+').trim();
      if (modelArchive) viewer.loadModelArchive(modelArchive);
    `);
    }
    _getWebviewContentForFiles(webview, extensionUri, clickedFiles, initialFileIndex) {
        const fileDescriptors = clickedFiles.map((clickedFile) => {
            const fileInfo = this._getStructureFileInfo(clickedFile);
            return {
                fileName: path.basename(clickedFile.fsPath),
                uri: webview.asWebviewUri(clickedFile).toString(),
                format: fileInfo.format,
                isBinary: fileInfo.isBinary
            };
        });
        const initialState = JSON.stringify({
            files: fileDescriptors,
            initialIndex: Math.min(Math.max(initialFileIndex, 0), Math.max(fileDescriptors.length - 1, 0))
        });
        const controlsMarkup = `
      <div id="viewer-toolbar">
        <button id="prev-file" type="button" title="Previous file (ArrowLeft)">Previous</button>
        <button id="next-file" type="button" title="Next file (ArrowRight)">Next</button>
        <span id="file-name">Loading...</span>
        <span id="file-position"></span>
        <span id="hint">ArrowLeft / ArrowRight</span>
      </div>
      <div id="status-banner" hidden></div>
    `;
        return this._wrapWebviewHtml(webview, extensionUri, controlsMarkup, `
      const vscodeApi = acquireVsCodeApi();
      const initialState = ${initialState};
      const files = initialState.files;
      let currentIndex = initialState.initialIndex;
      let navigationToken = 0;

      const previousButton = document.getElementById('prev-file');
      const nextButton = document.getElementById('next-file');
      const fileNameLabel = document.getElementById('file-name');
      const filePositionLabel = document.getElementById('file-position');
      const statusBanner = document.getElementById('status-banner');

      function setStatus(message) {
        if (!message) {
          statusBanner.hidden = true;
          statusBanner.textContent = '';
          return;
        }

        statusBanner.hidden = false;
        statusBanner.textContent = message;
      }

      function updateToolbar() {
        const currentFile = files[currentIndex];
        fileNameLabel.textContent = currentFile.fileName;
        filePositionLabel.textContent = (currentIndex + 1) + ' / ' + files.length;
        const navigationDisabled = files.length <= 1;
        previousButton.disabled = navigationDisabled;
        nextButton.disabled = navigationDisabled;
        vscodeApi.postMessage({
          type: 'updateTitle',
          fileName: currentFile.fileName,
          position: currentIndex + 1,
          total: files.length
        });
      }

      async function loadCurrentStructure() {
        const token = ++navigationToken;
        const viewer = await createViewer();
        const currentFile = files[currentIndex];

        setStatus('Loading ' + currentFile.fileName + '...');
        await viewer.plugin.clear();
        if (token !== navigationToken) {
          return;
        }

        await viewer.loadStructureFromUrl(currentFile.uri, currentFile.format, currentFile.isBinary, {
          label: currentFile.fileName
        });

        if (token !== navigationToken) {
          return;
        }

        updateToolbar();
        setStatus('');
      }

      async function showFile(index) {
        if (!files.length) {
          setStatus('No supported structure files found.');
          return;
        }

        currentIndex = (index + files.length) % files.length;
        try {
          await loadCurrentStructure();
        } catch (error) {
          console.error(error);
          const message = error instanceof Error ? error.message : String(error);
          setStatus('Failed to load file: ' + message);
        }
      }

      function shouldIgnoreKeyboardShortcut(target) {
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        const tagName = target.tagName;
        return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
      }

      previousButton.addEventListener('click', () => {
        void showFile(currentIndex - 1);
      });

      nextButton.addEventListener('click', () => {
        void showFile(currentIndex + 1);
      });

      window.addEventListener('keydown', (event) => {
        if (shouldIgnoreKeyboardShortcut(event.target)) {
          return;
        }

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          void showFile(currentIndex - 1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          void showFile(currentIndex + 1);
        }
      });

      updateToolbar();
      void showFile(currentIndex);
      window.focus();
    `);
    }
    _wrapWebviewHtml(webview, extensionUri, controlsMarkup, scriptBody) {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "node_modules", "molstar", "build/viewer", "molstar.css"));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "node_modules", "molstar", "build/viewer", "molstar.js"));
        return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0" />
          <link rel="icon" href="./favicon.ico" type="image/x-icon" />
          <title>Mol* Viewer</title>
          <link rel="stylesheet" type="text/css" href="${cssUri}" />
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            html, body {
              width: 100%;
              height: 100%;
              overflow: hidden;
              background: #111;
            }

            body {
              position: relative;
              font-family: sans-serif;
            }

            #app {
              position: absolute;
              inset: 0;
            }

            #viewer-toolbar {
              position: absolute;
              top: 12px;
              left: 12px;
              z-index: 20;
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 8px 12px;
              color: #fff;
              background: rgba(17, 17, 17, 0.78);
              border: 1px solid rgba(255, 255, 255, 0.18);
              border-radius: 8px;
              backdrop-filter: blur(4px);
            }

            #viewer-toolbar button {
              border: 1px solid rgba(255, 255, 255, 0.24);
              border-radius: 4px;
              background: rgba(255, 255, 255, 0.08);
              color: inherit;
              padding: 4px 10px;
              cursor: pointer;
            }

            #viewer-toolbar button:disabled {
              opacity: 0.45;
              cursor: default;
            }

            #file-name {
              min-width: 160px;
              max-width: 320px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            #file-position,
            #hint {
              color: rgba(255, 255, 255, 0.72);
              font-size: 12px;
            }

            #status-banner {
              position: absolute;
              top: 64px;
              left: 12px;
              z-index: 20;
              max-width: 420px;
              padding: 6px 10px;
              color: #fff;
              background: rgba(17, 17, 17, 0.78);
              border-radius: 8px;
              border: 1px solid rgba(255, 255, 255, 0.18);
            }
          </style>
        </head>
        <body>
          ${controlsMarkup}
          <div id="app"></div>
          <script type="text/javascript" src="${jsUri}"></script>
          <script type="text/javascript">
            function getParam(name, regex) {
              var r = new RegExp(name + '=' + '(' + regex + ')[&]?', 'i');
              return decodeURIComponent(((window.location.search || '').match(r) || [])[1] || '');
            }

            function getViewerOptions() {
              var debugMode = getParam('debug-mode', '[^&]+').trim() === '1';
              if (debugMode) molstar.setDebugMode(debugMode, debugMode);

              var hideControls = getParam('hide-controls', '[^&]+').trim() === '1';
              var collapseLeftPanel = getParam('collapse-left-panel', '[^&]+').trim() === '1';
              var pdbProvider = getParam('pdb-provider', '[^&]+').trim().toLowerCase();
              var emdbProvider = getParam('emdb-provider', '[^&]+').trim().toLowerCase();
              var mapProvider = getParam('map-provider', '[^&]+').trim().toLowerCase();
              var pixelScale = getParam('pixel-scale', '[^&]+').trim();
              var pickScale = getParam('pick-scale', '[^&]+').trim();
              var pickPadding = getParam('pick-padding', '[^&]+').trim();
              var disableWboit = getParam('disable-wboit', '[^&]+').trim() === '1';
              var preferWebgl1 = getParam('prefer-webgl1', '[^&]+').trim() === '1' || void 0;

              return {
                layoutShowControls: !hideControls,
                viewportShowExpand: false,
                collapseLeftPanel: collapseLeftPanel,
                pdbProvider: pdbProvider || 'pdbe',
                emdbProvider: emdbProvider || 'pdbe',
                volumeStreamingServer: (mapProvider || 'pdbe') === 'rcsb'
                  ? 'https://maps.rcsb.org'
                  : 'https://www.ebi.ac.uk/pdbe/densities',
                pixelScale: parseFloat(pixelScale) || 1,
                pickScale: parseFloat(pickScale) || 0.25,
                pickPadding: isNaN(parseFloat(pickPadding)) ? 1 : parseFloat(pickPadding),
                enableWboit: disableWboit ? true : void 0,
                preferWebgl1: preferWebgl1
              };
            }

            let viewerPromise;

            async function createViewer() {
              if (!viewerPromise) {
                viewerPromise = molstar.Viewer.create('app', getViewerOptions());
              }

              return viewerPromise;
            }

            (async function () {
              ${scriptBody}
            })();
          </script>
          <!-- __MOLSTAR_ANALYTICS__ -->
        </body>
      </html>`;
    }
    _getStructureFileInfo(clickedFile) {
        const fileName = path.basename(clickedFile.fsPath).toLowerCase();
        if (fileName.endsWith(".pdb.gz")) {
            return { format: "pdb", isBinary: false };
        }
        if (fileName.endsWith(".mmcif.gz") || fileName.endsWith(".mcif.gz") || fileName.endsWith(".cif.gz")) {
            return { format: "mmcif", isBinary: false };
        }
        if (fileName.endsWith(".mmcif") || fileName.endsWith(".mcif") || fileName.endsWith(".cif")) {
            return { format: "mmcif", isBinary: false };
        }
        if (fileName.endsWith(".ent")) {
            return { format: "pdb", isBinary: false };
        }
        if (fileName.endsWith(".mol2")) {
            return { format: "mol2", isBinary: false };
        }
        if (fileName.endsWith(".pdbqt")) {
            return { format: "pdbqt", isBinary: false };
        }
        if (fileName.endsWith(".sdf")) {
            return { format: "sdf", isBinary: false };
        }
        if (fileName.endsWith(".gro")) {
            return { format: "gro", isBinary: false };
        }
        if (fileName.endsWith(".xyz")) {
            return { format: "xyz", isBinary: false };
        }
        if (fileName.endsWith(".mol")) {
            return { format: "mol", isBinary: false };
        }
        return { format: "pdb", isBinary: false };
    }
}
exports.ProteinViewerPanel = ProteinViewerPanel;
//# sourceMappingURL=ProteinViewerPanel.js.map