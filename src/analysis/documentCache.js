import { SemanticAnalyzer } from "./semanticAnalyzer.js";
import { isSystemVerilogPath, parseSource } from "../parser/sourceParser.js";

const MAX_CACHED_DOCUMENTS = 32;

export class DocumentCache {
  entries = new Map();
  analyzer;
  constructor(d) {
    this.analyzer = new SemanticAnalyzer(d);
  }
  get(d, m, k) {
    let value = this.entries.get(d);
    if (value && !(value.version !== m || value.text !== k)) {
      return value;
    }
  }
  analyzeSafely(ast, uri, parserDiagnostics) {
    try {
      return this.analyzer.analyze(ast);
    } catch (error) {
      if (!isSystemVerilogPath(uri) || !(error instanceof RangeError)) {
        throw error;
      }
      parserDiagnostics.push({
        message: "This file is nested too deeply to analyze",
        severity: "error",
        code: "SYNTAX-TOO-DEEP",
        span: ast.span,
      });
      ast.modules = [];
      return this.analyzer.analyze(ast);
    }
  }
  analyze(d, m, k) {
    let value = this.get(d, m, k);
    if (value) {
      this.entries.delete(d);
      this.entries.set(d, value);
      return value;
    }
    let { tokens: tokenize, ast: parse, diagnostics: parserDiagnostics } = parseSource(
      k,
      d,
      this.analyzer.moduleResolver,
    );
    let { symbolTable: R, diagnostics: J } = this.analyzeSafely(parse, d, parserDiagnostics);
    let X = {
      uri: d,
      version: m,
      text: k,
      tokens: tokenize,
      ast: parse,
      symbolTable: R,
      parserDiagnostics,
      semanticDiagnostics: J,
    };
    for (
      this.entries.delete(d), this.entries.set(d, X);
      this.entries.size > MAX_CACHED_DOCUMENTS;
    ) {
      let next = this.entries.keys().next();
      if (next.done || next.value === undefined) {
        break;
      }
      this.entries.delete(next.value);
    }
    return X;
  }
  invalidate(d) {
    this.entries.delete(d);
  }
  clear() {
    this.entries.clear();
  }
  get size() {
    return this.entries.size;
  }
}
