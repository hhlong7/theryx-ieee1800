import * as vscode from "vscode";
import { SignatureHelpService } from "../language/signatureHelpService.js";
import { DocumentCache } from "../analysis/documentCache.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";

export class SignatureHelpProvider {
  static triggerCharacters = ["(", ","];
  signatureService = new SignatureHelpService();
  documentCache;
  moduleResolver;
  constructor(documentCache = new DocumentCache(), moduleResolver = new ModuleResolver()) {
    this.documentCache = documentCache;
    this.moduleResolver = moduleResolver;
  }
  provideSignatureHelp(document, position, token, context) {
    try {
      let C = document.uri.toString();
      let analyze = this.documentCache.analyze(C, document.version ?? 0, document.getText());
      let signatureHelp = this.signatureService.getSignatureHelp(
        analyze.ast,
        position.line + 1,
        position.character + 1,
        C,
        this.moduleResolver,
        document.getText().split(/\r?\n/),
      );
      if (!signatureHelp || signatureHelp.parameters.length === 0) {
        return;
      }
      let R = new vscode.SignatureInformation(signatureHelp.signature);
      R.parameters = signatureHelp.parameters.map((X) => {
        let Q = new vscode.ParameterInformation(X.label);
        Q.documentation = new vscode.MarkdownString(X.documentation);
        return Q;
      });
      let J = new vscode.SignatureHelp();
      J.signatures = [R];
      J.activeSignature = 0;
      J.activeParameter = Math.min(
        signatureHelp.activeParameter,
        Math.max(0, signatureHelp.parameters.length - 1),
      );
      return J;
    } catch {
      return;
    }
  }
}
