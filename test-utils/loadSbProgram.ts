import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";

// Utility function to load the Switchboard program
export async function loadSbProgram(provider: anchor.Provider): Promise<anchor.Program> {
    console.log("Loading Switchboard program...");
    const sbProgramId = await sb.getProgramId(provider.connection);
    console.log("Switchboard program ID:", sbProgramId.toString());
  
    console.log("Fetching program IDL...");
    const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
  
    if (!sbIdl) {
      console.error("Failed to fetch Switchboard IDL");
      throw new Error("IDL fetch failed");
    }
  
    console.log("Creating program instance...");
    const sbProgram = new anchor.Program(sbIdl, provider);
    return sbProgram;
  }