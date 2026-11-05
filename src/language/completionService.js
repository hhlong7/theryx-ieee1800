import { spanContains } from "./nodeLocator.js";
import { DIRECTIVES, KEYWORD_SET } from "../parser/lexer.js";

export class CompletionService {
  getCompletions(d, m, k, E, C, M, v, R) {
    let J = [];
    let X = d.modules.find((Q) => spanContains(k, E, Q.span));
    if (X) {
      let instanceAtPosition = this.findInstanceAtPosition(X, k, E, M, R);
      if (instanceAtPosition) {
        let endsWith = M.trimEnd().endsWith(".");
        let connectedPortNames = this.getConnectedPortNames(
          R,
          instanceAtPosition.startLine,
          k,
          instanceAtPosition.endLine,
        );
        return this.getPortCompletions(
          instanceAtPosition.moduleName,
          C,
          d,
          v,
          endsWith,
          connectedPortNames,
          M,
        );
      }
    }
    if (X) {
      let moduleScope = m.getModuleScope(X.name);
      if (moduleScope) {
        for (let Re of moduleScope.getSymbols()) {
          J.push(this.symbolToCompletion(Re));
        }
      }
      J.push(...this.getLanguageSnippets());
      J.push(...this.getIeee1364Keywords());
      if (d.isSystemVerilog) {
        J.push(...this.getIeee1800Completions());
      }
      J.push(...this.getCompilerDirectives());
    } else {
      J.push({
        label: "module",
        kind: "snippet",
        detail: "Verilog module declaration (IEEE 1364)",
        documentation: "Snippet to declare a new module with ports per IEEE 1364 standard",
        insertText: `module \${1:module_name} (
    input  wire \${2:clk},
    input  wire \${3:rst_n}
);

    \${0}

endmodule
`,
        isSnippet: true,
        sortText: "00_module",
      });
      J.push(...this.getCompilerDirectives());
    }
    for (let moduleItem of d.modules) {
      if (!X || moduleItem.name !== X.name) {
        J.push({
          label: moduleItem.name,
          kind: "module",
          detail: `Verilog module (local: ${moduleItem.name})`,
          documentation: `Instantiate module '${moduleItem.name}'`,
          sortText: `50_${moduleItem.name}`,
        });
      }
    }
    return J;
  }
  findInstanceAtPosition(d, m, k, E, C) {
    for (let item of d.items) {
      if (item.kind === "InstanceDeclaration" && spanContains(m, k, item.span)) {
        return {
          moduleName: item.moduleName,
          instanceName: item.instanceName,
          startLine: item.span.start.line,
          endLine: item.span.end.line,
        };
      }
    }
    let match = E.match(
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:#\s*\(.*?\)\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
    );
    if (match) {
      return {
        moduleName: match[1],
        instanceName: match[2],
        startLine: m,
      };
    }
    if (C && C.length > 0) {
      let v = m - 1;
      for (let R = v; R >= 0 && R >= v - 30; R--) {
        let J = C[R];
        if (R < v && J.includes(");")) {
          break;
        }
        let match2 = J.match(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:#\s*\(.*?\)\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
        );
        if (match2) {
          let Q = match2[1];
          if (
            ![
              "always",
              "initial",
              "if",
              "case",
              "casex",
              "casez",
              "function",
              "task",
              "module",
            ].includes(Q)
          ) {
            return {
              moduleName: Q,
              instanceName: match2[2],
              startLine: R + 1,
            };
          }
        }
      }
    }
  }
  getConnectedPortNames(d, m = 1, k = 1, E) {
    let C = new Set();
    if (!d || d.length === 0) {
      return C;
    }
    let maxValue = Math.max(0, m - 1);
    let v = E ? Math.min(d.length - 1, E - 1) : Math.min(d.length - 1, k + 10);
    for (let R = maxValue; R <= v; R++) {
      let J = d[R];
      let matchAll = J.matchAll(/\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(|$)/g);
      for (let matchAllItem of matchAll) {
        if (matchAllItem[1]) {
          if (R === k - 1 && J.trimEnd().endsWith(".")) {
            continue;
          }
          C.add(matchAllItem[1]);
        }
      }
    }
    return C;
  }
  getPortCompletions(d, m, k, E, C = false, M = new Set(), v = "") {
    let R = [];
    let J = k.modules.find((te) => te.name === d);
    if (!J && E) {
      let te = E.resolveModule(d, m);
      if (te.found && te.moduleNode) {
        J = te.moduleNode;
      }
    }
    if (!J) {
      return R;
    }
    let X = [];
    for (let item of J.items) {
      if (item.kind === "PortDeclaration") {
        let Oe = "";
        if (
          item.range &&
          item.range.msb.kind === "NumberLiteral" &&
          item.range.lsb.kind === "NumberLiteral"
        ) {
          Oe = `[${item.range.msb.value}:${item.range.lsb.value}] `;
        }
        for (let identifier of item.identifiers) {
          X.push({
            name: identifier.name,
            direction: item.direction,
            width: Oe,
          });
        }
      }
    }
    let Q = X.filter((te) => !M.has(te.name));
    let match = v.match(/^(\s*)/);
    let Qe = match ? match[1] : "    ";
    let le = Qe.endsWith("    ") ? Qe : Qe + "    ";
    if (X.length > 0) {
      if (M.size === 0) {
        let te = X.map(
          (Oe, _e) =>
            `${(_e === 0 && C) || _e === 0 ? "" : le}${_e === 0 && C ? "" : "."}${Oe.name}(\${${_e + 1}:${Oe.name}})`,
        ).join(`,
`);
        R.push({
          label: "Auto-connect all ports (RMM-2.2)",
          filterText: C ? ".autoconnect" : "autoconnect",
          kind: "snippet",
          detail: `Connect all ${X.length} ports of ${d} (RMM-2.2)`,
          documentation: `Automatically inserts complete list of named ports per RMM-2.2:
.port(signal)`,
          insertText: te,
          isSnippet: true,
          sortText: "00_rmm22_all",
        });
      } else if (Q.length > 0) {
        let te = Q.map(
          (Oe, _e) =>
            `${(_e === 0 && C) || _e === 0 ? "" : le}${_e === 0 && C ? "" : "."}${Oe.name}(\${${_e + 1}:${Oe.name}})`,
        ).join(`,
`);
        R.push({
          label: "Auto-connect remaining ports (RMM-2.2)",
          filterText: C ? ".autoconnect" : "autoconnect",
          kind: "snippet",
          detail: `Connect remaining ${Q.length} ports of ${d} (RMM-2.2)`,
          documentation: `Inserts port mapping with remaining ports (${Q.map((Oe) => Oe.name).join(", ")}).`,
          insertText: te,
          isSnippet: true,
          sortText: "00_rmm22_remaining",
        });
      }
    }
    Q.forEach((te, Oe) => {
      let _e = C ? `${te.name}(\${1:${te.name}})` : `.${te.name}(\${1:${te.name}})`;
      R.push({
        label: `.${te.name}`,
        filterText: `.${te.name}`,
        kind: "property",
        detail: `(${te.direction}) ${te.width}.${te.name}`,
        documentation: `Connect port '${te.name}' of module '${d}' (IEEE 1364)`,
        insertText: _e,
        isSnippet: true,
        sortText: `01_${String(Oe).padStart(2, "0")}_${te.name}`,
      });
    });
    return R;
  }
  symbolToCompletion(d) {
    let m = d.bitWidth > 1 ? `[${d.msb}:${d.lsb}] ` : "";
    let k = "";
    let E = "variable";
    switch (d.kind) {
      case "port":
        k = `(${d.direction}) ${d.netType ?? "wire"} ${m}${d.name}`;
        break;
      case "wire":
        k = `(wire) ${m}${d.name}`;
        break;
      case "reg":
        k = `(reg) ${m}${d.name}`;
        break;
      case "parameter":
        k = `parameter ${d.name}${d.value !== undefined ? " = " + d.value : ""}`;
        E = "constant";
        break;
      case "instance":
        k = `instance ${d.name}`;
        E = "property";
        break;
      default:
        k = d.name;
    }
    return {
      label: d.name,
      kind: E,
      detail: k,
      documentation: `Declared at line ${d.span.start.line}`,
      insertText: d.name,
      sortText: `10_${d.name}`,
    };
  }
  getLanguageSnippets() {
    return [
      {
        label: "always (combinational)",
        kind: "snippet",
        detail: "always @(*) combinational (IEEE 1364-2001)",
        documentation: "IEEE 1364 standard combinational procedural block",
        insertText: `always @(*) begin
    \${0}
end`,
        isSnippet: true,
        sortText: "20_always_comb",
        requiresKeywords: ["always", "begin", "end"],
      },
      {
        label: "always (sequential with reset)",
        kind: "snippet",
        detail: "always @(posedge clk or negedge rst_n)",
        documentation: "Sequential procedural block with active-low async reset (IEEE 1364)",
        insertText:
          "always @(posedge ${1:clk} or negedge ${2:rst_n}) begin\n    if (!${2:rst_n}) begin\n        ${3:q} <= ${4:0};\n    end else begin\n        ${3:q} <= ${5:d};\n    end\nend",
        isSnippet: true,
        sortText: "21_always_seq",
        requiresKeywords: ["always", "begin", "end", "if", "else", "posedge", "negedge"],
      },
      {
        label: "assign",
        kind: "snippet",
        detail: "assign continuous assignment (IEEE 1364)",
        documentation: "Continuous assignment for nets/wires",
        insertText: "assign ${1:net} = ${2:expression};",
        isSnippet: true,
        sortText: "22_assign",
        requiresKeywords: ["assign"],
      },
      {
        label: "case",
        kind: "snippet",
        detail: "case ... default ... endcase",
        documentation: "Case statement with default clause per STARC-2.3.1",
        insertText:
          "case (${1:sel})\n    ${2:2'b00}: ${3:out} = ${4:in0};\n    default: ${3:out} = ${5:in1};\nendcase",
        isSnippet: true,
        sortText: "23_case",
        requiresKeywords: ["case", "endcase", "default"],
      },
      {
        label: "if-else",
        kind: "snippet",
        detail: "if (...) begin ... end else begin ... end",
        documentation: "Full conditional structure preventing latch inference",
        insertText: `if (\${1:condition}) begin
    \${2}
end else begin
    \${3}
end`,
        isSnippet: true,
        sortText: "24_if_else",
        requiresKeywords: ["if", "else", "begin", "end"],
      },
      {
        label: "parameter",
        kind: "snippet",
        detail: "parameter NAME = VALUE;",
        documentation: "Configurable module parameter declaration (IEEE 1364)",
        insertText: "parameter ${1:WIDTH} = ${2:8};",
        isSnippet: true,
        sortText: "25_parameter",
        requiresKeywords: ["parameter"],
      },
      {
        label: "localparam",
        kind: "snippet",
        detail: "localparam NAME = VALUE;",
        documentation: "Local constant not modifiable externally (IEEE 1364-2001)",
        insertText: "localparam ${1:STATE_IDLE} = ${2:2'b00};",
        isSnippet: true,
        sortText: "26_localparam",
        requiresKeywords: ["localparam"],
      },
      {
        label: "function",
        kind: "snippet",
        detail: "function [WIDTH-1:0] func_name;",
        documentation: "Pure combinational function (IEEE 1364)",
        insertText:
          "function [${1:7}:0] ${2:func_name};\n    input [${3:7}:0] ${4:a};\n    begin\n        ${2:func_name} = ${5:a};\n    end\nendfunction",
        isSnippet: true,
        sortText: "27_function",
        requiresKeywords: ["function"],
      },
      {
        label: "task",
        kind: "snippet",
        detail: "task task_name;",
        documentation: "Procedural task (IEEE 1364)",
        insertText: `task \${1:task_name};
    input \${2:in};
    output \${3:out};
    begin
        \${0}
    end
endtask`,
        isSnippet: true,
        sortText: "28_task",
        requiresKeywords: ["task"],
      },
      {
        label: "generate for",
        kind: "snippet",
        detail: "generate ... for ... endgenerate",
        documentation: "Iterative generate loop with genvar (IEEE 1364-2001)",
        insertText:
          "genvar ${1:i};\ngenerate\n    for (${1:i} = 0; ${1:i} < ${2:N}; ${1:i} = ${1:i} + 1) begin : ${3:gen_block}\n        ${0}\n    end\nendgenerate",
        isSnippet: true,
        sortText: "29_generate",
        requiresKeywords: ["genvar", "generate"],
      },
      {
        label: "initial",
        kind: "snippet",
        detail: "initial begin ... end",
        documentation: "Initialization block for testbench or simulation (IEEE 1364)",
        insertText: `initial begin
    \${0}
end`,
        isSnippet: true,
        sortText: "30_initial",
        requiresKeywords: ["initial"],
      },
    ].filter((m) => (m.requiresKeywords ?? []).every((k) => KEYWORD_SET.has(k)));
  }
  getIeee1800Completions() {
    let snippets = [
      ["always_ff", "Sequential block", "always_ff @(posedge ${1:clk}) begin\n\t$0\nend"],
      ["always_comb", "Combinational block", "always_comb begin\n\t$0\nend"],
      ["always_latch", "Latch block", "always_latch begin\n\t$0\nend"],
      ["typedef struct", "Packed struct type", "typedef struct packed {\n\t${1:logic} ${2:field};\n} ${3:name_t};"],
      ["typedef enum", "Enumerated type", "typedef enum logic [${1:1}:0] {\n\t${2:IDLE}\n} ${3:state_e};"],
      ["package", "Package", "package ${1:name}_pkg;\n\t$0\nendpackage"],
      ["interface", "Interface", "interface ${1:name}_if (input logic clk);\n\t$0\nendinterface"],
      ["modport", "Interface modport", "modport ${1:name} (${2:input a});"],
      ["import", "Package import", "import ${1:name}_pkg::*;"],
      ["foreach", "Array loop", "foreach (${1:array}[${2:i}]) begin\n\t$0\nend"],
    ].map(([label, detail, insertText]) => ({
      label,
      filterText: label,
      kind: "snippet",
      detail: `${detail} (IEEE 1800)`,
      insertText,
      isSnippet: true,
      sortText: `35_${label}`,
    }));
    let keywords = [
      "logic", "bit", "byte", "int", "longint", "shortint", "string", "void", "enum", "struct", "union", "packed",
      "unique", "unique0", "priority", "inside", "return", "break", "continue", "do", "automatic", "static", "const",
      "ref", "var", "class", "endclass", "program", "endprogram", "endpackage", "endinterface", "final", "assert",
      "assume", "cover", "property", "endproperty", "sequence", "endsequence", "covergroup", "endgroup", "clocking",
      "endclocking", "fork", "join_any", "join_none", "timeunit", "timeprecision",
    ].map((label) => ({
      label,
      filterText: label,
      kind: "keyword",
      detail: "IEEE 1800 keyword",
      insertText: label,
      isSnippet: false,
      sortText: `50_${label}`,
    }));
    return [...snippets, ...keywords];
  }
  getIeee1364Keywords() {
    return [
      {
        label: "always",
        detail: "Procedural always block (IEEE 1364)",
      },
      {
        label: "assign",
        detail: "Continuous assignment for nets (IEEE 1364)",
      },
      {
        label: "begin",
        detail: "Delimited sequential block start",
      },
      {
        label: "end",
        detail: "Delimited sequential block end",
      },
      {
        label: "case",
        detail: "Multiway decision branch",
      },
      {
        label: "casex",
        detail: "Case statement with don't-care on x and z",
      },
      {
        label: "casez",
        detail: "Case statement with don't-care on z and ?",
      },
      {
        label: "endcase",
        detail: "End of case statement block",
      },
      {
        label: "default",
        detail: "Default clause of case statement",
      },
      {
        label: "if",
        detail: "Conditional if branch",
      },
      {
        label: "else",
        detail: "Alternative else branch",
      },
      {
        label: "wire",
        detail: "Physical net / connection type (IEEE 1364)",
      },
      {
        label: "reg",
        detail: "Procedural storage variable reg (IEEE 1364)",
      },
      {
        label: "integer",
        detail: "32-bit signed integer type (IEEE 1364)",
      },
      {
        label: "time",
        detail: "64-bit simulation time type (IEEE 1364)",
      },
      {
        label: "real",
        detail: "Double-precision floating point type",
      },
      {
        label: "input",
        detail: "Input port declaration",
      },
      {
        label: "output",
        detail: "Output port declaration",
      },
      {
        label: "inout",
        detail: "Bidirectional port declaration",
      },
      {
        label: "parameter",
        detail: "Configurable module parameter",
      },
      {
        label: "localparam",
        detail: "Local constant not modifiable externally",
      },
      {
        label: "posedge",
        detail: "Rising edge sensitivity qualifier",
      },
      {
        label: "negedge",
        detail: "Falling edge sensitivity qualifier",
      },
      {
        label: "generate",
        detail: "Generate block start (IEEE 1364-2001)",
      },
      {
        label: "endgenerate",
        detail: "Generate block end",
      },
      {
        label: "genvar",
        detail: "Loop variable for generate construct",
      },
      {
        label: "for",
        detail: "For loop statement",
      },
      {
        label: "while",
        detail: "While loop statement",
      },
      {
        label: "repeat",
        detail: "Fixed repetition loop",
      },
      {
        label: "forever",
        detail: "Infinite simulation loop",
      },
      {
        label: "function",
        detail: "Function definition start",
      },
      {
        label: "endfunction",
        detail: "Function definition end",
      },
      {
        label: "task",
        detail: "Task definition start",
      },
      {
        label: "endtask",
        detail: "Task definition end",
      },
      {
        label: "signed",
        detail: "Signed modifier (IEEE 1364-2001)",
      },
      {
        label: "unsigned",
        detail: "Unsigned modifier (IEEE 1364-2001)",
      },
    ]
      .filter((m) => KEYWORD_SET.has(m.label))
      .map((m) => ({
        label: m.label,
        kind: "keyword",
        detail: m.detail,
        documentation: `Standard Verilog IEEE 1364 keyword: '${m.label}'`,
        insertText: m.label,
        sortText: `40_${m.label}`,
      }));
  }
  getCompilerDirectives() {
    return [
      {
        label: "`timescale",
        detail: "Time scale and precision directive",
        insertText: "`timescale ${1:1ns} / ${2:1ps}",
      },
      {
        label: "`define",
        detail: "Text substitution macro",
        insertText: "`define ${1:MACRO} ${2:value}",
      },
      {
        label: "`ifdef",
        detail: "Conditional compilation if defined",
        insertText: "`ifdef ${1:MACRO}\n    ${0}\n`endif",
      },
      {
        label: "`ifndef",
        detail: "Conditional compilation if not defined",
        insertText: "`ifndef ${1:MACRO}\n    ${0}\n`endif",
      },
      {
        label: "`else",
        detail: "Alternative conditional compilation branch",
      },
      {
        label: "`endif",
        detail: "End of preprocessor conditional block",
      },
      {
        label: "`include",
        detail: "Header file inclusion",
        insertText: '`include "${1:header.vh}"',
      },
      {
        label: "`default_nettype",
        detail: "Default undeclared net type",
        insertText: "`default_nettype ${1|none,wire|}",
      },
    ]
      .filter((m) => DIRECTIVES.has(m.label))
      .map((m) => ({
        label: m.label,
        filterText: m.label,
        kind: "snippet",
        detail: m.detail,
        documentation: `Standard IEEE 1364 compiler directive: ${m.label}`,
        insertText: m.insertText ?? m.label,
        isSnippet: m.insertText !== undefined,
        sortText: `45_${m.label.replace("`", "")}`,
      }));
  }
}
