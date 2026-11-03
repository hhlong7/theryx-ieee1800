import * as vscode from "vscode";
import { DefinitionService } from "../language/definitionService.js";
import { DocumentCache } from "../analysis/documentCache.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { spanToRange } from "./diagnosticsProvider.js";

export class DefinitionProvider {
  definitionService = new DefinitionService();
  documentCache;
  moduleResolver;
  constructor(documentCache = new DocumentCache(), moduleResolver = new ModuleResolver()) {
    this.documentCache = documentCache;
    this.moduleResolver = moduleResolver;
  }
  provideDefinition(document, position, token) {
    try {
      let text = document.getText();
      let C = document.uri.toString();
      let analyze = this.documentCache.analyze(C, document.version ?? 0, text);
      let v = position.line + 1;
      let R = position.character + 1;
      let definition = this.definitionService.findDefinition(
        analyze.ast,
        analyze.symbolTable,
        v,
        R,
        C,
        this.moduleResolver,
      );
      if (!definition) {
        return;
      }
      let parse = vscode.Uri.parse(definition.targetUri);
      let Q = spanToRange(definition.targetSpan);
      return new vscode.Location(parse, Q);
    } catch {
      return;
    }
  }
}
