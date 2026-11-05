import * as vscode from "vscode";
import * as crypto from "crypto";

function inlineSvgColors(O) {
  if (!O) {
    return "";
  }
  let d = O.trim();
  d = d.replace(/var\(--[^,]+,\s*([^)]+)\)/g, "$1");
  d = d.replace(/stroke="currentColor"/g, 'stroke="#d4d4d4"');
  d = d.replace(/fill="currentColor"/g, 'fill="#d4d4d4"');
  let m = `
    <style type="text/css">
      .verilog-schematic {
        background-color: #1e1e1e;
        color: #d4d4d4;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      text {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, monospace;
        user-select: none;
      }
      .wire-path {
        stroke: #d4d4d4;
      }
      .wire-single .wire-path {
        stroke-width: 1.8px;
      }
      .wire-bus .wire-path {
        stroke-width: 3px;
      }
      .schematic-wire {
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .wire-net-label {
        fill: #d4d4d4;
        font-family: monospace;
        font-size: 9px;
        font-weight: 600;
      }
    </style>
  `.trim();
  if (!d.includes("<style")) {
    if (d.includes("<defs>")) {
      d = d.replace(
        "<defs>",
        `<defs>
    ${m}`,
      );
    } else {
      d = d.replace(
        /<svg([^>]*)>/,
        `<svg_1>
  <defs>
    ${m}
  </defs>`,
      );
    }
  }
  if (!d.includes('id="standalone-bg"') && !d.includes('fill="#1e1e1e"')) {
    d = d.replace(
      /(<rect width="100%" height="100%" fill="url\(#grid-dots\)" \/>)/,
      `<rect id="standalone-bg" width="100%" height="100%" fill="#1e1e1e" />
  $1`,
    );
  }
  if (!d.includes("xmlns=")) {
    d = d.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!d.includes("version=")) {
    d = d.replace("<svg", '<svg version="1.1"');
  }
  if (!d.startsWith("<?xml")) {
    d = `<?xml version="1.0" encoding="UTF-8"?>
${d}`;
  }
  return d;
}

const VIEW_TYPE = "theryx.schematic";

const MAX_NAME_LENGTH = 64;

const MAX_PATH_LENGTH = 512;

const MAX_SVG_BYTES = 16 * 1024 * 1024;

