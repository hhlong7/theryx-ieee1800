import * as vscode from "vscode";
import { DocumentCache } from "../analysis/documentCache.js";

export class FoldingProvider {
  documentCache;
  constructor(documentCache = new DocumentCache()) {
    this.documentCache = documentCache;
  }
  provideFoldingRanges(document, token) {
    let text = document.getText();
    let analyze = this.documentCache.analyze(document.uri.toString(), document.version ?? 0, text);
    let C = [];
    let M = new Set();
    for (let unit of [...(analyze.ast.packages ?? []), ...(analyze.ast.classes ?? [])]) {
      this.pushRange(unit.span, C, M);
    }
    for (let moduleItem of analyze.ast.modules) {
      this.pushRange(moduleItem.span, C, M);
      this.collectItems(moduleItem.items, C, M);
    }
    return C;
  }
  pushRange(d, m, k) {
    let E = d.start.line - 1;
    let C = d.end.line - 1;
    if (C <= E) {
      return;
    }
    let M = `${E}:${C}`;
    if (!k.has(M)) {
      k.add(M);
      m.push(new vscode.FoldingRange(E, C, vscode.FoldingRangeKind.Region));
    }
  }
  collectItems(d, m, k) {
    for (let E of d) {
      this.collectItem(E, m, k);
    }
  }
  collectItem(d, m, k) {
    switch (d.kind) {
      case "AlwaysBlock":
        this.pushRange(d.span, m, k);
        this.collectStatement(d.statement, m, k);
        break;
      case "InitialBlock":
        this.pushRange(d.span, m, k);
        this.collectStatement(d.statement, m, k);
        break;
      case "FunctionDeclaration":
        this.pushRange(d.span, m, k);
        this.collectStatements(d.statements, m, k);
        break;
      case "TaskDeclaration":
        this.pushRange(d.span, m, k);
        this.collectStatements(d.statements, m, k);
        break;
      case "GenerateBlock":
        this.pushRange(d.span, m, k);
        this.collectItems(d.items, m, k);
        this.collectStatements(d.statements, m, k);
        break;
      default:
        break;
    }
  }
  collectStatements(d, m, k) {
    for (let E of d) {
      this.collectStatement(E, m, k);
    }
  }
  collectStatement(d, m, k) {
    switch (d.kind) {
      case "BlockStatement":
        this.pushRange(d.span, m, k);
        this.collectStatements(d.statements, m, k);
        break;
      case "IfStatement":
        this.collectStatement(d.thenBranch, m, k);
        if (d.elseBranch) {
          this.collectStatement(d.elseBranch, m, k);
        }
        break;
      case "CaseStatement":
        this.pushRange(d.span, m, k);
        for (let item of d.items) {
          this.collectStatement(item.statement, m, k);
        }
        break;
      case "LoopStatement":
        this.collectStatement(d.body, m, k);
        break;
      case "GenerateLoopStatement":
        this.collectStatement(d.body, m, k);
        break;
      case "GenerateBlockStatement":
        this.pushRange(d.span, m, k);
        this.collectItems(d.items, m, k);
        this.collectStatements(d.statements, m, k);
        break;
      default:
        break;
    }
  }
}
