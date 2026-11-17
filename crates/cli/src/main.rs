use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use ebl_firmware::FirmwareInfo;

#[derive(Parser)]
#[command(name = "ebl", version, about = "ESP32 board lab tools")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Inspect an ESP32 firmware image without executing it.
    Inspect {
        /// Path to an application or merged flash image.
        path: PathBuf,
        /// Print machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("ebl: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.command {
        Command::Inspect { path, json } => {
            let bytes = std::fs::read(&path)
                .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
            let info = ebl_firmware::inspect(&bytes)?;
            let mut out = io::BufWriter::new(io::stdout().lock());
            if json {
                serde_json::to_writer_pretty(&mut out, &info)?;
                writeln!(out)?;
            } else {
                print_info(&mut out, &info)?;
            }
            out.flush()?;
        }
    }
    Ok(())
}

fn print_info(out: &mut impl Write, info: &FirmwareInfo) -> io::Result<()> {
    // Use the library's serialized chip spelling so human and JSON output agree.
    let chip = serde_json::to_value(info.chip).map_err(io::Error::other)?;
    writeln!(out, "Chip:       {}", chip.as_str().unwrap_or("unknown"))?;
    match info.flash_size {
        Some(size) => writeln!(out, "Flash size: {} bytes ({} MiB)", size, size / 1_048_576)?,
        None => writeln!(out, "Flash size: unknown")?,
    }
    writeln!(
        out,
        "Merged:     {}",
        if info.merged { "yes" } else { "no" }
    )?;
    writeln!(out, "\nPartition table:")?;
    if info.partitions.is_empty() {
        writeln!(out, "  No partition table found.")?;
    } else {
        writeln!(
            out,
            "  {:<18} {:<12} {:<16} {:>10} {:>10}",
            "Name", "Type", "Subtype", "Offset", "Size"
        )?;
        for part in &info.partitions {
            writeln!(
                out,
                "  {:<18} {:<12} {:<16} {:#010x} {:#010x}",
                part.name, part.type_, part.subtype, part.offset, part.size
            )?;
        }
    }
    writeln!(out, "\nApplication:")?;
    if let Some(app) = &info.app {
        writeln!(
            out,
            "  Project: {}\n  Version: {}\n  ESP-IDF: {}\n  Built:   {} {}",
            app.project_name, app.version, app.idf_ver, app.date, app.time
        )?;
    } else {
        writeln!(out, "  No application description found.")?;
    }
    writeln!(out, "\nHints:")?;
    if info.hints.is_empty() {
        writeln!(out, "  No firmware fingerprints found.")?;
    } else {
        for hint in &info.hints {
            writeln!(out, "  - {hint}")?;
        }
    }
    Ok(())
}