function escapeHtml(O) {
  return O.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class WebviewManager {
  currentPanel;
  currentTitle = "schematic";
  lastSvgContent = "";
  onDrillDownHandler;
  onDrillDownMacroHandler;
  onGoBackHandler;
  onGoToBreadcrumbHandler;
  onSelectSignalHandler;
  panelDisposables = [];
  dispose() {
    this.close();
    for (let panelDisposable of this.panelDisposables) {
      try {
        panelDisposable.dispose();
      } catch {}
    }
    this.panelDisposables.length = 0;
  }
  isVisible() {
    return !!this.currentPanel?.visible;
  }
  close() {
    let currentPanel = this.currentPanel;
    this.currentPanel = undefined;
    this.onDrillDownHandler = undefined;
    this.onDrillDownMacroHandler = undefined;
    this.onGoBackHandler = undefined;
    this.onGoToBreadcrumbHandler = undefined;
    this.onSelectSignalHandler = undefined;
    try {
      currentPanel?.dispose();
    } catch {}
  }
  highlightSignal(d, m = "") {
    if (this.currentPanel) {
      this.currentPanel.webview.postMessage({
        command: "highlightSignal",
        signalName: d,
        bitWidth: m,
      });
    }
  }
  clearHighlight() {
    if (this.currentPanel) {
      this.currentPanel.webview.postMessage({
        command: "clearHighlight",
      });
    }
  }
  showSchematic(d, m, k = [], E, C, M, v, R, J) {
    if (
      ((this.currentTitle = d),
      (this.lastSvgContent = m),
      (this.onDrillDownHandler = E),
      (this.onDrillDownMacroHandler = C),
      (this.onGoBackHandler = M),
      (this.onGoToBreadcrumbHandler = R),
      (this.onSelectSignalHandler = v),
      this.currentPanel)
    ) {
      this.currentPanel.title = d;
      this.currentPanel.reveal(this.currentPanel.viewColumn, true);
    } else {
      let Q =
        vscode.window.activeTextEditor || vscode.window.visibleTextEditors.length > 0
          ? vscode.ViewColumn.Beside
          : vscode.ViewColumn.One;
      let webviewPanel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        d,
        {
          viewColumn: Q,
          preserveFocus: true,
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [],
        },
      );
      this.currentPanel = webviewPanel;
      this.panelDisposables.push(
        webviewPanel.onDidDispose(() => {
          if (this.currentPanel === webviewPanel) {
            this.currentPanel = undefined;
            this.onDrillDownHandler = undefined;
            this.onDrillDownMacroHandler = undefined;
            this.onGoBackHandler = undefined;
            this.onGoToBreadcrumbHandler = undefined;
            this.onSelectSignalHandler = undefined;
          }
        }),
      );
      this.panelDisposables.push(
        webviewPanel.webview.onDidReceiveMessage(async (Qe) => {
          if (!Qe || typeof Qe != "object") {
            return;
          }
          let le = typeof Qe.command == "string" ? Qe.command : "";
          let te = typeof Qe.moduleName == "string" ? Qe.moduleName : "";
          let Oe = typeof Qe.signalName == "string" ? Qe.signalName : "";
          let _e = typeof Qe.svgContent == "string" ? Qe.svgContent : "";
          let Ke = typeof Qe.index == "number" ? Qe.index : -1;
          let yn = typeof Qe.nodeId == "string" ? Qe.nodeId : "";
          if (!(
            le.length > MAX_NAME_LENGTH ||
            te.length > MAX_PATH_LENGTH ||
            Oe.length > MAX_PATH_LENGTH ||
            _e.length > MAX_SVG_BYTES ||
            yn.length > MAX_PATH_LENGTH
          )) {
            try {
              if (le === "drillDown" && te) {
                this.onDrillDownHandler?.(te);
              } else {
                if (le === "drillDownMacro" && yn) {
                  await this.onDrillDownMacroHandler?.(yn);
                } else {
                  if (le === "goBack") {
                    this.onGoBackHandler?.();
                  } else {
                    if (le === "goToBreadcrumb" && Ke >= 0) {
                      this.onGoToBreadcrumbHandler?.(Ke);
                    } else {
                      if (le === "selectSignalInEditor" && Oe) {
                        this.onSelectSignalHandler?.(Oe);
                      } else {
                        if (le === "saveSvgFile") {
                          await this.handleSaveSvg(_e);
                        } else {
                          if (le === "copySvg") {
                            await this.handleCopySvg(_e);
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (Se) {
              console.error("[Theryx] Schematic webview message failed", Se);
            }
          }
        }),
      );
    }
    this.currentPanel.webview.html = this.currentPanel.webview
      ? this.buildWebviewHtml(this.currentPanel.webview, d, m, k, J)
      : "";
  }
  async handleSaveSvg(d) {
    let m = d || this.lastSvgContent;
    if (!m) {
      vscode.window.showWarningMessage("No schematic available to export.");
      return;
    }
    let k = inlineSvgColors(m);
    let E = this.currentTitle
      .replace(/^Circuit:\s*/i, "")
      .trim()
      .replace(/[^a-zA-Z0-9_\-\.]/g, "_");
    if (!E) {
      E = "schematic";
    }
    let C = E.endsWith(".svg") ? E : `${E}.svg`;
    let M;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      M = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, C);
    }
    let v = {
      filters: {
        "SVG Vector Images": ["svg"],
      },
      saveLabel: "Save SVG",
      title: "Save Schematic as SVG",
    };
    if (M) {
      v.defaultUri = M;
    }
    let showSaveDialog = await vscode.window.showSaveDialog(v);
    if (showSaveDialog) {
      try {
        let textEncoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(showSaveDialog, textEncoder.encode(k));
        let X = "Open File";
        if (
          (await vscode.window.showInformationMessage(
            `Schematic successfully saved to: ${showSaveDialog.fsPath}`,
            X,
          )) === X
        ) {
          await vscode.commands.executeCommand("vscode.open", showSaveDialog);
        }
      } catch (J) {
        vscode.window.showErrorMessage(`Failed to save SVG file: ${J.message || J}`);
      }
    }
  }
  async handleCopySvg(d) {
    let m = d || this.lastSvgContent;
    if (!m) {
      vscode.window.showWarningMessage("No schematic available to copy.");
      return;
    }
    let k = inlineSvgColors(m);
    try {
      await vscode.env.clipboard.writeText(k);
      vscode.window.showInformationMessage("Schematic SVG copied to clipboard!");
    } catch (E) {
      vscode.window.showErrorMessage(`Failed to copy SVG to clipboard: ${E.message || E}`);
    }
  }
  buildWebviewHtml(d, m, k, E, C) {
    let M = E.length > 1;
    let v = escapeHtml(m);
    let R = crypto.randomBytes(16).toString("hex");
    let J = [
      "default-src 'none'",
      `style-src ${d.cspSource} 'nonce-${R}'`,
      `script-src 'nonce-${R}'`,
      `img-src ${d.cspSource} data:`,
    ].join("; ");
    let X = "";
    if (M) {
      X = `
        <div class="breadcrumbs-container">
          <button id="btn-back" class="back-btn" title="Back to parent module">
            <svg viewBox="0 0 448 512" width="12" height="12" fill="currentColor">
              <path d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.2 288 416 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-306.7 0L214.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z"/>
            </svg>
            <span>Back</span>
          </button>
          <div class="breadcrumb-trail">${E.map((te, Oe) => (Oe === E.length - 1 ? `<span class="breadcrumb-current">${escapeHtml(te.label)}</span>` : `<span class="breadcrumb-item" data-index="${Oe}">${escapeHtml(te.label)}</span> <span class="breadcrumb-sep">&gt;</span>`)).join(" ")}</div>
        </div>
      `;
    }
    let Q = "";
    if (C?.notice) {
      let le = C.notice.detail
        ? `<div class="notice-detail">${escapeHtml(C.notice.detail)}</div>`
        : "";
      Q = `
        <div class="notice">
          <div class="notice-title">${escapeHtml(C.notice.title)}</div>
          ${le}
        </div>
      `;
    }
    let Qe =
      C?.nodeCount === 0
        ? `
        <div class="empty-state">
          <div class="empty-title">No schematic to display</div>
          <div class="empty-detail">
            The elaborator produced no components for this module. It may be empty, or it
            may only contain constructs the schematic renderer does not model yet.
          </div>
        </div>
      `
        : `<div id="viewport">${k}</div>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${J}">
  <title>${v}</title>
  <style nonce="${R}">
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --border: var(--vscode-panel-border, #3e3e42);
      --button-bg: var(--vscode-button-background, #0e639c);
      --button-fg: var(--vscode-button-foreground, #ffffff);
      --highlight: #00E5FF;
    }
    /* Light themes only: the SVG symbols fill with var(--bg-panel, #252526),
       whose dark fallback makes the dark currentColor text unreadable there.
       Dark themes keep the fallback (matching the exported dark SVG), so this
       is intentionally defined only on light bodies. */
    body.vscode-light,
    body.vscode-high-contrast-light {
      --bg-panel: var(--vscode-editor-background, #ffffff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--vscode-sideBar-background, #252526);
      font-size: 13px;
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar-title {
      font-weight: 600;
      display: flex;
      align-items: center;
    }
    .breadcrumbs-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--button-bg);
      color: var(--button-fg);
      border: none;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    .back-btn:hover {
      opacity: 0.9;
    }
    .breadcrumb-trail {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #858585);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .breadcrumb-item {
      cursor: pointer;
      color: var(--vscode-textLink-foreground, #3794ff);
      transition: text-decoration 0.15s ease;
    }
    .breadcrumb-item:hover {
      text-decoration: underline;
    }
    .breadcrumb-current {
      font-weight: bold;
      color: var(--fg);
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .controls-divider {
      width: 1px;
      height: 18px;
      background-color: var(--border);
      margin: 0 4px;
    }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: var(--vscode-editorActionList-background, rgba(255, 255, 255, 0.08));
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
      padding: 0;
    }
    .icon-btn:hover {
      background: var(--button-bg);
      color: var(--button-fg);
      border-color: var(--button-bg);
    }
    .icon-btn:active {
      transform: scale(0.94);
    }
    .icon-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
      pointer-events: none;
    }
    #canvas-container {
      flex: 1;
      overflow: hidden;
      cursor: grab;
      position: relative;
      background-color: var(--bg);
    }
    #canvas-container.grabbing { cursor: grabbing; }
    #viewport {
      transform-origin: 0 0;
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
    }

    /* Net Tracing & Submodule Styles */
    .schematic-wire {
      cursor: pointer;
    }
    .schematic-wire:hover .wire-path {
      stroke: var(--highlight) !important;
      stroke-width: 4px !important;
    }
    .wire-highlighted .wire-path {
      stroke: var(--highlight) !important;
      stroke-width: 4.5px !important;
      filter: drop-shadow(0 0 8px var(--highlight));
      transition: stroke 0.15s ease, stroke-width 0.15s ease;
    }
    .wire-dimmed {
      opacity: 0.15 !important;
      transition: opacity 0.2s ease;
    }
    .wire-net-label {
      pointer-events: none;
      transition: fill 0.15s ease, opacity 0.15s ease;
    }
    .wire-highlighted .wire-net-label {
      fill: var(--highlight) !important;
      font-weight: bold;
      opacity: 1 !important;
      filter: drop-shadow(0 0 5px var(--highlight));
    }
    .wire-dimmed .wire-net-label {
      opacity: 0.15 !important;
    }
    .node-port {
      cursor: pointer;
    }
    .node-port:hover rect, .node-port:hover polygon {
      stroke: var(--highlight) !important;
      stroke-width: 2.5px !important;
    }
    .node-highlighted rect, .node-highlighted polygon {
      stroke: var(--highlight) !important;
      stroke-width: 2.5px !important;
      filter: drop-shadow(0 0 6px var(--highlight));
    }
    .node-dimmed {
      opacity: 0.3 !important;
      transition: opacity 0.2s ease;
    }
    .node-submodule {
      cursor: pointer;
    }
    .node-submodule:hover rect {
      stroke: var(--highlight) !important;
      stroke-width: 2.5px !important;
    }
    .node-expandable {
      cursor: zoom-in;
    }
    .node-expandable:hover rect,
    .node-expandable:hover polygon {
      stroke: var(--highlight) !important;
      stroke-width: 2.5px !important;
    }
    /* Right-click menu for expandable macros. */
    .ctx-menu {
      display: none;
      position: fixed;
      z-index: 200;
      background: var(--vscode-menu-background, #252526);
      color: var(--vscode-menu-foreground, #cccccc);
      border: 1px solid var(--vscode-menu-border, #454545);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      min-width: 200px;
      padding: 4px;
      flex-direction: column;
    }
    .ctx-menu button {
      background: transparent;
      color: inherit;
      border: none;
      text-align: left;
      padding: 6px 12px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      border-radius: 3px;
    }
    .ctx-menu button:hover {
      background: var(--vscode-menu-selectionBackground, #0e639c);
      color: var(--vscode-menu-selectionForeground, #ffffff);
    }
    .net-badge {
      position: absolute;
      bottom: 12px;
      left: 16px;
      background: rgba(14, 99, 156, 0.95);
      color: #ffffff;
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
      pointer-events: none;
      display: none;
      backdrop-filter: blur(4px);
      border: 1px solid rgba(0, 229, 255, 0.5);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      z-index: 100;
    }
    /* Notice banner: the schematic is shown, but something is off. */
    .notice {
      flex: 0 0 auto;
      padding: 8px 16px;
      background: var(--vscode-editorWarning-background, rgba(204, 167, 0, 0.15));
      border-bottom: 1px solid var(--vscode-editorWarning-foreground, #cca700);
      color: var(--vscode-editorWarning-foreground, #cca700);
      font-size: 12px;
    }
    .notice-title { font-weight: 600; }
    .notice-detail { margin-top: 2px; opacity: 0.85; }
    /* Empty state: the elaborator produced nothing to draw. */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 32px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #858585);
    }
    .empty-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .empty-detail { font-size: 12px; max-width: 480px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <div class="toolbar-title">
        <span>${v}</span>
      </div>
      ${X}
    </div>
    <div class="controls">
      <button id="btn-export-svg" class="icon-btn" title="Save Schematic as SVG" aria-label="Save Schematic as SVG">
        <svg viewBox="0 0 512 512">
          <path d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32V274.7l-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7V32zM64 352c-35.3 0-64 28.7-64 64v32c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V416c0-35.3-28.7-64-64-64H346.5l-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352H64zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"/>
        </svg>
      </button>
      <button id="btn-copy-svg" class="icon-btn" title="Copy SVG to Clipboard" aria-label="Copy SVG to Clipboard">
        <svg viewBox="0 0 512 512">
          <path d="M288 448H64V224h64V160H64c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H288c35.3 0 64-28.7 64-64V384H288v64zm-64-96H448c35.3 0 64-28.7 64-64V64c0-35.3-28.7-64-64-64H224c-35.3 0-64 28.7-64 64V288c0 35.3 28.7 64 64 64z"/>
        </svg>
      </button>
      <div class="controls-divider"></div>
      <button id="btn-zoom-in" class="icon-btn" title="Zoom In" aria-label="Zoom In">
        <svg viewBox="0 0 512 512">
          <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0s208 93.1 208 208zM184 296c0 13.3 10.7 24 24 24s24-10.7 24-24V232h64c13.3 0 24-10.7 24-24s-10.7-24-24-24H232V120c0-13.3-10.7-24-24-24s-24 10.7-24 24v64H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h64v64z"/>
        </svg>
      </button>
      <button id="btn-zoom-out" class="icon-btn" title="Zoom Out" aria-label="Zoom Out">
        <svg viewBox="0 0 512 512">
          <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0s208 93.1 208 208zM120 184c-13.3 0-24 10.7-24 24s10.7 24 24 24h176c13.3 0 24-10.7 24-24s-10.7-24-24-24H120z"/>
        </svg>
      </button>
      <button id="btn-reset" class="icon-btn" title="Reset View" aria-label="Reset">
        <svg viewBox="0 0 512 512">
          <path d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 182.6c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z"/>
        </svg>
      </button>
    </div>
  </div>
  ${Q}
  <div id="canvas-container">
    ${Qe}
    <div id="net-badge" class="net-badge"></div>
  </div>
  <div id="ctx-menu" class="ctx-menu"></div>

  <script nonce="${R}">
    const vscode = acquireVsCodeApi();
    let scale = 1;
    let pointX = 0;
    let pointY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    const container = document.getElementById('canvas-container');
    // The viewport is absent in the empty state (nothing was elaborated).
    const viewport = document.getElementById('viewport');
    const badge = document.getElementById('net-badge');

    function updateTransform() {
      if (!viewport) return;
      viewport.style.transform = "translate(" + pointX + "px, " + pointY + "px) scale(" + scale + ")";
    }

    let mouseDownX = 0, mouseDownY = 0;

    container.addEventListener('mousedown', function(e) {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX - pointX;
      startY = e.clientY - pointY;
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      container.classList.add('grabbing');
    });

    window.addEventListener('mouseup', function(e) {
      isDragging = false;
      container.classList.remove('grabbing');
    });

    window.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > 5) {
        hasMoved = true;
      }
      pointX = e.clientX - startX;
      pointY = e.clientY - startY;
      updateTransform();
    });

    container.addEventListener('wheel', function(e) {
      e.preventDefault();
      const xs = (e.clientX - pointX) / scale;
      const ys = (e.clientY - pointY) / scale;
      const delta = -e.deltaY;
      if (delta > 0) {
        scale *= 1.15;
      } else {
        scale = Math.max(0.15, scale / 1.15);
      }
      pointX = e.clientX - xs * scale;
      pointY = e.clientY - ys * scale;
      updateTransform();
    }, { passive: false });

    document.getElementById('btn-zoom-in').addEventListener('click', function() {
      scale *= 1.25;
      updateTransform();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', function() {
      scale = Math.max(0.15, scale / 1.25);
      updateTransform();
    });

    document.getElementById('btn-reset').addEventListener('click', function() {
      scale = 1;
      pointX = 0;
      pointY = 0;
      updateTransform();
      clearNetHighlight();
    });

    function getCleanSvgContent() {
      const svgEl = document.querySelector('#viewport svg');
      if (!svgEl) return '';
      const clone = svgEl.cloneNode(true);
      const highlightedWires = clone.querySelectorAll('.wire-highlighted, .wire-dimmed');
      highlightedWires.forEach(function(el) {
        el.classList.remove('wire-highlighted', 'wire-dimmed');
      });
      const highlightedNodes = clone.querySelectorAll('.node-highlighted, .node-dimmed');
      highlightedNodes.forEach(function(el) {
        el.classList.remove('node-highlighted', 'node-dimmed');
      });
      return clone.outerHTML;
    }

    const exportBtn = document.getElementById('btn-export-svg');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        const svgStr = getCleanSvgContent();
        vscode.postMessage({ command: 'saveSvgFile', svgContent: svgStr });
      });
    }

    const copyBtn = document.getElementById('btn-copy-svg');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        const svgStr = getCleanSvgContent();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(svgStr).catch(function() {});
        }
        vscode.postMessage({ command: 'copySvg', svgContent: svgStr });
      });
    }

    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        vscode.postMessage({ command: 'goBack' });
      });
    }

    const breadcrumbItems = document.querySelectorAll('.breadcrumb-item');
    breadcrumbItems.forEach(function(item) {
      item.addEventListener('click', function() {
        const idx = parseInt(item.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          vscode.postMessage({ command: 'goToBreadcrumb', index: idx });
        }
      });
    });

    // --- Net Tracing & Highlight System ---
    function clearNetHighlight() {
      const allWires = document.querySelectorAll('.schematic-wire');
      allWires.forEach(w => {
        w.classList.remove('wire-highlighted');
        w.classList.remove('wire-dimmed');
      });
      const allNodes = document.querySelectorAll('.schematic-node');
      allNodes.forEach(n => {
        n.classList.remove('node-highlighted');
        n.classList.remove('node-dimmed');
      });
      badge.style.display = 'none';
    }

    container.addEventListener('click', function(e) {
      if (hasMoved) return; // Ignore drag clicks

      const wire = e.target.closest('.schematic-wire');
      if (wire) {
        const netName = wire.getAttribute('data-net');
        const bitWidth = wire.getAttribute('data-width') || '1';
        if (netName) {
          highlightNet(netName, bitWidth);
          vscode.postMessage({ command: 'selectSignalInEditor', signalName: netName });
          return;
        }
      }

      const nodeWithNet = e.target.closest('[data-net]');
      if (nodeWithNet) {
        const netName = nodeWithNet.getAttribute('data-net');
        const bitWidth = nodeWithNet.getAttribute('data-width') || '1';
        if (netName) {
          highlightNet(netName, bitWidth);
          vscode.postMessage({ command: 'selectSignalInEditor', signalName: netName });
          return;
        }
      }

      // Clicking empty background clears highlight
      clearNetHighlight();
    });

    function highlightNet(netName, bitWidth) {
      const allWires = document.querySelectorAll('.schematic-wire');
      let foundCount = 0;

      allWires.forEach(w => {
        const wNet = w.getAttribute('data-net');
        const wSrc = w.getAttribute('data-source');
        const wTgt = w.getAttribute('data-target');
        const wSrcLabel = w.getAttribute('data-source-label');
        const wTgtLabel = w.getAttribute('data-target-label');
        if (
          wNet === netName ||
          wSrc === netName ||
          wTgt === netName ||
          wSrcLabel === netName ||
          wTgtLabel === netName
        ) {
          w.classList.add('wire-highlighted');
          w.classList.remove('wire-dimmed');
          foundCount++;
        } else {
          w.classList.remove('wire-highlighted');
          w.classList.add('wire-dimmed');
        }
      });

      const allNodes = document.querySelectorAll('.schematic-node');
      let foundNodeCount = 0;
      allNodes.forEach(n => {
        const nNet = n.getAttribute('data-net') || n.getAttribute('data-node-id');
        if (nNet === netName) {
          n.classList.add('node-highlighted');
          n.classList.remove('node-dimmed');
          foundNodeCount++;
        } else {
          n.classList.remove('node-highlighted');
          n.classList.add('node-dimmed');
        }
      });

      if (foundCount > 0 || foundNodeCount > 0) {
        const bitInfo = bitWidth ? " (" + bitWidth + " bit" + (bitWidth > 1 ? "s" : "") + ")" : "";
        // textContent, never innerHTML: the net name comes from the document
        // and must not be able to inject markup into the badge.
        badge.textContent = "Signal: " + netName + bitInfo;
        badge.style.display = 'block';
      } else {
        clearNetHighlight();
      }
    }

    // --- Submodule & Macro Drill-down Navigation ---
    container.addEventListener('dblclick', function(e) {
      const submodNode = e.target.closest('.node-submodule');
      if (submodNode) {
        const modName = submodNode.getAttribute('data-module-name');
        if (modName) {
          vscode.postMessage({ command: 'drillDown', moduleName: modName });
        }
        return;
      }

      const macroNode = e.target.closest('.node-expandable');
      if (macroNode) {
        const macroNodeId = macroNode.getAttribute('data-node-id');
        if (macroNodeId) {
          vscode.postMessage({ command: 'drillDownMacro', nodeId: macroNodeId });
        }
      }
    });

    // --- Context menu for expandable macros (right-click) ---
    const ctxMenu = document.getElementById('ctx-menu');
    function hideCtxMenu() {
      if (ctxMenu) {
        ctxMenu.style.display = 'none';
      }
    }
    function addCtxItem(label, action) {
      // textContent, never innerHTML: menu labels are static, but the habit
      // keeps the menu injection-proof by construction.
      const item = document.createElement('button');
      item.textContent = label;
      item.addEventListener('click', function() {
        hideCtxMenu();
        action();
      });
      ctxMenu.appendChild(item);
    }

    container.addEventListener('contextmenu', function(e) {
      const macroNode = e.target.closest('.node-expandable');
      if (!macroNode || !ctxMenu) {
        return;
      }
      e.preventDefault();
      const nodeId = macroNode.getAttribute('data-node-id');
      if (!nodeId) {
        return;
      }

      while (ctxMenu.firstChild) {
        ctxMenu.removeChild(ctxMenu.firstChild);
      }
      addCtxItem('View internal gates', function() {
        vscode.postMessage({ command: 'drillDownMacro', nodeId: nodeId });
      });
      // Inside a decomposition there is a breadcrumb history: offer the way
      // back to the macro (black-box) view.
      if (document.querySelector('.breadcrumb-item, #btn-back')) {
        addCtxItem('Back to macro view', function() {
          vscode.postMessage({ command: 'goBack' });
        });
      }

      ctxMenu.style.display = 'flex';
      ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
      ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';
    });

    window.addEventListener('click', hideCtxMenu);
    window.addEventListener('blur', hideCtxMenu);

    // --- Cross-Probing: Receber destaque do Editor RTL ---
    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (!msg) return;
      if (msg.command === 'highlightSignal' && msg.signalName) {
        highlightNet(msg.signalName, msg.bitWidth || '');
      } else if (msg.command === 'clearHighlight') {
        clearNetHighlight();
      }
    });
  </script>
</body>
</html>`;
  }
}
