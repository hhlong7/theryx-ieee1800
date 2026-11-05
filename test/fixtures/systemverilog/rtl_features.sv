`define WIDTH_OF(x) $bits(x)
`define ASSIGN_ZERO(sig) \
  sig = '0;

module rtl_features
  import bus_pkg::*;
#(
  parameter int DEPTH = 4,
  parameter type payload_t = logic [7:0]
) (
  input  logic              clk,
  input  logic              rst_n,
  input  req_t              req_i,
  input  payload_t          payload_i,
  output logic [DATA_W-1:0] data_o,
  output logic              is_write_o,
  output logic [1:0]        count_o
);

  typedef struct packed {
    logic [3:0] tag;
    logic       hit;
  } entry_t;

  entry_t                  entries [DEPTH];
  entry_t                  next_entry;
  logic [DEPTH-1:0][7:0]   packed_bytes;
  logic [$clog2(DEPTH)-1:0] index_q;
  op_e                     op_q;
  int                      total;

  assign is_write_o = is_write(req_i);
  assign data_o     = req_i.valid ? req_i.data : '0;
  assign count_o    = index_q[1:0];

  always_comb begin
    logic [3:0] temp;
    temp = req_i.addr[3:0];
    next_entry = '{tag: temp, hit: 1'b1};
    unique case (req_i.op)
      OP_READ, OP_WRITE: next_entry.hit = req_i.valid;
      default:           `ASSIGN_ZERO(next_entry)
    endcase
    if (req_i.addr inside {16'h0, 16'h10, [16'h20:16'h2f]}) begin
      next_entry.tag = 4'hF;
    end
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      index_q <= '0;
      op_q    <= OP_IDLE;
      total   <= 0;
      foreach (entries[i]) entries[i] <= '{default: '0};
    end else begin
      index_q <= index_q + 1'b1;
      op_q    <= bus_pkg::OP_READ;
      total   <= total + `WIDTH_OF(index_q);
      entries[index_q] <= next_entry;
      packed_bytes[index_q] <= payload_i[7:0];
    end
  end

  for (genvar g = 0; g < 2; g++) begin : g_buffers
    logic local_q;
    always_ff @(posedge clk) local_q <= req_i.valid;
  end

  if (DEPTH > 2) begin : g_large
    logic extra_q;
    always_ff @(posedge clk) extra_q <= rst_n;
  end else begin : g_small
    logic other_q;
    always_ff @(posedge clk) other_q <= rst_n;
  end

endmodule
