// Combinational ALU: case, ternary, shifts, reductions, part selects, concatenation.
module alu #(parameter WIDTH = 8, parameter OPS = 4'd6) (
    input  wire [WIDTH-1:0] a,
    input  wire [WIDTH-1:0] b,
    input  wire [2:0]       op,
    output reg  [WIDTH-1:0] y,
    output wire             zero,
    output wire             parity,
    output wire [WIDTH:0]   sum
);
    localparam ADD = 3'b000, SUB = 3'b001;
    wire [WIDTH-1:0] masked = a & ~b;
    assign sum = {1'b0, a} + {1'b0, b};
    assign zero = ~|y;
    assign parity = ^y;
    always @(*) begin
        case (op)
            ADD: y = a + b;
            SUB: y = a - b;
            3'b010: y = a << b[2:0];
            3'b011: y = a >>> 1;
            3'b100: y = masked;
            3'b101: y = (a < b) ? {WIDTH{1'b1}} : {WIDTH{1'b0}};
            3'b110: y = a * b;
            default: y = 0;
        endcase
    end
endmodule
