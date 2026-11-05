export function makeSpan(O, d, m, k, E) {
  return {
    fileUri: O,
    start: {
      line: d,
      column: m,
    },
    end: {
      line: k,
      column: E,
    },
  };
}

const KEYWORDS = {
  module: "module",
  endmodule: "endmodule",
  input: "input",
  output: "output",
  inout: "inout",
  wire: "wire",
  reg: "reg",
  assign: "assign",
  always: "always",
  posedge: "posedge",
  negedge: "negedge",
  or: "or",
  begin: "begin",
  end: "end",
  if: "if",
  else: "else",
  case: "case",
  endcase: "endcase",
  casex: "casex",
  casez: "casez",
  default: "default",
  parameter: "parameter",
  localparam: "localparam",
  generate: "generate",
  endgenerate: "endgenerate",
  genvar: "genvar",
  function: "function",
  endfunction: "endfunction",
  task: "task",
  endtask: "endtask",
  initial: "initial",
  integer: "integer",
  real: "real",
  time: "time",
  signed: "signed",
  unsigned: "unsigned",
  for: "for",
  while: "while",
  repeat: "repeat",
  forever: "forever",
  and: "and",
  nand: "nand",
  nor: "nor",
  xor: "xor",
  xnor: "xnor",
  not: "not",
  buf: "buf",
  bufif0: "bufif0",
  bufif1: "bufif1",
  notif0: "notif0",
  notif1: "notif1",
};

export const KEYWORD_SET = new Set(Object.keys(KEYWORDS));

export const DIRECTIVES = new Set([
  "`timescale",
  "`define",
  "`undef",
  "`ifdef",
  "`ifndef",
  "`else",
  "`endif",
  "`include",
  "`default_nettype",
]);

const SKIPPED_DIRECTIVES = new Set([
  "define",
  "undef",
  "include",
  "timescale",
  "default_nettype",
  "celldefine",
  "endcelldefine",
  "unconnected_drive",
  "nounconnected_drive",
  "resetall",
  "line",
  "pragma",
  "begin_keywords",
  "end_keywords",
  "default_decay_time",
  "default_trireg_strength",
  "delay_mode_distributed",
  "delay_mode_path",
  "delay_mode_unit",
  "delay_mode_zero",
  "accelerate",
  "noaccelerate",
  "autoexpand_vectornets",
  "expand_vectornets",
  "noexpand_vectornets",
  "remove_gatename",
  "noremove_gatename",
  "remove_netname",
  "noremove_netname",
  "suppress_faults",
  "nosuppress_faults",
  "enable_portfaults",
  "disable_portfaults",
]);

