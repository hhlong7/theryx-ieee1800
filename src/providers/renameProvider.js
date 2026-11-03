import * as vscode from "vscode";
import { DocumentCache } from "../analysis/documentCache.js";
import {
  collectReferences,
  identifierTokenAt,
  moduleNameAtLine,
} from "../analysis/referenceCollector.js";
import { spanToRange } from "./diagnosticsProvider.js";

export class RenameProvider {
  documentCache;
  constructor(documentCache = new DocumentCache()) {
    this.documentCache = documentCache;
  }
  prepareRename(document, position, token) {
    try {
      let text = document.getText();
      let C = document.uri.toString();
      let analyze = this.documentCache.analyze(C, document.version ?? 0, text);
      let v = identifierTokenAt(analyze.tokens, position.line + 1, position.character + 1);
      return v
        ? {
            range: spanToRange(v.span),
            placeholder: v.text,
          }
        : undefined;
    } catch {
      return;
    }
  }
  provideRenameEdits(document, position, newName, token) {
    try {
      if (!newName || !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(newName)) {
        return;
      }
      let text = document.getText();
      let M = document.uri.toString();
      let analyze = this.documentCache.analyze(M, document.version ?? 0, text);
      let R = position.line + 1;
      let J = position.character + 1;
      let X = identifierTokenAt(analyze.tokens, R, J);
      if (!X || X.text === newName) {
        return;
      }
      let Q = moduleNameAtLine(analyze.ast, R);
      let references = collectReferences(analyze.ast, X.text, Q);
      if (references.length === 0) {
        return;
      }
      let Qe = new vscode.WorkspaceEdit();
      for (let reference of references) {
        Qe.replace(document.uri, spanToRange(reference.span), newName);
      }
      return Qe;
    } catch {
      return;
    }
  }
}
