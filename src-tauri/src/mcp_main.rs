use dev_command_center_lib::mcp::DevCommandCenterMcp;

#[tokio::main]
async fn main() {
    match DevCommandCenterMcp::open_default().and_then(|server| Ok(server)) {
        Ok(server) => {
            if let Err(error) = server.serve_stdio().await {
                eprintln!("Dev Command Center MCP error: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("Dev Command Center MCP startup error: {error}");
            std::process::exit(1);
        }
    }
}
