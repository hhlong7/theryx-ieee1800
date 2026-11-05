// Instances: named, positional, parameter override, gates, latch inference, lint violations.
module sub_a (input a, input b, output y);
    and u1 (y, a, b);
    wire n;
    not (n, a);
    xor #1 u2 (m, n, b);
endmodule
module sub_b #(parameter W = 2) (input [W-1:0] d, output reg [W-1:0] q, input en);
    always @(en or d) if (en) q = d;
endmodule
module top (input clk, input reset, input [1:0] sel, input [3:0] data, output [3:0] out, output reg mixed, inout pad);
    wire y1, y2;
    wire [1:0] q;
    reg r;
    sub_a a0 (.a(sel[0]), .b(sel[1]), .y(y1));
    sub_a a1 (sel[0], sel[1], y2);
    sub_b #(.W(2)) b0 (.d(data[1:0]), .q(q), .en());
    missing m0 (.x(y1));
    assign {out[3:2], out[1:0]} = data;
    assign pad = r ? 1'bz : 1'b0;
    always @(posedge clk) begin
        mixed = y1;
        r <= y2 & mixed;
    end
    always @(*) case (sel) 2'b00: r = 1; endcase
    initial begin
        #5 $display("hello %d", y1);
        repeat (2) @(posedge clk);
        $finish;
    end
endmodule
