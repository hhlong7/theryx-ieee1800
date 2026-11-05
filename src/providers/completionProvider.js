import * as vscode from "vscode";
import { CompletionService } from "../language/completionService.js";
import { DocumentCache } from "../analysis/documentCache.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";

export class CompletionProvider {
  completionService = new CompletionService();
  documentCache;
  moduleResolver;
  constructor(documentCache = new DocumentCache(), moduleResolver = new ModuleResolver()) {
    this.documentCache = documentCache;
    this.moduleResolver = moduleResolver;
  }
  provideCompletionItems(document, position, token, context) {
    try {
      let text = document.getText();
      let M = document.uri.toString();
      let analyze = this.documentCache.analyze(M, document.version ?? 0, text);
      let R = position.line + 1;
      let J = position.character + 1;
      let substring = document.lineAt(position.line).text.substring(0, position.character);
      let parts = text.split(/\r?\n/);
      return this.completionService
        .getCompletions(
          analyze.ast,
          analyze.symbolTable,
          R,
          J,
          M,
          substring,
          this.moduleResolver,
          parts,
        )
        .map((Qe) => this.toVscodeItem(Qe));
    } catch {
      return [];
    }
  }
  toVscodeItem(d) {
    let mapKind = this.mapKind(d.kind);
    let k = new vscode.CompletionItem(d.label, mapKind);
    if (d.detail) {
      k.detail = d.detail;
    }
    if (d.documentation) {
      k.documentation = new vscode.MarkdownString(d.documentation);
    }
    if (d.sortText) {
      k.sortText = d.sortText;
    }
    if (d.filterText) {
      k.filterText = d.filterText;
    }
    if (d.isSnippet && d.insertText) {
      k.insertText = new vscode.SnippetString(d.insertText);
    } else {
      if (d.insertText) {
        k.insertText = d.insertText;
      }
    }
    return k;
  }
  mapKind(d) {
    switch (d) {
      case "variable":
        return vscode.CompletionItemKind.Variable;
      case "constant":
        return vscode.CompletionItemKind.Constant;
      case "module":
        return vscode.CompletionItemKind.Class;
      case "property":
        return vscode.CompletionItemKind.Property;
      case "snippet":
        return vscode.CompletionItemKind.Snippet;
      case "keyword":
        return vscode.CompletionItemKind.Keyword;
      default:
        return vscode.CompletionItemKind.Text;
    }
  }
}
