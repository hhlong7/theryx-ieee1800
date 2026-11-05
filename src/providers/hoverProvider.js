import * as vscode from "vscode";
import { HoverService } from "../language/hoverService.js";
import { DocumentCache } from "../analysis/documentCache.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { spanToRange } from "./diagnosticsProvider.js";

export class HoverProvider {
  hoverService = new HoverService();
  documentCache;
  moduleResolver;
  constructor(documentCache = new DocumentCache(), moduleResolver = new ModuleResolver()) {
    this.documentCache = documentCache;
    this.moduleResolver = moduleResolver;
  }
  provideHover(document, position, token) {
    try {
      let text = document.getText();
      let C = document.uri.toString();
      let analyze = this.documentCache.analyze(C, document.version ?? 0, text);
      let v = position.line + 1;
      let R = position.character + 1;
      let hoverInfo = this.hoverService.getHoverInfo(
        analyze.ast,
        analyze.symbolTable,
        v,
        R,
        C,
        this.moduleResolver,
      );
      if (!hoverInfo) {
        return;
      }
      let X = new vscode.MarkdownString();
      X.appendCodeblock(hoverInfo.codeSignature, "verilog");
      if (hoverInfo.description) {
        X.appendMarkdown(
          `

` + hoverInfo.description,
        );
      }
      let Q;
      if (hoverInfo.range) {
        Q = spanToRange(hoverInfo.range);
      }
      return new vscode.Hover(X, Q);
    } catch {
      return;
    }
  }
}
