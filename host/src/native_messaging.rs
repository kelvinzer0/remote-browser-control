use anyhow::{Context, Result};
use serde_json::Value;
use std::io::{self, Read, Write};

const MAX_MESSAGE_SIZE: u32 = 1024 * 1024; // 1MB Chrome limit

/// Read a Native Message from reader (4-byte LE length + JSON payload)
pub fn read_message(reader: &mut impl Read) -> Result<Option<Value>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e).context("reading message length"),
    }

    let len = u32::from_le_bytes(len_buf);
    if len > MAX_MESSAGE_SIZE {
        anyhow::bail!("message too large: {} bytes (max {})", len, MAX_MESSAGE_SIZE);
    }

    let mut payload = vec![0u8; len as usize];
    reader
        .read_exact(&mut payload)
        .context("reading message payload")?;

    let msg: Value = serde_json::from_slice(&payload).context("parsing message JSON")?;
    Ok(Some(msg))
}

/// Write a Native Message to writer (4-byte LE length + JSON payload)
pub fn write_message(writer: &mut impl Write, msg: &Value) -> Result<()> {
    let payload = serde_json::to_vec(msg).context("serializing message")?;
    let len = payload.len() as u32;

    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;

    Ok(())
}
