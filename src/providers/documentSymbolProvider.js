import * as vscode from "vscode";
import { DocumentCache } from "../analysis/documentCache.js";
import { spanToRange } from "./diagnosticsProvider.js";

function joinNames(O) {
  return O.map((d) => d.name).join(", ");
}

function firstSpan(O) {
  return O.length > 0 ? O[0].span : undefined;
}

function sensitivityLabel(O) {
  return O.length === 0
    ? "always"
    : O.map((d) => {
        if (d.edge === "all") {
          return "*";
        }
        let m = d.signal?.name ?? "";
        return d.edge === "none" ? m : `${d.edge} ${m}`;
      }).join(", ");
}

export class DocumentSymbolProvider {
  documentCache;
  constructor(documentCache = new DocumentCache()) {
    this.documentCache = documentCache;
  }
  provideDocumentSymbols(document, token) {
    let text = document.getText();
    let { ast } = this.documentCache.analyze(document.uri.toString(), document.version ?? 0, text);
    return [
      ...(ast.packages ?? []).map((C) => this.buildPackageSymbol(C)),
      ...(ast.classes ?? []).map((C) =>
        this.createSymbol(C.name, "class", vscode.SymbolKind.Class, C.span, C.nameSpan ?? C.span),
      ),
      ...ast.modules.map((C) => this.buildModuleSymbol(C)),
    ];
  }
  buildPackageSymbol(d) {
    let m = new vscode.DocumentSymbol(
      d.name,
      "package",
      vscode.SymbolKind.Package,
      spanToRange(d.span),
      spanToRange(d.nameSpan ?? d.span),
    );
    m.children = d.items.flatMap((k) => {
      if (k.kind === "TypedefDeclaration") {
        return [this.createSymbol(k.name, "typedef", vscode.SymbolKind.Struct, k.span, k.nameSpan ?? k.span)];
      }
      if (k.kind === "ParameterDeclaration") {
        return [this.buildItemSymbol(k)];
      }
      if (k.kind === "FunctionDeclaration" || k.kind === "TaskDeclaration") {
        return [this.createSymbol(k.name, k.kind === "TaskDeclaration" ? "task" : "function", vscode.SymbolKind.Function, k.span, k.nameSpan ?? k.span)];
      }
      return [];
    });
    return m;
  }
  buildModuleSymbol(d) {
    let m = new vscode.DocumentSymbol(
      d.name,
      d.designUnit ?? "module",
      d.designUnit === "interface" ? vscode.SymbolKind.Interface : vscode.SymbolKind.Module,
      spanToRange(d.span),
      spanToRange(d.nameSpan ?? d.span),
    );
    m.children = d.items.map((k) => this.buildItemSymbol(k));
    return m;
  }
  buildItemSymbol(d) {
    let kind = d.kind;
    let span = d.span;
    switch (d.kind) {
      case "PortDeclaration":
        return this.createSymbol(
          joinNames(d.identifiers),
          d.direction,
          vscode.SymbolKind.Interface,
          d.span,
          firstSpan(d.identifiers) ?? d.span,
        );
      case "NetDeclaration":
        return this.createSymbol(
          joinNames(d.identifiers),
          d.netType,
          vscode.SymbolKind.Variable,
          d.span,
          firstSpan(d.identifiers) ?? d.span,
        );
      case "ParameterDeclaration":
        return this.createSymbol(
          d.parameters.map((E) => E.name).join(", "),
          d.isLocal ? "localparam" : "parameter",
          vscode.SymbolKind.Constant,
          d.span,
          (d.parameters.length > 0 ? d.parameters[0].span : undefined) ?? d.span,
        );
      case "ContinuousAssign":
        return this.createSymbol(
          "assign",
          this.describeAssignTarget(d),
          vscode.SymbolKind.Object,
          d.span,
          this.keywordSpan(d.span, "assign"),
        );
      case "AlwaysBlock":
        return this.createSymbol(
          "always",
          sensitivityLabel(d.sensitivities),
          vscode.SymbolKind.Method,
          d.span,
          this.keywordSpan(d.span, "always"),
        );
      case "InstanceDeclaration":
        return this.createSymbol(
          d.instanceName,
          d.moduleName,
          vscode.SymbolKind.Class,
          d.span,
          d.instanceNameSpan ?? d.span,
        );
      case "GenerateBlock":
        return this.createSymbol(
          "generate",
          "generate region",
          vscode.SymbolKind.Namespace,
          d.span,
          this.keywordSpan(d.span, "generate"),
        );
      case "GenvarDeclaration":
        return this.createSymbol(
          joinNames(d.identifiers),
          "genvar",
          vscode.SymbolKind.Variable,
          d.span,
          firstSpan(d.identifiers) ?? d.span,
        );
      case "FunctionDeclaration":
        return this.createSymbol(
          d.name,
          d.returnType ? `function ${d.returnType}` : "function",
          vscode.SymbolKind.Function,
          d.span,
          d.nameSpan ?? d.span,
        );
      case "TaskDeclaration":
        return this.createSymbol(
          d.name,
          "task",
          vscode.SymbolKind.Method,
          d.span,
          d.nameSpan ?? d.span,
        );
      case "InitialBlock":
        return this.createSymbol(
          "initial",
          "initial",
          vscode.SymbolKind.Method,
          d.span,
          this.keywordSpan(d.span, "initial"),
        );
      case "VariableDeclaration":
        return this.createSymbol(
          joinNames(d.identifiers),
          d.dataType,
          vscode.SymbolKind.Variable,
          d.span,
          firstSpan(d.identifiers) ?? d.span,
        );
      case "GateInstantiation": {
        let E = d.instances.length > 0 ? d.instances[0] : undefined;
        return this.createSymbol(
          d.instances.map((C) => C.name).join(", "),
          d.gateType,
          vscode.SymbolKind.Object,
          d.span,
          E?.nameSpan ?? d.span,
        );
      }
      default:
        return this.createSymbol(kind, "", vscode.SymbolKind.Object, span, span);
    }
  }
  createSymbol(d, m, k, E, C) {
    return new vscode.DocumentSymbol(d, m, k, spanToRange(E), spanToRange(C));
  }
  keywordSpan(d, m) {
    let maxValue = Math.max(1, d.start.column);
    let minValue = Math.min(d.end.column, maxValue + m.length);
    return {
      fileUri: d.fileUri,
      start: {
        line: d.start.line,
        column: maxValue,
      },
      end: {
        line: d.end.line,
        column: Math.max(maxValue, minValue),
      },
    };
  }
  describeAssignTarget(d) {
    return d.lhs.kind === "Identifier" ? d.lhs.name : "continuous assignment";
  }
}
