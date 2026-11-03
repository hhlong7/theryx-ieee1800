import * as vscode from "vscode";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { DocumentCache } from "../analysis/documentCache.js";
import { isVerilogDocument } from "./diagnosticsProvider.js";
import { detectTestbench } from "../lint/testbenchDetector.js";

export class CodeLensProvider {
  moduleResolver;
  documentCache;
  constructor(moduleResolver = new ModuleResolver(), documentCache = new DocumentCache()) {
    this.moduleResolver = moduleResolver;
    this.documentCache = documentCache;
  }
  provideCodeLenses(document) {
    if (!isVerilogDocument(document)) {
      return [];
    }
    let text = document.getText();
    let uri = document.uri;
    if (
      vscode.workspace.getConfiguration("theryx.lint").get("ignoreTestbenches", true) &&
      detectTestbench(text, document.fileName).isTestbench
    ) {
      return [];
    }
    let ast = this.documentCache.analyze(uri.toString(), document.version ?? 0, text).ast;
    let v = [];
    for (let moduleItem of ast.modules) {
      let maxValue = Math.max(0, moduleItem.span.start.line - 1);
      let X = new vscode.Range(maxValue, 0, maxValue, 0);
      v.push(
        new vscode.CodeLens(X, {
          title: `$(circuit-board) View Module Schematic '${moduleItem.name}'`,
          command: "verilog.showFullModuleSchematic",
          arguments: [uri, moduleItem.name],
        }),
      );
      for (let item of moduleItem.items) {
        if (item.kind === "ContinuousAssign" || item.kind === "AlwaysBlock") {
          let maxValue2 = Math.max(0, item.span.start.line - 1);
          let Qe = new vscode.Range(maxValue2, 0, maxValue2, 0);
          let le =
            item.kind === "ContinuousAssign"
              ? "$(eye) Inspect Subcircuit (Assign)"
              : "$(eye) Inspect Subcircuit (Always)";
          v.push(
            new vscode.CodeLens(Qe, {
              title: le,
              command: "verilog.showSubcircuitSchematic",
              arguments: [uri, moduleItem.name, item.span.start.line],
            }),
          );
        } else if (item.kind === "InstanceDeclaration") {
          let maxValue3 = Math.max(0, item.span.start.line - 1);
          let Qe = new vscode.Range(maxValue3, 0, maxValue3, 0);
          v.push(
            new vscode.CodeLens(Qe, {
              title: "$(circuit-board) Inspect Submodule",
              command: "verilog.showInstanceSchematic",
              arguments: [uri, moduleItem.name, item.moduleName, item.instanceName],
            }),
          );
          let le = this.moduleResolver.resolveModule(item.moduleName, uri.toString());
          if (le.found && le.filePath) {
            v.push(
              new vscode.CodeLens(Qe, {
                title: "$(go-to-file) Open Source",
                command: "verilog.openModuleFile",
                arguments: [le.filePath],
              }),
            );
          }
        }
      }
    }
    return v;
  }
}
