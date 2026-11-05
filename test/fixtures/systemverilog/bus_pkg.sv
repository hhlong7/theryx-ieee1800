package bus_pkg;
  parameter int unsigned ADDR_W = 16;
  localparam int DATA_W = 2 * 16;

  typedef logic [ADDR_W-1:0] addr_t;

  typedef enum logic [1:0] {
    OP_IDLE,
    OP_READ = 2'd2,
    OP_WRITE
  } op_e;

  typedef struct packed {
    op_e               op;
    addr_t             addr;
    logic [DATA_W-1:0] data;
    logic              valid;
  } req_t;

  function automatic logic is_write(input req_t r);
    return r.valid && r.op == OP_WRITE;
  endfunction
endpackage
