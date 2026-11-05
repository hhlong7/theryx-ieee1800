// Sequential logic, async reset, memories, submodule instance, generate and functions.
`timescale 1ns/1ps
`define DEPTH 16
module fifo (clk, rst_n, push, pop, din, dout, full, empty);
    parameter WIDTH = 8;
    input clk, rst_n, push, pop;
    input [WIDTH-1:0] din;
    output [WIDTH-1:0] dout;
    output full, empty;
    reg [WIDTH-1:0] mem [0:`DEPTH-1];
    reg [3:0] wp, rp;
    reg [4:0] count;
    integer i;
    genvar g;
    wire [3:0] wp_next;
    function [3:0] inc;
        input [3:0] v;
        begin inc = v + 1; end
    endfunction
    task clear; begin wp <= 0; rp <= 0; count <= 0; end endtask
    assign wp_next = inc(wp);
    assign full = count == 16;
    assign empty = count == 0;
    assign dout = mem[rp];
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            wp <= 0; rp <= 0; count <= 5'd0;
        end else begin
            if (push && !full) begin mem[wp] <= din; wp <= wp_next; end
            if (pop && !empty) rp <= rp + 1;
            case ({push, pop})
                2'b10: count <= count + 1;
                2'b01: count <= count - 1;
            endcase
        end
    end
    generate
        for (g = 0; g < 2; g = g + 1) begin : gen_buf
            wire t;
            assign t = wp[g];
        end
        if (WIDTH > 4) begin : big
            wire x = 1'b1;
        end else begin
            wire x = 1'b0;
        end
    endgenerate
endmodule
