import { describe, it, expect } from "vitest";
import * as path from "path";
import { DocumentCache } from "../../src/analysis/documentCache.js";
import { ModuleResolver } from "../../src/workspace/moduleResolver.js";
import { Elaborator } from "../../src/schematic/elaborator.js";

const fixtures = path.resolve(__dirname, "../fixtures/systemverilog");

// Elaborates `top` from the given source and returns helpers for asking about the drawn graph.
function schematic(text, top) {
  let resolver = new ModuleResolver();
  resolver.setSearchRoots([fixtures]);
  let entry = new DocumentCache(resolver).analyze(`file://${path.join(fixtures, "schematic-inline.sv")}`, 1, text);
  let module = entry.ast.modules.find((candidate) => candidate.name === top);
  let graph = new Elaborator(resolver).elaborateModule(module, entry.symbolTable);
  let node = (id) => graph.nodes.find((candidate) => candidate.id === id);
  let byLabel = (label) => graph.nodes.filter((candidate) => candidate.label === label);
  let driver = (target, pin) => {
    let wire = graph.connections.find((candidate) => candidate.targetNodeId === target.id && candidate.targetPinId === pin);
    return wire && node(wire.sourceNodeId);
  };
  let output = (name) => driver(graph.nodes.find((candidate) => candidate.type === "PORT_OUT" && candidate.label === name), "in");
  let ofType = (type) => graph.nodes.filter((candidate) => candidate.type === type);
  return { graph, node, byLabel, driver, output, ofType };
}

