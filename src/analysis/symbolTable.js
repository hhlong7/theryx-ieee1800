import { makeSpan } from "../parser/lexer.js";
import { collectReferences } from "./referenceCollector.js";

function isMacroName(O) {
  return O.startsWith("`");
}

function macroSymbol(O) {
  return {
    name: O,
    kind: "parameter",
    msb: 0,
    lsb: 0,
    bitWidth: 1,
    span: makeSpan("", 1, 1, 1, 1),
  };
}

class Scope {
  name;
  parent;
  symbols = new Map();
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
  }
  define(d) {
    return this.symbols.has(d.name) ? false : (this.symbols.set(d.name, d), true);
  }
  resolve(d) {
    let value = this.symbols.get(d);
    return value || (isMacroName(d) ? macroSymbol(d) : this.parent?.resolve(d));
  }
  getSymbols() {
    return Array.from(this.symbols.values());
  }
  hasLocal(d) {
    return this.symbols.has(d);
  }
}

export class SymbolTable {
  globalScope;
  currentScope;
  moduleScopes = new Map();
  sourceAst;
  constructor() {
    this.globalScope = new Scope("global");
    this.currentScope = this.globalScope;
  }
  attachSource(d) {
    this.sourceAst = d;
  }
  findReferences(d, m) {
    return this.sourceAst ? collectReferences(this.sourceAst, d, m) : [];
  }
  findDeclaration(d) {
    return this.globalScope.resolve(d)?.span;
  }
  enterScope(d) {
    let scope = new Scope(d, this.currentScope);
    this.currentScope = scope;
    if (this.currentScope.parent === this.globalScope) {
      this.moduleScopes.set(d, scope);
    }
    return scope;
  }
  exitScope() {
    if (this.currentScope.parent) {
      this.currentScope = this.currentScope.parent;
    }
  }
  getModuleScope(d) {
    return this.moduleScopes.get(d);
  }
  getAllModuleNames() {
    return Array.from(this.moduleScopes.keys());
  }
}
