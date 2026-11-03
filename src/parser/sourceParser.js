import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { SvLexer } from "./svLexer.js";
import { SvParser } from "./svParser.js";
import { lowerSourceFile } from "../analysis/svLowering.js";

export function isSystemVerilogPath(uriOrPath) {
  return /\.(sv|svh)$/i.test(uriOrPath.split("?")[0].split("#")[0]);
}

// Language mode follows the file extension: .v/.vh stay strict IEEE 1364, .sv/.svh are IEEE 1800.
export function parseSource(text, fileUri, resolver) {
  if (!isSystemVerilogPath(fileUri)) {
    let tokens = new Lexer(text, fileUri).tokenize();
    let parser = new Parser(tokens, fileUri);
    let ast = parser.parse();
    return { tokens, ast, diagnostics: parser.diagnostics };
  }
  let lexer = new SvLexer(text, fileUri, {
    includeResolver: resolver ? (name, from) => resolver.resolveInclude?.(name, from) : undefined,
  });
  let allTokens = lexer.tokenize();
  let parser = new SvParser(allTokens, fileUri);
  let ast = parser.parse();
  let lowering = lowerSourceFile(ast, { resolver, fileUri });
  return {
    // Editor features work on tokens the user can see, not on macro or include expansions.
    tokens: allTokens.filter((token) => !token.span.fromMacro),
    ast,
    diagnostics: [...parser.diagnostics, ...lowering],
  };
}
