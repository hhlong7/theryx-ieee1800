import * as vscode from "vscode";
import { DocumentCache } from "../analysis/documentCache.js";
import {
  collectReferences,
  identifierTokenAt,
  moduleNameAtLine,
} from "../analysis/referenceCollector.js";
import { spanToRange } from "./diagnosticsProvider.js";

export class ReferenceProvider {
  documentCache;
  constructor(documentCache = new DocumentCache()) {
    this.documentCache = documentCache;
  }
  provideReferences(document, position, context, token) {
    try {
      let text = document.getText();
      let M = document.uri.toString();
      let analyze = this.documentCache.analyze(M, document.version ?? 0, text);
      let R = position.line + 1;
      let J = position.character + 1;
      let X = identifierTokenAt(analyze.tokens, R, J);
      if (!X) {
        return [];
      }
      let Q = moduleNameAtLine(analyze.ast, R);
      return collectReferences(analyze.ast, X.text, Q).map(
        (Qe) => new vscode.Location(document.uri, spanToRange(Qe.span)),
      );
    } catch {
      return [];
    }
  }
}
