use serde_json::{json, Value};

/// All MCP tool definitions with JSON Schema parameters
pub fn tool_definitions() -> Vec<Value> {
    vec![
        tool("navigate", "Navigate to a URL", json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "URL to navigate to" }
            },
            "required": ["url"]
        })),
        tool("go_back", "Go back in browser history", json!({
            "type": "object",
            "properties": {}
        })),
        tool("go_forward", "Go forward in browser history", json!({
            "type": "object",
            "properties": {}
        })),
        tool("reload", "Reload the current page", json!({
            "type": "object",
            "properties": {}
        })),
        tool("click", "Click an element on the page", json!({
            "type": "object",
            "properties": {
                "text": { "type": "string", "description": "Click by visible text content" },
                "selector": { "type": "string", "description": "Click by CSS selector" },
                "xpath": { "type": "string", "description": "Click by XPath expression" },
                "id": { "type": "string", "description": "Click by element ID" },
                "name": { "type": "string", "description": "Click by element name attribute" },
                "index": { "type": "integer", "description": "Click n-th clickable element" }
            }
        })),
        tool("type_text", "Type text into an input field", json!({
            "type": "object",
            "properties": {
                "value": { "type": "string", "description": "Text to type" },
                "selector": { "type": "string", "description": "CSS selector of input" },
                "id": { "type": "string", "description": "Element ID of input" },
                "name": { "type": "string", "description": "Name attribute of input" },
                "placeholder": { "type": "string", "description": "Placeholder text to match" },
                "label": { "type": "string", "description": "Label text to match" }
            },
            "required": ["value"]
        })),
        tool("clear_input", "Clear an input field", json!({
            "type": "object",
            "properties": {
                "selector": { "type": "string", "description": "CSS selector of input to clear" }
            }
        })),
        tool("select_option", "Select an option in a dropdown", json!({
            "type": "object",
            "properties": {
                "value": { "type": "string", "description": "Option value or text to select" },
                "selector": { "type": "string", "description": "CSS selector of select element" },
                "name": { "type": "string", "description": "Name attribute of select" },
                "id": { "type": "string", "description": "Element ID of select" }
            },
            "required": ["value"]
        })),
        tool("check", "Check or uncheck a checkbox/radio", json!({
            "type": "object",
            "properties": {
                "checked": { "type": "boolean", "description": "Whether to check (true) or uncheck (false)", "default": true },
                "selector": { "type": "string", "description": "CSS selector" },
                "name": { "type": "string", "description": "Name attribute" },
                "label": { "type": "string", "description": "Label text to match" }
            }
        })),
        tool("scroll", "Scroll the page", json!({
            "type": "object",
            "properties": {
                "to": { "type": "string", "enum": ["top", "bottom"], "description": "Scroll to top or bottom" },
                "y": { "type": "integer", "description": "Scroll by N pixels (default 500)" },
                "selector": { "type": "string", "description": "Scroll element into view" },
                "text": { "type": "string", "description": "Scroll element with text into view" }
            }
        })),
        tool("get_text", "Get text content of the page or element", json!({
            "type": "object",
            "properties": {
                "selector": { "type": "string", "description": "CSS selector (omit for full page)" }
            }
        })),
        tool("get_html", "Get HTML of the page or element", json!({
            "type": "object",
            "properties": {
                "selector": { "type": "string", "description": "CSS selector (omit for full page)" }
            }
        })),
        tool("get_links", "Get all links on the page", json!({
            "type": "object",
            "properties": {
                "filter": { "type": "string", "description": "Filter links containing this text" }
            }
        })),
        tool("get_inputs", "Get all form inputs on the page", json!({
            "type": "object",
            "properties": {}
        })),
        tool("get_attr", "Get an attribute value from an element", json!({
            "type": "object",
            "properties": {
                "selector": { "type": "string", "description": "CSS selector" },
                "attr": { "type": "string", "description": "Attribute name" }
            },
            "required": ["selector", "attr"]
        })),
        tool("get_value", "Get the value of an input element", json!({
            "type": "object",
            "properties": {
                "selector": { "type": "string", "description": "CSS selector" }
            },
            "required": ["selector"]
        })),
        tool("wait", "Wait for a specified duration", json!({
            "type": "object",
            "properties": {
                "ms": { "type": "integer", "description": "Milliseconds to wait (default 1000)" }
            }
        })),
        tool("wait_for", "Wait for an element to appear", json!({
            "type": "object",
            "properties": {
                "selector": { "type": "string", "description": "CSS selector to wait for" },
                "timeout": { "type": "integer", "description": "Timeout in ms (default 10000)" }
            },
            "required": ["selector"]
        })),
        tool("eval_js", "Execute JavaScript in the page", json!({
            "type": "object",
            "properties": {
                "code": { "type": "string", "description": "JavaScript code to execute" }
            },
            "required": ["code"]
        })),
        tool("screenshot", "Take a screenshot of the visible tab", json!({
            "type": "object",
            "properties": {}
        })),
        tool("get_tabs", "List all open browser tabs", json!({
            "type": "object",
            "properties": {}
        })),
        tool("new_tab", "Open a new browser tab", json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "URL to open (default: about:blank)" }
            }
        })),
        tool("close_tab", "Close a browser tab", json!({
            "type": "object",
            "properties": {
                "tab_id": { "type": "integer", "description": "Tab ID to close (default: active tab)" }
            }
        })),
        tool("switch_tab", "Switch to a different browser tab", json!({
            "type": "object",
            "properties": {
                "tab_id": { "type": "integer", "description": "Tab ID to switch to" }
            },
            "required": ["tab_id"]
        })),
        tool("clear_local_storage", "Clear localStorage for the current page", json!({
            "type": "object",
            "properties": {}
        })),
        tool("clear_session_storage", "Clear sessionStorage for the current page", json!({
            "type": "object",
            "properties": {}
        })),
        tool("get_cookies", "Get cookies in Netscape format", json!({
            "type": "object",
            "properties": {
                "domain": { "type": "string", "description": "Filter by domain" }
            }
        })),
        tool("save_cookies", "Save cookies to a file", json!({
            "type": "object",
            "properties": {
                "domain": { "type": "string", "description": "Filter by domain" },
                "filename": { "type": "string", "description": "Output filename" }
            }
        })),
        tool("ping", "Ping the browser extension", json!({
            "type": "object",
            "properties": {}
        })),
        tool("get_status", "Get browser extension status", json!({
            "type": "object",
            "properties": {}
        })),
    ]
}

