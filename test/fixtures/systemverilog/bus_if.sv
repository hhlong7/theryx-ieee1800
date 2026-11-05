interface bus_if #(parameter int WIDTH = 8) (input logic clk);
  logic             valid;
  logic             ready;
  logic [WIDTH-1:0] data;

  modport master (input clk, input ready, output valid, output data);
  modport slave  (input clk, input valid, input data, output ready);
endinterface
