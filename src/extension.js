import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  findUnknownRulePrefixes,
  mergeRulesets,
  parseRuleset,
  validateRuleset,
} from "./lint/rulesConfig.js";
import { defaultRegistry } from "./lint/checkerRegistry.js";
import { ModuleResolver } from "./workspace/moduleResolver.js";
import { DocumentCache } from "./analysis/documentCache.js";
import {
  DiagnosticsProvider,
  isVerilogDocument,
  isVerilogPath,
} from "./providers/diagnosticsProvider.js";
import { CodeLensProvider } from "./providers/codeLensProvider.js";
import { HoverProvider } from "./providers/hoverProvider.js";
import { DefinitionProvider } from "./providers/definitionProvider.js";
import { CompletionProvider } from "./providers/completionProvider.js";
import { CodeActionProvider } from "./providers/codeActionProvider.js";
import { SemanticTokensProvider } from "./providers/semanticTokensProvider.js";
import { DocumentSymbolProvider } from "./providers/documentSymbolProvider.js";
import { FoldingProvider } from "./providers/foldingProvider.js";
import { DocumentHighlightProvider } from "./providers/documentHighlightProvider.js";
import { ReferenceProvider } from "./providers/referenceProvider.js";
import { RenameProvider } from "./providers/renameProvider.js";
import { SignatureHelpProvider } from "./providers/signatureHelpProvider.js";
import { SemanticThemeManager } from "./themes/semanticThemes.js";
import { SchematicController } from "./schematic/schematicController.js";

let diagnosticsProvider;

function loadRules(O, d) {
  let m = loadBuiltinRules(O, d);
  let workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    let fsPath = workspaceFolders[0].uri.fsPath;
    let value = vscode.workspace
      .getConfiguration("theryx.lint")
      .get("rulesPath", ".theryx-rules.json");
    let M = path.isAbsolute(value) ? value : path.join(fsPath, value);
    if (fs.existsSync(M)) {
      try {
        let fileSync = fs.readFileSync(M, "utf-8");
        let ruleset = parseRuleset(fileSync);
        checkRuleset(ruleset, M, d);
        let J = mergeRulesets(m.config, ruleset);
        d?.appendLine(
          `[Linter] Rules loaded from project file: ${M} (overrides builtin rules by id)`,
        );
        return {
          config: J,
          source: M,
        };
      } catch (v) {
        d?.appendLine(`[Linter Warning] Error reading ${M}: ${v.message}. Using default rules.`);
      }
    }
  }
  return m;
}

function loadBuiltinRules(O, d) {
  let m = path.join(O, "rules", "starc-rmm-rules.json");
  let k = path.join(O, "rules", "theryx-rules.json");
  let E = {
    version: "1.0.0",
    rules: [],
  };
  try {
    let fileSync = fs.readFileSync(m, "utf-8");
    E = parseRuleset(fileSync);
    checkRuleset(E, m, d);
    let unknownRulePrefixes = findUnknownRulePrefixes(E, ["STARC-", "RMM-"]);
    logRuleProblems(unknownRulePrefixes, m, d);
  } catch (C) {
    d?.appendLine(`[Linter Warning] Could not load built-in ruleset from ${m}: ${C.message}.`);
    vscode.window.showWarningMessage(
      `Theryx: could not load the built-in STARC/RMM ruleset (${C.message}).`,
    );
  }
  if (fs.existsSync(k)) {
    try {
      let fileSync2 = fs.readFileSync(k, "utf-8");
      let ruleset = parseRuleset(fileSync2);
      checkRuleset(ruleset, k, d);
      let unknownRulePrefixes2 = findUnknownRulePrefixes(ruleset, ["THERYX-"]);
      logRuleProblems(unknownRulePrefixes2, k, d);
      E = mergeRulesets(E, ruleset);
    } catch (C) {
      d?.appendLine(`[Linter Warning] Could not load built-in ruleset from ${k}: ${C.message}.`);
    }
  }
  return E.rules.length === 0
    ? (d?.appendLine("[Linter Warning] No builtin rules loaded. Linting is disabled."),
      {
        config: E,
        source: "empty",
      })
    : {
        config: E,
        source: m,
      };
}

function logRuleProblems(O, d, m) {
  for (let k of O) {
    m?.appendLine(`[Linter Warning] ${d}: ${k.message}`);
  }
}

function checkRuleset(O, d, m) {
  let k = validateRuleset(O, defaultRegistry);
  if (k.length !== 0) {
    m?.appendLine(`[Linter Warning] ${k.length} problem(s) found in the ruleset "${d}":`);
    for (let E of k) {
      m?.appendLine(`[Linter Warning]   ${E.message}`);
    }
    vscode.window.showWarningMessage(
      `Theryx: ${k.length} rule configuration problem(s) in ${path.basename(d)}. Affected rules will not run \u2014 see the Theryx Verilog output channel for details.`,
    );
  }
}

