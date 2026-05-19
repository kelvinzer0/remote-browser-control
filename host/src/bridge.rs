use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use crate::native_messaging;

pub type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// Resolve a pending oneshot with an error result
pub fn resolve_pending_error(pending: &PendingMap, cmd_id: &str, error: &str) {
    let sender = {
        let mut map = pending.lock().unwrap();
        map.remove(cmd_id)
    };
    if let Some(tx) = sender {
        let _ = tx.send(json!({
            "commandId": cmd_id,
            "ok": false,
            "error": error
        }));
    }
}

/// Read NM messages from stdin (extension → host), dispatch results to oneshot channels
pub fn stdin_reader(pending: PendingMap) {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();

    loop {
        match native_messaging::read_message(&mut reader) {
            Ok(Some(msg)) => {
                handle_ext_message(msg, &pending);
            }
            Ok(None) => {
                eprintln!("[nm] stdin closed (extension disconnected)");
                break;
            }
            Err(e) => {
                eprintln!("[nm] read error: {}", e);
                break;
            }
        }
    }
}

/// Write a NM message to stdout (host → extension)
pub fn write_to_ext(msg: &Value) -> anyhow::Result<()> {
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();
    native_messaging::write_message(&mut writer, msg)
}

/// Send a command to the extension and wait for result
pub fn send_command(
    pending: &PendingMap,
    cmd_id: &str,
    action: &str,
    params: &Value,
) -> anyhow::Result<oneshot::Receiver<Value>> {
    let (result_tx, result_rx) = oneshot::channel::<Value>();
    {
        let mut map = pending.lock().unwrap();
        map.insert(cmd_id.to_string(), result_tx);
    }

    let msg = json!({
        "type": "command",
        "commandId": cmd_id,
        "action": action,
        "params": params
    });

    write_to_ext(&msg)?;
    Ok(result_rx)
}

/// Handle a message from the extension
fn handle_ext_message(msg: Value, pending: &PendingMap) {
    let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");

    match msg_type {
        "result" => {
            if let Some(cmd_id) = msg.get("commandId").and_then(|c| c.as_str()) {
                let sender = {
                    let mut map = pending.lock().unwrap();
                    map.remove(cmd_id)
                };
                if let Some(tx) = sender {
                    let _ = tx.send(msg);
                }
            }
        }
        "status" => {
            eprintln!(
                "[nm] ext status: {} | url: {}",
                msg.get("status").and_then(|s| s.as_str()).unwrap_or(""),
                msg.get("url").and_then(|u| u.as_str()).unwrap_or("")
            );
        }
        "heartbeat" => {}
        _ => {
            eprintln!("[nm] unknown ext message type: {}", msg_type);
        }
    }
}
