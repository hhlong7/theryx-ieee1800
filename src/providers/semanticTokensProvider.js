import * as vscode from "vscode";
import { DocumentCache } from "../analysis/documentCache.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { walkItems } from "../lint/rtlCheckers.js";

const TOKEN_TYPES = [
  "clock",
  "reset",
  "reg",
  "wire",
  "portInput",
  "portOutput",
  "portInout",
  "verilogParameter",
  "moduleDef",
  "moduleInstance",
];

const TOKEN_MODIFIERS = ["declaration", "definition", "readonly"];

function isClockName(O) {
  return /^(clk|clock|clk_.*|.*_clk|.*clk|.*clock)$/i.test(O);
}

function isResetName(O) {
  return /^(rst|reset|rst_n|.*_rst|.*_rst_n|.*rst|.*rst_n)$/i.test(O);
}

export class SemanticTokensProvider {
  static legend = new vscode.SemanticTokensLegend([...TOKEN_TYPES], [...TOKEN_MODIFIERS]);
  documentCache;
  moduleResolver;
  constructor(documentCache = new DocumentCache(), moduleResolver = new ModuleResolver()) {
    this.documentCache = documentCache;
    this.moduleResolver = moduleResolver;
  }
  provideDocumentSemanticTokens(document, token) {
    let k = new vscode.SemanticTokensBuilder(SemanticTokensProvider.legend);
    try {
      let text = document.getText();
      let C = document.uri.toString();
      let analyze = this.documentCache.analyze(C, document.version ?? 0, text);
      let tokens = analyze.tokens;
      let ast = analyze.ast;
      let symbolTable = analyze.symbolTable;
      let X = new Set(ast.modules.map((le) => le.name));
      let Q = new Set();
      let Re = new Map();
      let Qe = new Map();
      for (let moduleItem of ast.modules) {
        let te = new Set();
        let Oe = new Set();
        for (let _e of walkItems(moduleItem.items)) {
          if (_e.kind === "AlwaysBlock") {
            for (let sensitivity of _e.sensitivities) {
              if (!(
                !sensitivity.signal ||
                (sensitivity.edge !== "posedge" && sensitivity.edge !== "negedge")
              )) {
                if (isResetName(sensitivity.signal.name)) {
                  Oe.add(sensitivity.signal.name);
                } else {
                  te.add(sensitivity.signal.name);
                }
              }
            }
          }
        }
        Re.set(moduleItem.name, te);
        Qe.set(moduleItem.name, Oe);
      }
      for (let moduleItem2 of ast.modules) {
        for (let item of moduleItem2.items) {
          if (item.kind === "InstanceDeclaration") {
            Q.add(item.instanceName);
          }
        }
      }
      for (let le = 0; le < tokens.length; le++) {
        let te = tokens[le];
        if (te.type !== "Identifier") {
          continue;
        }
        let text2 = te.text;
        let _e = te.span.start.line - 1;
        let Ke = te.span.start.column - 1;
        let count = te.text.length;
        if (X.has(text2)) {
          this.pushToken(k, _e, Ke, count, "moduleDef");
          continue;
        }
        if (Q.has(text2)) {
          this.pushToken(k, _e, Ke, count, "moduleInstance");
          continue;
        }
        let enclosingModule = this.findEnclosingModule(ast, te.span.start.line);
        let resolve = (
          enclosingModule ? symbolTable.getModuleScope(enclosingModule.name) : undefined
        )?.resolve(text2);
        if (enclosingModule && Qe.get(enclosingModule.name)?.has(text2)) {
          this.pushToken(k, _e, Ke, count, "reset");
          continue;
        }
        if (enclosingModule && Re.get(enclosingModule.name)?.has(text2)) {
          this.pushToken(k, _e, Ke, count, "clock");
          continue;
        }
        if (resolve) {
          if (resolve.kind === "port") {
            if (resolve.direction === "input") {
              this.pushToken(k, _e, Ke, count, "portInput");
            } else {
              if (resolve.direction === "output") {
                this.pushToken(k, _e, Ke, count, "portOutput");
              } else {
                this.pushToken(k, _e, Ke, count, "portInout");
              }
            }
            continue;
          }
          if (resolve.kind === "parameter") {
            this.pushToken(k, _e, Ke, count, "verilogParameter");
            continue;
          }
          if (isClockName(text2)) {
            this.pushToken(k, _e, Ke, count, "clock");
            continue;
          }
          if (isResetName(text2)) {
            this.pushToken(k, _e, Ke, count, "reset");
            continue;
          }
          if (resolve.kind === "reg") {
            this.pushToken(k, _e, Ke, count, "reg");
            continue;
          }
          if (resolve.kind === "wire") {
            this.pushToken(k, _e, Ke, count, "wire");
            continue;
          }
          continue;
        }
        if (isClockName(text2)) {
          this.pushToken(k, _e, Ke, count, "clock");
          continue;
        }
        if (isResetName(text2)) {
          this.pushToken(k, _e, Ke, count, "reset");
          continue;
        }
        if (le > 0 && tokens[le - 1]?.type === ".") {
          let portDirection = this.resolvePortDirection(ast, text2, te.span.start.line, C);
          if (portDirection === "output") {
            this.pushToken(k, _e, Ke, count, "portOutput");
          } else {
            if (portDirection === "inout") {
              this.pushToken(k, _e, Ke, count, "portInout");
            } else {
              this.pushToken(k, _e, Ke, count, "portInput");
            }
          }
        }
      }
      return k.build();
    } catch {
      return k.build();
    }
  }
  resolvePortDirection(d, m, k, E) {
    let enclosingInstance = this.findEnclosingInstance(d, k);
    if (!enclosingInstance) {
      return;
    }
    let M = d.modules.find((v) => v.name === enclosingInstance.moduleName);
    if (!M) {
      let v = this.moduleResolver.resolveModule(enclosingInstance.moduleName, E);
      if (v.found && v.moduleNode) {
        M = v.moduleNode;
      }
    }
    if (M) {
      for (let item of M.items) {
        if (item.kind === "PortDeclaration" && item.identifiers.some((R) => R.name === m)) {
          return item.direction;
        }
      }
    }
  }
  findEnclosingInstance(d, m) {
    for (let moduleItem of d.modules) {
      for (let item of moduleItem.items) {
        if (
          item.kind === "InstanceDeclaration" &&
          item.span.start.line <= m &&
          item.span.end.line >= m
        ) {
          return item;
        }
      }
    }
  }
  pushToken(d, m, k, E, C) {
    let index = TOKEN_TYPES.indexOf(C);
    if (index !== -1) {
      d.push(m, k, E, index, 0);
    }
  }
  findEnclosingModule(d, m) {
    return d.modules.find((k) => k.span.start.line <= m && k.span.end.line >= m);
  }
}
