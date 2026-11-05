export class QuickFixService {
  getQuickFixes(d, m, k, E, C) {
    let M = [];
    for (let v of m) {
      if (v.code) {
        switch (v.code) {
          case "STARC-2.1.2":
          case "STARC-2.1.1": {
            let assignmentTypeFixes = this.createAssignmentTypeFixes(d, v, k);
            M.push(...assignmentTypeFixes);
            break;
          }
          case "STARC-2.3.1": {
            let caseDefaultFix = this.createCaseDefaultFix(d, v);
            if (caseDefaultFix) {
              M.push(caseDefaultFix);
            }
            break;
          }
          case "STARC-Latch": {
            let latchElseFix = this.createLatchElseFix(d, v, k);
            if (latchElseFix) {
              M.push(latchElseFix);
            }
            break;
          }
          case "RMM-2.2": {
            let namedPortConnectionsFix = this.createNamedPortConnectionsFix(d, v, k, E, C);
            if (namedPortConnectionsFix) {
              M.push(namedPortConnectionsFix);
            }
            break;
          }
          case "SEM-UNDECLARED":
          case "SEM-UNDECLARED-LHS": {
            let declareFixes = this.createDeclareFixes(d, v, k);
            M.push(...declareFixes);
            break;
          }
          case "SEM-MODULE-NOT-FOUND": {
            let createModuleFix = this.createCreateModuleFix(d, v, k);
            if (createModuleFix) {
              M.push(createModuleFix);
            }
            break;
          }
          case "SYNTAX-MISSING-COMMA": {
            M.push({
              title: "Insert missing comma (',')",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.end.line,
                  startColumn: v.span.end.column,
                  endLine: v.span.end.line,
                  endColumn: v.span.end.column,
                  newText: ",",
                },
              ],
            });
            break;
          }
          case "SYNTAX-TRAILING-COMMA": {
            M.push({
              title: "Remove trailing comma",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: v.span.start.column,
                  endLine: v.span.end.line,
                  endColumn: v.span.end.column,
                  newText: "",
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-SEMICOLON": {
            let line = v.span.start.line;
            let column = v.span.start.column;
            if (line > 1 && d[line - 2] !== undefined && d[line - 2].trim().length > 0) {
              line = line - 1;
              column = this.insertionColumnAfterCode(d[line - 1]);
            }
            M.push({
              title: "Insert missing semicolon (';')",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: line,
                  startColumn: column,
                  endLine: line,
                  endColumn: column,
                  newText: ";",
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-RPAREN": {
            M.push({
              title: "Insert missing closing parenthesis (')')",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: v.span.start.column,
                  endLine: v.span.start.line,
                  endColumn: v.span.start.column,
                  newText: ")",
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-RBRACKET": {
            M.push({
              title: "Insert missing closing bracket (']')",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: v.span.start.column,
                  endLine: v.span.start.line,
                  endColumn: v.span.start.column,
                  newText: "]",
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-RBRACE": {
            M.push({
              title: "Insert missing closing brace ('}')",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: v.span.start.column,
                  endLine: v.span.start.line,
                  endColumn: v.span.start.column,
                  newText: "}",
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-COLON": {
            M.push({
              title: "Insert missing colon (':')",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: v.span.start.column,
                  endLine: v.span.start.line,
                  endColumn: v.span.start.column,
                  newText: ":",
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-END": {
            M.push({
              title: "Insert 'end' to close block",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: 1,
                  endLine: v.span.start.line,
                  endColumn: 1,
                  newText: `end
`,
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-ENDCASE": {
            M.push({
              title: "Insert 'endcase' to close case statement",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: 1,
                  endLine: v.span.start.line,
                  endColumn: 1,
                  newText: `endcase
`,
                },
              ],
            });
            break;
          }
          case "SYNTAX-MISSING-ENDMODULE": {
            let count = d.length;
            let J = (d[count - 1]?.length ?? 0) + 1;
            M.push({
              title: "Insert 'endmodule' at end of file",
              kind: "quickfix",
              isPreferred: true,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: count,
                  startColumn: J,
                  endLine: count,
                  endColumn: J,
                  newText: `
endmodule
`,
                },
              ],
            });
            break;
          }
          case "SYNTAX-UNEXPECTED-TOKEN": {
            M.push({
              title: "Remove unexpected token",
              kind: "quickfix",
              isPreferred: false,
              diagnosticCode: v.code,
              edits: [
                {
                  startLine: v.span.start.line,
                  startColumn: v.span.start.column,
                  endLine: v.span.end.line,
                  endColumn: v.span.end.column,
                  newText: "",
                },
              ],
            });
            break;
          }
        }
      }
    }
    return M;
  }
  createDeclareFixes(d, m, k) {
    let E = [];
    let match = m.message.match(/'([^']+)'/);
    if (!match) {
      return E;
    }
    let M = match[1];
    if (!k) {
      return E;
    }
    let v = k.modules.find(
      (Q) => Q.span.start.line <= m.span.start.line && Q.span.end.line >= m.span.start.line,
    );
    if (!v) {
      return E;
    }
    let R = v.items.find(
      (Q) => Q.span.start.line <= m.span.start.line && Q.span.end.line >= m.span.start.line,
    );
    let J = R ? R.span.start.line : (v.items[0]?.span.start.line ?? m.span.start.line);
    let indentation = this.getIndentation(d, J);
    for (let Q of ["wire", "reg"]) {
      E.push({
        title: `Declare '${M}' as ${Q}`,
        kind: "quickfix",
        isPreferred: Q === "wire",
        diagnosticCode: m.code,
        edits: [
          {
            startLine: J,
            startColumn: 1,
            endLine: J,
            endColumn: 1,
            newText: `${indentation}${Q} ${M};
`,
          },
        ],
      });
    }
    return E;
  }
  createCreateModuleFix(d, m, k) {
    let match = m.message.match(/Module '([^']+)' not found/);
    if (!match) {
      return;
    }
    let C = match[1];
    let M = [];
    if (k) {
      for (let moduleItem of k.modules) {
        for (let item of moduleItem.items) {
          if (!(item.kind !== "InstanceDeclaration" || item.moduleName !== C)) {
            for (let portConnection of item.portConnections) {
              if (
                !portConnection.portName.startsWith("__pos_") &&
                !M.includes(portConnection.portName)
              ) {
                M.push(portConnection.portName);
              }
            }
          }
        }
      }
    }
    let count = d.length;
    let R = (d[count - 1]?.length ?? 0) + 1;
    let J =
      M.length > 0
        ? `
// TODO: implement module '${C}' and set the real port directions
module ${C} (
${M.map((X) => `  inout ${X}`).join(`,
`)}
);
endmodule
`
        : `
// TODO: implement module '${C}'
module ${C};
endmodule
`;
    return {
      title: `Create module '${C}'`,
      kind: "quickfix",
      isPreferred: true,
      diagnosticCode: m.code,
      edits: [
        {
          startLine: count,
          startColumn: R,
          endLine: count,
          endColumn: R,
          newText: J,
        },
      ],
    };
  }
  getIndentation(d, m) {
    let k = m - 1;
    if (k < 0 || k >= d.length) {
      return "  ";
    }
    let match = d[k].match(/^(\s*)/);
    return match && match[1] ? match[1] : "  ";
  }
  insertionColumnAfterCode(d) {
    let m = false;
    for (let k = 0; k < d.length; k++) {
      let E = d[k];
      if (E === '"') {
        m = !m;
      } else if (!m && E === "/" && d[k + 1] === "/") {
        return d.slice(0, k).trimEnd().length + 1;
      }
    }
    return d.length + 1;
  }
  createAssignmentTypeFixes(d, m, k) {
    let E = [];
    let C = m.span.start.line - 1;
    if (C < 0 || C >= d.length) {
      return E;
    }
    let M =
      m.message.includes("use non-blocking assignment (<=), found blocking (=)") ||
      m.message.includes("use only non-blocking (<=); found blocking (=)");
    let v =
      m.message.includes("use blocking assignment (=), found non-blocking (<=)") ||
      m.message.includes("use only blocking (=); found non-blocking (<=)");
    if (M) {
      let operatorInSpan = this.findOperatorInSpan(d, m.span, "=");
      if (operatorInSpan) {
        E.push({
          title: "Convert '=' to '<=' on this line (IEEE 1364)",
          kind: "quickfix",
          isPreferred: true,
          diagnosticCode: m.code,
          edits: [
            {
              startLine: operatorInSpan.startLine,
              startColumn: operatorInSpan.startColumn,
              endLine: operatorInSpan.startLine,
              endColumn: operatorInSpan.endColumn,
              newText: "<=",
            },
          ],
        });
      }
      let assignmentsInAlwaysBlock = this.findAssignmentsInAlwaysBlock(
        d,
        m.span.start.line,
        "=",
        "<=",
        k,
      );
      if (assignmentsInAlwaysBlock.length > 0) {
        E.push({
          title: "Convert all assignments in this always block to '<=' (IEEE 1364)",
          kind: "quickfix",
          isPreferred: false,
          diagnosticCode: m.code,
          edits: assignmentsInAlwaysBlock,
        });
      }
    } else if (v) {
      let operatorInSpan2 = this.findOperatorInSpan(d, m.span, "<=");
      if (operatorInSpan2) {
        E.push({
          title: "Convert '<=' to '=' on this line (IEEE 1364)",
          kind: "quickfix",
          isPreferred: true,
          diagnosticCode: m.code,
          edits: [
            {
              startLine: operatorInSpan2.startLine,
              startColumn: operatorInSpan2.startColumn,
              endLine: operatorInSpan2.startLine,
              endColumn: operatorInSpan2.endColumn,
              newText: "=",
            },
          ],
        });
      }
      let assignmentsInAlwaysBlock2 = this.findAssignmentsInAlwaysBlock(
        d,
        m.span.start.line,
        "<=",
        "=",
        k,
      );
      if (assignmentsInAlwaysBlock2.length > 0) {
        E.push({
          title: "Convert all assignments in this always block to '=' (IEEE 1364)",
          kind: "quickfix",
          isPreferred: false,
          diagnosticCode: m.code,
          edits: assignmentsInAlwaysBlock2,
        });
      }
    }
    return E;
  }
  findAssignmentsInAlwaysBlock(d, m, k, E, C) {
    if (C) {
      for (let moduleItem of C.modules) {
        for (let item of moduleItem.items) {
          if (item.kind === "AlwaysBlock" && item.span.start.line <= m && item.span.end.line >= m) {
            let Qe = k === "=" ? "BlockingAssign" : "NonBlockingAssign";
            let le = [];
            this.collectAssignmentStatements(item.statement, Qe, le);
            let te = [];
            for (let Oe of le) {
              let operatorInSpan = this.findOperatorInSpan(d, Oe.span, k);
              if (operatorInSpan) {
                te.push({
                  startLine: operatorInSpan.startLine,
                  startColumn: operatorInSpan.startColumn,
                  endLine: operatorInSpan.startLine,
                  endColumn: operatorInSpan.endColumn,
                  newText: E,
                });
              }
            }
            return te;
          }
        }
      }
    }
    let M = [];
    let v = m;
    let R = m;
    for (let Q = m - 1; Q >= 0; Q--) {
      if (/^\s*always\b/.test(d[Q])) {
        v = Q + 1;
        break;
      }
    }
    for (let Q = m - 1; Q < d.length; Q++) {
      if (/^\s*end\b/.test(d[Q])) {
        R = Q + 1;
        break;
      }
    }
    let J = k === "=" ? /(?<![<>=!])=(?!=)/ : /<=(?!=)/;
    let count = k.length;
    for (let Q = v; Q <= R; Q++) {
      let Re = Q - 1;
      if (Re < 0 || Re >= d.length) {
        continue;
      }
      let match = d[Re].match(J);
      if (match && match.index !== undefined) {
        M.push({
          startLine: Q,
          startColumn: match.index + 1,
          endLine: Q,
          endColumn: match.index + 1 + count,
          newText: E,
        });
      }
    }
    return M;
  }
  collectAssignmentStatements(d, m, k) {
    switch ((d.kind === m && k.push(d), d.kind)) {
      case "BlockStatement":
        for (let statement of d.statements) {
          this.collectAssignmentStatements(statement, m, k);
        }
        break;
      case "IfStatement":
        this.collectAssignmentStatements(d.thenBranch, m, k);
        if (d.elseBranch) {
          this.collectAssignmentStatements(d.elseBranch, m, k);
        }
        break;
      case "CaseStatement":
        for (let item of d.items) {
          this.collectAssignmentStatements(item.statement, m, k);
        }
        break;
      case "LoopStatement":
      case "GenerateLoopStatement":
        this.collectAssignmentStatements(d.body, m, k);
        break;
      case "GenerateBlockStatement":
        for (let statement2 of d.statements) {
          this.collectAssignmentStatements(statement2, m, k);
        }
        break;
      default:
        break;
    }
  }
  findOperatorInSpan(d, m, k) {
    let E = k === "=" ? /(?<![<>=!])=(?!=)/ : /<=(?!=)/;
    for (let line = m.start.line; line <= m.end.line && line - 1 < d.length; line++) {
      let M = d[line - 1] ?? "";
      let v = line === m.start.line ? m.start.column - 1 : 0;
      let R = line === m.end.line ? m.end.column - 1 : M.length;
      let match = M.slice(v, R).match(E);
      if (match && match.index !== undefined) {
        return {
          startLine: line,
          startColumn: v + match.index + 1,
          endColumn: v + match.index + 1 + k.length,
        };
      }
    }
  }
  createCaseDefaultFix(d, m) {
    let closingEndcase = this.findClosingEndcase(d, m.span);
    if (closingEndcase === undefined) {
      return;
    }
    let C = d[closingEndcase - 1].match(/^(\s*)endcase\b/)?.[1] ?? "        ";
    return {
      title: "Add 'default' clause to case statement (STARC-2.3.1)",
      kind: "quickfix",
      isPreferred: true,
      diagnosticCode: m.code,
      edits: [
        {
          startLine: closingEndcase,
          startColumn: 1,
          endLine: closingEndcase,
          endColumn: 1,
          newText: `${C}    default: ; // TODO: define default assignment (avoids latch)
`,
        },
      ],
    };
  }
  findClosingEndcase(d, m) {
    let line = m.end.line;
    if (line - 1 < d.length && /^\s*endcase\b/.test(d[line - 1])) {
      return line;
    }
    let E = 1;
    let C = false;
    for (let M = m.start.line - 1; M < d.length; M++) {
      let R = (d[M] ?? "").replace(/\/\/.*$/, "").match(/\b(endcase|casez|casex|case)\b/g) ?? [];
      for (let J = 0; J < R.length; J++) {
        let X = R[J];
        if (!C && X !== "endcase") {
          C = true;
          continue;
        }
        if (((E += X === "endcase" ? -1 : 1), E === 0)) {
          return M + 1;
        }
      }
    }
  }
  createLatchElseFix(d, m, k) {
    let line = m.span.end.line;
    let C = line - 1;
    if (C < 0 || C >= d.length) {
      return;
    }
    let match = d[C].match(/^(\s*)/);
    let R = match ? match[1] : "        ";
    let X = m.message.match(/'([^']+)'/)?.[1];
    let Q = X
      ? `${X} = 1'b0; // TODO: choose the default value (avoids the latch)`
      : "// TODO: assign a default value to avoid the latch";
    if (k) {
      let ifStatementAt = this.findIfStatementAt(k, m.span);
      if (ifStatementAt?.elseBranch) {
        let indentation = this.getIndentation(d, ifStatementAt.span.start.line);
        return {
          title: `Add default assignment for '${X ?? "signal"}' before the if/else (IEEE 1364)`,
          kind: "quickfix",
          isPreferred: true,
          diagnosticCode: m.code,
          edits: [
            {
              startLine: ifStatementAt.span.start.line,
              startColumn: 1,
              endLine: ifStatementAt.span.start.line,
              endColumn: 1,
              newText: `${indentation}${Q}
`,
            },
          ],
        };
      }
    }
    return {
      title: "Add 'else' clause to avoid latch inference (IEEE 1364)",
      kind: "quickfix",
      isPreferred: true,
      diagnosticCode: m.code,
      edits: [
        {
          startLine: line,
          startColumn: d[C].length + 1,
          endLine: line,
          endColumn: d[C].length + 1,
          newText: ` else begin
${R}    ${Q}
${R}end`,
        },
      ],
    };
  }
  findIfStatementAt(d, m) {
    for (let moduleItem of d.modules) {
      for (let item of moduleItem.items) {
        if (item.kind !== "AlwaysBlock") {
          continue;
        }
        let ifStatement = this.findIfStatement(item.statement, m);
        if (ifStatement) {
          return ifStatement;
        }
      }
    }
  }
  findIfStatement(d, m) {
    if (d.kind === "IfStatement") {
      if (d.span.start.line === m.start.line && d.span.end.line === m.end.line) {
        return d;
      }
      let ifStatement = this.findIfStatement(d.thenBranch, m);
      if (ifStatement) {
        return ifStatement;
      }
      if (d.elseBranch) {
        let ifStatement2 = this.findIfStatement(d.elseBranch, m);
        if (ifStatement2) {
          return ifStatement2;
        }
      }
      return;
    }
    switch (d.kind) {
      case "BlockStatement":
        for (let statement of d.statements) {
          let ifStatement3 = this.findIfStatement(statement, m);
          if (ifStatement3) {
            return ifStatement3;
          }
        }
        return;
      case "CaseStatement":
        for (let item of d.items) {
          let ifStatement4 = this.findIfStatement(item.statement, m);
          if (ifStatement4) {
            return ifStatement4;
          }
        }
        return;
      case "LoopStatement":
      case "GenerateLoopStatement":
        return this.findIfStatement(d.body, m);
      case "GenerateBlockStatement":
        for (let statement2 of d.statements) {
          let ifStatement5 = this.findIfStatement(statement2, m);
          if (ifStatement5) {
            return ifStatement5;
          }
        }
        return;
      default:
        return;
    }
  }
  createNamedPortConnectionsFix(d, m, k, E, C) {
    let M;
    let v;
    if (k) {
      for (let moduleItem of k.modules) {
        for (let item of moduleItem.items) {
          if (
            item.kind === "InstanceDeclaration" &&
            ((item.span.start.line <= m.span.start.line &&
              item.span.end.line >= m.span.start.line) ||
              m.message.includes(`'${item.instanceName}'`))
          ) {
            v = item;
            M = item.moduleName;
            break;
          }
        }
        if (v) {
          break;
        }
      }
    }
    if (!M) {
      let match = m.message.match(/instance\s+'([^']+)'\s+of\s+'([^']+)'/);
      if (match) {
        M = match[2];
      }
    }
    if (!M) {
      return;
    }
    let R = k?.modules.find((xr) => xr.name === M);
    if (!R && E && C) {
      let xr = E.resolveModule(M, C);
      if (xr.found && xr.moduleNode) {
        R = xr.moduleNode;
      }
    }
    if (!R) {
      return;
    }
    let J = [];
    if (R.portNames && R.portNames.length > 0) {
      J.push(...R.portNames);
    } else {
      for (let item2 of R.items) {
        if (item2.kind === "PortDeclaration") {
          for (let identifier of item2.identifiers) {
            J.push(identifier.name);
          }
        }
      }
    }
    if (J.length === 0) {
      return;
    }
    let X = (v ? v.span.start.line : m.span.start.line) - 1;
    let Q = (v ? v.span.end.line : m.span.end.line) - 1;
    let Re = "";
    for (let xr = X; xr <= Q; xr++) {
      Re +=
        (xr === X
          ? ""
          : `
`) + d[xr];
    }
    let Qe = d[X].match(/^(\s*)/)?.[1] ?? "    ";
    let le = Qe + "    ";
    if (v) {
      let xr = [];
      if (
        (v.portConnections.forEach((B0, W8) => {
          if (B0.portName.startsWith("__pos_")) {
            xr.push({
              index: W8,
              conn: B0,
            });
          }
        }),
        xr.length === 0)
      ) {
        return;
      }
      let bs = [];
      for (let { index: B0, conn: W8 } of xr) {
        let zj = B0 < J.length ? J[B0] : `port_${B0}`;
        let extractSpanText = this.extractSpanText(d, W8.span);
        bs.push(`.${zj}(${extractSpanText})`);
      }
      let span = xr[0].conn.span;
      let span2 = xr[xr.length - 1].conn.span;
      let qj = span.start.line !== span2.end.line;
      let Tm;
      if (qj) {
        Tm =
          `
` +
          bs.map((B0) => `${le}${B0}`).join(`,
`) +
          `
${Qe}`;
      } else {
        Tm = bs.join(", ");
      }
      return {
        title: "Convert to named port connections (.port(signal)) (RMM-2.2)",
        kind: "quickfix",
        isPreferred: true,
        diagnosticCode: m.code,
        edits: [
          {
            startLine: span.start.line,
            startColumn: span.start.column,
            endLine: span2.end.line,
            endColumn: span2.end.column,
            newText: Tm,
          },
        ],
      };
    }
    let portListParens = this.findPortListParens(Re);
    if (!portListParens) {
      return;
    }
    let { openParenIdx: Oe, closeParenIdx: _e } = portListParens;
    let substring = Re.substring(Oe + 1, _e);
    let includes = substring.includes(`
`);
    let splitPositionalArgs = this.splitPositionalArgs(substring);
    if (splitPositionalArgs.length === 0) {
      return;
    }
    let jn = [];
    splitPositionalArgs.forEach((xr, bs) => {
      let bh = xr.trim();
      let U = bs < J.length ? J[bs] : `port_${bs}`;
      jn.push(`.${U}(${bh})`);
    });
    let Ln;
    if (includes) {
      Ln =
        `
` +
        jn.map((xr) => `${le}${xr}`).join(`,
`) +
        `
${Qe}`;
    } else {
      Ln = jn.join(", ");
    }
    let parts = Re.substring(0, Oe + 1).split(`
`);
    let Zu = X + parts.length;
    let Di = parts[parts.length - 1].length + 1;
    let parts2 = Re.substring(0, _e).split(`
`);
    let od = X + parts2.length;
    let Sb = parts2[parts2.length - 1].length + 1;
    return {
      title: "Convert to named port connections (.port(signal)) (RMM-2.2)",
      kind: "quickfix",
      isPreferred: true,
      diagnosticCode: m.code,
      edits: [
        {
          startLine: Zu,
          startColumn: Di,
          endLine: od,
          endColumn: Sb,
          newText: Ln,
        },
      ],
    };
  }
  extractSpanText(d, m) {
    let line = m.start.line;
    let line2 = m.end.line;
    if (line === line2) {
      return (d[line - 1] ?? "").substring(m.start.column - 1, m.end.column - 1);
    }
    let C = [];
    for (let M = line; M <= line2; M++) {
      let v = d[M - 1] ?? "";
      if (M === line) {
        C.push(v.substring(m.start.column - 1));
      } else {
        if (M === line2) {
          C.push(v.substring(0, m.end.column - 1));
        } else {
          C.push(v);
        }
      }
    }
    return C.join(`
`);
  }
  findPortListParens(d) {
    let m = 0;
    for (; m < d.length;) {
      let index = d.indexOf("#", m);
      if (index === -1) {
        break;
      }
      let M = index + 1;
      for (; M < d.length && /\s/.test(d[M]);) {
        M++;
      }
      if (d[M] === "(") {
        let matchingParen = this.findMatchingParen(d, M);
        if (matchingParen === -1) {
          break;
        }
        m = matchingParen + 1;
      } else {
        m = index + 1;
      }
    }
    let index2 = d.indexOf("(", m);
    if (index2 === -1) {
      return;
    }
    let matchingParen2 = this.findMatchingParen(d, index2);
    if (matchingParen2 !== -1) {
      return {
        openParenIdx: index2,
        closeParenIdx: matchingParen2,
      };
    }
  }
  findMatchingParen(d, m) {
    let k = 0;
    for (let E = m; E < d.length; E++) {
      let C = d[E];
      if (C === "(") {
        k++;
      } else if (C === ")" && (k--, k === 0)) {
        return E;
      }
    }
    return -1;
  }
  splitPositionalArgs(d) {
    let m = [];
    let k = "";
    let E = 0;
    for (let C = 0; C < d.length; C++) {
      let M = d[C];
      if (M === "(" || M === "[" || M === "{") {
        E++;
        k += M;
      } else {
        if (M === ")" || M === "]" || M === "}") {
          E--;
          k += M;
        } else {
          if (M === "," && E === 0) {
            if (k.trim().length > 0) {
              m.push(k.trim());
            }
            k = "";
          } else {
            k += M;
          }
        }
      }
    }
    if (k.trim().length > 0) {
      m.push(k.trim());
    }
    return m;
  }
}
