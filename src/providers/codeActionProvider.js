import * as vscode from "vscode";
import { QuickFixService } from "../language/quickFixService.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { parseSource } from "../parser/sourceParser.js";

export class CodeActionProvider {
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  quickFixService = new QuickFixService();
  moduleResolver = new ModuleResolver();
  provideCodeActions(document, range, context, token) {
    if (!context.diagnostics || context.diagnostics.length === 0) {
      return [];
    }
    let text = document.getText();
    let parts = text.split(/\r?\n/);
    let v = document.uri.toString();
    let R;
    try {
      R = parseSource(text, v, this.moduleResolver).ast;
    } catch {}
    let J = context.diagnostics.map((Q) => ({
      code:
        typeof Q.code == "object"
          ? String(Q.code.value)
          : Q.code !== undefined
            ? String(Q.code)
            : undefined,
      message: Q.message,
      span: {
        fileUri: v,
        start: {
          line: Q.range.start.line + 1,
          column: Q.range.start.character + 1,
        },
        end: {
          line: Q.range.end.line + 1,
          column: Q.range.end.character + 1,
        },
      },
    }));
    let quickFixes = this.quickFixService.getQuickFixes(parts, J, R, this.moduleResolver, v);
    return quickFixes.length === 0
      ? []
      : quickFixes.map((Q) => {
          let Re = new vscode.CodeAction(Q.title, vscode.CodeActionKind.QuickFix);
          if ((Q.isPreferred && (Re.isPreferred = Q.isPreferred), Q.diagnosticCode)) {
            let le = context.diagnostics.find(
              (te) =>
                (typeof te.code == "object" ? String(te.code.value) : String(te.code)) ===
                Q.diagnosticCode,
            );
            if (le) {
              Re.diagnostics = [le];
            }
          }
          let Qe = new vscode.WorkspaceEdit();
          for (let edit of Q.edits) {
            let te = new vscode.Range(
              new vscode.Position(edit.startLine - 1, edit.startColumn - 1),
              new vscode.Position(edit.endLine - 1, edit.endColumn - 1),
            );
            Qe.replace(document.uri, te, edit.newText);
          }
          Re.edit = Qe;
          return Re;
        });
  }
}
