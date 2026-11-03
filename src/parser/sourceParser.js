import { Lexer, makeSpan } from "./lexer.js";
import { Parser } from "./parser.js";
import { SvLexer } from "./svLexer.js";
import { SvParser } from "./svParser.js";
import { lowerSourceFile } from "../analysis/svLowering.js";

const MAX_DIAGNOSTICS = 500;

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
  try {
    let allTokens = lexer.tokenize();
    let parser = new SvParser(allTokens, fileUri);
    let ast = parser.parse();
    ast.svDefaultNettypes = lexer.nettypeChanges;
    let undefinedMacros = allTokens.filter((token) => token.type === "MacroReference");
    ast.svUnresolvedSource = lexer.hasUnresolvedInclude || undefinedMacros.length > 0;
    let lowering = lowerSourceFile(ast, { resolver, fileUri });
    for (let token of undefinedMacros) {
      lexer.diagnostics.push({
        message: `Macro '${token.text}' is not defined here; it may come from a file this extension cannot see`,
        severity: "warning",
        code: "SYNTAX-UNDEFINED-MACRO",
        span: token.span,
      });
    }
    return {
      // Editor features work on tokens the user can see, not on macro or include expansions.
      tokens: allTokens.filter((token) => !token.span.fromMacro),
      ast,
      diagnostics: capDiagnostics([...lexer.diagnostics, ...parser.diagnostics, ...lowering]),
    };
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return tooDeepResult(fileUri);
  }
}

// A badly broken file should not bury the editor in thousands of follow-on errors.
function capDiagnostics(diagnostics) {
  return diagnostics.length > MAX_DIAGNOSTICS ? diagnostics.slice(0, MAX_DIAGNOSTICS) : diagnostics;
}

// Absurdly nested source overflows the stack; report it instead of losing every editor feature.
function tooDeepResult(fileUri) {
  let span = makeSpan(fileUri, 1, 1, 1, 1);
  return {
    tokens: [],
    ast: emptySvAst(span),
    diagnostics: [
      {
        message: "This file is nested too deeply to analyze",
        severity: "error",
        code: "SYNTAX-TOO-DEEP",
        span,
      },
    ],
  };
}

export function emptySvAst(span) {
  return { kind: "SourceFile", modules: [], packages: [], classes: [], unitItems: [], isSystemVerilog: true, span };
}