function computeSearchRoots() {
  let O = vscode.workspace.workspaceFolders ?? [];
  let value = vscode.workspace.getConfiguration("theryx").get("moduleSearchPaths", []);
  let m = [];
  for (let k of O) {
    m.push(k.uri.fsPath);
    for (let valueItem of value) {
      m.push(path.isAbsolute(valueItem) ? valueItem : path.join(k.uri.fsPath, valueItem));
    }
  }
  if (O.length === 0) {
    for (let valueItem2 of value) {
      if (path.isAbsolute(valueItem2)) {
        m.push(valueItem2);
      }
    }
  }
  return m;
}

export function activate(O) {
  let outputChannel = vscode.window.createOutputChannel("Theryx Verilog");
  O.subscriptions.push(outputChannel);
  outputChannel.appendLine(
    "[Theryx Verilog] Extension activated successfully (v0.1.2-alpha) \u2014 Author: Luigi C. Filho (LC Desenvolvimentos).",
  );
  let { config: m, source: k } = loadRules(O.extensionPath, outputChannel);
  outputChannel.appendLine(`[Linter] Initial rules configuration: ${k}`);
  let diagnosticCollection = vscode.languages.createDiagnosticCollection("verilog");
  O.subscriptions.push(diagnosticCollection);
  let moduleResolver = new ModuleResolver({
    logger: (Di) => outputChannel.appendLine(Di),
  });
  moduleResolver.setSearchRoots(computeSearchRoots());
  let documentCache = new DocumentCache(moduleResolver);
  diagnosticsProvider = new DiagnosticsProvider(
    diagnosticCollection,
    m,
    outputChannel,
    documentCache,
  );
  let v = (Di) => {
    moduleResolver.clearCache();
    documentCache.clear();
    outputChannel.appendLine(`[Workspace] ${Di} \u2014 re-analyzing open Verilog documents.`);
    for (let textDocument of vscode.workspace.textDocuments) {
      if (isVerilogDocument(textDocument)) {
        diagnosticsProvider?.updateDiagnostics(textDocument, 250);
      }
    }
  };
  let fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/.theryx-rules.json");
  let J = () => {
    let Di = loadRules(O.extensionPath, outputChannel);
    diagnosticsProvider?.setRulesConfig(Di.config);
    outputChannel.appendLine(`[Linter] Rules updated from: ${Di.source}`);
  };
  let fileSystemWatcher2 = vscode.workspace.createFileSystemWatcher("**/*.{v,vh,sv,svh}");
  O.subscriptions.push(
    fileSystemWatcher,
    fileSystemWatcher.onDidCreate(J),
    fileSystemWatcher.onDidChange(J),
    fileSystemWatcher.onDidDelete(J),
    fileSystemWatcher2,
    fileSystemWatcher2.onDidCreate((Di) => v(`Verilog file created: ${path.basename(Di.fsPath)}`)),
    fileSystemWatcher2.onDidChange((Di) =>
      v(`Verilog file changed on disk: ${path.basename(Di.fsPath)}`),
    ),
    fileSystemWatcher2.onDidDelete((Di) => v(`Verilog file deleted: ${path.basename(Di.fsPath)}`)),
    vscode.workspace.onDidCreateFiles((Di) => {
      if (Di.files.some((Js) => isVerilogPath(Js.fsPath))) {
        v("Verilog files created");
      }
    }),
    vscode.workspace.onDidDeleteFiles((Di) => {
      if (Di.files.some((Js) => isVerilogPath(Js.fsPath))) {
        v("Verilog files deleted");
      }
    }),
    vscode.workspace.onDidRenameFiles((Di) => {
      if (
        Di.files.some((Js) => isVerilogPath(Js.oldUri.fsPath) || isVerilogPath(Js.newUri.fsPath))
      ) {
        v("Verilog files renamed");
      }
    }),
    vscode.workspace.onDidChangeConfiguration((Di) => {
      if (Di.affectsConfiguration("theryx.lint.rulesPath")) {
        J();
      }
      if (Di.affectsConfiguration("theryx.moduleSearchPaths")) {
        moduleResolver.setSearchRoots(computeSearchRoots());
        v("Module search paths changed");
      }
    }),
  );
  vscode.workspace.textDocuments.forEach((Di) => diagnosticsProvider?.updateDiagnostics(Di, 0));
  O.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((Di) => diagnosticsProvider?.updateDiagnostics(Di, 250)),
    vscode.workspace.onDidChangeTextDocument((Di) =>
      diagnosticsProvider?.updateDiagnostics(Di.document, 250),
    ),
    vscode.workspace.onDidSaveTextDocument((Di) => {
      if (isVerilogDocument(Di)) {
        v(`Verilog file saved: ${path.basename(Di.fileName)}`);
      } else {
        diagnosticsProvider?.updateDiagnostics(Di, 100);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((Di) => {
      diagnosticsProvider?.clearDiagnostics(Di);
      documentCache.invalidate(Di.uri.toString());
    }),
  );
  let Q = [
    {
      language: "verilog",
      scheme: "file",
    },
    {
      language: "systemverilog",
      scheme: "file",
    },
    {
      pattern: "**/*.{v,vh,sv,svh}",
    },
  ];
  let codeLensProvider = new CodeLensProvider(moduleResolver, documentCache);
  let hoverProvider = new HoverProvider(documentCache, moduleResolver);
  let definitionProvider = new DefinitionProvider(documentCache, moduleResolver);
  let completionProvider = new CompletionProvider(documentCache, moduleResolver);
  let codeActionProvider = new CodeActionProvider();
  let semanticTokensProvider = new SemanticTokensProvider(documentCache, moduleResolver);
  let documentSymbolProvider = new DocumentSymbolProvider(documentCache);
  let foldingProvider = new FoldingProvider(documentCache);
  let documentHighlightProvider = new DocumentHighlightProvider(documentCache);
  let referenceProvider = new ReferenceProvider(documentCache);
  let renameProvider = new RenameProvider(documentCache);
  let signatureHelpProvider = new SignatureHelpProvider(documentCache, moduleResolver);
  O.subscriptions.push(
    vscode.languages.registerCodeLensProvider(Q, codeLensProvider),
    vscode.languages.registerHoverProvider(Q, hoverProvider),
    vscode.languages.registerDefinitionProvider(Q, definitionProvider),
    vscode.languages.registerCompletionItemProvider(Q, completionProvider, ".", "`"),
    vscode.languages.registerCodeActionsProvider(Q, codeActionProvider, {
      providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(
      Q,
      semanticTokensProvider,
      SemanticTokensProvider.legend,
    ),
    vscode.languages.registerDocumentSymbolProvider(Q, documentSymbolProvider),
    vscode.languages.registerFoldingRangeProvider(Q, foldingProvider),
    vscode.languages.registerDocumentHighlightProvider(Q, documentHighlightProvider),
    vscode.languages.registerReferenceProvider(Q, referenceProvider),
    vscode.languages.registerRenameProvider(Q, renameProvider),
    vscode.languages.registerSignatureHelpProvider(
      Q,
      signatureHelpProvider,
      ...SignatureHelpProvider.triggerCharacters,
    ),
  );
  let value = vscode.workspace.getConfiguration("theryx").get("semanticTheme", "theryx-dark");
  SemanticThemeManager.applyTheme(value, outputChannel).catch((Di) => {
    outputChannel.appendLine(`[Warning] Failed to apply semantic theme: ${Di}`);
  });
  O.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (Di) => {
      if (
        Di.affectsConfiguration("theryx.semanticTheme") ||
        Di.affectsConfiguration("workbench.colorTheme")
      ) {
        let value = vscode.workspace.getConfiguration("theryx").get("semanticTheme", "theryx-dark");
        await SemanticThemeManager.applyTheme(value, outputChannel);
      }
    }),
  );
  let schematicController = new SchematicController({
    outputChannel: outputChannel,
    documentCache: documentCache,
    moduleResolver: moduleResolver,
    extensionPath: O.extensionPath,
  });
  schematicController.register(O.subscriptions);
  O.subscriptions.push(schematicController);
  O.subscriptions.push(
    vscode.commands.registerCommand("theryx.selectSemanticTheme", async () => {
      await SemanticThemeManager.selectThemeInteractive(outputChannel);
    }),
    vscode.commands.registerCommand("theryx.resetSemanticTheme", async () => {
      await SemanticThemeManager.resetTheme(outputChannel);
      vscode.window.showInformationMessage(
        "Theryx: semantic theme colours removed from the workspace settings.",
      );
    }),
    vscode.commands.registerCommand("theryx.createRulesConfig", async () => {
      let workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage(
          "Open a project folder in VS Code to create the .theryx-rules.json file.",
        );
        return;
      }
      let fsPath = workspaceFolders[0].uri.fsPath;
      let Qa = path.join(fsPath, ".theryx-rules.json");
      if (fs.existsSync(Qa)) {
        let openTextDocument = await vscode.workspace.openTextDocument(Qa);
        await vscode.window.showTextDocument(openTextDocument);
        vscode.window.showInformationMessage(
          "The .theryx-rules.json file already exists in the project root and was opened.",
        );
        return;
      }
      let od = path.join(O.extensionPath, "rules", "starc-rmm-rules.json");
      let Sb = "";
      try {
        Sb = fs.readFileSync(od, "utf-8");
      } catch {
        Sb = JSON.stringify(
          {
            version: "1.0.0",
            rules: [],
          },
          null,
          2,
        );
      }
      try {
        let parse = JSON.parse(Sb);
        if (parse && typeof parse == "object") {
          delete parse.$schema;
          Sb =
            JSON.stringify(parse, null, 2) +
            `
`;
        }
      } catch {}
      fs.writeFileSync(Qa, Sb, "utf-8");
      let openTextDocument2 = await vscode.workspace.openTextDocument(Qa);
      await vscode.window.showTextDocument(openTextDocument2);
      vscode.window.showInformationMessage(
        ".theryx-rules.json file created successfully in the project root!",
      );
    }),
  );
}

export function deactivate() {
  diagnosticsProvider = undefined;
}
