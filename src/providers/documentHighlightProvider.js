import * as vscode from "vscode";
import { DocumentCache } from "../analysis/documentCache.js";

function spanToRange_2(O) {
  return new vscode.Range(
    Math.max(0, O.start.line - 1),
    Math.max(0, O.start.column - 1),
    Math.max(0, O.end.line - 1),
    Math.max(0, O.end.column - 1),
  );
}

export class DocumentHighlightProvider {
  documentCache;
  constructor(documentCache = new DocumentCache()) {
    this.documentCache = documentCache;
  }
  provideDocumentHighlights(document, position, token) {
    let text = document.getText();
    let analyze = this.documentCache.analyze(document.uri.toString(), document.version ?? 0, text);
    let identifierToken = this.findIdentifierToken(analyze.tokens, position);
    if (!identifierToken) {
      return [];
    }
    let enclosingModule = this.findEnclosingModule(analyze.ast.modules, position.line + 1);
    return analyze.tokens
      .filter((R) => R.type === "Identifier")
      .filter((R) => R.text === identifierToken.text)
      .filter((R) => this.isInScope(R, enclosingModule))
      .map(
        (R) =>
          new vscode.DocumentHighlight(spanToRange_2(R.span), vscode.DocumentHighlightKind.Text),
      );
  }
  findIdentifierToken(d, m) {
    let k = m.line + 1;
    let E = m.character + 1;
    for (let C of d) {
      if (C.type !== "Identifier") {
        continue;
      }
      let { start: M, end: v } = C.span;
      if (!(M.line !== k || v.line !== k) && ((E >= M.column && E < v.column) || E === v.column)) {
        return C;
      }
    }
  }
  findEnclosingModule(d, m) {
    return d.find((k) => k.span.start.line <= m && k.span.end.line >= m);
  }
  isInScope(d, m) {
    return m
      ? d.span.start.line >= m.span.start.line && d.span.start.line <= m.span.end.line
      : true;
  }
}
