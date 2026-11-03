// Tier 2: accepted without false errors and shown in the outline, but not drawn in schematics.
class packet;
  rand bit [7:0] payload;
  constraint c_small { payload < 8'd100; }

  function new(bit [7:0] value = 8'd0);
    payload = value;
  endfunction

  virtual function int size();
    return $bits(payload);
  endfunction
endclass

program automatic stimulus (input logic clk);
  initial begin
    packet p = new(8'd4);
    @(posedge clk);
    if (!p.randomize()) $error("randomize failed");
    $display("%0d", p.size());
  end
endprogram

module recognized_only (input logic clk, input logic req, input logic ack);
  logic [3:0] count;

  default clocking cb @(posedge clk);
  endclocking

  property req_gets_ack;
    @(posedge clk) req |-> ##[1:3] ack;
  endproperty

  assert property (req_gets_ack) else $error("no ack");

  covergroup cg @(posedge clk);
    cp_count : coverpoint count { bins low = {0, 1}; bins high = {[2:15]}; }
  endgroup

  cg cg_inst = new();

  initial begin
    int queue [$];
    queue.push_back(1);
    assert (queue.size() == 1) else $fatal(1, "bad size");
    fork
      #1 count = 4'd1;
      #2 count = 4'd2;
    join_none
    wait fork;
    do begin
      count++;
    end while (count < 4'd8);
    void'(queue.pop_front());
  end
endmodule