/// Map MCP tool name to extension action + params
pub fn map_tool_to_action(name: &str, args: &Value) -> (String, Value) {
    let params = args.clone();
    match name {
        "navigate" => ("navigate".into(), params),
        "go_back" => ("back".into(), json!({})),
        "go_forward" => ("forward".into(), json!({})),
        "reload" => ("reload".into(), json!({})),
        "click" => ("click".into(), params),
        "type_text" => ("type".into(), params),
        "clear_input" => ("clear".into(), params),
        "select_option" => ("select".into(), params),
        "check" => ("check".into(), params),
        "scroll" => ("scroll".into(), params),
        "get_text" => ("getText".into(), params),
        "get_html" => ("getHTML".into(), params),
        "get_links" => ("getLinks".into(), params),
        "get_inputs" => ("getInputs".into(), json!({})),
        "get_attr" => ("getAttr".into(), params),
        "get_value" => ("getValue".into(), params),
        "wait" => ("wait".into(), params),
        "wait_for" => ("waitFor".into(), params),
        "eval_js" => ("eval".into(), params),
        "screenshot" => ("screenshot".into(), json!({})),
        "get_tabs" => ("getTabs".into(), json!({})),
        "new_tab" => ("newTab".into(), params),
        "close_tab" => ("closeTab".into(), params),
        "switch_tab" => ("switchTab".into(), params),
        "clear_local_storage" => ("clearLocalStorage".into(), json!({})),
        "clear_session_storage" => ("clearSessionStorage".into(), json!({})),
        "get_cookies" => ("cookiejar".into(), params),
        "save_cookies" => ("cookiefile".into(), params),
        "ping" => ("ping".into(), json!({})),
        "get_status" => ("status".into(), json!({})),
        _ => ("unknown".into(), json!({})),
    }
}

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema
    })
}
