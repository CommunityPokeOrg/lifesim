import { useState } from "react";
import corePack from "./packs/core.json";
import type { EventPack } from "./engine/types";
import GameScreen from "./game/GameScreen";
import EditorScreen from "./editor/EditorScreen";

export default function App() {
  const [screen, setScreen] = useState<"play" | "editor">("play");
  const [packs, setPacks] = useState<EventPack[]>([corePack as EventPack]);

  const addPack = (pack: EventPack) =>
    setPacks((prev) => {
      const rest = prev.filter((p) => p.id !== pack.id);
      return [...rest, pack];
    });

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">lifesim</span>
        <nav>
          <button
            className={screen === "play" ? "tab active" : "tab"}
            onClick={() => setScreen("play")}
          >
            Play
          </button>
          <button
            className={screen === "editor" ? "tab active" : "tab"}
            onClick={() => setScreen("editor")}
          >
            Mod Editor
          </button>
        </nav>
        <span className="packs-hint">
          {packs.length} pack{packs.length === 1 ? "" : "s"} loaded
        </span>
      </header>
      {screen === "play" ? (
        <GameScreen packs={packs} onImportPack={addPack} />
      ) : (
        <EditorScreen onPlaytest={(pack) => { addPack(pack); setScreen("play"); }} />
      )}
    </div>
  );
}