describe("schematic elaboration", () => {
  it("nonblocking assignments read the register outputs (a pipeline, not a wire)", () => {
    let g = schematic(
      `module p (input logic clk, d, output logic q);
         logic s1, s2;
         always_ff @(posedge clk) begin s1 <= d; s2 <= s1; q <= s2; end
       endmodule`,
      "p",
    );
    expect(g.ofType("DFF")).toHaveLength(3);
    let q = g.byLabel("DFF (q)")[0];
    expect(g.driver(q, "d").label).toBe("DFF (s2)");
    expect(g.driver(g.byLabel("DFF (s2)")[0], "d").label).toBe("DFF (s1)");
  });

  it("unrolls procedural for loops and keeps bit order", () => {
    let g = schematic(
      `module r (input logic [3:0] a, output logic [3:0] y);
         always_comb for (int i = 0; i < 4; i++) y[i] = a[3 - i];
       endmodule`,
      "r",
    );
    let concat = g.output("y");
    expect(concat.type).toBe("CONCAT");
    // in0 is the most significant bit: y[3] = a[0]
    expect(g.driver(concat, "in0").label).toBe("[0]");
    expect(g.driver(concat, "in3").label).toBe("[3]");
    expect(g.ofType("UNSUPPORTED")).toHaveLength(0);
  });

  it("unrolls generate loops with properly nested instance names", () => {
    let g = schematic(
      `module leaf (input logic a, output logic y); assign y = ~a; endmodule
       module grid (input logic [3:0] a, output logic [3:0] y);
         for (genvar i = 0; i < 2; i++) begin : row
           for (genvar j = 0; j < 2; j++) begin : col
             leaf u (.a(a[i*2+j]), .y(y[i*2+j]));
           end
         end
       endmodule`,
      "grid",
    );
    let names = g.ofType("SUBMODULE").map((instance) => instance.attributes.instanceName).sort();
    expect(names).toEqual(["row[0].col[0].u", "row[0].col[1].u", "row[1].col[0].u", "row[1].col[1].u"]);
  });

  it("draws unpacked arrays element by element, including whole-array copies", () => {
    let g = schematic(
      `module arr (input logic clk, input logic [7:0] d [3], output logic [7:0] q [3]);
         always_ff @(posedge clk) q <= d;
       endmodule`,
      "arr",
    );
    expect(g.ofType("DFF").map((dff) => dff.label).sort()).toEqual(["DFF (q[0])", "DFF (q[1])", "DFF (q[2])"]);
    expect(g.ofType("UNSUPPORTED")).toHaveLength(0);
  });

  it("draws a RAM written with a run-time address as a memory block", () => {
    let g = schematic(
      `module ram (input logic clk, we, input logic [9:0] wa, ra, input logic [31:0] wd, output logic [31:0] rd);
         logic [31:0] mem [1024];
         always_ff @(posedge clk) begin
           if (we) mem[wa] <= wd;
           rd <= mem[ra];
         end
       endmodule`,
      "ram",
    );
    let [memory] = g.graph.nodes.filter((candidate) => candidate.attributes?.memory);
    expect(memory.label).toBe("memory mem [1024x32]");
    expect(g.driver(memory, "we0").label).toBe("we");
    expect(g.driver(memory, "waddr0").label).toBe("wa");
    expect(g.driver(memory, "wdata0").label).toBe("wd");
    expect(g.driver(memory, "clk0").label).toBe("clk");
    expect(g.driver(g.byLabel("DFF (rd)")[0], "d").id).toBe(memory.id);
    expect(g.ofType("UNSUPPORTED")).toHaveLength(0);
  });

  it("keeps the width of a size cast on a literal under a shift", () => {
    let g = schematic(
      `module sh (input logic [4:0] s, output logic [49:0] y);
         assign y = 50'(1) << s;
       endmodule`,
      "sh",
    );
    expect(g.output("y").bitWidth).toBe(50);
  });

  it("inlines module and package functions", () => {
    let g = schematic(
      `package fp; function automatic logic [1:0] inc(input logic [1:0] v); return v + 1; endfunction endpackage
       module fn (input logic [1:0] a, output logic [1:0] y, z);
         function automatic logic [1:0] neg(input logic [1:0] v); return ~v; endfunction
         assign y = fp::inc(a);
         assign z = neg(a);
       endmodule`,
      "fn",
    );
    expect(g.output("y").type).toBe("ADD");
    expect(g.output("z").type).toBe("GATE_NOT");
  });

  it("matches casez items on their non-wildcard bits", () => {
    let g = schematic(
      `module cz (input logic [3:0] s, output logic y);
         always_comb casez (s) 4'b1???: y = 1; default: y = 0; endcase
       endmodule`,
      "cz",
    );
    expect(g.ofType("UNSUPPORTED")).toHaveLength(0);
    expect(g.byLabel("4'b1000").length).toBeGreaterThan(0);
  });

  it("expands instance arrays and slices their buses", () => {
    let g = schematic(
      `module leaf (input logic a, output logic y); assign y = ~a; endmodule
       module ia (input logic [3:0] a, output logic [3:0] y); leaf u [3:0] (.a(a), .y(y)); endmodule`,
      "ia",
    );
    expect(g.ofType("SUBMODULE")).toHaveLength(4);
    expect(g.output("y").type).toBe("CONCAT");
  });

  it("joins continuous assigns to slices into one concatenation", () => {
    let g = schematic(
      `module sl (input logic [7:0] a, output logic [7:0] y);
         for (genvar k = 0; k < 4; k++) begin : g assign y[k*2 +: 2] = ~a[k*2 +: 2]; end
       endmodule`,
      "sl",
    );
    expect(g.ofType("CONCAT")).toHaveLength(1);
    expect(g.ofType("GATE_NOT")).toHaveLength(4);
  });

  it("does not rename a net when it is copied into another variable", () => {
    let g = schematic(
      `module al (input logic clk, d, output logic q, r);
         always_ff @(posedge clk) q <= d;
         assign r = q;
       endmodule`,
      "al",
    );
    let dff = g.byLabel("DFF (q)")[0];
    let wire = g.graph.connections.find((candidate) => candidate.sourceNodeId === dff.id && candidate.netName);
    expect(wire.netName).toBe("q");
  });
  it("draws members of type-parameter structs as taps and a struct block", () => {
    let g = schematic(
      `module st #(parameter type req_t = logic) (input req_t [1:0] r_i, input req_t q_i, output logic v_o, output req_t o);
         assign v_o = r_i[1].aw_valid;
         always_comb begin o = '0; o.aw_valid = q_i.w_valid; end
       endmodule`,
      "st",
    );
    expect(g.ofType("UNSUPPORTED")).toHaveLength(0);
    expect(g.output("v_o").label).toBe(".aw_valid");
    let struct = g.output("o");
    expect(struct.label).toBe("struct o");
    expect(g.driver(struct, "m_aw_valid").label).toBe(".w_valid");
    expect(g.driver(struct, "base").type).toBe("CONSTANT");
  });

  it("draws logical operators on vectors, unary minus and run-time indexed writes", () => {
    let g = schematic(
      `module lg (input logic [3:0] a, b, input logic [1:0] k, output logic y, output logic [3:0] n, q);
         assign y = a && !b;
         assign n = -a;
         always_comb begin q = a; q[k] = 1'b0; end
       endmodule`,
      "lg",
    );
    expect(g.ofType("UNSUPPORTED")).toHaveLength(0);
    expect(g.ofType("REDUCTION_OR").length).toBeGreaterThan(0);
    expect(g.output("n").type).toBe("SUB");
  });

  it("maps division, modulo and power to their own cells", () => {
    let g = schematic(
      `module dm (input logic [7:0] a, b, output logic [7:0] x, y, z);
         assign x = a / b; assign y = a % b; assign z = a ** 2;
       endmodule`,
      "dm",
    );
    expect([g.output("x").type, g.output("y").type, g.output("z").type]).toEqual(["DIV", "MOD", "POW"]);
  });
});
