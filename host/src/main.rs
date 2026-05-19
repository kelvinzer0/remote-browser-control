mod bridge;
mod mcp;
mod native_messaging;
mod tools;

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

const MCP_PORT: u16 = 3000;

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.contains(&"--stdio".to_string()) {
        return run_stdio_proxy();
    }

    eprintln!("[rbc-host] starting v3.0.0 — NM host + MCP server");

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    // Thread 1: NM stdin reader — reads extension messages, resolves oneshot channels
    let pending_nm = pending.clone();
    let nm_handle = std::thread::spawn(move || {
        bridge::stdin_reader(pending_nm);
    });

    // Thread 2: TCP listener for MCP clients
    let pending_mcp = pending.clone();
    let mcp_handle = std::thread::spawn(move || {
        let listener = match TcpListener::bind(format!("127.0.0.1:{}", MCP_PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[mcp] failed to bind port {}: {} — MCP server disabled, NM still active", MCP_PORT, e);
                // Keep thread alive so NM can still work
                std::thread::park();
                return;
            }
        };
        eprintln!("[mcp] listening on tcp://127.0.0.1:{}", MCP_PORT);

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let pending = pending_mcp.clone();
                    std::thread::spawn(move || {
                        handle_mcp_client(stream, pending);
                    });
                }
                Err(e) => {
                    eprintln!("[mcp] accept error: {}", e);
                }
            }
        }
    });

    let _ = nm_handle.join();
    let _ = mcp_handle.join();

    Ok(())
}

/// stdio MCP proxy mode — for OpenClaude / Claude Code
/// Reads JSON-RPC from stdin, forwards to TCP MCP server on port 3000
fn run_stdio_proxy() -> anyhow::Result<()> {
    eprintln!("[rbc-host] stdio proxy mode → tcp://127.0.0.1:{}", MCP_PORT);

    let stream = TcpStream::connect(format!("127.0.0.1:{}", MCP_PORT))?;
    let server_read = stream.try_clone()?;
    let mut server_write = stream;

    // Thread: read responses from TCP server, write to stdout
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(server_read);
        let stdout = std::io::stdout();
        let mut stdout = stdout.lock();
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    if writeln!(stdout, "{}", l).is_err() { break; }
                    let _ = stdout.flush();
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    });

    // Main thread: read JSON-RPC from stdin, forward to TCP server
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(l) if !l.trim().is_empty() => {
                if writeln!(server_write, "{}", l).is_err() { break; }
                let _ = server_write.flush();
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }

    Ok(())
}

/// Handle a single MCP client connection over TCP
fn handle_mcp_client(stream: TcpStream, pending: PendingMap) {
    let addr = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    eprintln!("[mcp] client connected: {}", addr);

    let reader = std::io::BufReader::new(stream.try_clone().unwrap());
    let mut writer = stream;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[mcp] invalid JSON from {}: {}", addr, e);
                continue;
            }
        };

        // Skip notifications (no id)
        if request.get("id").is_none() {
            continue;
        }

        // Try sync handling first (initialize, tools/list, ping)
        if let Some(response) = mcp::handle_sync(&request) {
            write_response(&mut writer, &response);
            continue;
        }

        // Handle tools/call — send to extension, await result
        if let Some((id, tool_name, arguments)) = mcp::extract_tool_call(&request) {
            let (action, params) = tools::map_tool_to_action(&tool_name, &arguments);
            let cmd_id = format!("mcp_{}", rand_id());

            let result_rx = match bridge::send_command(&pending, &cmd_id, &action, &params) {
                Ok(rx) => rx,
                Err(e) => {
                    write_response(&mut writer, &mcp::tool_error_response(&id, &e.to_string()));
                    continue;
                }
            };

            // Wait for result with timeout
            let result = std::thread::scope(|_| {
                tokio::runtime::Runtime::new().ok().and_then(|rt| {
                    rt.block_on(async {
                        tokio::time::timeout(std::time::Duration::from_secs(30), result_rx)
                            .await
                            .ok()
                    })
                })
            });

            let response = match result {
                Some(Ok(ext_result)) => {
                    let ok = ext_result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                    if ok {
                        let data = ext_result.get("data");
                        let text = match data {
                            Some(d) if d.is_string() => d.as_str().unwrap_or("").to_string(),
                            Some(d) => serde_json::to_string_pretty(d).unwrap_or_default(),
                            None => "OK".to_string(),
                        };
                        mcp::tool_result_response(&id, &text)
                    } else {
                        let error = ext_result
                            .get("error")
                            .and_then(|e| e.as_str())
                            .unwrap_or("unknown error");
                        mcp::tool_error_response(&id, error)
                    }
                }
                Some(Err(_)) => mcp::tool_error_response(&id, "request cancelled"),
                None => {
                    bridge::resolve_pending_error(&pending, &cmd_id, "timeout");
                    mcp::tool_error_response(&id, "timeout waiting for extension")
                }
            };

            write_response(&mut writer, &response);
        }
    }

    eprintln!("[mcp] client disconnected: {}", addr);
}

fn write_response(writer: &mut impl Write, response: &Value) {
    if let Ok(text) = serde_json::to_string(response) {
        let _ = writeln!(writer, "{}", text);
        let _ = writer.flush();
    }
}

fn rand_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}_{:x}", ts, seq)
}
