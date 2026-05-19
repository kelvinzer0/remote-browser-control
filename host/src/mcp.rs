use serde_json::{json, Value};

use crate::tools;

/// Handle a synchronous MCP request (initialize, tools/list, ping)
/// Returns Some(response) if handled, None if this needs async handling (tools/call)
pub fn handle_sync(request: &Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let _params = request.get("params").cloned().unwrap_or(json!({}));

    match method {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "rbc-host", "version": "3.0.0" }
            }
        })),

        "notifications/initialized" => None, // No response for notifications

        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "tools": tools::tool_definitions() }
        })),

        "ping" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {}
        })),

        "tools/call" => None, // Needs async handling in main.rs

        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", method)
            }
        })),
    }
}

/// Extract tool call info from a tools/call request
pub fn extract_tool_call(request: &Value) -> Option<(Value, String, Value)> {
    let id = request.get("id").cloned()?;
    let params = request.get("params")?;
    let name = params.get("name")?.as_str()?.to_string();
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
    Some((id, name, arguments))
}

/// Build a successful MCP tool result response
pub fn tool_result_response(id: &Value, content: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": content }]
        }
    })
}

/// Build an error MCP tool result response
pub fn tool_error_response(id: &Value, error: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": format!("Error: {}", error) }],
            "isError": true
        }
    })
}