export class Lexer {
  source;
  fileUri;
  index = 0;
  line = 1;
  column = 1;
  definedMacros = new Set();
  conditionalStack = [];
  constructor(source, fileUri = "file:///untitled.v") {
    this.source = source;
    this.fileUri = fileUri;
  }
  getDefinedMacros() {
    return Array.from(this.definedMacros);
  }
  tokenize() {
    let d = [];
    for (; !this.isAtEnd() && (this.skipWhitespaceAndComments(), !this.isAtEnd());) {
      if (this.peek() === "`" && this.isDirectiveStart()) {
        let directive = this.scanDirective();
        if (directive) {
          d.push(directive);
        }
        continue;
      }
      if (!this.isActive()) {
        this.skipInactiveContent();
        continue;
      }
      let nextToken = this.nextToken();
      d.push(nextToken);
    }
    d.push({
      type: "EOF",
      text: "",
      span: makeSpan(this.fileUri, this.line, this.column, this.line, this.column),
    });
    return d;
  }
  isActive() {
    let d = this.conditionalStack[this.conditionalStack.length - 1];
    return d ? d.currentActive : true;
  }
  isDirectiveStart() {
    if (this.peek() !== "`") {
      return false;
    }
    let peekNext = this.peekNext();
    return peekNext !== "" && (this.isAlphaOrUnderscore(peekNext) || peekNext === "$");
  }
  scanDirective() {
    let line = this.line;
    let column = this.column;
    this.advance();
    let k = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      k += this.advance();
    }
    let E = k.toLowerCase();
    switch (E) {
      case "ifdef":
      case "ifndef": {
        let identifierForDirective = this.readIdentifierForDirective();
        let M = this.isActive();
        let v =
          E === "ifdef"
            ? this.definedMacros.has(identifierForDirective)
            : !this.definedMacros.has(identifierForDirective);
        let R = M && v;
        this.conditionalStack.push({
          parentActive: M,
          branchTaken: R,
          currentActive: R,
        });
        return;
      }
      case "else": {
        let C = this.conditionalStack[this.conditionalStack.length - 1];
        if (!C) {
          return;
        }
        C.currentActive = C.parentActive && !C.branchTaken;
        if (C.currentActive) {
          C.branchTaken = true;
        }
        return;
      }
      case "endif": {
        this.conditionalStack.pop();
        return;
      }
      default: {
        if (E === "define" && this.isActive()) {
          let identifierForDirective2 = this.readIdentifierForDirective();
          if (identifierForDirective2) {
            this.definedMacros.add(identifierForDirective2);
          }
        }
        if (SKIPPED_DIRECTIVES.has(E)) {
          this.skipRestOfLine();
          return;
        }
        return this.isActive()
          ? this.createToken("MacroReference", "`" + k, line, column)
          : undefined;
      }
    }
  }
  readIdentifierForDirective() {
    this.skipInlineWhitespace();
    let d = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      d += this.advance();
    }
    return d;
  }
  skipRestOfLine() {
    for (
      ;
      !this.isAtEnd() &&
      this.peek() !==
        `
`;
    ) {
      this.advance();
    }
  }
  skipInlineWhitespace() {
    for (; !this.isAtEnd();) {
      let token = this.peek();
      if (token === " " || token === "	" || token === "\r") {
        this.advance();
      } else {
        break;
      }
    }
  }
  skipInactiveContent() {
    if ((this.skipWhitespaceAndComments(), this.isAtEnd() || this.isDirectiveStart())) {
      return;
    }
    let token = this.peek();
    if (token === '"') {
      this.skipStringLiteral();
      return;
    }
    if (token === "\\") {
      for (this.advance(); !this.isAtEnd() && !this.isWhitespace(this.peek());) {
        this.advance();
      }
      return;
    }
    this.advance();
  }
  isAtEnd() {
    return this.index >= this.source.length;
  }
  peek() {
    return this.isAtEnd() ? "" : this.source[this.index];
  }
  peekNext() {
    return this.index + 1 >= this.source.length ? "" : this.source[this.index + 1];
  }
  peekAfterNext() {
    return this.index + 2 >= this.source.length ? "" : this.source[this.index + 2];
  }
  advance() {
    let d = this.source[this.index];
    this.index++;
    if (
      d ===
      `
`
    ) {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return d;
  }
  skipWhitespaceAndComments() {
    for (; !this.isAtEnd();) {
      let token = this.peek();
      if (
        token === " " ||
        token === "	" ||
        token === "\r" ||
        token ===
          `
`
      ) {
        this.advance();
        continue;
      }
      if (token === "/" && this.peekNext() === "/") {
        for (
          this.advance(), this.advance();
          !this.isAtEnd() &&
          this.peek() !==
            `
`;
        ) {
          this.advance();
        }
        continue;
      }
      if (token === "/" && this.peekNext() === "*") {
        for (this.advance(), this.advance(); !this.isAtEnd();) {
          if (this.peek() === "*" && this.peekNext() === "/") {
            this.advance();
            this.advance();
            break;
          }
          this.advance();
        }
        continue;
      }
      break;
    }
  }
  nextToken() {
    let line = this.line;
    let column = this.column;
    let token = this.peek();
    if (token === "\\") {
      return this.scanEscapedIdentifier(line, column);
    }
    if (token === "$") {
      return this.scanSystemIdentifier(line, column);
    }
    if (token === '"') {
      return this.scanStringLiteral(line, column);
    }
    if (this.isAlphaOrUnderscore(token)) {
      return this.scanIdentifierOrKeyword(line, column);
    }
    if (
      this.isDigit(token) ||
      (token === "'" &&
        (this.isBaseSpecifier(this.peekNext()) ||
          ((this.peekNext() === "s" || this.peekNext() === "S") &&
            this.isBaseSpecifier(this.peekAfterNext()))))
    ) {
      return this.scanNumberLiteral(line, column);
    }
    let peekNext = this.peekNext();
    let peekAfterNext = this.peekAfterNext();
    let M = token + peekNext + peekAfterNext;
    if (M === "<<<") {
      this.advance();
      this.advance();
      this.advance();
      return this.createToken("<<<", "<<<", line, column);
    }
    if (M === ">>>") {
      this.advance();
      this.advance();
      this.advance();
      return this.createToken(">>>", ">>>", line, column);
    }
    if (M === "===") {
      this.advance();
      this.advance();
      this.advance();
      return this.createToken("===", "===", line, column);
    }
    if (M === "!==") {
      this.advance();
      this.advance();
      this.advance();
      return this.createToken("!==", "!==", line, column);
    }
    switch (token + peekNext) {
      case "<<":
        this.advance();
        this.advance();
        return this.createToken("<<", "<<", line, column);
      case ">>":
        this.advance();
        this.advance();
        return this.createToken(">>", ">>", line, column);
      case "&&":
        this.advance();
        this.advance();
        return this.createToken("&&", "&&", line, column);
      case "||":
        this.advance();
        this.advance();
        return this.createToken("||", "||", line, column);
      case "==":
        this.advance();
        this.advance();
        return this.createToken("==", "==", line, column);
      case "!=":
        this.advance();
        this.advance();
        return this.createToken("!=", "!=", line, column);
      case "<=":
        this.advance();
        this.advance();
        return this.createToken("<=", "<=", line, column);
      case ">=":
        this.advance();
        this.advance();
        return this.createToken(">=", ">=", line, column);
      case "~&":
        this.advance();
        this.advance();
        return this.createToken("~&", "~&", line, column);
      case "~|":
        this.advance();
        this.advance();
        return this.createToken("~|", "~|", line, column);
      case "~^":
        this.advance();
        this.advance();
        return this.createToken("~^", "~^", line, column);
      case "^~":
        this.advance();
        this.advance();
        return this.createToken("^~", "^~", line, column);
      case "**":
        this.advance();
        this.advance();
        return this.createToken("**", "**", line, column);
    }
    switch ((this.advance(), token)) {
      case "&":
        return this.createToken("&", token, line, column);
      case "|":
        return this.createToken("|", token, line, column);
      case "^":
        return this.createToken("^", token, line, column);
      case "~":
        return this.createToken("~", token, line, column);
      case "!":
        return this.createToken("!", token, line, column);
      case "?":
        return this.createToken("?", token, line, column);
      case ":":
        return this.createToken(":", token, line, column);
      case "<":
        return this.createToken("<", token, line, column);
      case ">":
        return this.createToken(">", token, line, column);
      case "=":
        return this.createToken("=", token, line, column);
      case "+":
        return this.createToken("+", token, line, column);
      case "-":
        return this.createToken("-", token, line, column);
      case "*":
        return this.createToken("*", token, line, column);
      case "/":
        return this.createToken("/", token, line, column);
      case "%":
        return this.createToken("%", token, line, column);
      case "@":
        return this.createToken("@", token, line, column);
      case "(":
        return this.createToken("(", token, line, column);
      case ")":
        return this.createToken(")", token, line, column);
      case "[":
        return this.createToken("[", token, line, column);
      case "]":
        return this.createToken("]", token, line, column);
      case "{":
        return this.createToken("{", token, line, column);
      case "}":
        return this.createToken("}", token, line, column);
      case ",":
        return this.createToken(",", token, line, column);
      case ";":
        return this.createToken(";", token, line, column);
      case ".":
        return this.createToken(".", token, line, column);
      case "#":
        return this.createToken("#", token, line, column);
      default:
        return this.createToken("Illegal", token, line, column);
    }
  }
  scanIdentifierOrKeyword(d, m) {
    let k = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      k += this.advance();
    }
    let C = KEYWORDS[k] ?? "Identifier";
    return this.createToken(C, k, d, m);
  }
  scanEscapedIdentifier(d, m) {
    let k = "";
    for (; !this.isAtEnd() && !this.isWhitespace(this.peek());) {
      k += this.advance();
    }
    return this.createToken("EscapedIdentifier", k, d, m);
  }
  scanSystemIdentifier(d, m) {
    let k = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      k += this.advance();
    }
    return this.createToken("SystemIdentifier", k, d, m);
  }
  scanStringLiteral(d, m) {
    this.advance();
    let k = '"';
    let E = "";
    for (; !this.isAtEnd();) {
      let token = this.peek();
      if (token === '"') {
        this.advance();
        k += '"';
        break;
      }
      if (token === "\\") {
        let peekNext = this.peekNext();
        if (((k += this.advance()), this.isAtEnd())) {
          break;
        }
        switch (((k += this.advance()), peekNext)) {
          case "n":
            E += `
`;
            break;
          case "t":
            E += "	";
            break;
          case "r":
            E += "\r";
            break;
          case "\\":
            E += "\\";
            break;
          case '"':
            E += '"';
            break;
          case "0":
            E += "\0";
            break;
          default:
            E += peekNext;
            break;
        }
        if (peekNext === "\r" && this.peek() === "\n") {
          k += this.advance();
        }
        continue;
      }
      if (
        token ===
        `
`
      ) {
        break;
      }
      E += token;
      k += this.advance();
    }
    return this.createToken("StringLiteral", k, d, m);
  }
  skipStringLiteral() {
    for (this.advance(); !this.isAtEnd();) {
      let token = this.peek();
      if (token === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          this.advance();
        }
        continue;
      }
      if ((this.advance(), token === '"')) {
        return;
      }
    }
  }
  scanNumberLiteral(d, m) {
    let k = "";
    for (; !this.isAtEnd() && (this.isDigit(this.peek()) || this.peek() === "_");) {
      k += this.advance();
    }
    if (!this.isAtEnd() && this.peek() === "'") {
      for (
        k += this.advance(),
          !this.isAtEnd() && (this.peek() === "s" || this.peek() === "S") && (k += this.advance()),
          this.isAtEnd() || (k += this.advance());
        !this.isAtEnd() &&
        (this.isHexDigit(this.peek()) ||
          this.peek() === "_" ||
          this.peek() === "x" ||
          this.peek() === "X" ||
          this.peek() === "z" ||
          this.peek() === "Z" ||
          this.peek() === "?");
      ) {
        k += this.advance();
      }
    }
    return this.createToken("NumberLiteral", k, d, m);
  }
  isAlphaOrUnderscore(d) {
    return (d >= "a" && d <= "z") || (d >= "A" && d <= "Z") || d === "_";
  }
  isAlphaNumericOrUnderscore(d) {
    return this.isAlphaOrUnderscore(d) || this.isDigit(d) || d === "$";
  }
  isDigit(d) {
    return d >= "0" && d <= "9";
  }
  isHexDigit(d) {
    return this.isDigit(d) || (d >= "a" && d <= "f") || (d >= "A" && d <= "F");
  }
  isBaseSpecifier(d) {
    let m = d.toLowerCase();
    return m === "b" || m === "o" || m === "d" || m === "h";
  }
  isWhitespace(d) {
    return (
      d === " " ||
      d === "	" ||
      d === "\r" ||
      d ===
        `
`
    );
  }
  createToken(d, m, k, E) {
    return {
      type: d,
      text: m,
      span: makeSpan(this.fileUri, k, E, k, E + m.length),
    };
  }
}
