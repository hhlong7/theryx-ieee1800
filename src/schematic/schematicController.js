import * as path from "path";
import * as vscode from "vscode";
import { WebviewManager } from "./webviewManager.js";
import { SvgRenderer } from "./svgRenderer.js";
import { Elaborator } from "./elaborator.js";
import { LayoutEngine } from "./layoutEngine.js";
import { isVerilogDocument } from "../providers/diagnosticsProvider.js";
import { detectTestbench } from "../lint/testbenchDetector.js";
import { expandMacroNode } from "./macroExpansion.js";

function partialSchematicBanner(O) {
  let d = O.filter((E) => E.severity === "error");
  if (d.length === 0) {
    return;
  }
  let m = d[0];
  let k = d.length > 1 ? ` (+${d.length - 1} more)` : "";
  return {
    title: "Partial schematic",
    detail: `The source has ${d.length} syntax error${d.length > 1 ? "s" : ""}, so this circuit may be incomplete. First: line ${m.span.start.line}, ${m.message}${k}`,
  };
}

export class SchematicController {
  outputChannel;
  documentCache;
  moduleResolver;
  webviewManager = new WebviewManager();
  elaborator;
  layoutEngine;
  renderer = new SvgRenderer();
  navHistory = [];
  currentGraph;
  selectionDebounceTimer;
  constructor(d) {
    this.outputChannel = d.outputChannel;
    this.documentCache = d.documentCache;
    this.moduleResolver = d.moduleResolver;
    this.elaborator = new Elaborator(d.moduleResolver);
    this.layoutEngine = new LayoutEngine({
      workerPath: path.join(d.extensionPath, "dist", "layout-worker.js"),
      logger: (m) => this.outputChannel.appendLine(m),
    });
  }
  dispose() {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
    }
    this.webviewManager.dispose();
    this.layoutEngine.dispose();
  }
  register(d) {
    d.push(
      vscode.window.onDidChangeTextEditorSelection((m) => this.onEditorSelection(m)),
      vscode.commands.registerCommand("verilog.showFullModuleSchematic", (m, k) =>
        this.showFullModuleSchematic(m, k),
      ),
      vscode.commands.registerCommand("verilog.showSubcircuitSchematic", (m, k, E) =>
        this.showSubcircuitSchematic(m, k, E),
      ),
      vscode.commands.registerCommand("verilog.showInstanceSchematic", (m, k, E, C) =>
        this.showInstanceSchematic(m, k, E, C),
      ),
      vscode.commands.registerCommand("verilog.openModuleFile", (m) => this.openModuleFile(m)),
      vscode.commands.registerCommand("theryx.closeSchematic", () => {
        this.webviewManager.close();
      }),
    );
  }
  activeVerilogDocument() {
    let activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor) {
      return isVerilogDocument(activeTextEditor.document) ? activeTextEditor.document : undefined;
    }
  }
  moduleAtCursor() {
    let activeVerilogDocument = this.activeVerilogDocument();
    let activeTextEditor = vscode.window.activeTextEditor;
    if (!activeVerilogDocument || !activeTextEditor) {
      return;
    }
    let analyze = this.documentCache.analyze(
      activeVerilogDocument.uri.toString(),
      activeVerilogDocument.version ?? 0,
      activeVerilogDocument.getText(),
    );
    let E = activeTextEditor.selection.active.line + 1;
    let C =
      analyze.ast.modules.find((M) => M.span.start.line <= E && M.span.end.line >= E) ??
      analyze.ast.modules[0];
    if (C) {
      return {
        uri: activeVerilogDocument.uri,
        moduleName: C.name,
        line: E,
      };
    }
  }
  instanceAtCursor() {
    let activeVerilogDocument = this.activeVerilogDocument();
    let activeTextEditor = vscode.window.activeTextEditor;
    if (!activeVerilogDocument || !activeTextEditor) {
      return;
    }
    let analyze = this.documentCache.analyze(
      activeVerilogDocument.uri.toString(),
      activeVerilogDocument.version ?? 0,
      activeVerilogDocument.getText(),
    );
    let E = activeTextEditor.selection.active.line + 1;
    for (let moduleItem of analyze.ast.modules) {
      for (let item of moduleItem.items) {
        if (
          item.kind === "InstanceDeclaration" &&
          item.span.start.line <= E &&
          item.span.end.line >= E
        ) {
          return {
            uri: activeVerilogDocument.uri,
            parentModuleName: moduleItem.name,
            submoduleName: item.moduleName,
            instanceName: item.instanceName,
          };
        }
      }
    }
  }
  async showFullModuleSchematic(d, m) {
    let k = d ? undefined : this.moduleAtCursor();
    let E = d ?? k?.uri;
    if (!E) {
      vscode.window.showWarningMessage(
        "Theryx: open a Verilog file to view the schematic of the module at the cursor.",
      );
      return;
    }
    await this.renderSchematicModule(E, m ?? k?.moduleName, false);
  }
  async showSubcircuitSchematic(d, m, k) {
    try {
      let E = d ? undefined : this.moduleAtCursor();
      let C = d ?? E?.uri;
      if (!C) {
        vscode.window.showWarningMessage(
          "Theryx: open a Verilog file to inspect the block at the cursor.",
        );
        return;
      }
      let openTextDocument = await vscode.workspace.openTextDocument(C);
      let text = openTextDocument.getText();
      if (detectTestbench(text, C.fsPath).isTestbench) {
        this.webviewManager.close();
        vscode.window.showInformationMessage(
          `File '${path.basename(C.fsPath)}' was identified as a simulation testbench. Subcircuit inspection is only available for synthesizable modules.`,
        );
        return;
      }
      let analyze = this.documentCache.analyze(C.toString(), openTextDocument.version ?? 0, text);
      let ast = analyze.ast;
      let Q = m ?? E?.moduleName;
      let Re = k ?? E?.line;
      let Qe = ast.modules.find((yn) => yn.name === Q) ?? ast.modules[0];
      if (!Qe) {
        this.webviewManager.close();
        vscode.window.showWarningMessage("Verilog module not found.");
        return;
      }
      let te =
        Qe.items
          .filter((yn) => Re !== undefined && yn.span.start.line <= Re && yn.span.end.line >= Re)
          .sort(
            (yn, Se) =>
              yn.span.end.line - yn.span.start.line - (Se.span.end.line - Se.span.start.line),
          )[0] ?? Qe.items[0];
      if (!te) {
        this.webviewManager.close();
        vscode.window.showWarningMessage("Verilog block not found for inspection.");
        return;
      }
      let block = this.elaborator.elaborateBlock(te, Qe, analyze.symbolTable);
      let layout = await this.layoutEngine.computeLayout(block);
      let render = this.renderer.render(layout);
      this.currentGraph = block;
      this.outputChannel.appendLine(
        `[Schematic] Subcircuit '${Qe.name}' (line ${Re ?? 1}) generated with ${layout.nodes.length} nodes.`,
      );
      this.webviewManager.showSchematic(
        `Subcircuit: ${Qe.name} (Line ${Re ?? 1})`,
        render,
        [],
        undefined,
        (yn) => {
          this.handleDrillDownMacro(yn, C);
        },
        undefined,
        (yn) => this.selectSignalInActiveEditor(yn, Qe.name),
        undefined,
        {
          nodeCount: layout.nodes.length,
          notice: partialSchematicBanner(analyze.parserDiagnostics),
        },
      );
    } catch (E) {
      this.webviewManager.close();
      this.outputChannel.appendLine(`[Error] Failed to inspect subcircuit: ${E.message || E}`);
      vscode.window.showErrorMessage(`Error inspecting subcircuit: ${E.message || E}`);
    }
  }
  async showInstanceSchematic(d, m, k, E) {
    try {
      let C = d;
      let M = m;
      let v = k;
      let R = E;
      if (!C || !v || !M) {
        let instanceAtCursor = this.instanceAtCursor();
        if (!instanceAtCursor) {
          vscode.window.showWarningMessage(
            "Theryx: place the cursor on a module instance to inspect it.",
          );
          return;
        }
        C = C ?? instanceAtCursor.uri;
        M = M ?? instanceAtCursor.parentModuleName;
        v = v ?? instanceAtCursor.submoduleName;
        R = R ?? instanceAtCursor.instanceName;
      }
      if (!C || !M || !v) {
        vscode.window.showWarningMessage(
          "Theryx: place the cursor on a module instance to inspect it.",
        );
        return;
      }
      let J = C;
      let X = this.moduleResolver.resolveModule(v, C.toString());
      if (X.found && X.filePath) {
        J = vscode.Uri.file(X.filePath);
      }
      this.navHistory.length = 0;
      this.navHistory.push({
        uri: C,
        moduleName: M,
        label: M,
      });
      this.navHistory.push({
        uri: J,
        moduleName: v,
        label: `${v} (${R})`,
      });
      await this.renderSchematicModule(J, v, true);
    } catch (C) {
      this.outputChannel.appendLine(
        `[Error] Failed to inspect submodule instance: ${C.message || C}`,
      );
      vscode.window.showErrorMessage(`Error inspecting submodule: ${C.message || C}`);
    }
  }
  async openModuleFile(d) {
    try {
      let m = d;
      if (!m) {
        let moduleAtCursor = this.moduleAtCursor();
        if (!moduleAtCursor) {
          vscode.window.showWarningMessage(
            "Theryx: open a Verilog file to open the module it declares.",
          );
          return;
        }
        let C = this.moduleResolver.resolveModule(
          moduleAtCursor.moduleName,
          moduleAtCursor.uri.toString(),
        );
        if (!C.found || !C.filePath || C.filePath === moduleAtCursor.uri.fsPath) {
          vscode.window.showInformationMessage(
            `Theryx: module '${moduleAtCursor.moduleName}' is declared in this file.`,
          );
          return;
        }
        m = C.filePath;
      }
      let openTextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(m));
      await vscode.window.showTextDocument(openTextDocument);
    } catch (m) {
      this.outputChannel.appendLine(`[Error] Failed to open module file: ${m.message || m}`);
      vscode.window.showErrorMessage(`Error opening file: ${m.message || m}`);
    }
  }
  async renderSchematicModule(d, m, k = false) {
    try {
      let openTextDocument = await vscode.workspace.openTextDocument(d);
      let text = openTextDocument.getText();
      let M = detectTestbench(text, d.fsPath);
      if (M.isTestbench) {
        this.webviewManager.close();
        vscode.window.showInformationMessage(
          `File '${path.basename(d.fsPath)}' was identified as a simulation testbench with non-synthesizable constructs (${M.reasons.slice(0, 3).join(", ")}). RTL schematic generation is only available for synthesizable modules.`,
        );
        return;
      }
      let analyze = this.documentCache.analyze(d.toString(), openTextDocument.version ?? 0, text);
      let ast = analyze.ast;
      let J = ast.modules.find((te) => te.name === m) ?? ast.modules[0];
      if (!J) {
        this.webviewManager.close();
        vscode.window.showWarningMessage(`Verilog module '${m ?? ""}' not found to render.`);
        return;
      }
      if (!k) {
        this.navHistory.length = 0;
        this.navHistory.push({
          uri: d,
          moduleName: J.name,
          label: J.name,
        });
      }
      let X = this.elaborator.elaborateModule(J, analyze.symbolTable);
      let layout = await this.layoutEngine.computeLayout(X);
      let render = this.renderer.render(layout);
      this.currentGraph = X;
      this.outputChannel.appendLine(
        `[Schematic] Circuit '${J.name}' generated with ${layout.nodes.length} nodes and ${layout.connections.length} connections.`,
      );
      let Qe = this.navHistory.map((te) => ({
        label: te.label,
        moduleName: te.moduleName,
      }));
      if (
        !vscode.window.visibleTextEditors.some((te) => te.document.uri.toString() === d.toString())
      ) {
        try {
          let te = vscode.window.visibleTextEditors[0]?.viewColumn ?? vscode.ViewColumn.One;
          await vscode.window.showTextDocument(openTextDocument, {
            viewColumn: te,
            preserveFocus: true,
            preview: false,
          });
        } catch {}
      }
      this.webviewManager.showSchematic(
        `Circuit: ${J.name}`,
        render,
        Qe,
        async (te) => {
          let Oe = d;
          if (!ast.modules.find((Ke) => Ke.name === te)) {
            let Ke = this.moduleResolver.resolveModule(te, d.toString());
            if (Ke.found && Ke.filePath) {
              Oe = vscode.Uri.file(Ke.filePath);
            }
          }
          this.navHistory.push({
            uri: Oe,
            moduleName: te,
            label: te,
          });
          await this.renderSchematicModule(Oe, te, true);
        },
        (te) => {
          this.handleDrillDownMacro(te, d);
        },
        async () => {
          if (this.navHistory.length > 1) {
            this.navHistory.pop();
            let te = this.navHistory[this.navHistory.length - 1];
            await this.renderNavEntry(te);
          }
        },
        (te) => {
          this.selectSignalInActiveEditor(te, J.name);
        },
        async (te) => {
          if (te >= 0 && te < this.navHistory.length - 1) {
            this.navHistory.splice(te + 1);
            let Oe = this.navHistory[this.navHistory.length - 1];
            await this.renderNavEntry(Oe);
          }
        },
        {
          nodeCount: layout.nodes.length,
          notice: partialSchematicBanner(analyze.parserDiagnostics),
        },
      );
    } catch (E) {
      this.webviewManager.close();
      this.outputChannel.appendLine(`[Error] Failed to generate circuit: ${E.message || E}`);
      vscode.window.showErrorMessage(`Error generating circuit: ${E.message || E}`);
    }
  }
  async handleDrillDownMacro(d, m) {
    let k = this.currentGraph?.nodes.find((C) => C.id === d);
    if (!k) {
      this.outputChannel.appendLine(
        `[Schematic] Macro node '${d}' not found in the displayed netlist.`,
      );
      return;
    }
    let subGraph = k.subGraph;
    if (!subGraph) {
      if (((subGraph = expandMacroNode(k)), !subGraph)) {
        vscode.window.showInformationMessage(
          `Theryx: the '${k.label}' macro has no gate-level decomposition available yet.`,
        );
        return;
      }
      k.subGraph = subGraph;
      this.outputChannel.appendLine(
        `[Schematic] Macro '${k.label}' (${k.attributes?.macroType ?? k.type}) decomposed into ${subGraph.nodes.length} nodes.`,
      );
    }
    this.navHistory.push({
      uri: m,
      moduleName: k.id,
      label: `${k.label} (gates)`,
      graph: subGraph,
    });
    await this.renderNavEntry(this.navHistory[this.navHistory.length - 1]);
  }
  async renderNavEntry(d) {
    if (d.graph) {
      await this.renderGraphDirect(d);
    } else {
      await this.renderSchematicModule(d.uri, d.moduleName, true);
    }
  }
  async renderGraphDirect(d) {
    try {
      let graph = d.graph;
      this.currentGraph = graph;
      let layout = await this.layoutEngine.computeLayout(graph);
      let render = this.renderer.render(layout);
      let C = this.navHistory.map((M) => ({
        label: M.label,
        moduleName: M.moduleName,
      }));
      this.webviewManager.showSchematic(
        `Circuit: ${d.label}`,
        render,
        C,
        undefined,
        (M) => {
          this.handleDrillDownMacro(M, d.uri);
        },
        async () => {
          if (this.navHistory.length > 1) {
            this.navHistory.pop();
            let M = this.navHistory[this.navHistory.length - 1];
            await this.renderNavEntry(M);
          }
        },
        (M) => {
          this.selectSignalInActiveEditor(M);
        },
        async (M) => {
          if (M >= 0 && M < this.navHistory.length - 1) {
            this.navHistory.splice(M + 1);
            let v = this.navHistory[this.navHistory.length - 1];
            await this.renderNavEntry(v);
          }
        },
        {
          nodeCount: layout.nodes.length,
        },
      );
    } catch (m) {
      this.webviewManager.close();
      this.outputChannel.appendLine(`[Error] Failed to render decomposed macro: ${m.message || m}`);
      vscode.window.showErrorMessage(`Error rendering macro circuit: ${m.message || m}`);
    }
  }
  selectSignalInActiveEditor(d, m) {
    let k =
      vscode.window.activeTextEditor ??
      vscode.window.visibleTextEditors.find((E) => isVerilogDocument(E.document));
    if (k) {
      try {
        let document = k.document;
        let analyze = this.documentCache.analyze(
          document.uri.toString(),
          document.version ?? 0,
          document.getText(),
        );
        let M = m ? analyze.ast.modules.find((X) => X.name === m) : undefined;
        let v = analyze.tokens.find(
          (X) =>
            X.type === "Identifier" &&
            X.text === d &&
            (!M || (X.span.start.line >= M.span.start.line && X.span.end.line <= M.span.end.line)),
        );
        if (!v) {
          return;
        }
        let R = new vscode.Position(v.span.start.line - 1, v.span.start.column - 1);
        let J = new vscode.Position(v.span.end.line - 1, v.span.end.column - 1);
        k.selection = new vscode.Selection(R, J);
        k.revealRange(
          new vscode.Range(R, J),
          vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
      } catch {}
    }
  }
  onEditorSelection(d) {
    let textEditor = d.textEditor;
    let document = textEditor.document;
    if (isVerilogDocument(document) && this.webviewManager.isVisible()) {
      clearTimeout(this.selectionDebounceTimer);
      this.selectionDebounceTimer = setTimeout(() => {
        let selection = textEditor.selection;
        let C = "";
        if (!selection.isEmpty) {
          C = document.getText(selection).trim();
        } else {
          let wordRangeAtPosition = document.getWordRangeAtPosition(selection.active);
          if (wordRangeAtPosition) {
            C = document.getText(wordRangeAtPosition).trim();
          }
        }
        if (C && /^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(C)) {
          this.webviewManager.highlightSignal(C);
        }
      }, 70);
    }
  }
}
