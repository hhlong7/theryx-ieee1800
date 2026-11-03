module producer (bus_if.master bus, input logic enable);
  assign bus.valid = enable;
  assign bus.data  = 8'hA5;
endmodule

module consumer (bus_if.slave port, output logic [7:0] seen);
  assign port.ready = 1'b1;
  always_ff @(posedge port.clk) if (port.valid) seen <= port.data;
endmodule

module adder (input logic [3:0] a, input logic [3:0] b, output logic [4:0] sum);
  assign sum = a + b;
endmodule

module hierarchy (input logic clk, input logic enable, output logic [7:0] seen, output logic [4:0] sum);
  bus_if link (clk);
  logic [3:0] a;
  logic [3:0] b;

  assign a = 4'd1;
  assign b = 4'd2;

  producer u_producer (.bus(link), .enable);
  consumer u_consumer (.port(link), .seen(seen));
  adder    u_adder (.*);
endmodule
