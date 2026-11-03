import * as vscode from "vscode";
import { Linter } from "../lint/linter.js";
import { DocumentCache } from "../analysis/documentCache.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { detectTestbench } from "../lint/testbenchDetector.js";

export function isVerilogPath(O) {
  return /\.(v|vh|sv|svh)$/i.test(O);
}

export function isVerilogDocument(O) {
  return O.languageId === "verilog" || O.languageId === "systemverilog" ? true : isVerilogPath(O.fileName);
}

export function spanToRange(O) {
  let maxValue = Math.max(0, O.start.line - 1);
  let maxValue2 = Math.max(0, O.start.column - 1);
  let maxValue3 = Math.max(0, O.end.line - 1);
  let maxValue4 = Math.max(maxValue2 + 1, O.end.column - 1);
  return new vscode.Range(
    new vscode.Position(maxValue, maxValue2),
    new vscode.Position(maxValue3, maxValue4),
  );
}

export class DiagnosticsProvider {
  collection;
  config;
  linter;
  debounceTimers = new Map();
  outputChannel;
  documentCache;
  constructor(collection, config, outputChannel, E) {
    this.collection = collection;
    this.config = config;
    this.linter = new Linter(this.config);
    this.outputChannel = outputChannel;
    this.documentCache = E ?? new DocumentCache(new ModuleResolver());
  }
  setRulesConfig(d) {
    this.config = d;
    this.linter = new Linter(this.config);
    vscode.workspace.textDocuments.forEach((m) => {
      this.updateDiagnostics(m, 0);
    });
  }
  updateDiagnostics(d, m = 0) {
    if (!isVerilogDocument(d)) {
      return;
    }
    let k = d.uri.toString();
    let value = this.debounceTimers.get(k);
    if ((value && (clearTimeout(value), this.debounceTimers.delete(k)), m > 0)) {
      let C = setTimeout(() => {
        this.debounceTimers.delete(k);
        this.doUpdate(d);
      }, m);
      this.debounceTimers.set(k, C);
    } else {
      this.doUpdate(d);
    }
  }
  doUpdate(d) {
    let text = d.getText();
    let uri = d.uri;
    if (vscode.workspace.getConfiguration("theryx.lint").get("ignoreTestbenches", true)) {
      let J = detectTestbench(text, d.fileName);
      if (J.isTestbench) {
        this.collection.delete(uri);
        this.outputChannel?.appendLine(
          `[Testbench] ${d.fileName} detected as simulation testbench (score: ${J.score}, ${J.reasons.join(", ")}). Linting and error squiggles suppressed.`,
        );
        return;
      }
    }
    let analyze = this.documentCache.analyze(uri.toString(), d.version ?? 0, text);
    let lint = this.linter.lint(analyze.ast, analyze.symbolTable);
    let v = [...analyze.parserDiagnostics, ...analyze.semanticDiagnostics, ...lint];
    let R = v.map((J) => {
      let X = spanToRange(J.span);
      let mapSeverity = this.mapSeverity(J.severity);
      let Re = new vscode.Diagnostic(X, J.message, mapSeverity);
      if (J.code) {
        Re.code = J.code;
        Re.source = J.code.startsWith("SYNTAX-") ? "Verilog Parser" : "STARC/RMM Linter";
      } else {
        Re.source = "Verilog Parser";
      }
      return Re;
    });
    this.collection.set(uri, R);
    this.outputChannel?.appendLine(`[Linter] ${d.fileName}: ${v.length} issue(s) detected.`);
    for (let J of v) {
      if (J.message.includes("not found") || J.message.includes("n\xE3o encontrado")) {
        this.outputChannel?.appendLine(`[Error/Hierarchy] ${J.message}`);
      }
    }
  }
  clearDiagnostics(d) {
    let m = d.uri.toString();
    let value = this.debounceTimers.get(m);
    if (value) {
      clearTimeout(value);
      this.debounceTimers.delete(m);
    }
    this.collection.delete(d.uri);
  }
  mapSeverity(d) {
    switch (d) {
      case "error":
        return vscode.DiagnosticSeverity.Error;
      case "warning":
        return vscode.DiagnosticSeverity.Warning;
      case "info":
        return vscode.DiagnosticSeverity.Information;
      case "hint":
        return vscode.DiagnosticSeverity.Hint;
      default:
        this.outputChannel?.appendLine(
          `[Linter] Unknown severity '${String(d)}' \u2014 falling back to Warning.`,
        );
        return vscode.DiagnosticSeverity.Warning;
    }
  }
}
